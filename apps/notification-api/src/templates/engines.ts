import { Liquid, type FS, type LiquidOptions } from 'liquidjs';

import { registerFilters, type RenderLocale } from './filters.js';

/**
 * `html` escapes every output for email HTML; `text` leaves output as is for subjects, plain text, in-app Markdown
 * (sanitized after rendering) and webhook payload values (JSON-encoded after rendering) (KTD6).
 */
export type EngineFlavour = 'html' | 'text';

/** Layout and partial sources by name: everything a render can include. */
export type FragmentSources = Readonly<Record<string, string>>;

/** Denial-of-service bounds on one parse or render (KTD6). */
export const TEMPLATE_LIMITS = {
  /** Characters parsed per `parse()` call: a template part, layout or partial. */
  parseLimit: 1_000_000,
  /** Milliseconds per `render()` call. */
  renderLimit: 2_000,
  /** Characters of strings and arrays a render may create. */
  memoryLimit: 20_000_000,
} as const;

/**
 * Sandboxed Liquid (R20): templates see only their own data's own properties (no prototypes), an undefined variable
 * or filter fails the render outside `if`/`unless`/`default`, and nothing is read from disk.
 */
const SANDBOX: LiquidOptions = {
  strictVariables: true,
  lenientIf: true,
  strictFilters: true,
  ownPropertyOnly: true,
  relativeReference: false,
  cache: false,
  ...TEMPLATE_LIMITS,
};

/**
 * An engine for one render, built from that render's pinned layouts and partials (KTD6). They are the only names
 * `{% layout %}`, `{% include %}` and `{% render %}` resolve; the lookup map has no prototype, so `constructor`
 * and the like are unknown names too.
 */
export function createEngine(flavour: EngineFlavour, fragments: FragmentSources, locale: RenderLocale): Liquid {
  const templates: Record<string, string> = Object.assign(Object.create(null), fragments);
  const engine = new Liquid({
    ...SANDBOX,
    templates,
    ...(flavour === 'html' ? { outputEscape: 'escape' as const } : {}),
  });
  registerFilters(engine, locale);
  return engine;
}

/** Renders one source to text. */
export async function renderSource(engine: Liquid, source: string, data: Record<string, unknown>): Promise<string> {
  const output: unknown = await engine.parseAndRender(source, data);
  return String(output);
}

/** An in-memory file system that records each name looked up and serves every one as empty. */
function recordingFs(names: Set<string>): FS {
  const lookup = (file: string): boolean => {
    names.add(file);
    return true;
  };
  return {
    sep: '/',
    exists: (file) => Promise.resolve(lookup(file)),
    existsSync: lookup,
    readFile: () => Promise.resolve(''),
    readFileSync: () => '',
    resolve: (_dir, file, ext) => `${file}${ext}`,
    dirname: () => '.',
  };
}

/**
 * The layout and partial names the sources name statically, in first-use order (KTD7). Each source is parsed, so a
 * syntax error throws. A name computed at render time is not found here, so it resolves only to a name another
 * reference pinned.
 */
export function referencedNames(sources: readonly string[]): string[] {
  const names = new Set<string>();
  const engine = new Liquid({ ...SANDBOX, fs: recordingFs(names), root: ['.'], partials: ['.'], layouts: ['.'] });
  for (const source of sources) engine.analyzeSync(engine.parse(source), { partials: true });
  return [...names];
}
