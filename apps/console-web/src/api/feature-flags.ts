import { ApiError, apiRequest } from './http';

export const AUDIENCES = ['portal', 'console', 'both'] as const;
export type Audience = (typeof AUDIENCES)[number];
const AUDIENCE_SET: ReadonlySet<unknown> = new Set(AUDIENCES);
export const isAudience = (value: unknown): value is Audience => AUDIENCE_SET.has(value);

export const EVENT_ACTIONS = ['created', 'updated', 'deleted', 'override_set', 'override_removed'] as const;
export type FlagEventAction = (typeof EVENT_ACTIONS)[number];

export const PERSON_KINDS = ['resident', 'console-user'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/** A flag with how many people it is forced on and off for (R21). */
export interface FlagSummary {
  readonly key: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly audience: Audience;
  readonly overrideCounts: { readonly on: number; readonly off: number };
}

/** One person's override, with their current name, email and kind. */
export interface FlagOverride {
  readonly principalId: string;
  readonly name: string;
  readonly email: string | null;
  readonly kind: PersonKind;
  readonly enabled: boolean;
}

export interface FlagDetail extends FlagSummary {
  readonly overrides: readonly FlagOverride[];
}

export interface NewFlag {
  readonly key: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly audience: Audience;
}

/** Only the fields to change (KTD8). */
export type FlagChanges = Partial<Pick<FlagSummary, 'description' | 'enabled' | 'rolloutPct' | 'audience'>>;

export type FieldValue = string | number | boolean | null;
export type EventChanges = Readonly<Record<string, { readonly from: FieldValue; readonly to: FieldValue } | number>>;

/** One change to a flag or override; `actor.name` is the administrator's name when they made it. */
export interface FlagEvent {
  readonly id: number;
  readonly flagKey: string;
  readonly action: FlagEventAction;
  readonly actor: { readonly principalId: string; readonly name: string };
  readonly subject: { readonly principalId: string; readonly name: string | null } | null;
  readonly changes: EventChanges;
  readonly createdAt: string;
}

/** A numbered page of the flag list (KTD2): `offset` is the one core-api used, the last page's when asked past it. */
export interface FlagListPage {
  readonly items: readonly FlagSummary[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** The flag list's search, filters (`audience` portal or console, `enabled` true or false), sort and page. */
export interface FlagListQuery {
  readonly limit: number;
  readonly offset: number;
  readonly q?: string;
  readonly audience?: string;
  readonly enabled?: string;
  readonly sort?: string;
  readonly order?: 'asc' | 'desc';
}

/** A cursor page of a flag's history, newest first (KTD3): `older` and `newer` are the next pages' cursors, or null. */
export interface FlagHistoryPage {
  readonly items: readonly FlagEvent[];
  readonly older: number | null;
  readonly newer: number | null;
}

/** At most one of `before` (older than) and `after` (newer than), each an event id from a previous page. */
export interface FlagHistoryQuery {
  readonly key: string;
  readonly limit: number;
  readonly before?: string;
  readonly after?: string;
}

export interface Person {
  readonly principalId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly kind: PersonKind;
  readonly lastSignInAt: string;
}

export interface PeopleSearchResult {
  readonly results: readonly Person[];
  readonly more: boolean;
}

export const FEATURE_FLAGS_PATH = '/api/v1/console/feature-flags';
export const FLAG_HISTORY_PATH = '/api/v1/console/feature-flag-history';
export const PEOPLE_SEARCH_PATH = '/api/v1/console/people/search';

/** KTD13's key rule, repeated here for instant feedback; core-api checks it too. */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isCount = (value: unknown): value is number => Number.isInteger(value);
const oneOf = (values: readonly unknown[], value: unknown) => values.includes(value);

function isSummary(value: unknown): value is FlagSummary {
  if (!isObject(value) || !isObject(value['overrideCounts'])) return false;
  const counts = value['overrideCounts'];
  return (
    isString(value['key']) &&
    isNullableString(value['description']) &&
    typeof value['enabled'] === 'boolean' &&
    isCount(value['rolloutPct']) &&
    oneOf(AUDIENCES, value['audience']) &&
    isCount(counts['on']) &&
    isCount(counts['off'])
  );
}

function isOverride(value: unknown): value is FlagOverride {
  return (
    isObject(value) &&
    isString(value['principalId']) &&
    isString(value['name']) &&
    isNullableString(value['email']) &&
    oneOf(PERSON_KINDS, value['kind']) &&
    typeof value['enabled'] === 'boolean'
  );
}

function isDetail(value: unknown): value is FlagDetail {
  if (!isObject(value)) return false;
  const overrides = value['overrides'];
  return isSummary(value) && Array.isArray(overrides) && overrides.every(isOverride);
}

function isEvent(value: unknown): value is FlagEvent {
  if (!isObject(value) || !isObject(value['actor']) || !isObject(value['changes'])) return false;
  const { actor, subject } = value;
  return (
    isCount(value['id']) &&
    isString(value['flagKey']) &&
    oneOf(EVENT_ACTIONS, value['action']) &&
    isString(actor['principalId']) &&
    isString(actor['name']) &&
    (subject === null || (isObject(subject) && isString(subject['principalId']))) &&
    isString(value['createdAt'])
  );
}

const isCursor = (value: unknown) => value === null || isCount(value);

function isHistoryPage(value: unknown): value is FlagHistoryPage {
  if (!isObject(value) || !Array.isArray(value['items'])) return false;
  return value['items'].every(isEvent) && isCursor(value['older']) && isCursor(value['newer']);
}

function isListPage(value: unknown): value is FlagListPage {
  if (!isObject(value) || !Array.isArray(value['items'])) return false;
  const { items, total, limit, offset } = value;
  return items.every(isSummary) && isCount(total) && isCount(limit) && isCount(offset);
}

function isPerson(value: unknown): value is Person {
  return (
    isObject(value) &&
    isString(value['principalId']) &&
    isString(value['displayName']) &&
    isNullableString(value['email']) &&
    oneOf(PERSON_KINDS, value['kind']) &&
    isString(value['lastSignInAt'])
  );
}

const isSearchResult = (value: unknown): value is PeopleSearchResult =>
  isObject(value) &&
  Array.isArray(value['results']) &&
  value['results'].every(isPerson) &&
  typeof value['more'] === 'boolean';

/** The body, if it has the expected shape; otherwise the answer is treated as unexpected. */
function expectShape<T>(body: unknown, guard: (value: unknown) => value is T): T {
  if (!guard(body)) throw new ApiError('unexpected', undefined, ['console-api returned an unexpected body']);
  return body;
}

const flagPath = (key: string) => `${FEATURE_FLAGS_PATH}/${encodeURIComponent(key)}`;
const overridePath = (key: string, principalId: string) =>
  `${flagPath(key)}/overrides/${encodeURIComponent(principalId)}`;

/** The query string of the fields that are set, in the order given. */
function queryString(fields: Readonly<Record<string, string | number | undefined>>): string {
  const entries = Object.entries(fields).flatMap(([name, value]) =>
    value === undefined ? [] : [[name, String(value)]],
  );
  return new URLSearchParams(entries).toString();
}

/** One page of the flags matching the search and filters, in the requested order (R15–R17). */
export async function listFlags(query: FlagListQuery): Promise<FlagListPage> {
  const { limit, offset, q, audience, enabled, sort, order } = query;
  const search = queryString({ limit, offset, q, audience, enabled, sort, order });
  return expectShape(await apiRequest(`${FEATURE_FLAGS_PATH}?${search}`), isListPage);
}

export async function fetchFlag(key: string): Promise<FlagDetail> {
  return expectShape(await apiRequest(flagPath(key)), isDetail);
}

export async function createFlag(flag: NewFlag): Promise<FlagSummary> {
  return expectShape(await apiRequest(FEATURE_FLAGS_PATH, { method: 'POST', body: flag }), isSummary);
}

export async function updateFlag(key: string, changes: FlagChanges): Promise<FlagSummary> {
  return expectShape(await apiRequest(flagPath(key), { method: 'PATCH', body: changes }), isSummary);
}

export async function deleteFlag(key: string): Promise<void> {
  await apiRequest(flagPath(key), { method: 'DELETE' });
}

export async function setOverride(key: string, principalId: string, enabled: boolean): Promise<FlagOverride> {
  const body = { enabled };
  return expectShape(await apiRequest(overridePath(key, principalId), { method: 'PUT', body }), isOverride);
}

export async function removeOverride(key: string, principalId: string): Promise<void> {
  await apiRequest(overridePath(key, principalId), { method: 'DELETE' });
}

/** A page of one flag's history, newest first, deleted or not (R19, R20). */
export async function listHistory({ key, limit, before, after }: FlagHistoryQuery): Promise<FlagHistoryPage> {
  const search = queryString({ key, limit, before, after });
  return expectShape(await apiRequest(`${FLAG_HISTORY_PATH}?${search}`), isHistoryPage);
}

/** People who signed in to an app in `audience`, by partial name or email; the query goes in the body (KTD9). */
export async function searchPeople(query: string, audience: Audience): Promise<PeopleSearchResult> {
  const body = { query, audience };
  return expectShape(await apiRequest(PEOPLE_SEARCH_PATH, { method: 'POST', body }), isSearchResult);
}
