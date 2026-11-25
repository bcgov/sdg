import { Button } from '@repo/design-system/components/button';
import { TextField } from '@repo/design-system/components/text-field';
import { faMagnifyingGlass, FontAwesomeIcon } from '@repo/design-system/icons';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState, type SubmitEvent } from 'react';

import styles from './service-search.module.css';

const SEARCH_ICON = <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />;

/**
 * react-aria types `placeholder` on `Input`, not `TextField`, and bcgov's TextField renders its own Input. TextField
 * still hands `placeholder` to the input at runtime, so it goes in untyped; the home page's tests check it lands.
 */
const PLACEHOLDER_PROPS: object = { placeholder: 'Search for services' };

interface ServiceSearchProps {
  /** Positions the `<search>` element in its page (the home page centres it on the hero's edge). */
  className?: string;
  /** The query to start with, e.g. the Services page's current `q`. */
  defaultQuery?: string;
}

/** The services search: a field and a Search button that go to /services with the trimmed query. */
export function ServiceSearch({ className, defaultQuery = '' }: Readonly<ServiceSearchProps>) {
  const [query, setQuery] = useState(defaultQuery);
  const navigate = useNavigate();

  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const q = query.trim();
      void navigate({ to: '/services', search: q ? { q } : {} });
    },
    [navigate, query],
  );

  return (
    <search className={className}>
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
