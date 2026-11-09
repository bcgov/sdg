// The seed's find-or-create steps (scripts/seed.ts). Each step reads what is there and writes only what is missing,
// so running the seed again finishes a partial seed and changes nothing after a full one. notification-api has no
// list of senders and sender names aren't unique, so the sender is found among the platform topic's broadcasters.
import { z } from 'zod';

import { PLATFORM_TOPIC, TYPE_KEYS, type SeedType } from './catalog.ts';
import { expectBody, expectStatus, type Api } from './http.ts';

const personSchema = z.object({ issuer: z.string(), subject: z.string() });
export type Person = z.infer<typeof personSchema>;

/** The seed's sender, found by this name among the platform topic's broadcasters. */
const SENDER_NAME = 'Permits Office';

const credentialSchema = z.object({ id: z.uuid(), clientId: z.string(), scopedTypes: z.array(z.string()) });
export type Credential = z.infer<typeof credentialSchema>;

const senderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  owners: z.array(personSchema),
  grantedTypes: z.array(z.string()),
  callbackUrl: z.string().nullable(),
});
type Sender = z.infer<typeof senderSchema>;

const topicSchema = z.object({ id: z.uuid(), key: z.string(), broadcasters: z.array(z.uuid()) });
type PlatformTopic = z.infer<typeof topicSchema>;

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item) => b.includes(item));

/** The keys of the catalog's types. Stops first when the admin API refuses the token. */
async function existingTypeKeys(admin: Api): Promise<Set<string>> {
  const reply = await admin.call('GET', '/api/v1/admin/types');
  if (reply.status === 401 || reply.status === 403) {
    throw new Error(`The admin API answered ${reply.status}: the token needs notification-api's admin client role`);
  }
  const types = expectBody(reply, 'Listing the types', z.array(z.object({ key: z.string() })));
  return new Set(types.map((type) => type.key));
}

/** The type, then each of its templates that has no version yet. */
async function ensureType(admin: Api, { templates, ...definition }: SeedType, exists: boolean): Promise<void> {
  const saved = new Set<string>();
  if (exists) {
    const reply = await admin.call('GET', `/api/v1/admin/types/${definition.key}/templates`);
    const current = expectBody(
      reply,
      `Listing ${definition.key} templates`,
      z.array(z.object({ channel: z.string(), language: z.string() })),
    );
    for (const { channel, language } of current) saved.add(`${channel}/${language}`);
  } else {
    expectStatus(await admin.call('POST', '/api/v1/admin/types', definition), `Creating type ${definition.key}`);
  }
  const missing = templates.filter(({ channel, language }) => !saved.has(`${channel}/${language}`));
  await Promise.all(
    missing.map(async ({ channel, language, parts }) => {
      const path = `/api/v1/admin/types/${definition.key}/templates/${channel}/${language}/versions`;
      expectStatus(await admin.call('POST', path, { parts }), `Saving ${definition.key} ${channel} ${language}`);
    }),
  );
}

export async function ensureTypes(admin: Api, types: readonly SeedType[]): Promise<void> {
  const existing = await existingTypeKeys(admin);
  await Promise.all(types.map((type) => ensureType(admin, type, existing.has(type.key))));
}

/** The platform topic with the seed's key, created when there is none. */
export async function ensurePlatformTopic(admin: Api): Promise<PlatformTopic> {
  const topics = expectBody(
    await admin.call('GET', '/api/v1/admin/topics'),
    'Listing platform topics',
    z.array(topicSchema),
  );
  const found = topics.find((topic) => topic.key === PLATFORM_TOPIC.key);
  if (found) return found;
  return expectBody(
    await admin.call('POST', '/api/v1/admin/topics', PLATFORM_TOPIC),
    'Creating the topic',
    topicSchema,
  );
}

async function readSender(admin: Api, senderId: string): Promise<Sender> {
  return expectBody(await admin.call('GET', `/api/v1/senders/${senderId}`), `Reading sender ${senderId}`, senderSchema);
}

