// I1 (inbox live path), through the compose edge: the portal relay's live stream signals a new notification within
// two seconds and stays open past 30 seconds on keep-alives; opening a notification by its id and reading it through
// the relay cancels its reminder; an email template links to the notification's portal page; and the header's
// direct mode passes the CORS preflight from the allowed origin only.
import { z } from 'zod';

import { TYPE_KEYS } from '../lib/catalog.ts';
import { expectBody, expectStatus } from '../lib/http.ts';
import type { E2eContext } from './context.ts';
import { openEventStream, type EventStream } from './event-stream.ts';
import { mailTo } from './flows-recipients.ts';
import { send, settled, to } from './notifications.ts';
import { check, sleep, waitFor } from './support.ts';

/** Success Criteria: a new notification reaches an open portal tab within two seconds. */
const SIGNAL_WITHIN_MS = 2000;
/** Past the platform's 30-second idle limit (R30); notification-api sends a keep-alive every 15 seconds. */
const OPEN_FOR_MS = 31_000;
/** compose.yaml's CORS_ALLOWED_ORIGINS for notification-api. */
const ALLOWED_ORIGIN = 'http://localhost:5173';
const UNLISTED_ORIGIN = 'https://unlisted.example.test';
const LANGUAGES = ['en-CA', 'fr-CA'] as const;

const itemSchema = z.object({ id: z.uuid(), notificationId: z.uuid(), readAt: z.string().nullable() });

/** The portal user's relayed stream, as the header opens it (a background request, R35), once it is subscribed. */
async function openRelayedStream(ctx: E2eContext): Promise<EventStream> {
  const stream = await openEventStream(
    'The relayed inbox stream',
    `${ctx.urls.portal}/api/v1/notifications/inbox/stream`,
    {
      cookie: ctx.portalCookie,
      'sdg-background': '1',
    },
  );
  // notification-api subscribes the stream to the user's signals in the same tick it writes `: open`.
  await stream.next('the opening comment', (text) => text === ': open', { timeoutMs: 10_000 });
  return stream;
}

/** Sends a permit approval (in-app now, email after a delay unless read) and expects `changed` within two seconds. */
async function expectLiveSignal(ctx: E2eContext, stream: EventStream): Promise<string> {
  const sentAt = Date.now();
  const notificationId = await send(ctx.notify.a, {
    type: TYPE_KEYS.permitApproved,
    data: { permitNumber: `I1R-${ctx.run}` },
    idempotencyKey: `i1-reminder-${ctx.run}`,
    audience: to({ kind: 'user', ...ctx.me }),
  });
  const signal = await stream.next('event: changed', (text) => text.split('\n').includes('event: changed'), {
    timeoutMs: 10_000,
    since: sentAt,
  });
  const latency = signal.at - sentAt;
  check(latency <= SIGNAL_WITHIN_MS, `The live signal came ${latency} ms after the send, over ${SIGNAL_WITHIN_MS} ms`);
  return notificationId;
}

/** Opens the notification by its id through the relay, as the notification page does, reads it, and expects its
 * pending email reminder to end `cancelled` (R18, R19). */
async function readCancelsReminder(ctx: E2eContext, notificationId: string): Promise<void> {
  const item = await waitFor(`the portal user's item for ${notificationId}`, async () => {
    const reply = await ctx.portal.call('GET', `/api/v1/notifications/inbox/by-notification/${notificationId}`);
    return reply.status === 404 ? undefined : expectBody(reply, 'Opening by notification id', itemSchema);
  });
  const read = await ctx.portal.call('POST', `/api/v1/notifications/inbox/${item.id}/read`);
  check(expectBody(read, 'Marking it read', itemSchema, [200]).readAt !== null, 'The item is not read after reading');
  const found = await settled(ctx.notify.a, notificationId);
  const emails = found.deliveries.filter((delivery) => delivery.channel === 'email');
  check(
    emails.length > 0 && emails.every((delivery) => delivery.status === 'cancelled'),
    `The reminder's email steps are ${emails.map((delivery) => delivery.status).join(', ') || 'missing'}, not cancelled`,
  );
}

