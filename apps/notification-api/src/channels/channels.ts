/** The spike's channels (R44). */
export const CHANNELS = ['in-app', 'email', 'webhook'] as const;
export type Channel = (typeof CHANNELS)[number];

/** One part of a channel's template (R21). Every part is template source text. */
export interface TemplatePart {
  readonly name: string;
  /** An optional part may be left out or empty; the declaration's description says what happens then. */
  readonly required: boolean;
  readonly description: string;
}

/**
 * What a channel declares (R44): its template parts (R21), whether recipients can switch it off (R37), what quiet
 * hours do to it (R40), and how its addresses are normalized (KTD17).
 */
export interface ChannelDeclaration {
  readonly channel: Channel;
  readonly templateParts: readonly TemplatePart[];
  /** Whether a recipient's channel switch can turn it off (R37). */
  readonly switchable: boolean;
  /** `hold`: a delivery due in quiet hours waits until they end. `immediate`: quiet hours never hold it (R40). */
  readonly quietHours: 'hold' | 'immediate';
  /** The stored form of a contact point address, for deduplication (KTD14, KTD17). In-app has no addresses. */
  readonly normalizeAddress: ((address: string) => string) | null;
}

export const CHANNEL_DECLARATIONS: Readonly<Record<Channel, ChannelDeclaration>> = {
  email: {
    channel: 'email',
    templateParts: [
      { name: 'subject', required: true, description: 'Liquid; plain text' },
      { name: 'html', required: true, description: 'Liquid producing MJML, compiled to the HTML body' },
      { name: 'text', required: false, description: 'Liquid; plain text. Generated from the HTML when empty' },
    ],
    switchable: true,
    quietHours: 'hold',
    normalizeAddress: (address) => address.trim().toLowerCase(),
  },
  'in-app': {
    channel: 'in-app',
    templateParts: [
      { name: 'title', required: true, description: 'Liquid; plain text' },
      { name: 'body', required: true, description: 'Liquid producing Markdown, rendered to sanitized HTML' },
      {
        name: 'actionUrl',
        required: false,
        description: 'Liquid producing an absolute https URL or a relative path; none when empty',
      },
    ],
    // The inbox is the complete record, so every recipient with one gets the item (R18, R38).
    switchable: false,
    quietHours: 'immediate',
    normalizeAddress: null,
  },
  webhook: {
    channel: 'webhook',
    templateParts: [
      {
        name: 'payload',
        required: false,
        description:
          'A JSON document whose string values are Liquid. The standard envelope (type, recipient, data) when empty',
      },
    ],
    // Webhook recipients are systems, which have no channel switches or quiet hours.
    switchable: false,
    quietHours: 'immediate',
    normalizeAddress: (address) => address.trim(),
  },
};
