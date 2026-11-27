import { Button } from '@repo/design-system/components/button';
import { TextField, type TextFieldProps } from '@repo/design-system/components/text-field';
import { Tooltip, TooltipTrigger } from '@repo/design-system/components/tooltip';
import { faMagnifyingGlass, faXmark, FontAwesomeIcon } from '@repo/design-system/icons';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState, type ReactNode, type SubmitEvent } from 'react';

import styles from './service-search.module.css';

const SEARCH_ICON = <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />;
const CLEAR_ICON = <FontAwesomeIcon icon={faXmark} aria-hidden="true" />;

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
  /** Extra controls after the Search button, e.g. the Services page's Search tools button. */
  children?: ReactNode;
  /** The field's and Search button's size. Defaults to `large`. */
  size?: 'xsmall' | 'small' | 'medium' | 'large';
}

/**
 * The services search: a field (with a clear button once it has text) and a Search button that go to /services with
 * the trimmed query.
 */
export function ServiceSearch({
  className,
  defaultQuery = '',
  children,
  size = 'large',
}: Readonly<ServiceSearchProps>) {
  const [query, setQuery] = useState(defaultQuery);
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);

  // Empties the field and puts the focus back in it (the clear button disappears with the text).
  const clear = useCallback(() => {
    setQuery('');
    formRef.current?.querySelector('input')?.focus();
  }, []);

  const hasQuery = query !== '';
  const clearButton = useMemo(
    () =>
      hasQuery ? (
        <TooltipTrigger delay={300}>
          <Button variant="tertiary" size="xsmall" isIconButton aria-label="Clear search" onPress={clear}>
            {CLEAR_ICON}
          </Button>
          <Tooltip placement="top">Clear search</Tooltip>
        </TooltipTrigger>
      ) : undefined,
    [hasQuery, clear],
  );

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
      <form ref={formRef} className={styles['searchForm']} onSubmit={submit}>
        <TextField
          className={styles['searchField']}
          size={size satisfies TextFieldProps['size']}
          aria-label="Search for services"
          {...PLACEHOLDER_PROPS}
          iconLeft={SEARCH_ICON}
          iconRight={clearButton}
          value={query}
          onChange={setQuery}
        />
        <Button type="submit" variant="primary" size={size}>
          Search
        </Button>
        {children}
      </form>
    </search>
  );
}
