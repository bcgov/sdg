import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };

// fileURLToPath on the string: jsdom replaces the global URL class.
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bare-specifier imports (`from "lit"`, `import "lit/…"`) left in a built module. */
const bareImports = (code: string): string[] =>
  Array.from(code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"'./][^"']*)["']/gu), (match) => match[1] ?? '');

/** A built module plus the shared chunks it imports (`./x.js`, `../x.js`), concatenated. */
function withChunks(dir: string, file: string): string {
  const code = readFileSync(join(dir, file), 'utf8');
  const chunks = Array.from(code.matchAll(/from\s*["'](\.{1,2}\/[^"']+\.js)["']/gu), (match) =>
    readFileSync(join(dir, dirname(file), match[1] ?? ''), 'utf8'),
  );
  return [code, ...chunks].join('\n');
}

describe('@repo/sdg-header package', () => {
  describe('package.json', () => {
    it('exports "." and "./react" (types + import) and "./cdn"', () => {
      expect(manifest.exports).toEqual({
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './react': { types: './dist/react/index.d.ts', import: './dist/react/index.js' },
        './cdn': './dist/cdn/sdg-header.js',
      });
      expect(manifest.files).toEqual(['dist']);
      expect(manifest.type).toBe('module');
    });

    it('depends on lit and Font Awesome solid icons via the catalog', () => {
      expect(manifest.dependencies).toEqual({ '@fortawesome/free-solid-svg-icons': 'catalog:', lit: 'catalog:' });
      // React is only needed by the ./react entry, so it is an optional peer.
      expect(manifest.peerDependencies).toEqual({ react: 'catalog:' });
      expect(manifest.peerDependenciesMeta).toEqual({ react: { optional: true } });
      expect(Object.keys(manifest.devDependencies)).toContain('@bcgov/design-tokens');
    });

    it('marks the registering entries as side-effectful', () => {
      expect(manifest.sideEffects).toEqual(['./dist/index.js', './dist/react/index.js', './dist/cdn/sdg-header.js']);
      expect(manifest.scripts.build).toBe('vite build && vite build --mode cdn && tsc -p tsconfig.build.json');
    });
  });

  describe('build output', () => {
    let outDir = '';

    beforeAll(() => {
      outDir = mkdtempSync(join(tmpdir(), 'sdg-header-build-'));
      const bin = (name: string): string => join(packageDir, 'node_modules/.bin', name);
      // Vitest sets NODE_ENV=test, which makes Vite bundle Lit's dev build; build as `pnpm build` does.
      const env = { ...process.env, NODE_ENV: 'production' };
      const vite = (...args: string[]) =>
        execFileSync(bin('vite'), ['build', '--logLevel', 'error', ...args], { cwd: packageDir, env });
      vite('--outDir', outDir);
      vite('--mode', 'cdn', '--outDir', join(outDir, 'cdn'));
      execFileSync(bin('tsc'), ['-p', 'tsconfig.build.json', '--outDir', outDir], { cwd: packageDir });
    }, 120_000);

    afterAll(() => {
      if (outDir) rmSync(outDir, { recursive: true, force: true });
    });

    it('emits dist/index.js with lit left external and registers the element', () => {
      const entry = readFileSync(join(outDir, 'index.js'), 'utf8');
      const code = withChunks(outDir, 'index.js');
      expect(entry).toMatch(/^defineSdgHeader\(\);$/mu);
      expect(code).toContain('customElements.define("sdg-header"');
      expect(bareImports(code)).toEqual(expect.arrayContaining(['lit', '@fortawesome/free-solid-svg-icons']));
      expect(code).not.toContain('class ReactiveElement');
      // The React entry adds nothing to the core.
      expect(bareImports(code).filter((id) => id.startsWith('react'))).toEqual([]);
    });

    it('emits dist/react/index.js that registers the element through the shared core chunk', () => {
      const entry = readFileSync(join(outDir, 'react/index.js'), 'utf8');
      expect(bareImports(entry)).toEqual(['react']);
      // Registration is an explicit call, so no bundler can drop it as an unused side-effect import.
      expect(entry).toMatch(/^defineSdgHeader\(\);$/mu);
      // The element and Lit come from the chunk the core entry also uses: nothing is duplicated.
      expect(entry).not.toContain('customElements.define');
      expect(withChunks(outDir, 'react/index.js')).toContain('customElements.define("sdg-header"');
      expect(statSync(join(outDir, 'react/index.js')).size).toBeLessThan(3_000);
      expect(readFileSync(join(outDir, 'react/index.d.ts'), 'utf8')).toMatch(/SdgHeaderProps/u);
    });

    it('emits a self-contained dist/cdn/sdg-header.js with no bare imports', () => {
      const code = readFileSync(join(outDir, 'cdn/sdg-header.js'), 'utf8');
      expect(bareImports(code)).toEqual([]);
      expect(code).toContain('sdg-header');
      // Lit's own names contain "react" (ReactiveElement); check for the module specifier instead.
      expect(code).not.toMatch(/["']react(?:-dom)?(?:\/[\w-]+)?["']/u);
      // Minified: no source comments or bundler region markers (Lit's css`` text keeps its own line breaks).
      expect(code).not.toContain('//#region');
      expect(code).not.toContain('Registering once lets');
      expect(code).not.toContain('Lit is in dev mode');
      expect(statSync(join(outDir, 'cdn/sdg-header.js')).size).toBeLessThan(50_000);
    });

    it('emits dist/index.d.ts', () => {
      const dts = readFileSync(join(outDir, 'index.d.ts'), 'utf8');
      expect(dts).toMatch(/export \{ SdgHeader \}/u);
      expect(dts).toContain("'sdg-header': SdgHeader");
      expect(existsSync(join(outDir, 'sdg-header.d.ts'))).toBe(true);
      expect(existsSync(join(outDir, 'sdg-header.test.d.ts'))).toBe(false);
      expect(existsSync(join(outDir, 'test-support'))).toBe(false);
    });
  });
});
