import { Button } from '@repo/design-system/components/button';
import { DataTable, readTableState, type DataTableSearchChange } from '@repo/design-system/components/data-table';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Text } from '@repo/design-system/components/text';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import type { FlagSummary } from '../../api/feature-flags';
import { CreateFlagForm } from './create-flag-form';
import { FLAG_COLUMNS } from './flag-columns';
import { FormDialog } from './form-dialog';
import { FLAG_LIST_CONFIG, flagListQuery, listParams, stringParams } from './table-search';
import { tableStatus, useFlagList } from './use-feature-flags';

import styles from './feature-flags.module.css';

const MESSAGES = {
  empty: 'No feature flags exist yet.',
  noMatches: 'No feature flags match the search or filters.',
  error: "The feature flags couldn't be loaded. Try again in a moment.",
};

const flagId = (flag: FlagSummary) => flag.key;
const NO_FLAGS: readonly FlagSummary[] = [];

/** Each row links to its flag's page, carrying the list's params so deleting returns to this view (R18). */
function useRowHref(search: Readonly<Record<string, unknown>>) {
  const router = useRouter();
  const carried = useMemo(() => listParams(search), [search]);
  return useCallback(
    (flag: FlagSummary) =>
      router.buildLocation({ to: '/feature-flags/$key', params: { key: flag.key }, search: carried }).href,
    [router, carried],
  );
}

/** The flags a page at a time from core-api, with search, filters, sort and page in the URL (R7, R15–R17). */
function FlagList() {
  const search = useSearch({ from: '/_app/feature-flags' });
  const navigate = useNavigate({ from: '/feature-flags' });
  const query = useMemo(() => flagListQuery(readTableState(search, FLAG_LIST_CONFIG).state), [search]);
  const list = useFlagList(query);
  const { data, refetch } = list;
  const getRowHref = useRowHref(search);
  const onSearchChange = useCallback<DataTableSearchChange>(
    (next, { replace }) => void navigate({ search: stringParams(next), replace }),
    [navigate],
  );
  const retry = useCallback(() => void refetch(), [refetch]);
  const paging = useMemo(
    () => ({ mode: 'numbered' as const, total: data?.total ?? 0, offset: data?.offset }),
    [data?.total, data?.offset],
  );
  return (
    <DataTable
      caption="Every feature flag; select one to change it, its overrides or see its history"
      columns={FLAG_COLUMNS}
      rows={data?.items ?? NO_FLAGS}
      getRowId={flagId}
      getRowHref={getRowHref}
      config={FLAG_LIST_CONFIG}
      paging={paging}
      search={search}
      onSearchChange={onSearchChange}
      status={tableStatus(list)}
      onRetry={retry}
      messages={MESSAGES}
    />
  );
}

/**
 * The Feature Flags landing page (R15–R18): the flags in a DataTable, each row opening the flag's own page, and a
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
