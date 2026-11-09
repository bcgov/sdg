// The shapes of the values some columns hold (`$type<...>()`): jsonb documents and text unions the app validates
// before writing. notification-api's own definitions must stay assignable to these.

/** A delivery channel. */
export type Channel = 'in-app' | 'email' | 'webhook';

/** The channels a delivery policy governs. In-app is never one: every recipient with an inbox gets the in-app item. */
export type PolicyChannel = Exclude<Channel, 'in-app'>;

/** One escalation step: its channel and the minutes after the previous step's final status. */
export interface EscalationStep {
  channel: PolicyChannel;
  delayMinutes: number;
}

/** A Notification type's delivery policy: every channel at once, or ordered escalation steps. */
export type DeliveryPolicy =
  | { mode: 'all-at-once'; channels: PolicyChannel[] }
  | { mode: 'escalation'; steps: EscalationStep[] };

export type ScalarType = 'string' | 'number' | 'integer' | 'boolean';

export interface ScalarProperty {
  type: ScalarType;
  description?: string | undefined;
}

export interface ArrayProperty {
  type: 'array';
  items: ContractProperty;
  description?: string | undefined;
}

export interface ObjectProperty {
  type: 'object';
  properties: Record<string, ContractProperty>;
  required?: string[] | undefined;
  description?: string | undefined;
}

export type ContractProperty = ScalarProperty | ArrayProperty | ObjectProperty;

/** A Notification type's data contract: the subset of JSON Schema the platform supports, an object at the top. */
export type DataContract = ObjectProperty;

/** One channel's rendered content. */
export type RenderedParts =
  | { channel: 'email'; subject: string; html: string; text: string }
  /** `title` is plain text; `body` is sanitized HTML; `actionUrl` is an absolute https URL, a relative path or null. */
  | { channel: 'in-app'; title: string; body: string; actionUrl: string | null }
  /** `payload` is JSON text. */
  | { channel: 'webhook'; payload: string };

/** The template, layout and partial versions a notification renders with, recorded at accept. */
export interface PinnedTemplates {
  typeKey: string;
  /** The type's default language at accept, for recipients whose language has no template. */
  defaultLanguage: string;
  /** Template version ids by channel, then language. A channel the type has no template for is absent. */
  templates: Partial<Record<Channel, Record<string, string>>>;
  /** Layout and partial version ids by name: every one the pinned templates reach. */
  fragments: Record<string, string>;
}
