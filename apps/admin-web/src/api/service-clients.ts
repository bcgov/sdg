import { ApiError, apiRequest } from './http';

export interface ServiceClient {
  readonly clientId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const SERVICE_CLIENT_ACTIONS = ['added', 'disabled', 'enabled', 'removed'] as const;
export type ServiceClientAction = (typeof SERVICE_CLIENT_ACTIONS)[number];

/** One registry change; `actor.name` is the administrator's display name when they made it. */
export interface ServiceClientEvent {
  readonly id: number;
  readonly clientId: string;
  readonly action: ServiceClientAction;
  readonly actor: { readonly principalId: string; readonly name: string };
  readonly createdAt: string;
}

/** A page of history, newest first; `nextBefore` fetches the next (older) page, null when there is none. */
export interface HistoryPage {
  readonly events: readonly ServiceClientEvent[];
  readonly nextBefore: number | null;
}

export interface NewServiceClient {
  readonly clientId: string;
  readonly displayName: string;
}

export const SERVICE_CLIENTS_PATH = '/api/v1/admin/service-clients';
export const HISTORY_PAGE_SIZE = 20;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';

function isServiceClient(value: unknown): value is ServiceClient {
  return (
    isObject(value) &&
    isString(value['clientId']) &&
    isString(value['displayName']) &&
    typeof value['enabled'] === 'boolean' &&
    isString(value['createdAt']) &&
    isString(value['updatedAt'])
  );
}

function isEvent(value: unknown): value is ServiceClientEvent {
  if (!isObject(value) || !isObject(value['actor'])) return false;
  const { actor } = value;
  return (
    typeof value['id'] === 'number' &&
    isString(value['clientId']) &&
    SERVICE_CLIENT_ACTIONS.some((action) => action === value['action']) &&
    isString(actor['principalId']) &&
    isString(actor['name']) &&
    isString(value['createdAt'])
  );
}

function isHistoryPage(value: unknown): value is HistoryPage {
  if (!isObject(value) || !Array.isArray(value['events'])) return false;
  const { events, nextBefore } = value;
  return events.every(isEvent) && (nextBefore === null || typeof nextBefore === 'number');
}

/** The body, if it has the expected shape; otherwise the answer is treated as unexpected. */
function expectShape<T>(body: unknown, guard: (value: unknown) => value is T): T {
  if (!guard(body)) throw new ApiError('unexpected', undefined, ['admin-api returned an unexpected body']);
  return body;
}

const isServiceClientList = (value: unknown): value is ServiceClient[] =>
  Array.isArray(value) && value.every(isServiceClient);

const clientPath = (clientId: string) => `${SERVICE_CLIENTS_PATH}/${encodeURIComponent(clientId)}`;

export async function listServiceClients(): Promise<ServiceClient[]> {
  return expectShape(await apiRequest(SERVICE_CLIENTS_PATH), isServiceClientList);
}

export async function fetchHistory(before?: number): Promise<HistoryPage> {
  const query = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
  if (before !== undefined) query.set('before', String(before));
  return expectShape(await apiRequest(`${SERVICE_CLIENTS_PATH}/history?${query}`), isHistoryPage);
}

export async function addServiceClient(client: NewServiceClient): Promise<ServiceClient> {
  return expectShape(await apiRequest(SERVICE_CLIENTS_PATH, { method: 'POST', body: client }), isServiceClient);
}

export async function setServiceClientEnabled(clientId: string, enabled: boolean): Promise<ServiceClient> {
  const path = `${clientPath(clientId)}/${enabled ? 'enable' : 'disable'}`;
  return expectShape(await apiRequest(path, { method: 'POST' }), isServiceClient);
}

export async function removeServiceClient(clientId: string): Promise<void> {
  await apiRequest(clientPath(clientId), { method: 'DELETE' });
}
