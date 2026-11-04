import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { typeDefinition } from '../testing/catalog.js';
import { bearer, createSender } from '../testing/senders.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { contractValidator } from './data-contract.js';
import { TypesService } from './types.service.js';

let t: TestApp;
let issuer: TestIssuer;
let adminToken: string;
let admin: { authorization: string };

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch });
  adminToken = await issuer.ownClientUserToken({ admin: true });
  admin = bearer(adminToken);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const typesPath = '/api/v1/admin/types';

const permitApproved = {
  key: 'permit-approved',
  displayName: 'Permit approved',
  dataContract: {
    type: 'object',
    properties: {
      permitNumber: { type: 'string' },
      holder: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    required: ['permitNumber', 'holder'],
  },
  defaultLanguage: 'en-ca',
  policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] },
};

describe('admin Notification types (R13, R14)', () => {
  it('defines a type with a data contract, a canonical default language and an escalation policy', async () => {
    const created = await t.http().post(typesPath).set(admin).send(permitApproved);

    expect(created.status).toBe(201);
    const expected = { ...permitApproved, defaultLanguage: 'en-CA' };
    expect(created.body).toEqual(expected);
    const [read, list] = await Promise.all([
      t.http().get(`${typesPath}/permit-approved`).set(admin),
      t.http().get(typesPath).set(admin),
    ]);
    expect(read.body).toEqual(expected);
    expect(list.body).toContainEqual(expected);
  });

  it('gives sends the stored contract as a validator', async () => {
    const key = 'contract-for-sends';
    expect(
      (
        await t
          .http()
          .post(typesPath)
          .set(admin)
          .send({ ...permitApproved, key })
      ).status,
    ).toBe(201);

    const type = await t.app.get(TypesService).find(key);
    if (!type) throw new Error('The type was not stored');
    const validate = contractValidator(type.dataContract);
    expect(validate.safeParse({ permitNumber: 'P-1', holder: { name: 'Jane' } }).success).toBe(true);
    expect(validate.safeParse({ permitNumber: 'P-1', holder: {} }).success).toBe(false);
  });

  it('rejects a policy naming in-app as a step, and stores nothing', async () => {
    const res = await t
      .http()
      .post(typesPath)
      .set(admin)
      .send({
        ...permitApproved,
        key: 'in-app-step',
        policy: { mode: 'escalation', steps: [{ channel: 'in-app', delayMinutes: 0 }] },
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('In-app is not a policy channel');
    expect((await t.http().get(`${typesPath}/in-app-step`).set(admin)).status).toBe(404);
  });

  it('rejects a negative delay, an invalid contract and a language tag that is not BCP 47', async () => {
    const attempts = await Promise.all(
      [
        { policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: -1 }] } },
        { dataContract: { type: 'object', properties: {}, required: ['permitNumber'] } },
        { defaultLanguage: 'english_canada' },
      ].map((override, index) =>
        t
          .http()
          .post(typesPath)
          .set(admin)
          .send({ ...permitApproved, key: `rejected-${index}`, ...override }),
      ),
    );

    expect(attempts.map((res) => res.status)).toEqual([400, 400, 400]);
    const list = await t.http().get(typesPath).set(admin);
    const keys: string[] = list.body.map((type: { key: string }) => type.key);
    expect(keys.filter((key) => key.startsWith('rejected-'))).toEqual([]);
  });

  it('refuses a key that is already defined, keeping the first definition', async () => {
    const first = await t.http().post(typesPath).set(admin).send(typeDefinition('duplicate-key'));
    const second = await t
      .http()
      .post(typesPath)
      .set(admin)
      .send({ ...typeDefinition('duplicate-key'), displayName: 'Second' });

    expect([first.status, second.status]).toEqual([201, 409]);
    expect((await t.http().get(`${typesPath}/duplicate-key`).set(admin)).body.displayName).toBe('duplicate-key');
  });

  it('are refused to a sender owner who is not an admin', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Owners', owner: 'types-owner' });
    const owner = bearer(sender.ownerToken);
    const [create, list] = await Promise.all([
      t.http().post(typesPath).set(owner).send(typeDefinition('owner-type')),
      t.http().get(typesPath).set(owner),
    ]);
    expect([create.status, list.status]).toEqual([403, 403]);
  });
});
