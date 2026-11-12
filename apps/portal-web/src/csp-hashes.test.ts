// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// react-aria (bundled into @bcgov/design-system-react-components) prepends a few <style> elements with fixed
// text. The production edge CSP allows exactly those by hash on every site in caddy/Caddyfile, so this fails when an
// upgrade changes one, or a site's security_headers line misses one, before the strict CSP blocks it in a browser.
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
  const expected = [...new Set(styles.map(sha256))].toSorted();
  // One per host the edge serves (portal, console, gateway): each site's second argument is its extra style-src.
  const siteHeaders = [...caddyfile.matchAll(/^\s*import security_headers (.*)$/gm)].map(([, args]) => args!);

  it('finds the fixed react-aria styles', () => {
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.some((text) => text.includes('touch-action'))).toBe(true);
    expect(styles.filter((text) => text.includes('${'))).toEqual([]);
  });

  it('finds a security_headers line for each site', () => {
    expect(siteHeaders.length).toBeGreaterThanOrEqual(3);
  });

  it('allows exactly the hash of each fixed style on every site', () => {
    const allowed = siteHeaders.map((args) => args.match(/'sha256-[A-Za-z0-9+/=]+'/g)?.toSorted() ?? []);
    expect(allowed).toEqual(siteHeaders.map(() => expected));
  });

  it('keeps unsafe-inline out of every production style-src', () => {
    expect(styleSrc).toContain('{args[1]}');
    expect(siteHeaders.filter((args) => styleSrc.replace('{args[1]}', args).includes('unsafe-inline'))).toEqual([]);
  });
});
