/**
 * TanStack Router search (de)serializers that keep every search value a plain string. The router's default
 * JSON-parses values, so `?page=3` would read as a number, `?q=1e3` as 1000 and `?q=null` as null, and a written
 * `"3"` would come out quoted. DataTable's search contract (plain strings) relies on these.
 */
export function parseSearch(searchStr: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(searchStr));
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
