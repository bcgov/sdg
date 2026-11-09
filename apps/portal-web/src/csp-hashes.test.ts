// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// react-aria (bundled into @bcgov/design-system-react-components) prepends a few <style> elements with fixed
// text. The production edge CSP allows exactly those by hash (caddy/Caddyfile), so this fails when an upgrade
// changes one, before the strict CSP blocks it in a browser.
const designSystem = fileURLToPath(new URL('../../../packages/design-system/package.json', import.meta.url));
const bcgovEntry = createRequire(designSystem).resolve('@bcgov/design-system-react-components');
const bcgovModule = readFileSync(bcgovEntry.replace(/cjs[/\\]index\.cjs$/, 'esm/index.js'), 'utf8');
const caddy = (name: string) => readFileSync(fileURLToPath(new URL(`../caddy/${name}`, import.meta.url)), 'utf8');
const caddyfile = caddy('Caddyfile');
// style-src in the shared security_headers snippet; its second argument is the per-site extra sources.
const styleSrc = caddy('common.caddy').match(/Content-Security-Policy ".*?style-src ([^;]*);/)?.[1] ?? '';

/** The text of every `style.textContent = `...`.trim()` in the module, with its constants filled in. */
function fixedStyleTexts(source: string): string[] {
  const constants = new Map(
    [...source.matchAll(/const (\$[\w$]+) = '([^']*)';/g)].map(([, name, value]) => [name, value]),
  );
  return [...source.matchAll(/style\.textContent = `([\s\S]*?)`\.trim\(\)/g)].map(([, text]) =>
    text!
      .replace(/\$\{([\w$]+)\}/g, (_, name: string) => {
        const value = constants.get(name);
        if (value === undefined) throw new Error(`Unknown constant ${name} in a react-aria <style>`);
        return value;
      })
      .trim(),
  );
}

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

describe('production CSP style hashes', () => {
  const styles = fixedStyleTexts(bcgovModule);
  const productionHeaders = caddyfile.match(/^\s*import security_headers (.*)$/m)?.[1] ?? '';
  const allowed = productionHeaders.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? [];

  it('finds the fixed react-aria styles', () => {
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.some((text) => text.includes('touch-action'))).toBe(true);
    expect(styles.filter((text) => text.includes('${'))).toEqual([]);
  });

  it('allows exactly the hash of each fixed style', () => {
    expect(allowed.toSorted()).toEqual([...new Set(styles.map(sha256))].toSorted());
  });

  it('keeps unsafe-inline out of the production style-src', () => {
    expect(styleSrc).toContain('{args[1]}');
    expect(styleSrc.replace('{args[1]}', productionHeaders)).not.toContain('unsafe-inline');
  });
});
