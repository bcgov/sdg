import { Header } from '@bcgov/design-system-react-components';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Upstream colours the logo with classes from its own stylesheet; inline them so the SVG needs no global CSS.
const fills: Record<string, string> = {
  'bcds-bc-logo--whiteFill': '#ffffff',
  'bcds-bc-logo--blueFill': '#234075',
  'bcds-bc-logo--goldFill': '#e3a82b',
  'bcds-bc-logo--noFill': 'none',
};

/** Where the emblem crop ends: past the emblem (sky, sun and mountains), short of the wordmark and gold rule. */
const emblemRight = 356;

export interface BcLogo {
  viewBox: string;
  /** The SVG's children, with `fill` attributes in place of upstream's fill classes. */
  markup: string;
}

/** The logo's viewBox cut off at `emblemRight`: the emblem at the logo's own scale and margins, without the wordmark. */
export function emblemViewBox(logoViewBox: string): string {
  const [x = 0, y = 0, , height = 0] = logoViewBox.split(' ').map(Number);
  return `${x} ${y} ${emblemRight - x} ${height}`;
}

/** The B.C. logo as the installed @bcgov/design-system-react-components renders it in its Header. */
export function extractBcLogo(): BcLogo {
  const header = renderToStaticMarkup(createElement(Header));
  const svg = /<svg id="bcgov-logo-header"[^>]*\bviewBox="([^"]+)"[^>]*>(.*?)<\/svg>/su.exec(header);
  if (!svg?.[1] || !svg[2]) throw new Error('bc-logo: no #bcgov-logo-header <svg> in the upstream Header markup');
  const markup = svg[2].replaceAll(/ class="([^"]+)"/gu, (_match, name: string) => {
    const fill = fills[name];
    if (!fill) throw new Error(`bc-logo: unknown upstream logo class "${name}"`);
    return ` fill="${fill}"`;
  });
  return { viewBox: svg[1], markup };
}

/** Splits SVG markup into its top-level elements (upstream always writes closing tags). */
function childElements(markup: string): string[] {
  const elements: string[] = [];
  let depth = 0;
  let start = 0;
  for (const tag of markup.matchAll(/<(\/?)[a-z]+\b[^>]*?(\/?)>/gu)) {
    if (tag[2]) continue;
    depth += tag[1] ? -1 : 1;
    if (depth === 0) {
      const end = tag.index + tag[0].length;
      elements.push(markup.slice(start, end));
      start = end;
    }
  }
  if (depth !== 0 || start !== markup.length) throw new Error('bc-logo: unbalanced upstream logo markup');
  return elements;
}

const isGoldRule = (element: string): boolean =>
  element.startsWith('<rect') && element.includes(`fill="${fills['bcds-bc-logo--goldFill']}"`);

/** The `<g>` holding the gold rule `<rect>` as a direct child: the wordmark, at any depth. */
function findWordmark(markup: string): string | undefined {
  for (const element of childElements(markup)) {
    const inner = /^<g\b[^>]*>(.*)<\/g>$/su.exec(element)?.[1];
    if (inner === undefined) continue;
    if (childElements(inner).some(isGoldRule)) return element;
    const nested = findWordmark(inner);
    if (nested) return nested;
  }
  return undefined;
}

const pathArity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, z: 0 };

/** The x of every point and Bézier control point in a path; a curve stays within its control points, so they bound it. */
function pathXs(d: string): number[] {
  const xs: number[] = [];
  let [x, y, startX, startY] = [0, 0, 0, 0];
  for (const [, command = '', args = ''] of d.matchAll(/([a-z])([^a-z]*)/giu)) {
    const type = command.toLowerCase();
    const arity = pathArity[type];
    if (arity === undefined) throw new Error(`bc-logo: unsupported path command "${command}"`);
    const relative = command === type;
    const numbers = [...args.matchAll(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu)].map(Number);
    if (arity === 0) {
      [x, y] = [startX, startY];
      continue;
    }
    for (let i = 0; i < numbers.length; i += arity) {
      const values = numbers.slice(i, i + arity);
      const [baseX, baseY] = relative ? [x, y] : [0, 0];
      if (type === 'h') x = baseX + (values[0] ?? 0);
      else if (type === 'v') y = baseY + (values[0] ?? 0);
      else {
        for (let j = 0; j < values.length; j += 2) xs.push(baseX + (values[j] ?? 0));
        [x, y] = [baseX + (values.at(-2) ?? 0), baseY + (values.at(-1) ?? 0)];
      }
      xs.push(x);
      if (type === 'm' && i === 0) [startX, startY] = [x, y];
    }
  }
  return xs;
}

/** The horizontal extent of the visible shapes in some logo markup (bounded by control points, so never too narrow). */
export function xExtent(markup: string): { min: number; max: number } {
  const xs: number[] = [];
  for (const [, tag, attributes = ''] of markup.matchAll(/<(path|rect|polygon)\b([^>]*)>/gu)) {
    if (attributes.includes('fill="none"')) continue;
    const attribute = (name: string): string => new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(attributes)?.[1] ?? '0';
    if (tag === 'path') xs.push(...pathXs(attribute('d')));
    else if (tag === 'rect') xs.push(Number(attribute('x')), Number(attribute('x')) + Number(attribute('width')));
    else
      xs.push(
        ...attribute('points')
          .split(/[\s,]+/u)
          .filter((_, i) => i % 2 === 0)
          .map(Number),
      );
  }
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

/** The logo split into its wordmark group (the `<g>` holding the gold rule `<rect>`) and everything else (the emblem). */
export function splitWordmark(markup: string): { wordmark: string; emblem: string } {
  const wordmark = findWordmark(markup);
  if (!wordmark)
    throw new Error('bc-logo: no wordmark group (a <g> holding the gold rule <rect>) in the upstream logo');
  return { wordmark, emblem: markup.replace(wordmark, '') };
}

/** Source of src/logo.ts for `logo`. */
export function logoModule({ viewBox, markup }: BcLogo): string {
  return `import { svg, type SVGTemplateResult } from 'lit';

// Generated by scripts/generate-logo.ts from @bcgov/design-system-react-components — do not edit.
// The B.C. Government logo, with upstream's fill classes inlined as fill attributes.

export const bcLogoViewBox = '${viewBox}';

/** Crops bcLogo to its emblem (sky, sun and mountains) at the same scale and height, leaving out the wordmark. */
export const bcEmblemViewBox = '${emblemViewBox(viewBox)}';

export const bcLogo: SVGTemplateResult = svg\`${markup}\`;
`;
}
