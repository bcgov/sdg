import { Controller, Get, UseGuards } from '@nestjs/common';
import { expect } from 'vitest';

import { CredentialGuard } from '../auth/credential.guard.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { LinkedCredential } from '../auth/directories.js';
import type { Principal } from '../auth/token-kind.js';
import type { TestApp } from './app.js';
import { ensureTypes } from './catalog.js';
import type { TestIssuer } from './tokens.js';

export const bearer = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** A credential endpoint that echoes the linked credential the guard resolved. */
@Controller({ path: 'probe', version: '1' })
export class CredentialProbeController {
  @Get('credential')
  @UseGuards(CredentialGuard)
  credential(@CurrentPrincipal() principal: Principal): LinkedCredential | null {
    return principal.kind === 'credential' ? principal.credential : null;
  }
}

export const CREDENTIAL_PROBE = '/api/v1/probe/credential';

export interface SenderSetup {
  name: string;
  /** The owner's subject at the test issuer. */
  owner: string;
  types?: readonly string[];
}

export interface SenderFixture {
  id: string;
  ownerToken: string;
}

/** Creates a sender through the admin API, names its owner and grants `types`, defining any that do not exist. */
export async function createSender(
  t: TestApp,
  issuer: TestIssuer,
  adminToken: string,
  setup: SenderSetup,
): Promise<SenderFixture> {
  const admin = bearer(adminToken);
  const created = await t.http().post('/api/v1/admin/senders').set(admin).send({ name: setup.name });
  expect(created.status).toBe(201);
  const id: unknown = created.body.id;
  if (typeof id !== 'string') throw new Error('Creating a sender returned no id');
  const owner = await t
    .http()
    .post(`/api/v1/admin/senders/${id}/owners`)
    .set(admin)
    .send({ issuer: issuer.issuer, subject: setup.owner });
  expect(owner.status).toBe(200);
  await ensureTypes(t, adminToken, setup.types ?? []);
  const grants = await Promise.all(
    (setup.types ?? []).map((type) => t.http().put(`/api/v1/admin/senders/${id}/grants/${type}`).set(admin)),
  );
  expect(grants.map((granted) => granted.status)).toEqual(grants.map(() => 200));
  return { id, ownerToken: await issuer.ownClientUserToken({ subject: setup.owner }) };
}
