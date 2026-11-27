import { Button, type ButtonProps } from '@repo/design-system/components/button';
import { ButtonGroup } from '@repo/design-system/components/button-group';
import { Heading } from '@repo/design-system/components/heading';
import type { JSX } from 'react';

import { CodeBlock } from '../code-block';
import { DevPageLayout } from '../dev-page-layout';
import { devPage, importCode } from '../dev-pages';
import { DevSection } from '../dev-section';
import { ExamplePreview } from '../example-preview';
import { extractExample } from '../extract-example';
import { PropTable, type PropRow } from '../prop-table';
// oxlint-disable-next-line import/default, import/no-self-import -- Vite's `?raw` query makes this file's text the default export, for "Show code".
import source from './index.tsx?raw';

import styles from './button-page.module.css';

const page = devPage('/dev/button');

const apiRows = [
  [
    'variant',
    "'primary' | 'secondary' | 'tertiary' | 'link' | 'warning'",
    "'primary'",
    'Adds warning to the upstream variants.',
  ],
  ['danger', 'boolean', 'false', 'Wins over warning: renders the upstream primary danger button.'],
] as const satisfies readonly PropRow[];

const sections = [
  { id: 'full-example', title: 'Full example' },
  { id: 'usage', title: 'Usage' },
  { id: 'variants', title: 'Variants' },
  { id: 'warning', title: 'Warning variant' },
  { id: 'api', title: 'API' },
] as const;

const label = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// #region variants
const variants: NonNullable<ButtonProps['variant']>[] = ['primary', 'secondary', 'tertiary', 'link', 'warning'];
const sizes: NonNullable<ButtonProps['size']>[] = ['xsmall', 'small', 'medium', 'large'];

function VariantExamples({ variant }: Readonly<{ variant: NonNullable<ButtonProps['variant']> }>): JSX.Element {
  return (
    <div className={styles['rows']}>
      <ButtonGroup ariaLabel={`${label(variant)} sizes`}>
        {sizes.map((size) => (
          <Button key={size} variant={variant} size={size}>
            {label(size)}
          </Button>
        ))}
      </ButtonGroup>
      <ButtonGroup ariaLabel={`${label(variant)} states`}>
        <Button variant={variant} danger>
          Danger
        </Button>
        <Button variant={variant} isDisabled>
          Disabled
        </Button>
      </ButtonGroup>
    </div>
  );
}
// #endregion variants

export function ButtonPage(): JSX.Element {
  return (
    <DevPageLayout title={page.title} description={page.description} sections={sections}>
      <DevSection id="full-example" title="Full example">
        <ExamplePreview label="Full example" code={extractExample(source, 'full-example')}>
          {/* #region full-example */}
          <ButtonGroup ariaLabel="Form actions">
            <Button variant="primary">Submit</Button>
            <Button variant="secondary">Save for later</Button>
            <Button variant="warning">Reset form</Button>
          </ButtonGroup>
          {/* #endregion full-example */}
        </ExamplePreview>
      </DevSection>

      <DevSection id="usage" title="Usage">
        <CodeBlock label="Usage" code={importCode(page)} />
      </DevSection>

      <DevSection
        id="variants"
        title="Variants"
        description="Every variant at each size, then its danger and disabled states."
      >
        <ExamplePreview label="Variants" code={extractExample(source, 'variants')}>
          <div className={styles['rows']}>
            {variants.map((variant) => (
              <section key={variant} aria-labelledby={`button-${variant}-heading`}>
                <Heading level={3} id={`button-${variant}-heading`}>
                  {label(variant)}
                </Heading>
                <VariantExamples variant={variant} />
              </section>
            ))}
          </div>
        </ExamplePreview>
      </DevSection>

      <DevSection id="warning" title="Warning variant">
        <p>
          This repo's addition: B.C. gold, for actions that need care but aren't destructive. With <code>danger</code>{' '}
          it renders the upstream primary danger button instead.
        </p>
        <ExamplePreview label="Warning variant" code={extractExample(source, 'warning')}>
          {/* #region warning */}
          <ButtonGroup ariaLabel="Warning examples">
            <Button variant="warning">Reset form</Button>
            <Button variant="warning" danger>
              Delete draft
            </Button>
          </ButtonGroup>
          {/* #endregion warning */}
        </ExamplePreview>
      </DevSection>

      <DevSection
        id="api"
        title="API"
        description="Every other prop is the upstream BCDS button's, passed straight through."
      >
        <PropTable caption="Props this repo changes" rows={apiRows} />
      </DevSection>
    </DevPageLayout>
  );
}
