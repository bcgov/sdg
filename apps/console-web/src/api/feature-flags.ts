import { ApiError, apiRequest } from './http';

export const AUDIENCES = ['portal', 'console', 'both'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const isAudience = (value: unknown): value is Audience => AUDIENCES.some((audience) => audience === value);

export const EVENT_ACTIONS = ['created', 'updated', 'deleted', 'override_set', 'override_removed'] as const;
export type FlagEventAction = (typeof EVENT_ACTIONS)[number];

export type PersonKind = 'resident' | 'console-user';

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

export interface FlagHistoryPage {
  readonly events: readonly FlagEvent[];
  readonly nextBefore: number | null;
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
export const FLAG_HISTORY_PAGE_SIZE = 20;

/** KTD13's key rule, repeated here for instant feedback; core-api checks it too. */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isCount = (value: unknown): value is number => Number.isInteger(value);
const oneOf = (values: readonly unknown[], value: unknown) => values.includes(value);
const KINDS: readonly unknown[] = ['resident', 'console-user'];

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
    oneOf(KINDS, value['kind']) &&
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

function isHistoryPage(value: unknown): value is FlagHistoryPage {
  if (!isObject(value) || !Array.isArray(value['events'])) return false;
  const { events, nextBefore } = value;
  return events.every(isEvent) && (nextBefore === null || isCount(nextBefore));
}

function isPerson(value: unknown): value is Person {
  return (
    isObject(value) &&
    isString(value['principalId']) &&
    isString(value['displayName']) &&
    isNullableString(value['email']) &&
    oneOf(KINDS, value['kind']) &&
    isString(value['lastSignInAt'])
  );
}

const isSearchResult = (value: unknown): value is PeopleSearchResult =>
  isObject(value) &&
  Array.isArray(value['results']) &&
  value['results'].every(isPerson) &&
  typeof value['more'] === 'boolean';

const isSummaryList = (value: unknown): value is FlagSummary[] => Array.isArray(value) && value.every(isSummary);

/** The body, if it has the expected shape; otherwise the answer is treated as unexpected. */
function expectShape<T>(body: unknown, guard: (value: unknown) => value is T): T {
  if (!guard(body)) throw new ApiError('unexpected', undefined, ['console-api returned an unexpected body']);
  return body;
}

const flagPath = (key: string) => `${FEATURE_FLAGS_PATH}/${encodeURIComponent(key)}`;
const overridePath = (key: string, principalId: string) =>
  `${flagPath(key)}/overrides/${encodeURIComponent(principalId)}`;

export async function listFlags(): Promise<FlagSummary[]> {
  return expectShape(await apiRequest(FEATURE_FLAGS_PATH), isSummaryList);
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

/** A page of one flag's history, newest first, deleted or not (R19). */
export async function fetchFlagHistory(key: string, before?: number): Promise<FlagHistoryPage> {
  const query = new URLSearchParams({ limit: String(FLAG_HISTORY_PAGE_SIZE), key });
  if (before !== undefined) query.set('before', String(before));
  return expectShape(await apiRequest(`${FLAG_HISTORY_PATH}?${query}`), isHistoryPage);
}

/** People who signed in to an app in `audience`, by partial name or email; the query goes in the body (KTD9). */
export async function searchPeople(query: string, audience: Audience): Promise<PeopleSearchResult> {
  const body = { query, audience };
  return expectShape(await apiRequest(PEOPLE_SEARCH_PATH, { method: 'POST', body }), isSearchResult);
}
