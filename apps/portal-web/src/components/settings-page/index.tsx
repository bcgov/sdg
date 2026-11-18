import { Heading } from '@repo/design-system/components/heading';
import { Separator } from '@repo/design-system/components/separator';
import { Text } from '@repo/design-system/components/text';
import { useId } from 'react';

import styles from './settings-page.module.css';

interface SettingsSectionProps {
  title: string;
  description: string;
}

function SettingsSection({ title, description }: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <Heading level={2} id={headingId}>
        {title}
      </Heading>
      <Text elementType="p" color="secondary">
        {description}
      </Text>
    </section>
  );
}

export function SettingsPage() {
  return (
    <div className={styles.page}>
      <Heading level={1}>Settings</Heading>
      <Separator />
      <SettingsSection title="Profile" description="Habitant sit ut scelerisque a metus BC Services Card." />
      <SettingsSection title="Communication" description="At vitae blandit habitant purus." />
      <SettingsSection title="Data & Privacy" description="At tellus nunc nisl aliquam" />
    </div>
  );
}
