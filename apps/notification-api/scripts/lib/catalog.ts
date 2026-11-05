// The seed's catalog: three Notification types (F5 grants all three), their templates in en-CA and fr-CA, and the
// platform topic (F6). Templates print only contracted data; optional fields go through `default` (R23).

/** Minimal MJML around one paragraph of Liquid text. */
const mjml = (content: string): string =>
  `<mjml><mj-body><mj-section><mj-column><mj-text>${content}</mj-text></mj-column></mj-section></mj-body></mjml>`;

export interface SeedTemplate {
  channel: 'in-app' | 'email' | 'webhook';
  language: string;
  parts: Record<string, string>;
}

export interface SeedType {
  key: string;
  displayName: string;
  dataContract: Record<string, unknown>;
  defaultLanguage: string;
  policy: Record<string, unknown>;
  templates: SeedTemplate[];
}

const permitNumber = { type: 'string', description: 'The permit number' };

/** F1: in-app first, then email after `delayMinutes` unless the item is read (R18). */
function permitApproved(delayMinutes: number): SeedType {
  return {
    key: 'permit-approved',
    displayName: 'Permit approved',
    dataContract: {
      type: 'object',
      properties: { permitNumber, holderName: { type: 'string' } },
      required: ['permitNumber'],
    },
    defaultLanguage: 'en-CA',
    policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes }] },
    templates: [
      {
        channel: 'in-app',
        language: 'en-CA',
        parts: {
          title: 'Permit {{ permitNumber }} approved',
          body: 'Your permit **{{ permitNumber }}** has been approved.',
        },
      },
      {
        channel: 'in-app',
        language: 'fr-CA',
        parts: {
          title: 'Permis {{ permitNumber }} approuvé',
          body: 'Votre permis **{{ permitNumber }}** a été approuvé.',
        },
      },
      {
        channel: 'email',
        language: 'en-CA',
        parts: {
          subject: 'Permit {{ permitNumber }} approved',
          html: mjml('Hello {{ holderName | default: "there" }}, your permit {{ permitNumber }} has been approved.'),
        },
      },
      {
        channel: 'email',
        language: 'fr-CA',
        parts: {
          subject: 'Permis {{ permitNumber }} approuvé',
          html: mjml(
            'Bonjour {{ holderName | default: "madame, monsieur" }}, votre permis {{ permitNumber }} a été approuvé.',
          ),
        },
      },
    ],
  };
}

/** F2: a public form's follow-up email, all at once (address-only recipients have no inbox). */
const formReceived: SeedType = {
  key: 'form-received',
  displayName: 'Form received',
  dataContract: {
    type: 'object',
    properties: { formReference: { type: 'string', description: 'The form submission reference' } },
    required: ['formReference'],
  },
  defaultLanguage: 'en-CA',
  policy: { mode: 'all-at-once', channels: ['email'] },
  templates: [
    {
      channel: 'in-app',
      language: 'en-CA',
      parts: { title: 'Form {{ formReference }} received', body: 'We received your form.' },
    },
    {
      channel: 'email',
      language: 'en-CA',
      parts: {
        subject: 'We received your form {{ formReference }}',
        html: mjml('We received your form {{ formReference }}.'),
      },
    },
    {
      channel: 'email',
      language: 'fr-CA',
      parts: {
        subject: 'Nous avons reçu votre formulaire {{ formReference }}',
        html: mjml('Nous avons reçu votre formulaire {{ formReference }}.'),
      },
    },
  ],
};

/** F3, F6 and the two-worker check: email and webhook at once, plus the in-app item for users. */
const permitStatus: SeedType = {
  key: 'permit-status',
  displayName: 'Permit status changed',
  dataContract: {
    type: 'object',
    properties: { permitNumber, status: { type: 'string', description: 'The new status' } },
    required: ['permitNumber', 'status'],
  },
  defaultLanguage: 'en-CA',
  policy: { mode: 'all-at-once', channels: ['email', 'webhook'] },
  templates: [
    {
      channel: 'in-app',
      language: 'en-CA',
      parts: {
        title: 'Permit {{ permitNumber }}: {{ status }}',
        body: 'Permit **{{ permitNumber }}** is now {{ status }}.',
      },
    },
    {
      channel: 'in-app',
      language: 'fr-CA',
      parts: {
        title: 'Permis {{ permitNumber }} : {{ status }}',
        body: 'Le permis **{{ permitNumber }}** est maintenant {{ status }}.',
      },
    },
    {
      channel: 'email',
      language: 'en-CA',
      parts: {
        subject: 'Permit {{ permitNumber }} is now {{ status }}',
        html: mjml('Permit {{ permitNumber }} is now {{ status }}.'),
      },
    },
    {
      channel: 'email',
      language: 'fr-CA',
      parts: {
        subject: 'Le permis {{ permitNumber }} est maintenant {{ status }}',
        html: mjml('Le permis {{ permitNumber }} est maintenant {{ status }}.'),
      },
    },
    // An empty payload sends the standard envelope (type, recipient, data).
    { channel: 'webhook', language: 'en-CA', parts: {} },
  ],
};

export const TYPE_KEYS = {
  permitApproved: 'permit-approved',
  formReceived: 'form-received',
  permitStatus: 'permit-status',
} as const;

/** The seed's types; `escalationDelayMinutes` is F1's email delay (60 for a demo, 1 in e2e.ts). */
export function seedTypes(escalationDelayMinutes: number): SeedType[] {
  return [permitApproved(escalationDelayMinutes), formReceived, permitStatus];
}

/** The platform topic recipients subscribe to themselves (R17), which the seeded sender may broadcast to (R15). */
export const PLATFORM_TOPIC = { key: 'service-alerts', name: 'Service alerts', selfSubscribe: true } as const;
