import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { serviceClientEvents, serviceClients } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/database.js';
import { ADMIN_CLIENT_ID, PORTAL_CLIENT_ID } from '../testing/idp.js';
import { RegistryService, type Actor } from './registry.service.js';

const ada: Actor = { principalId: '6f1c1d3e-8a43-4b7e-9d0c-1f2e3a4b5c6d', name: 'Ada Lovelace' };
const grace: Actor = { principalId: '0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', name: 'Grace Hopper' };

describe('RegistryService (KTD11)', () => {
  let database: TestDatabase;
  let registry: RegistryService;

  const actions = async () => (await registry.history({ limit: 100 })).events.map((event) => event.action);

  beforeAll(async () => {
    database = await createTestDatabase();
    registry = new RegistryService(database.db, { portal: PORTAL_CLIENT_ID, admin: ADMIN_CLIENT_ID });
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await Promise.all([database.db.delete(serviceClients), database.db.delete(serviceClientEvents)]);
  });

  it('Should add an enabled client and record one added event with the actor (F3)', async () => {
    const entry = await registry.add({ clientId: 'partner', displayName: 'Partner' }, ada);
    expect(entry).toEqual({
      clientId: 'partner',
      displayName: 'Partner',
      enabled: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const { events } = await registry.history({ limit: 10 });
    expect(events).toEqual([
      {
        id: expect.any(Number),
        clientId: 'partner',
        action: 'added',
        actor: { principalId: ada.principalId, name: 'Ada Lovelace' },
        createdAt: expect.any(String),
      },
    ]);
  });

  it('Should refuse an existing client id with 409 and record nothing', async () => {
    await registry.add({ clientId: 'partner', displayName: 'Partner' }, ada);
    await expect(registry.add({ clientId: 'partner', displayName: 'Again' }, grace)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await actions()).toEqual(['added']);
    expect((await registry.find('partner'))?.displayName).toBe('Partner');
  });

  it.each([PORTAL_CLIENT_ID, ADMIN_CLIENT_ID])('Should refuse to register the %s client with 400', async (clientId) => {
    await expect(registry.add({ clientId, displayName: 'Nope' }, ada)).rejects.toBeInstanceOf(BadRequestException);
    expect(await database.db.$count(serviceClients)).toBe(0);
    expect(await actions()).toEqual([]);
  });

  it('Should record disable and enable once each, and treat a repeat as a no-op', async () => {
    await registry.add({ clientId: 'partner', displayName: 'Partner' }, ada);
    expect(await registry.setEnabled('partner', false, ada)).toMatchObject({ enabled: false });
    expect(await registry.setEnabled('partner', false, grace)).toMatchObject({ enabled: false });
    expect(await registry.setEnabled('partner', true, grace)).toMatchObject({ enabled: true });
    expect(await registry.setEnabled('partner', true, ada)).toMatchObject({ enabled: true });
    expect(await actions()).toEqual(['enabled', 'disabled', 'added']);
  });

  it('Should remove the entry and keep its history, newest first', async () => {
    await registry.add({ clientId: 'partner', displayName: 'Partner' }, ada);
    await registry.setEnabled('partner', false, ada);
    await registry.remove('partner', grace);
    expect(await registry.find('partner')).toBeUndefined();
    const { events } = await registry.history({ limit: 10 });
    expect(events.map((event) => [event.action, event.actor.name])).toEqual([
      ['removed', 'Grace Hopper'],
      ['disabled', 'Ada Lovelace'],
      ['added', 'Ada Lovelace'],
    ]);
  });

  it('Should continue the history of a re-added client id', async () => {
    await registry.add({ clientId: 'partner', displayName: 'Partner' }, ada);
    await registry.remove('partner', ada);
    await registry.add({ clientId: 'partner', displayName: 'Partner again' }, grace);
    expect(await actions()).toEqual(['added', 'removed', 'added']);
    expect(await registry.find('partner')).toMatchObject({ displayName: 'Partner again', enabled: true });
  });

  it('Should answer 404 to changes on a missing client and record nothing', async () => {
    await expect(registry.setEnabled('ghost', false, ada)).rejects.toBeInstanceOf(NotFoundException);
    await expect(registry.setEnabled('ghost', true, ada)).rejects.toBeInstanceOf(NotFoundException);
    await expect(registry.remove('ghost', ada)).rejects.toBeInstanceOf(NotFoundException);
    expect(await actions()).toEqual([]);
  });

  it('Should list clients by client id', async () => {
    await registry.add({ clientId: 'zeta', displayName: 'Zeta' }, ada);
    await registry.add({ clientId: 'alpha', displayName: 'Alpha' }, ada);
    expect((await registry.list()).map((entry) => entry.clientId)).toEqual(['alpha', 'zeta']);
  });

  it('Should page the history with a cursor', async () => {
    // One at a time: the cursor follows insertion order.
    await registry.add({ clientId: 'a', displayName: 'A' }, ada);
    await registry.add({ clientId: 'b', displayName: 'B' }, ada);
    await registry.add({ clientId: 'c', displayName: 'C' }, ada);
    const first = await registry.history({ limit: 2 });
    expect(first.events.map((event) => event.clientId)).toEqual(['c', 'b']);
    expect(first.nextBefore).toBe(first.events[1]?.id);
    const second = await registry.history({ limit: 2, before: first.nextBefore ?? undefined });
    expect(second.events.map((event) => event.clientId)).toEqual(['a']);
    expect(second.nextBefore).toBeNull();
  });
});
