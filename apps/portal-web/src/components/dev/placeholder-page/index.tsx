import { InlineAlert } from '@repo/design-system/components/inline-alert';
import type { JSX } from 'react';

import { CodeBlock } from '../code-block';
import { DevPageLayout } from '../dev-page-layout';
import { devPage, importCode, type DevPagePath } from '../dev-pages';
import { DevSection } from '../dev-section';

export interface PlaceholderPageProps {
  to: DevPagePath;
}

const sections = [{ id: 'usage', title: 'Usage' }] as const;

/** A dev page that's listed but not built yet: the component's description and how to import it. */
export function PlaceholderPage({ to }: Readonly<PlaceholderPageProps>): JSX.Element {
  const page = devPage(to);

  return (
    <DevPageLayout title={page.title} description={page.description} sections={sections}>
      <InlineAlert
        variant="info"
        title="Page to come"
        description="This page is a placeholder. Add examples of every variant and state as the component's page is built out."
      />
      <DevSection id="usage" title="Usage">
        <CodeBlock label="Usage" code={importCode(page)} />
      </DevSection>
    </DevPageLayout>
  );
}
