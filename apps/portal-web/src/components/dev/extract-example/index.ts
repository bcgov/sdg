/**
 * Extracts the text between a named region-marker pair from `source` and dedents it. Throws
 * immediately on a missing/mismatched marker — a typo'd or renamed region must fail loudly, never
 * silently render blank "Show code" output.
 *
 * Markers can be either a `// #region NAME` / `// #endregion NAME` line comment (wrap a whole
 * function/statement) or a `{/* #region NAME *\/}` / `{/* #endregion NAME *\/}` JSX comment (wrap
 * one or more sibling JSX children, where a `//` line comment isn't legal syntax).
 */
export function extractExample(source: string, name: string): string {
  const start = markerRegex('region', name).exec(source);
  if (!start) throw new Error(`extractExample: no "#region ${name}" marker found`);

  const bodyStart = start.index + start[0].length;
  const end = markerRegex('endregion', name).exec(source.slice(bodyStart));
  if (!end) throw new Error(`extractExample: no matching "#endregion ${name}" marker`);

  return dedent(source.slice(bodyStart, bodyStart + end.index));
}

function markerRegex(kind: 'region' | 'endregion', name: string): RegExp {
  const escapedName = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(
    String.raw`^[ \t]*(?://\s*#${kind}\s+${escapedName}\s*|\{/\*\s*#${kind}\s+${escapedName}\s*\*/\})\s*$`,
    'm',
  );
}

function dedent(text: string): string {
  const lines = text.replace(/^\n/, '').trimEnd().split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}
