import type { FeatureFlagAudience } from '@repo/database';

import type { PersonKind } from './principals.schemas.js';

/** Whether any of a person's identities signed in through the portal, and through the console (KTD5). */
export interface SignInMarks {
  readonly portal: boolean;
  readonly console: boolean;
}

/**
 * A person's kind for a flag's audience, preferring the flag's own app when they signed in to both, so the people
 * search and a flag's override list always label someone the same way (AE10).
 */
export function personKind(marks: SignInMarks, audience: FeatureFlagAudience): PersonKind {
  if (audience === 'portal' && marks.portal) return 'resident';
  return marks.console ? 'console-user' : 'resident';
}
