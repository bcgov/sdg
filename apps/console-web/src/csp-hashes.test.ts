// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// console-web's own react-aria copy (react-aria-components, for the command palette) prepends the same fixed <style>
// elements as the copy bundled into the bcgov components. The edge CSP allows them by hash on every site
// (apps/portal-web/caddy/Caddyfile), but portal-web's csp-hashes test scans only the bcgov copy, so this fails when
// the two copies drift apart, before the strict CSP blocks a style in a browser.
const racPackage = createRequire(import.meta.url).resolve('react-aria-components/package.json');
const reactAria = dirname(createRequire(racPackage).resolve('react-aria/package.json'));
const reactAriaModule = (path: string) => readFileSync(join(reactAria, 'dist/private', path), 'utf8');
const caddyfile = readFileSync(fileURLToPath(new URL('../../portal-web/caddy/Caddyfile', import.meta.url)), 'utf8');

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

/** Each style text's hash that a site's security_headers arguments leave out, as `<site index>: <hash>`. */
function missingHashes(texts: readonly string[], siteHeaders: readonly string[]): string[] {
  return siteHeaders.flatMap((args, site) =>
    texts.map(sha256).flatMap((hash) => (args.includes(hash) ? [] : [`${site}: ${hash}`])),
  );
}

describe("console-web's react-aria style hashes", () => {
  const pressStyles = fixedStyleTexts(reactAriaModule('interactions/usePress.mjs'));
  const scrollStyles = fixedStyleTexts(reactAriaModule('overlays/usePreventScroll.mjs'));
  // One per host the edge serves (portal, console, gateway).
  const siteHeaders = [...caddyfile.matchAll(/^\s*import security_headers (.*)$/gm)].map(([, args]) => args!);

  it('finds exactly one fixed style in usePress and one in usePreventScroll', () => {
    expect(pressStyles).toHaveLength(1);
    expect(pressStyles[0]).toContain('touch-action');
    expect(scrollStyles).toHaveLength(1);
    expect(scrollStyles[0]).toContain('overscroll-behavior');
    expect([...pressStyles, ...scrollStyles].filter((text) => text.includes('${'))).toEqual([]);
  });

  it('finds a security_headers line for each site', () => {
    expect(siteHeaders.length).toBeGreaterThanOrEqual(3);
  });

  it("allows each fixed style's hash on every site", () => {
    expect(missingHashes([...pressStyles, ...scrollStyles], siteHeaders)).toEqual([]);
  });

  it('reports a fixed style whose hash no site allows', () => {
    const changed = `${pressStyles[0]}\n`;
    expect(missingHashes([changed], siteHeaders)).toEqual(siteHeaders.map((_, site) => `${site}: ${sha256(changed)}`));
  });
});
