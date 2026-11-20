import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };

// fileURLToPath on the string: jsdom replaces the global URL class.
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const components = readdirSync(join(packageDir, 'src/components'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/** Runs the given bin and returns the output. */
function runBin(name: 'vite' | 'tsc', args: string[]) {
  const script =
    name === 'vite'
      ? join(packageDir, 'node_modules/vite/bin/vite.js')
      : join(packageDir, 'node_modules/typescript/bin/tsc');
  return execFileSync(process.execPath, [script, ...args], { cwd: packageDir });
}

describe('package.json', () => {
  it('exposes only the components/*, icons, router-search, fonts.css and styles.css subpaths (no root export)', () => {
    expect(Object.keys(manifest.exports).toSorted()).toEqual([
      './components/*',
      './fonts.css',
      './icons',
      './router-search',
      './styles.css',
    ]);
    expect(manifest.exports['./components/*']).toEqual({
      types: './dist/components/*/index.d.ts',
      import: './dist/components/*/index.js',
    });
    expect(manifest.exports['./icons']).toEqual({
      types: './dist/icons/index.d.ts',
      import: './dist/icons/index.js',
    });
    expect(manifest.exports['./router-search']).toEqual({
      types: './dist/router-search/index.d.ts',
      import: './dist/router-search/index.js',
    });
    expect(manifest.exports['./fonts.css']).toBe('./src/fonts.css');
    expect(manifest.exports['./styles.css']).toBe('./dist/styles.css');
  });

  it('marks CSS as side-effectful', () => {
    expect(manifest.sideEffects).toEqual(['**/*.css']);
  });

  it('peers react, depends on the design system, Font Awesome Free, react-aria and TanStack Table via the catalog', () => {
    expect(manifest.peerDependencies).toEqual({
      react: 'catalog:',
      'react-dom': 'catalog:',
    });
    expect(manifest.dependencies).toEqual({
      '@bcgov/bc-sans': 'catalog:',
      '@bcgov/design-system-react-components': 'catalog:',
      '@fortawesome/fontawesome-svg-core': 'catalog:',
      '@fortawesome/free-regular-svg-icons': 'catalog:',
      '@fortawesome/free-solid-svg-icons': 'catalog:',
      '@fortawesome/react-fontawesome': 'catalog:',
      '@tanstack/react-table': 'catalog:',
      'react-aria-components': 'catalog:',
    });
    expect(Object.keys(manifest.dependencies).some((name) => name.includes('pro-'))).toBe(false);
  });
});

describe('fonts.css', () => {
  it('imports the BC Sans font-face declarations, which resolve from this package', () => {
    const css = readFileSync(join(packageDir, 'src/fonts.css'), 'utf8');
    expect(css).toMatch(/@import ['"]@bcgov\/bc-sans\/css\/BC_Sans\.css['"];/);
    const resolved = createRequire(join(packageDir, 'package.json')).resolve('@bcgov/bc-sans/css/BC_Sans.css');
    expect(readFileSync(resolved, 'utf8')).toContain('BC Sans');
  });
});

describe('build output', () => {
  let outDir = '';

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'design-system-build-'));
    runBin('vite', ['build', '--outDir', outDir, '--logLevel', 'error']);
    runBin('tsc', ['-p', 'tsconfig.build.json', '--outDir', outDir]);
  }, 120_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('emits a JS entry and declaration for every component folder, icons and router-search', () => {
    expect(components.length).toBeGreaterThan(0);
    for (const entry of [...components.map((name) => `components/${name}`), 'icons', 'router-search']) {
      expect(existsSync(join(outDir, entry, 'index.js'))).toBe(true);
      expect(existsSync(join(outDir, entry, 'index.d.ts'))).toBe(true);
    }
  });

  it('keeps upstream packages external instead of bundling them', () => {
    const button = readFileSync(join(outDir, 'components/button/index.js'), 'utf8');
    expect(button).toContain('@bcgov/design-system-react-components');
    expect(statSync(join(outDir, 'components/button/index.js')).size).toBeLessThan(2_000);
    const iconsJs = readFileSync(join(outDir, 'icons/index.js'), 'utf8');
    expect(iconsJs).toContain('@fortawesome/free-solid-svg-icons');
    expect(statSync(join(outDir, 'icons/index.js')).size).toBeLessThan(2_000);
    // The DataTable shares the app's react-aria copy (KTD7) instead of bundling its own.
    const dataTable = readFileSync(join(outDir, 'components/data-table/index.js'), 'utf8');
    expect(dataTable).toMatch(/from ['"]react-aria-components['"]/);
    expect(dataTable).toMatch(/from ['"]@tanstack\/react-table['"]/);
    expect(dataTable).not.toContain('useSelectableCollection');
  });

  it('extracts custom component CSS into styles.css and keeps it out of the JS', () => {
    const css = readFileSync(join(outDir, 'styles.css'), 'utf8');
    expect(css).toMatch(/_avatar_\w+/);
    expect(css).toContain('--surface-color-primary-default');
    expect(readFileSync(join(outDir, 'components/nav-link/index.js'), 'utf8')).not.toContain(
      '--surface-color-primary-default',
    );
  });

  it('declares the custom component props', () => {
    expect(readFileSync(join(outDir, 'components/avatar/index.d.ts'), 'utf8')).toMatch(/AvatarProps/);
    expect(readFileSync(join(outDir, 'components/nav-link/index.d.ts'), 'utf8')).toMatch(/NavLinkProps/);
    expect(readFileSync(join(outDir, 'components/data-table/index.d.ts'), 'utf8')).toMatch(/DataTableProps/);
  });

  it('emits Props type aliases in the component declarations', () => {
    const dts = readFileSync(join(outDir, 'components/button/index.d.ts'), 'utf8');
    expect(dts).toMatch(/export type ButtonProps\b/);
    expect(dts).not.toMatch(/Svg/);
  });

  it('does not emit test files', () => {
    expect(existsSync(join(outDir, 'package-exports.test.d.ts'))).toBe(false);
    expect(existsSync(join(outDir, 'components/components.test.d.ts'))).toBe(false);
    expect(existsSync(join(outDir, 'router-search/router-search.test.d.ts'))).toBe(false);
  });
});
