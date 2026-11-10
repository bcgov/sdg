import type { SdgHeader } from '@repo/sdg-header';
import { type BoundFunctions, type queries, waitFor, within } from '@testing-library/react';

/** The rendered `<sdg-header>` once its first render is done. */
export async function findSdgHeader(): Promise<SdgHeader> {
  const element = await waitFor(() => {
    const found = document.querySelector('sdg-header');
    if (!found?.shadowRoot) throw new Error('sdg-header not rendered yet');
    return found;
  });
  await element.updateComplete;
  return element;
}

/** Testing Library queries inside `<sdg-header>`'s shadow root, where `screen` can't reach. */
export async function headerQueries(): Promise<BoundFunctions<typeof queries>> {
  const element = await findSdgHeader();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the queries only use querySelectorAll, which a ShadowRoot has.
  return within(element.shadowRoot as unknown as HTMLElement);
}
