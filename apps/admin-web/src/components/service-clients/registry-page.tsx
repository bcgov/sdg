import { Heading } from '@repo/design-system/components/heading';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServiceClient } from '../../api/service-clients';
import { AddClientForm } from './add-client-form';
import { ClientTable } from './client-table';
import { HistoryPanel } from './history-panel';
import { loadFailureNotice, NoticeAlert } from './notice';
import { RemoveDialog } from './remove-dialog';
import { useServiceClients } from './use-registry';
import { useRegistryActions } from './use-registry-actions';

import styles from './registry.module.css';

interface ClientListProps {
  actions: ReturnType<typeof useRegistryActions>;
}

/** The registered clients, or why they can't be shown: loading, a load failure with a retry, or none yet. */
function ClientList({ actions }: ClientListProps) {
  const { data: clients, error, isPending, isError, refetch } = useServiceClients();
  const retry = useCallback(() => void refetch(), [refetch]);
  if (isError) {
    const notice = loadFailureNotice(error, 'The service accounts', retry);
    return notice && <NoticeAlert notice={notice} />;
  }
  if (isPending) return <Text elementType="p">Loading service accounts…</Text>;
  if (clients.length === 0) {
    return <Text elementType="p">No service accounts are registered yet. Add one below.</Text>;
  }
  return (
    <ClientTable
      clients={clients}
      busyClientId={actions.busyClientId}
      onToggle={actions.toggle}
      onRemove={actions.askRemove}
    />
  );
}

/** Moves focus to the list's section after the commit that removed a row (its Remove button is gone). */
function useFocusAfterChange() {
  const listRef = useRef<HTMLElement>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (request > 0) listRef.current?.focus();
  }, [request]);
  const focusList = useCallback(() => setRequest((count) => count + 1), []);
  return { listRef, focusList };
}

/** The service-account registry (R16, R17): list, add, disable, re-enable, remove, and the history of changes. */
export function RegistryPage() {
  const { listRef, focusList } = useFocusAfterChange();
  const actions = useRegistryActions(focusList);
  const { status, confirm, notice, dismiss } = actions;
  const onAdded = useCallback((client: ServiceClient) => confirm(`Added ${client.clientId}.`), [confirm]);

  return (
    <>
      <Heading level={1}>Service accounts</Heading>
      <Text elementType="p">
        Service accounts listed here, while enabled, may call the gateway with their Keycloak client credentials.
      </Text>
      <div className={styles.notices}>
        <output className={styles.status} aria-label="Registry updates">
          {status && <InlineAlert variant="success" description={status} />}
        </output>
        {notice && <NoticeAlert notice={notice} onDismiss={dismiss} />}
      </div>
      <section ref={listRef} tabIndex={-1} className={styles.section} aria-labelledby="registered-heading">
        <Heading level={2} id="registered-heading">
          Registered service accounts
        </Heading>
        <ClientList actions={actions} />
      </section>
      <section className={styles.section} aria-labelledby="add-heading">
        <Heading level={2} id="add-heading">
          Add a service account
        </Heading>
        <AddClientForm onAdded={onAdded} />
      </section>
      <section className={styles.section} aria-labelledby="history-heading">
        <Heading level={2} id="history-heading">
          History
        </Heading>
        <HistoryPanel />
      </section>
      <RemoveDialog
        client={actions.removing}
        isPending={actions.isRemoving}
        onConfirm={actions.confirmRemove}
        onCancel={actions.cancelRemove}
      />
    </>
  );
}
