import { Section } from '@repo/design-system/components/section';

import { useProfile } from '../../profile/use-profile';
import { PageLayout } from '../page-layout';
import { CommunicationDetails, ProfileDetails } from './profile-details';
import { ProfileQueryState } from './profile-query-state';

export function SettingsPage() {
  const profile = useProfile();
  return (
    <PageLayout title="Settings">
      <Section title="Profile" description="Review or change your personal information.">
        <ProfileQueryState query={profile}>{(data) => <ProfileDetails profile={data} />}</ProfileQueryState>
      </Section>
      <Section title="Communication" description="Review or change your contact information">
        <ProfileQueryState query={profile}>{(data) => <CommunicationDetails profile={data} />}</ProfileQueryState>
      </Section>
    </PageLayout>
  );
}
