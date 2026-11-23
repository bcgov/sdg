// The visitor's remembered floor (KTD4, R10): the highest manifest floor this browser has seen on this site, kept in
// localStorage. Every access is guarded: when storage is blocked, throws or holds nothing usable, the loader falls back
// to the manifest's own floor and the fallback is logged (the exposure the README documents, R16).

/** Returns the storage to use. A getter, since merely reading `window.localStorage` can throw. */
export type StorageProvider = () => Storage;

const FALLBACK = 'shared-ui: no remembered header floor on this site; using the manifest floor alone';

/** The localStorage key for one keyset and major: `sdg-header:floor:<keyset>:v<major>`. */
export function floorKey(keyset: string, major: number): string {
  return `sdg-header:floor:${keyset}:v${major}`;
}

/** The remembered floor, or `undefined` (logged) when there is none or storage can't be read. Never throws. */
export function readFloor(storage: StorageProvider, key: string): number | undefined {
  let value: string | null;
  try {
    value = storage().getItem(key);
  } catch (error) {
    console.warn(`${FALLBACK} (storage unavailable)`, { key, error });
    return undefined;
  }
  if (value === null) {
    console.info(FALLBACK, { key });
    return undefined;
  }
  const floor = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(floor)) {
    console.warn(`${FALLBACK} (stored value is not a floor)`, { key, value });
    return undefined;
  }
  return floor;
}

/** Remembers `floor` under `key`. Logs and carries on when storage can't be written. Never throws. */
export function rememberFloor(storage: StorageProvider, key: string, floor: number): void {
  try {
    storage().setItem(key, String(floor));
  } catch (error) {
    console.warn('shared-ui: cannot remember the header floor on this site', { key, floor, error });
  }
}
