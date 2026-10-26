import { describe, expect, it } from 'vitest';

import { emblemViewBox, extractBcLogo, splitWordmark, xExtent } from '../scripts/bc-logo.js';
import { bcEmblemViewBox, bcLogo, bcLogoViewBox } from './logo.js';

describe('B.C. logo', () => {
  // On failure the upstream logo changed: regenerate src/logo.ts and review the diff.
  it('matches the installed upstream Header logo (else run `pnpm --filter @repo/sdg-header generate:logo`)', () => {
    const upstream = extractBcLogo();
    expect(bcLogoViewBox).toBe(upstream.viewBox);
    expect(bcLogo.strings.join('')).toBe(upstream.markup);
    expect(bcEmblemViewBox).toBe(emblemViewBox(upstream.viewBox));
  });

  // On failure the upstream layout moved: re-measure and update emblemRight in scripts/bc-logo.ts.
  it('crops to the whole emblem, clear of the wordmark and gold rule, at the full logo height', () => {
    const [logoX, logoY, , logoHeight] = bcLogoViewBox.split(' ').map(Number);
    const [x = 0, y, width = 0, height] = bcEmblemViewBox.split(' ').map(Number);
    expect([x, y, height]).toEqual([logoX, logoY, logoHeight]);
    const { wordmark, emblem } = splitWordmark(bcLogo.strings.join(''));
    expect(xExtent(emblem).min).toBeGreaterThan(x);
    expect(xExtent(emblem).max).toBeLessThan(x + width);
    expect(xExtent(wordmark).min).toBeGreaterThan(x + width);
  });

  it('carries no upstream classes, so it needs no global stylesheet', () => {
    const markup = bcLogo.strings.join('');
    expect(markup).not.toContain('class=');
    expect(markup).toContain('fill="#234075"');
    expect(markup).toContain('fill="#e3a82b"');
  });
});
