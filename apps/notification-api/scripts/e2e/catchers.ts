// The local stack's catchers as scripts/e2e.ts reads them: Mailpit's API and the webhook receiver
// (scripts/webhook-receiver.ts), both on host ports compose publishes to localhost.
import { z } from 'zod';

import { api, expectBody } from '../lib/http.ts';

const mailSummarySchema = z.object({
  ID: z.string(),
  Subject: z.string(),
  From: z.object({ Address: z.string() }),
  To: z.array(z.object({ Address: z.string() })),
});
export type MailSummary = z.infer<typeof mailSummarySchema>;

const searchSchema = z.object({ messages: z.array(mailSummarySchema) });
const messageSchema = z.object({ Text: z.string() });

export interface Mailpit {
  /** Messages to `address`, newest first. */
  messagesTo(address: string): Promise<MailSummary[]>;
  /** A message's plain-text body. */
  text(id: string): Promise<string>;
}

export function mailpit(baseUrl: string): Mailpit {
  const http = api(baseUrl);
  return {
    async messagesTo(address) {
      const query = encodeURIComponent(`to:"${address}"`);
      const reply = await http.call('GET', `/api/v1/search?query=${query}&limit=200`);
      const { messages } = expectBody(reply, 'Searching Mailpit', searchSchema);
      // Mailpit's to: search matches substrings; keep exact recipients only.
      return messages.filter((message) => message.To.some((to) => to.Address.toLowerCase() === address));
    },
    async text(id) {
      return expectBody(await http.call('GET', `/api/v1/message/${id}`), 'Reading a Mailpit message', messageSchema)
        .Text;
    },
  };
}

const recordedSchema = z.object({
  method: z.string(),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
});
export type Recorded = z.infer<typeof recordedSchema>;

export interface WebhookReceiver {
  /** The requests to paths under `prefix`, oldest first. */
  requests(prefix: string): Promise<Recorded[]>;
}

export function webhookReceiver(baseUrl: string): WebhookReceiver {
  const http = api(baseUrl);
  return {
    async requests(prefix) {
      const reply = await http.call('GET', `/requests?path=${encodeURIComponent(prefix)}`);
      return expectBody(reply, 'Reading the webhook receiver', z.array(recordedSchema));
    },
  };
}
