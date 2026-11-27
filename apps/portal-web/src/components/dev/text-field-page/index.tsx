import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { TextField, type TextFieldProps } from '@repo/design-system/components/text-field';
import { faMagnifyingGlass, faXmark, FontAwesomeIcon } from '@repo/design-system/icons';
import { useCallback, useMemo, useState, type JSX } from 'react';

import { CodeBlock } from '../code-block';
import { DevPageLayout } from '../dev-page-layout';
import { devPage, importCode } from '../dev-pages';
import { DevSection } from '../dev-section';
import { ExamplePreview } from '../example-preview';
import { extractExample } from '../extract-example';
import { PropTable, type PropRow } from '../prop-table';
// oxlint-disable-next-line import/default, import/no-self-import -- Vite's `?raw` query makes this file's text the default export, for "Show code".
import source from './index.tsx?raw';

import styles from './text-field-page.module.css';

const page = devPage('/dev/text-field');

const apiRows = [
  [
    'size',
    "'xsmall' | 'small' | 'medium' | 'large'",
    "'medium'",
    'Adds xsmall (24px, label text) and large (48px) to the upstream sizes.',
  ],
] as const satisfies readonly PropRow[];

const sections = [
  { id: 'full-example', title: 'Full example' },
  { id: 'usage', title: 'Usage' },
  { id: 'sizes', title: 'Sizes' },
  { id: 'icons', title: 'Icons' },
  { id: 'states', title: 'States' },
  { id: 'api', title: 'API' },
] as const;

const label = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// #region sizes
const sizes: NonNullable<TextFieldProps['size']>[] = ['xsmall', 'small', 'medium', 'large'];
// #endregion sizes

// #region icons
const SEARCH_ICON = <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />;
const CLEAR_ICON = <FontAwesomeIcon icon={faXmark} aria-hidden="true" />;

/** A search field with an icon on the left and, once it has text, a clear button on the right. */
function SearchField({ size }: Readonly<{ size: NonNullable<TextFieldProps['size']> }>): JSX.Element {
  const [value, setValue] = useState('Fishing licence');
  const clear = useCallback(() => setValue(''), []);
  const hasValue = value !== '';
  const clearButton = useMemo(
    () =>
      hasValue ? (
        <Button variant="tertiary" size="xsmall" isIconButton aria-label="Clear search" onPress={clear}>
          {CLEAR_ICON}
        </Button>
      ) : undefined,
    [hasValue, clear],
  );
  return (
    <TextField
      size={size}
      aria-label={`${label(size)} search`}
      iconLeft={SEARCH_ICON}
      iconRight={clearButton}
      value={value}
      onChange={setValue}
    />
  );
}
// #endregion icons

// #region states
function StateExamples({ size }: Readonly<{ size: NonNullable<TextFieldProps['size']> }>): JSX.Element {
  return (
    <div className={styles['rows']}>
      <TextField label={`${label(size)} required`} size={size} isRequired />
      <TextField label={`${label(size)} invalid`} size={size} isInvalid errorMessage="Enter a valid value." />
      <TextField label={`${label(size)} disabled`} size={size} isDisabled defaultValue="Can't change this" />
      <TextField label={`${label(size)} read only`} size={size} isReadOnly defaultValue="Read only" />
    </div>
  );
}
// #endregion states

export function TextFieldPage(): JSX.Element {
  return (
    <DevPageLayout title={page.title} description={page.description} sections={sections}>
      <DevSection id="full-example" title="Full example">
        <ExamplePreview label="Full example" code={extractExample(source, 'full-example')}>
          {/* #region full-example */}
          <TextField
            label="Email address"
            description="We'll send your confirmation here."
            type="email"
            size="large"
            isRequired
          />
          {/* #endregion full-example */}
        </ExamplePreview>
      </DevSection>

      <DevSection id="usage" title="Usage">
        <CodeBlock label="Usage" code={importCode(page)} />
      </DevSection>

      <DevSection
        id="sizes"
        title="Sizes"
        description="xsmall and large are this repo's additions; small and medium are the upstream field, untouched."
      >
        <ExamplePreview label="Sizes" code={extractExample(source, 'sizes')}>
          <div className={styles['rows']}>
            {/* #region sizes */}
            {sizes.map((size) => (
              <TextField key={size} label={label(size)} size={size} defaultValue="Example text" />
            ))}
            {/* #endregion sizes */}
          </div>
        </ExamplePreview>
      </DevSection>

      <DevSection
        id="icons"
        title="Icons"
        description="iconLeft and iconRight at each size. In an xsmall field, icons drop to 14px and icon buttons to 16px so they stay inside the border."
      >
        <ExamplePreview label="Icons" code={extractExample(source, 'icons')}>
          <div className={styles['rows']}>
            {sizes.map((size) => (
              <section key={size} className={styles['example']} aria-labelledby={`text-field-${size}-heading`}>
                <Heading level={3} id={`text-field-${size}-heading`}>
                  {label(size)}
                </Heading>
                <SearchField size={size} />
              </section>
            ))}
          </div>
        </ExamplePreview>
      </DevSection>

      <DevSection id="states" title="States" description="Required, invalid, disabled and read-only at each size.">
        <ExamplePreview label="States" code={extractExample(source, 'states')}>
          <div className={styles['rows']}>
            {sizes.map((size) => (
              <section key={size} className={styles['example']} aria-labelledby={`text-field-${size}-states-heading`}>
                <Heading level={3} id={`text-field-${size}-states-heading`}>
                  {label(size)}
                </Heading>
                <StateExamples size={size} />
              </section>
            ))}
          </div>
        </ExamplePreview>
      </DevSection>

      <DevSection
        id="api"
        title="API"
        description="Every other prop is the upstream BCDS text field's, passed straight through."
      >
        <PropTable caption="Props this repo changes" rows={apiRows} />
      </DevSection>
    </DevPageLayout>
  );
}
