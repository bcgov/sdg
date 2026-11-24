// Entry of the loader IIFE (KTD5), one classic script per keyset, embedded with `integrity` (R1). The build injects
// the keyset and its public keys. `loadHeader` runs synchronously up to its first await, so it still sees this script
// as `document.currentScript`, and it never rejects.
import { HEADER_MAJOR } from '../header/contract.ts';
import { loadHeader } from './loader.ts';

void loadHeader(
  { keyset: SDG_HEADER_KEYSET, keys: SDG_HEADER_KEYS, major: HEADER_MAJOR },
  {
    document,
    fetch: (input, init) => fetch(input, init),
    storage: () => window.localStorage,
    now: () => Date.now(),
  },
);
