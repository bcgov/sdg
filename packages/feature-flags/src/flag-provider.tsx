import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';

import { fetchFlags, type FlagValues } from './fetch-flags';

/** Outside every app's own keys, so no app invalidation or prefix match can refetch the flags. */
export const flagsQueryKey: readonly ['@repo/feature-flags', 'evaluated'] = ['@repo/feature-flags', 'evaluated'];

export interface FlagResult {
  /** True until the flag list has loaded or failed: a flagged part renders nothing meanwhile. */
  isLoading: boolean;
  isEnabled: boolean;
}

interface FlagState {
  isLoading: boolean;
  flags: FlagValues;
}

const FlagContext = createContext<FlagState | null>(null);

const noFlags: FlagValues = {};

/**
 * Fetches the evaluated flags once per page load and renders its children straight away. Sign-in and sign-out are
 * full-page navigations, so the next page load fetches the flags for the new sign-in state. If the list can't be
 * fetched or read, every flag is off and nothing is shown to the user.
 */
export function FlagProvider({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const { data, error, isPending } = useQuery({
    queryKey: flagsQueryKey,
    queryFn: fetchFlags,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (error) console.warn('@repo/feature-flags: flags unavailable, every flag is off for this page load', error);
  }, [error]);

  const state = useMemo<FlagState>(() => ({ isLoading: isPending, flags: data ?? noFlags }), [isPending, data]);
  return <FlagContext.Provider value={state}>{children}</FlagContext.Provider>;
}

/** A flag the list doesn't name is off. Throws outside a `FlagProvider`. */
export function useFlag(key: string): FlagResult {
  const state = useContext(FlagContext);
  if (state === null) throw new Error('useFlag must be used inside <FlagProvider>');
  // `Object.hasOwn`: a key such as `constructor` must not read the prototype.
  const isEnabled = !state.isLoading && Object.hasOwn(state.flags, key) && state.flags[key] === true;
  return { isLoading: state.isLoading, isEnabled };
}
