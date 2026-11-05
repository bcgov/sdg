import { requiredSampleData, sampleData, type DataContract } from '../catalog/data-contract.js';
import type { Channel } from '../channels/channels.js';
import { referencedNames, type FragmentSources } from './engines.js';
import { errorMessage, TemplateRenderError } from './render-error.js';
import { partSources, renderParts, type TemplateParts } from './renderer.js';
import type { PinnedFragment } from './template-store.js';

/** The recipient id previews and test renders put in a webhook's standard envelope. */
export const SAMPLE_RECIPIENT_ID = '00000000-0000-4000-8000-000000000000';

export interface TestRenderInput {
  typeKey: string;
  channel: Channel;
  language: string;
  contract: DataContract;
  parts: TemplateParts;
  fragments: FragmentSources;
  timeZone: string;
}

/** Layout and partial sources by name, from a closure (template-store.ts). */
export function fragmentSources(fragments: ReadonlyMap<string, PinnedFragment>): FragmentSources {
  return Object.fromEntries([...fragments].map(([name, fragment]) => [name, fragment.source]));
}

/**
 * The layouts and partials a template's parts name (KTD7). Throws a TemplateRenderError for a part that does not
 * parse.
 */
export function templateReferences(channel: Channel, parts: TemplateParts): string[] {
  const names = partSources(channel, parts).flatMap(({ part, source }) => {
    try {
      return referencedNames([source]);
    } catch (error) {
      throw new TemplateRenderError(part, errorMessage(error), { cause: error });
    }
  });
  return [...new Set(names)];
}

/**
 * Test-renders a template against its type's data contract (R23): once with every field filled, once with only the
 * required fields, both with strict MJML validation. Returns each failure, prefixed with the pass; empty when both
 * render.
 */
export async function testRender(input: TestRenderInput): Promise<string[]> {
  const passes = [
    { name: 'With sample data', data: sampleData(input.contract) },
    { name: 'With only the required fields', data: requiredSampleData(input.contract) },
  ];
  const results = await Promise.all(
    passes.map(async ({ name, data }) => {
      try {
        await renderParts({
          channel: input.channel,
          parts: input.parts,
          fragments: input.fragments,
          locale: { language: input.language, timeZone: input.timeZone },
          data,
          envelope: { type: input.typeKey, recipientId: SAMPLE_RECIPIENT_ID },
          strict: true,
        });
        return null;
      } catch (error) {
        if (error instanceof TemplateRenderError) return `${name}: ${error.message}`;
        throw error;
      }
    }),
  );
  return results.filter((result) => result !== null);
}
