import { type BoundFunctions, type queries, waitFor, within } from '@testing-library/react';

/** The `<sdg-header>` once its shadow root holds the first render (Preact renders on connect, possibly async). */
export async function findSdgHeader(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector<HTMLElement>('sdg-header');
    if (!found?.shadowRoot?.querySelector('header')) throw new Error('sdg-header not rendered yet');
    return found;
  });
}

/** Testing Library queries inside `<sdg-header>`'s shadow root, where `screen` can't reach. */
export async function headerQueries(): Promise<BoundFunctions<typeof queries>> {
  const element = await findSdgHeader();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the queries only use querySelectorAll, which a ShadowRoot has.
  return within(element.shadowRoot as unknown as HTMLElement);
}
