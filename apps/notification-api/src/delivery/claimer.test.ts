import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defineDeliveryType,
  deliveriesOf,
  registerSystem,
  relayedUser,
  sendNotification,
  startDeliveryApp,
  systemAudience,
  type DeliveryApp,
} from '../testing/delivery.js';
import { sendingSender } from '../testing/sending.js';
import { DeliveryClaimer } from './claimer.js';
import { ExpanderService } from './expander.js';
import { PlannerService } from './planner.js';
import { DELIVERY_SETTINGS, type DeliverySettings } from './settings.js';

const HOOK = 'claim-hook';
const STEPS = 'claim-steps';

let app: DeliveryApp;
let credential: { authorization: string };

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, {
    key: HOOK,
    policy: { mode: 'all-at-once', channels: ['webhook'] },
    templates: { webhook: ['en-CA'] },
  });
  await defineDeliveryType(app.t, app.adminToken, {
    key: STEPS,
    policy: {
      mode: 'escalation',
      steps: [
        { channel: 'email', delayMinutes: 5 },
        { channel: 'email', delayMinutes: 5 },
      ],
    },
  });
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'claim-sender', [HOOK, STEPS]);
  credential = await sender.credential('claim-sender-client', [HOOK, STEPS]);
});

afterAll(() => app.close());

async function plan(): Promise<void> {
  await app.t.app.get(ExpanderService).expandBatch();
  await app.t.app.get(PlannerService).planBatch();
}

describe('claiming deliveries (KTD1)', () => {
  it('claims only due rows, oldest first and up to the limit, under a lease that counts an attempt', async () => {
    const user = await relayedUser(app);
    const urls = ['/a', '/b', '/c'].map((path) => app.receiver.url(path));
    await registerSystem(app.t, credential, 'claim-system', urls);
    const steps = await sendNotification(app.t, credential, STEPS, user.audience);
    const hooks = await sendNotification(app.t, credential, HOOK, systemAudience('claim-system'));
    await plan();
    const claimer = app.t.app.get(DeliveryClaimer);
    const { leaseMs } = app.t.app.get<DeliverySettings>(DELIVERY_SETTINGS);
    const now = app.clock.now();

    const first = await claimer.claim(2);
    const rest = await claimer.claim(10);

    // The escalation steps are not due: step 1 in five minutes, step 2 once step 1 has finished.
    expect(first).toHaveLength(2);
    expect(rest).toHaveLength(1);
    const hookRows = await deliveriesOf(app.t, hooks);
    expect(new Set([...first, ...rest].map((row) => row.id))).toEqual(new Set(hookRows.map((row) => row.id)));
    expect(hookRows.every((row) => row.status === 'sending' && row.attempts === 1)).toBe(true);
    expect(hookRows.every((row) => row.leaseUntil?.getTime() === now.getTime() + leaseMs)).toBe(true);
    expect(await deliveriesOf(app.t, steps)).toMatchObject([
      { step: 1, status: 'scheduled' },
      { step: 2, status: 'scheduled', dueAt: null },
    ]);

    app.clock.advanceMinutes(5);
    const later = await claimer.claim();
    expect(later.filter((row) => row.notificationId === steps).map((row) => row.step)).toEqual([1]);
  });
});
