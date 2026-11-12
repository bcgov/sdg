import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { logout } from './api';
import { currentUserQueryKey } from './use-current-user';

/** Ends the session through console-api and hands the browser to the logout URL it returns. */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void logout(() => queryClient.setQueryData(currentUserQueryKey, null));
  }, [queryClient]);
}
