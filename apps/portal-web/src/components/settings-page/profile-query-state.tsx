import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { ProgressCircle } from '@repo/design-system/components/progress-circle';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '../../api/http';
import type { Profile } from '../../profile/api';

interface ProfileQueryStateProps {
  query: UseQueryResult<Profile>;
  /** The section's content once the profile has loaded. */
  children: (profile: Profile) => ReactNode;
}

/**
 * The content once the profile has loaded, a loading indicator until then (R20), and a contained error when the first
 * load fails (R14). A failed background refetch keeps the details already shown rather than replacing them. An ended
 * session isn't a failure to show: `useSessionEndedRedirect` is already taking the resident to sign in.
 */
export function ProfileQueryState({ query, children }: Readonly<ProfileQueryStateProps>) {
  if (query.data !== undefined) return children(query.data);
  const sessionEnded = query.error instanceof ApiError && query.error.kind === 'session-ended';
  if (query.isError && !sessionEnded) {
    return <InlineAlert variant="danger" title="We couldn’t load your details" description="Please try again later." />;
  }
  return <ProgressCircle isIndeterminate aria-label="Loading your details" />;
}
