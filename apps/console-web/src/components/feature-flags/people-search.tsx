import { Button } from '@repo/design-system/components/button';
import { Text } from '@repo/design-system/components/text';
import { TextField } from '@repo/design-system/components/text-field';
import { useCallback, useEffect, useState } from 'react';

import type { Audience, Person, PeopleSearchResult } from '../../api/feature-flags';
import { apiErrorKind } from '../../api/http';
import { type Notice, NoticeAlert } from '../service-clients/notice';
import { dateTime, KIND_LABELS, people } from './labels';
import { usePeopleSearch } from './use-feature-flags';

import styles from './feature-flags.module.css';

export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_QUERY_LENGTH = 2;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * A failed search: the edge's WAF answers a bare 403 (`blocked`) to some text, e.g. an apostrophe, so that gets its
 * own advice. A 401 or core-api's 403 has already left the page.
 */
function searchFailure(error: unknown, retry: () => void): Notice | null {
  const kind = apiErrorKind(error);
  if (kind === 'session-ended' || kind === 'not-authorized') return null;
  if (kind === 'blocked') {
    return {
      variant: 'warning',
      title: 'The search was blocked',
      description: 'Some punctuation, such as an apostrophe, can be refused. Search for part of the name instead.',
    };
  }
  return {
    variant: 'danger',
    title: "The search couldn't be completed",
    description: 'Try again in a moment.',
    retry,
  };
}

function PersonButton({ person, onChoose }: Readonly<{ person: Person; onChoose: (person: Person) => void }>) {
  const choose = useCallback(() => onChoose(person), [person, onChoose]);
  return (
    <li>
      <Button variant="secondary" onPress={choose}>
        <span className={styles.person}>
          <strong>{person.displayName}</strong>
          <span className={styles.personDetail}>{person.email ?? 'No email'}</span>
          <span className={styles.personDetail}>
            {KIND_LABELS[person.kind]}, last signed in{' '}
            <time dateTime={person.lastSignInAt}>{dateTime.format(new Date(person.lastSignInAt))}</time>
          </span>
        </span>
      </Button>
    </li>
  );
}

function Results({ result, onChoose }: Readonly<{ result: PeopleSearchResult; onChoose: (p: Person) => void }>) {
  if (result.results.length === 0) return <Text elementType="p">No one matches that search.</Text>;
  return (
    <>
      <ul className={styles.results} aria-label="People found">
        {result.results.map((person) => (
          <PersonButton key={person.principalId} person={person} onChoose={onChoose} />
        ))}
      </ul>
      {result.more && (
        <Text elementType="p">
          Showing the first {result.results.length} matches. Refine your search to find someone else.
        </Text>
      )}
    </>
  );
}

/** What the polite live region (an `output`, role status) says: how many people were found, once a search has answered. */
function announcement(result: PeopleSearchResult | undefined, isCurrent: boolean): string {
  if (!result || !isCurrent) return '';
  if (result.results.length === 0) return 'No people found.';
  return `${people(result.results.length)} found${result.more ? ', and more match' : ''}.`;
}

interface PeopleSearchProps {
  audience: Audience;
  onChoose: (person: Person) => void;
}

/**
 * Finds people by partial name or email among those who sign in to the flag's apps (R18, KTD9): a text field and a
 * list of results, each a button (the design system has no combobox). Waits 300 ms after typing and sends nothing
 * shorter than 2 characters.
 */
export function PeopleSearch({ audience, onChoose }: Readonly<PeopleSearchProps>) {
  const [text, setText] = useState('');
  const typed = text.trim();
  const query = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  const isReady = query.length >= MIN_QUERY_LENGTH;
  const { data, error, isError, isFetching, refetch } = usePeopleSearch(query, audience, isReady);
  const retry = useCallback(() => void refetch(), [refetch]);
  const isCurrent = typed === query && isReady && !isFetching;
  const notice = isError && isCurrent ? searchFailure(error, retry) : null;

  return (
    <div className={styles.search}>
      <TextField
        label="Find a person"
        description="Part of their name or email"
        type="search"
        value={text}
        onChange={setText}
      />
      {typed.length < MIN_QUERY_LENGTH && (
        <Text elementType="p">Enter at least {MIN_QUERY_LENGTH} characters to search.</Text>
      )}
      {typed.length >= MIN_QUERY_LENGTH && !isCurrent && <Text elementType="p">Searching…</Text>}
      {notice && <NoticeAlert notice={notice} />}
      {isCurrent && data && !isError && <Results result={data} onChoose={onChoose} />}
      <output className={styles.status} aria-label="Search results">
        {announcement(isError ? undefined : data, isCurrent)}
      </output>
    </div>
  );
}