/** A new version of the permit status email that links users to the notification's portal page (R36). */
async function saveInboxLinkTemplates(ctx: E2eContext): Promise<void> {
  const link = `${ctx.urls.portal}/inbox/{{ notification.id }}`;
  const html =
    '<mjml><mj-body><mj-section><mj-column><mj-text>Permit {{ permitNumber }} is now {{ status }}.' +
    `{% if recipient.hasInbox %} <a href="${link}">${link}</a>{% endif %}` +
    '</mj-text></mj-column></mj-section></mj-body></mjml>';
  const parts = { subject: 'Permit {{ permitNumber }} is now {{ status }}', html };
  await Promise.all(
    LANGUAGES.map(async (language) => {
      const path = `/api/v1/admin/types/${TYPE_KEYS.permitStatus}/templates/email/${language}/versions`;
      expectStatus(await ctx.notify.admin.call('POST', path, { parts }), `Saving the ${language} inbox link template`);
    }),
  );
}

/** The email the portal user gets carries `/inbox/<notification id>`. */
async function emailLinksToInbox(ctx: E2eContext): Promise<void> {
  await saveInboxLinkTemplates(ctx);
  const permitNumber = `I1L-${ctx.run}`;
  const notificationId = await send(ctx.notify.a, {
    type: TYPE_KEYS.permitStatus,
    data: { permitNumber, status: 'linked' },
    idempotencyKey: `i1-link-${ctx.run}`,
    audience: to({ kind: 'user', ...ctx.me }),
  });
  const message = await mailTo(ctx.mailpit, ctx.idpEmail, permitNumber);
  const text = await ctx.mailpit.text(message.ID);
  check(text.includes(`/inbox/${notificationId}`), `The email has no link to /inbox/${notificationId}`);
}

async function preflight(ctx: E2eContext, origin: string): Promise<Response> {
  const response = await fetch(`${ctx.urls.notify}/api/v1/me/inbox/unread-count`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,sdg-background',
    },
  });
  await response.body?.cancel();
  return response;
}

/** Covers AE11: the direct-mode preflight is allowed from the configured origin and not from an unlisted one. */
async function corsPreflight(ctx: E2eContext): Promise<void> {
  const [allowed, unlisted] = await Promise.all([preflight(ctx, ALLOWED_ORIGIN), preflight(ctx, UNLISTED_ORIGIN)]);
  const allowedHeaders = (allowed.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',');
  check(
    allowed.status < 300 && allowed.headers.get('access-control-allow-origin') === ALLOWED_ORIGIN,
    `The preflight from ${ALLOWED_ORIGIN} got ${allowed.status} without its allow-origin`,
  );
  check(
    allowedHeaders.includes('authorization') && allowedHeaders.includes('sdg-background'),
    `The preflight allows headers "${allowedHeaders.join(',')}", not authorization and sdg-background`,
  );
  check(
    unlisted.headers.get('access-control-allow-origin') === null,
    `The preflight from ${UNLISTED_ORIGIN} got an access-control-allow-origin`,
  );
}

/** The stream is still open `OPEN_FOR_MS` after it opened and passed at least one keep-alive (R30). */
async function expectKeptOpen(stream: EventStream, openedAt: number): Promise<void> {
  await sleep(Math.max(0, openedAt + OPEN_FOR_MS - Date.now()));
  const seconds = Math.round(OPEN_FOR_MS / 1000);
  check(!stream.ended(), `The relayed stream closed within ${seconds} s`);
  const keepAlives = stream.frames().filter((frame) => frame.text === ': keep-alive').length;
  check(keepAlives > 0, `The relayed stream passed no keep-alive in ${seconds} s`);
}

/** I1: the checks share one relayed stream, which stays open while the others run. Adds about 31 seconds. */
export async function inboxLivePath(ctx: E2eContext): Promise<void> {
  const stream = await openRelayedStream(ctx);
  const openedAt = Date.now();
  try {
    const reminderId = await expectLiveSignal(ctx, stream);
    await Promise.all([readCancelsReminder(ctx, reminderId), emailLinksToInbox(ctx), corsPreflight(ctx)]);
    await expectKeptOpen(stream, openedAt);
  } finally {
    stream.close();
  }
}
