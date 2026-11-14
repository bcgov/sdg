import { Button } from '@repo/design-system/components/button';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useState } from 'react';

import type { FlagSummary } from '../../api/feature-flags';
import { loadFailureNotice, NoticeAlert } from '../service-clients/notice';
import { CreateFlagForm } from './create-flag-form';
import { FlagTable } from './flag-table';
import { FormDialog } from './form-dialog';
import { useFlagList } from './use-feature-flags';

import styles from './feature-flags.module.css';

function FlagList() {
  const { data: flags, error, isPending, isError, refetch } = useFlagList();
  const retry = useCallback(() => void refetch(), [refetch]);
  if (isError) {
    const notice = loadFailureNotice(error, 'The feature flags', retry);
    return notice && <NoticeAlert notice={notice} />;
  }
  if (isPending) return <Text elementType="p">Loading feature flags…</Text>;
  if (flags.length === 0) return <Text elementType="p">No feature flags exist yet.</Text>;
  return <FlagTable flags={flags} />;
}

/**
 * The Feature Flags landing page (R14, R15, R21): every flag in a table, each row opening the flag's own page, and a
 * button that opens the create form in a dialog. `deletedKey` is the flag the administrator just deleted from its page.
 * The app shell shows the title as the page's `h1`.
 */
export function FeatureFlagsPage({ deletedKey }: Readonly<{ deletedKey?: string | undefined }>) {
  const [status, setStatus] = useState(deletedKey ? `Deleted ${deletedKey}.` : '');
  const [creating, setCreating] = useState(false);
  const [isPending, setPending] = useState(false);
  const open = useCallback(() => setCreating(true), []);
  const close = useCallback(() => setCreating(false), []);
  const onCreated = useCallback((flag: FlagSummary) => {
    setCreating(false);
    setStatus(`Created ${flag.key}.`);
  }, []);

  return (
    <>
      <Text elementType="p">
        Feature flags turn parts of the portal and the console on or off without a deploy, for a share of people or for
        named people.
      </Text>
      <output className={styles.status} aria-label="Feature flag updates">
        {status && <InlineAlert variant="success" description={status} />}
      </output>
      <div>
        <Button onPress={open}>Create feature flag</Button>
      </div>
      <section className={styles.section} aria-label="Feature flags">
        <FlagList />
      </section>
      <FormDialog title="Create a feature flag" isOpen={creating} isPending={isPending} onClose={close}>
        <CreateFlagForm onCreated={onCreated} onPendingChange={setPending} onCancel={close} />
      </FormDialog>
    </>
  );
}
