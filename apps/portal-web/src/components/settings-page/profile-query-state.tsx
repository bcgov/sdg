import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { ProgressCircle } from '@repo/design-system/components/progress-circle';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { Profile } from '../../profile/api';

interface ProfileQueryStateProps {
  query: UseQueryResult<Profile>;
  /** The section's content once the profile has loaded. */
  children: (profile: Profile) => ReactNode;
}

/** A loading indicator while the profile loads (R20), a contained error if it fails (R14), else the content. */
export function ProfileQueryState({ query, children }: Readonly<ProfileQueryStateProps>) {
  if (query.isPending) return <ProgressCircle isIndeterminate aria-label="Loading your details" />;
  if (query.isError) {
    return <InlineAlert variant="danger" title="We couldn’t load your details" description="Please try again later." />;
  }
  return children(query.data);
}
