import type { Channel, RenderedParts } from '@repo/notification-database';
import { convert } from 'html-to-text';

import { createEngine, renderSource, type FragmentSources } from './engines.js';
import type { RenderLocale } from './filters.js';
import { markdownToHtml } from './markdown.js';
import { compileMjml } from './mjml.js';
import type { NotificationVariables } from './notification-variables.js';
import { errorMessage, renderingPart, TemplateRenderError } from './render-error.js';
import { parsePayloadTemplate, payloadLeaves, renderPayload, standardEnvelope } from './webhook-payload.js';

export type TemplateParts = Readonly<Record<string, string>>;

export interface RenderInput {
  channel: Channel;
  parts: TemplateParts;
  /** The pinned layouts and partials (KTD7). */
  fragments: FragmentSources;
  locale: RenderLocale;
  /** The sender's data, which templates see by field name. */
  data: Record<string, unknown>;
  /** The notification's variables; absent for a platform email that is not a notification. */
  variables?: NotificationVariables | undefined;
  /** What the webhook's standard envelope names. */
  envelope: { type: string; recipientId: string };
  /** On save, MJML validation is strict (KTD6). */
  strict: boolean;
}

/** The templates' variables: the sender's data, then the notification's variables over it. */
const scope = ({ data, variables }: RenderInput): Record<string, unknown> => ({ ...data, ...variables });

const isBlank = (source: string | undefined): source is undefined => source === undefined || source.trim() === '';

async function renderEmail(input: RenderInput): Promise<RenderedParts> {
  const { parts, fragments, locale } = input;
  const data = scope(input);
  const html = createEngine('html', fragments, locale);
  const text = createEngine('text', fragments, locale);
  const textSource = parts['text'];
  const [subject, body, plain] = await Promise.all([
    renderingPart('subject', () => renderSource(text, parts['subject'] ?? '', data)),
    renderingPart('html', async () =>
      compileMjml(await renderSource(html, parts['html'] ?? '', data), { strict: input.strict }),
    ),
    isBlank(textSource) ? null : renderingPart('text', () => renderSource(text, textSource, data)),
  ]);
  return { channel: 'email', subject, html: body, text: plain ?? convert(body, { wordwrap: 78 }) };
}

const RELATIVE_BASE = new URL('https://relative.invalid/');

/**
 * The rendered action link when it is an absolute https URL or a relative path, null when empty (KTD6). Anything
 * else (`javascript:`, `//host`, `/\host`) fails the render. URL parsing matches the browser's, so tabs, newlines
 * and backslashes cannot disguise a scheme or a host.
 */
function checkActionLink(rendered: string): string | null {
  const link = rendered.trim();
  if (link === '') return null;
  if (URL.canParse(link)) {
    if (new URL(link).protocol !== 'https:') throw new Error('Must be an absolute https URL or a relative path');
    return link;
  }
  if (URL.parse(link, RELATIVE_BASE)?.origin !== RELATIVE_BASE.origin) {
    throw new Error('Must be an absolute https URL or a relative path');
  }
  return link;
}

async function renderInApp(input: RenderInput): Promise<RenderedParts> {
  const { parts, fragments, locale } = input;
  const data = scope(input);
  const text = createEngine('text', fragments, locale);
  const actionSource = parts['actionUrl'];
  const [title, body, actionUrl] = await Promise.all([
    renderingPart('title', () => renderSource(text, parts['title'] ?? '', data)),
    renderingPart('body', async () => markdownToHtml(await renderSource(text, parts['body'] ?? '', data))),
    isBlank(actionSource)
      ? null
      : renderingPart('actionUrl', async () => checkActionLink(await renderSource(text, actionSource, data))),
  ]);
  return { channel: 'in-app', title, body, actionUrl };
}

async function renderWebhook(input: RenderInput): Promise<RenderedParts> {
  const { parts, data, fragments, locale, envelope } = input;
  const source = parts['payload'];
  if (isBlank(source)) {
    return { channel: 'webhook', payload: JSON.stringify(standardEnvelope({ ...envelope, data })) };
  }
  const text = createEngine('text', fragments, locale);
  const variables = scope(input);
  const payload = await renderingPart('payload', () =>
    renderPayload(parsePayloadTemplate(source), (leaf) => renderSource(text, leaf, variables)),
  );
  return { channel: 'webhook', payload: JSON.stringify(payload) };
}

const renderers: Record<Channel, (input: RenderInput) => Promise<RenderedParts>> = {
  email: renderEmail,
  'in-app': renderInApp,
  webhook: renderWebhook,
};

/** Renders one channel's template parts with sandboxed Liquid and that channel's output rules (R20, R21, R24). */
export function renderParts(input: RenderInput): Promise<RenderedParts> {
  return renderers[input.channel](input);
}

/**
 * Each part's Liquid sources: the part itself, or a webhook payload's string values. Throws a TemplateRenderError
 * for a payload that is not JSON (R24).
 */
export function partSources(channel: Channel, parts: TemplateParts): { part: string; source: string }[] {
  if (channel !== 'webhook') return Object.entries(parts).map(([part, source]) => ({ part, source }));
  const payload = parts['payload'];
  if (isBlank(payload)) return [];
  try {
    return payloadLeaves(parsePayloadTemplate(payload)).map((source) => ({ part: 'payload', source }));
  } catch (error) {
    throw new TemplateRenderError('payload', errorMessage(error), { cause: error });
  }
}
