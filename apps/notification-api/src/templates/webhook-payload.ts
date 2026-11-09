export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The payload when a webhook template sets none (R21). */
export interface EnvelopeInput {
  type: string;
  recipientId: string;
  data: Record<string, unknown>;
}

/**
 * A webhook payload template (KTD6): a JSON document whose string values are Liquid. Throws when it is not JSON, so
 * the save is rejected (R24).
 */
export function parsePayloadTemplate(source: string): JsonValue {
  try {
    const parsed: JsonValue = JSON.parse(source);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Not valid JSON: ${error.message}`, { cause: error });
    throw error;
  }
}

/** Every string value in the template, depth first: the Liquid sources it renders. */
export function payloadLeaves(template: JsonValue): string[] {
  if (typeof template === 'string') return [template];
  if (Array.isArray(template)) return template.flatMap(payloadLeaves);
  if (template !== null && typeof template === 'object') return Object.values(template).flatMap(payloadLeaves);
  return [];
}

/**
 * Renders each string value with `renderLeaf` and rebuilds the document around the results, so rendered text is
 * always one JSON string: sender data can never add keys or change the structure (R24). Keys, numbers, booleans and
 * nulls are kept as written.
 */
export async function renderPayload(
  template: JsonValue,
  renderLeaf: (source: string) => Promise<string>,
): Promise<JsonValue> {
  if (typeof template === 'string') return renderLeaf(template);
  if (Array.isArray(template)) return Promise.all(template.map((item) => renderPayload(item, renderLeaf)));
  if (template !== null && typeof template === 'object') {
    const entries = await Promise.all(
      Object.entries(template).map(async ([key, value]) => [key, await renderPayload(value, renderLeaf)] as const),
    );
    return Object.fromEntries(entries);
  }
  return template;
}

/** The standard envelope: the type key, the recipient and the sender's data. */
export function standardEnvelope({ type, recipientId, data }: EnvelopeInput): Record<string, unknown> {
  return { type, recipient: { id: recipientId }, data };
}
