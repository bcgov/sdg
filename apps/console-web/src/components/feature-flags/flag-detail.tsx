import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Link as DesignSystemLink } from '@repo/design-system/components/link';
import { Text } from '@repo/design-system/components/text';
import { type ReactNode, type RefObject, useCallback, useMemo, useRef } from 'react';

import type { FlagDetail } from '../../api/feature-flags';
import { apiErrorKind } from '../../api/http';
import { Link } from '../link';
import { loadFailureNotice, NoticeAlert } from '../service-clients/notice';
import { DeleteDialog } from './delete-dialog';
import { EditFlagForm, fieldValuesOf } from './edit-flag-form';
import { FlagHistory } from './history-list';
import { AUDIENCE_LABELS, onOff, people } from './labels';
import { OverridesPanel } from './overrides-panel';
import { type DetailActions, useDetailActions } from './use-detail-actions';
import { useFlagDetail } from './use-feature-flags';

import styles from './feature-flags.module.css';

interface OffNoticeProps {
  flag: FlagDetail;
  onReview: () => void;
  onDismiss: () => void;
}

/** R21: the flag is off, yet its "on" overrides still give it to people (an override beats the switch). */
function OffNotice({ flag, onReview, onDismiss }: Readonly<OffNoticeProps>) {
  const count = flag.overrideCounts.on;
  const buttons = useMemo(
    () => <DesignSystemLink onPress={onReview}>Review the overrides</DesignSystemLink>,
    [onReview],
  );
  return (
    <InlineAlert
      variant="warning"
      title={`${flag.key} is off, but ${people(count)} still ${count === 1 ? 'gets' : 'get'} it`}
      description={`Their "on" overrides come before the switch. Remove them to turn ${flag.key} off for everyone.`}
      isCloseable
      onClose={onDismiss}
      buttons={buttons}
    />
  );
}

interface PanelProps {
  id: string;
  title: string;
  isDanger?: boolean;
  children: ReactNode;
}

/** One of the page's sections: a bordered panel with a level-2 heading. */
function Panel({ id, title, isDanger = false, children }: Readonly<PanelProps>) {
  return (
    <section className={isDanger ? `${styles.panel} ${styles.dangerPanel}` : styles.panel} aria-labelledby={id}>
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
      <FlagHistory flagKey={flagKey} />
    </Panel>
  );
}

/** The flag as core-api last answered, one term and value per row. */
function FlagFacts({ flag }: Readonly<{ flag: FlagDetail }>) {
  const { on, off } = flag.overrideCounts;
  return (
    <dl className={styles.facts}>
      <dt>Key</dt>
      <dd>{flag.key}</dd>
      <dt>Description</dt>
      <dd>{flag.description ?? 'None'}</dd>
      <dt>Audience</dt>
      <dd>{AUDIENCE_LABELS[flag.audience]}</dd>
      <dt>Switch</dt>
      <dd>{onOff(flag.enabled)}</dd>
      <dt>Rollout</dt>
      <dd>{flag.rolloutPct}%</dd>
      <dt>Overrides</dt>
      <dd>
        {on} on, {off} off
      </dd>
    </dl>
  );
}

interface FlagPanelsProps {
  flag: FlagDetail;
  actions: DetailActions;
  overridesRef: RefObject<HTMLElement | null>;
}

/** Details with the inline edit form, overrides, history, and the delete action set apart at the bottom. */
function FlagPanels({ flag, actions, overridesRef }: Readonly<FlagPanelsProps>) {
  // A new answer from core-api for the editable fields starts the form over from it.
  const formKey = JSON.stringify(fieldValuesOf(flag));
  return (
    <div className={styles.panels}>
      <Panel id="flag-details-heading" title="Flag details">
        <FlagFacts flag={flag} />
        <Heading level={3}>Change the flag</Heading>
        <EditFlagForm key={formKey} flag={flag} isPending={actions.isSaving} onSave={actions.save} />
      </Panel>
      <OverridesPanel flag={flag} actions={actions} sectionRef={overridesRef} />
      <HistoryPanel flagKey={flag.key} />
      <Panel id="danger-zone-heading" title="Danger zone" isDanger>
        <Text elementType="p">
          Deleting {flag.key} removes it and its overrides, so it is off for everyone. Its history is kept.
        </Text>
        <div>
          <Button danger variant="secondary" isPending={actions.isDeleting} onPress={actions.askDelete}>
            Delete {flag.key}
          </Button>
        </div>
      </Panel>
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

function FlagBody({ flagKey, actions, overridesRef }: Readonly<Omit<FlagPanelsProps, 'flag'> & { flagKey: string }>) {
  const { data: flag, error, isPending, isError, refetch } = useFlagDetail(flagKey);
  const retry = useCallback(() => void refetch(), [refetch]);
  if (isError) {
    if (apiErrorKind(error) === 'not-found') return <DeletedFlag flagKey={flagKey} />;
    const notice = loadFailureNotice(error, flagKey, retry);
    return notice && <NoticeAlert notice={notice} />;
  }
  if (isPending) return <Text elementType="p">Loading {flagKey}…</Text>;
  return <FlagPanels flag={flag} actions={actions} overridesRef={overridesRef} />;
}

/**
 * One flag's page (`/feature-flags/$key`): its details with inline edits, its overrides with the people search, its
 * history and a delete action, each in its own panel. The status region above them confirms each change and holds the
 * R21 notice.
 */
export function FlagDetailPage({ flagKey }: Readonly<{ flagKey: string }>) {
  const overridesRef = useRef<HTMLElement>(null);
  const actions = useDetailActions(flagKey);
  const { data: flag } = useFlagDetail(flagKey);
  const { status, notice, dismiss, offNotice, dismissOffNotice } = actions;
  const reviewOverrides = useCallback(() => overridesRef.current?.focus(), []);
  const showOffNotice = offNotice && flag !== undefined && !flag.enabled && flag.overrideCounts.on > 0;

  return (
    <>
      <Link to="/feature-flags">All feature flags</Link>
      <div className={styles.notices}>
        <output className={styles.status} aria-label="Feature flag updates">
          {status && <InlineAlert variant="success" description={status} />}
          {showOffNotice && <OffNotice flag={flag} onReview={reviewOverrides} onDismiss={dismissOffNotice} />}
        </output>
        {notice && <NoticeAlert notice={notice} onDismiss={dismiss} />}
      </div>
      <FlagBody flagKey={flagKey} actions={actions} overridesRef={overridesRef} />
    </>
  );
}
