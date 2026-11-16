import { Heading } from '@repo/design-system/components/heading';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Text } from '@repo/design-system/components/text';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

import type { FlagDetail } from '../../api/feature-flags';
import { apiErrorKind } from '../../api/http';
import { Link } from '../link';
import { loadFailureNotice, NoticeAlert } from '../service-clients/notice';
import { DeleteDialog } from './delete-dialog';
import { EditFlagDialog } from './edit-flag-dialog';
import { FlagHeader } from './flag-header';
import { FlagTabs } from './flag-tabs';
import { HistoryTable } from './history-table';
import { flagTab, type FlagTab, listParams, withTab } from './table-search';
import { type DetailActions, useDetailActions } from './use-detail-actions';
import { useFlagDetail } from './use-feature-flags';

import styles from './feature-flags.module.css';

interface PanelProps {
  id: string;
  title: string;
  children: ReactNode;
}

/** A bordered panel with a level-2 heading, e.g. a deleted flag's history. */
function Panel({ id, title, children }: Readonly<PanelProps>) {
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <Heading level={2} id={id}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

function HistoryPanel({ flagKey }: Readonly<{ flagKey: string }>) {
  return (
    <Panel id="flag-history-heading" title="History">
      <HistoryTable flagKey={flagKey} />
    </Panel>
  );
}

interface FlagPanelsProps {
  flag: FlagDetail;
  actions: DetailActions;
  tab: FlagTab;
  onShowTab: (tab: FlagTab) => void;
}

/** The flag's header with its edit and delete actions, then its tabs. */
function FlagPanels({ flag, actions, ...tabs }: Readonly<FlagPanelsProps>) {
  const [isEditing, setEditing] = useState(false);
  const edit = useCallback(() => setEditing(true), []);
  const closeEdit = useCallback(() => setEditing(false), []);
  return (
    <div className={styles.flagPage}>
      <FlagHeader flag={flag} isDeleting={actions.isDeleting} onEdit={edit} onDelete={actions.askDelete} />
      <FlagTabs flag={flag} actions={actions} {...tabs} />
      <EditFlagDialog flag={flag} actions={actions} isOpen={isEditing} onClose={closeEdit} />
      <DeleteDialog
        flag={actions.isAskingDelete ? flag : null}
        isPending={actions.isDeleting}
        onConfirm={actions.confirmDelete}
        onCancel={actions.cancelDelete}
      />
    </div>
  );
}

/** A key with no flag, e.g. deleted since: only its history, which outlives it (R19, AE7). */
function DeletedFlag({ flagKey }: Readonly<{ flagKey: string }>) {
  return (
    <div className={styles.panels}>
      <Text elementType="p">This flag was deleted. Its history is kept.</Text>
      <HistoryPanel flagKey={flagKey} />
    </div>
  );
}

function FlagBody({ flagKey, ...panels }: Readonly<Omit<FlagPanelsProps, 'flag'> & { flagKey: string }>) {
  const { data: flag, error, isPending, isError, refetch } = useFlagDetail(flagKey);
  const retry = useCallback(() => void refetch(), [refetch]);
  if (isError) {
    if (apiErrorKind(error) === 'not-found') return <DeletedFlag flagKey={flagKey} />;
    const notice = loadFailureNotice(error, flagKey, retry);
    return notice && <NoticeAlert notice={notice} />;
  }
  if (isPending) return <Text elementType="p">Loading {flagKey}…</Text>;
  return <FlagPanels flag={flag} {...panels} />;
}

/** The tab the URL names, and a way to show another (keeping the scroll). */
function useFlagTab() {
  const search = useSearch({ from: '/_app/feature-flags/$key' });
  const navigate = useNavigate({ from: '/feature-flags/$key' });
  const tab = flagTab(search);
  const showTab = useCallback(
    (next: FlagTab) => void navigate({ search: withTab(search, next), resetScroll: false }),
    [navigate, search],
  );
  return { search, tab, showTab };
}

/**
 * One flag's page (`/feature-flags/$key`): its header with the edit and delete actions, then its overview, overrides
 * and history as tabs. The status region above them confirms each change.
 */
export function FlagDetailPage({ flagKey }: Readonly<{ flagKey: string }>) {
  const actions = useDetailActions(flagKey);
  const { status, notice, dismiss } = actions;
  const { search, tab, showTab } = useFlagTab();
  // Back to the list view this flag was opened from (KTD10).
  const listSearch = useMemo(() => listParams(search), [search]);

  return (
    <>
      <Link to="/feature-flags" search={listSearch}>
        All feature flags
      </Link>
      <div className={styles.notices}>
        <output className={styles.status} aria-label="Feature flag updates">
          {status && <InlineAlert variant="success" description={status} />}
        </output>
        {notice && <NoticeAlert notice={notice} onDismiss={dismiss} />}
      </div>
      <FlagBody flagKey={flagKey} actions={actions} tab={tab} onShowTab={showTab} />
    </>
  );
}
