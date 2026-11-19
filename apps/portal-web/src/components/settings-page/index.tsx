import { Heading } from '@repo/design-system/components/heading';
import { Section } from '@repo/design-system/components/section';
import { Separator } from '@repo/design-system/components/separator';

import { useProfile } from '../../profile/use-profile';
import { CommunicationDetails, ProfileDetails } from './profile-details';
import { ProfileQueryState } from './profile-query-state';

import styles from './settings-page.module.css';

export function SettingsPage() {
  const profile = useProfile();
  return (
    <div className={styles['page']}>
      <Heading level={1} className={styles['title']}>
        Settings
      </Heading>
      <Separator />
      <Section title="Profile" description="Habitant sit ut scelerisque a metus BC Services Card.">
        <ProfileQueryState query={profile}>{(data) => <ProfileDetails profile={data} />}</ProfileQueryState>
      </Section>
      <Section title="Communication" description="At vitae blandit habitant purus.">
        <ProfileQueryState query={profile}>{(data) => <CommunicationDetails profile={data} />}</ProfileQueryState>
      </Section>
      <Section title="Data & Privacy" description="At tellus nunc nisl aliquam" />
    </div>
  );
}
