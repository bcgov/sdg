import { Button } from '@repo/design-system/components/button';
import { TextField } from '@repo/design-system/components/text-field';
import { faMagnifyingGlass, FontAwesomeIcon } from '@repo/design-system/icons';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState, type FormEvent } from 'react';

import styles from './home-page.module.css';

const SEARCH_ICON = <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />;

/**
 * react-aria types `placeholder` on `Input`, not `TextField`, and bcgov's TextField renders its own Input. TextField
 * still hands `placeholder` to the input at runtime, so it goes in untyped; home-page.test.tsx checks it lands.
 */
const PLACEHOLDER_PROPS: object = { placeholder: 'Search for services' };

export function HomeSearch() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const q = query.trim();
      void navigate({ to: '/services', search: q ? { q } : {} });
    },
    [navigate, query],
  );

  return (
    <search className={styles['search']}>
      <form className={styles['searchForm']} onSubmit={submit}>
        <TextField
          className={styles['searchField']}
          aria-label="Search for services"
          {...PLACEHOLDER_PROPS}
          iconLeft={SEARCH_ICON}
          value={query}
          onChange={setQuery}
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>
    </search>
  );
}