/**
 * The seed's sender among the topic's broadcasters. When there is none, creates it and grants it the topic before
 * anything else, so a later run finds it even if a following step fails.
 */
async function findOrCreateSender(admin: Api, topic: PlatformTopic): Promise<Sender> {
  const broadcasters = await Promise.all(topic.broadcasters.map((id) => readSender(admin, id)));
  const found = broadcasters.find((sender) => sender.name === SENDER_NAME);
  if (found) return found;
  const reply = await admin.call('POST', '/api/v1/admin/senders', { name: SENDER_NAME });
  const created = expectBody(reply, 'Creating the sender', senderSchema);
  const path = `/api/v1/admin/topics/${topic.id}/broadcasters/${created.id}`;
  expectStatus(await admin.call('PUT', path), 'Granting the sender the platform topic');
  return created;
}

/** The seed's sender, granted the topic and every seed type and owned by `owner`. */
export async function ensureSender(admin: Api, topic: PlatformTopic, owner: Person): Promise<Sender> {
  const sender = await findOrCreateSender(admin, topic);
  const grants = Object.values(TYPE_KEYS)
    .filter((typeKey) => !sender.grantedTypes.includes(typeKey))
    .map(async (typeKey) => {
      const path = `/api/v1/admin/senders/${sender.id}/grants/${typeKey}`;
      expectStatus(await admin.call('PUT', path), `Granting ${typeKey}`);
    });
  const owned = sender.owners.some((person) => person.issuer === owner.issuer && person.subject === owner.subject);
  const addOwner = async () => {
    const path = `/api/v1/admin/senders/${sender.id}/owners`;
    expectStatus(await admin.call('POST', path, owner), 'Adding the admin as owner');
  };
  await Promise.all([...(owned ? [] : [addOwner()]), ...grants]);
  return sender;
}

/** Links `clientId` unless the sender already has it, then scopes it to `typeKeys` unless it already is. */
async function ensureCredential(
  owner: Api,
  senderId: string,
  linked: readonly Credential[],
  clientId: string,
  typeKeys: readonly string[],
): Promise<Credential> {
  let credential = linked.find((candidate) => candidate.clientId === clientId);
  if (!credential) {
    const reply = await owner.call('POST', `/api/v1/senders/${senderId}/credentials`, { clientId });
    credential = expectBody(reply, `Linking credential ${clientId}`, credentialSchema);
  }
  if (sameSet(credential.scopedTypes, typeKeys)) return credential;
  const path = `/api/v1/senders/${senderId}/credentials/${credential.id}/scopes`;
  return expectBody(await owner.call('PUT', path, { typeKeys }), `Scoping ${clientId}`, credentialSchema);
}

/** Both clients linked and scoped (R8): the first to every granted type, the second to `form-received` (F5). */
export async function ensureCredentials(
  owner: Api,
  senderId: string,
  [clientA, clientB]: readonly [string, string],
): Promise<{ a: Credential; b: Credential }> {
  const reply = await owner.call('GET', `/api/v1/senders/${senderId}/credentials`);
  const linked = expectBody(reply, 'Listing credentials', z.array(credentialSchema));
  const [a, b] = await Promise.all([
    ensureCredential(owner, senderId, linked, clientA, Object.values(TYPE_KEYS)),
    ensureCredential(owner, senderId, linked, clientB, [TYPE_KEYS.formReceived]),
  ]);
  return { a, b };
}

/** Points the failure callback at `url` unless it already is. The reply's signing secret is not printed. */
export async function ensureCallback(owner: Api, sender: Sender, url: string): Promise<void> {
  if (sender.callbackUrl === url) return;
  const reply = await owner.call('PUT', `/api/v1/senders/${sender.id}/callback`, { url });
  expectStatus(reply, 'Setting the failure callback');
}
