import { Button } from '@repo/design-system/components/button';
import { useCallback } from 'react';

import type { ServiceClient } from '../../api/service-clients';

import styles from './registry.module.css';

interface RowProps {
  client: ServiceClient;
  isBusy: boolean;
  onToggle: (client: ServiceClient) => void;
  onRemove: (client: ServiceClient) => void;
}

/** Buttons are named with the client id, so each is distinguishable out of context (screen reader lists, voice). */
function ClientRow({ client, isBusy, onToggle, onRemove }: RowProps) {
  const toggle = useCallback(() => onToggle(client), [client, onToggle]);
  const remove = useCallback(() => onRemove(client), [client, onRemove]);
  const toggleLabel = client.enabled ? 'Disable' : 'Enable';
  return (
    <tr>
      <th scope="row">{client.clientId}</th>
      <td>{client.displayName}</td>
      <td>{client.enabled ? 'Enabled' : 'Disabled'}</td>
      <td>
        <div className={styles.actions}>
          <Button
            size="small"
            variant="secondary"
            aria-label={`${toggleLabel} ${client.clientId}`}
            isPending={isBusy}
            onPress={toggle}
          >
            {toggleLabel}
          </Button>
          <Button
            size="small"
            variant="secondary"
            danger
            aria-label={`Remove ${client.clientId}`}
            isPending={isBusy}
            onPress={remove}
          >
            Remove
          </Button>
        </div>
      </td>
    </tr>
  );
}

interface ClientTableProps {
  clients: readonly ServiceClient[];
  busyClientId: string | undefined;
  onToggle: (client: ServiceClient) => void;
  onRemove: (client: ServiceClient) => void;
}

export function ClientTable({ clients, busyClientId, onToggle, onRemove }: ClientTableProps) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <caption>Clients the gateway accepts while enabled</caption>
        <thead>
          <tr>
            <th scope="col">Client ID</th>
            <th scope="col">Display name</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <ClientRow
              key={client.clientId}
              client={client}
              isBusy={busyClientId === client.clientId}
              onToggle={onToggle}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
