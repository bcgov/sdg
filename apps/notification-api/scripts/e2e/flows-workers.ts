// Two workers over one database (KTD4, R53): a second worker-role process runs inside the notification-api
// container next to the compose one, and a batch of webhook deliveries must each reach the receiver exactly once.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

import { TYPE_KEYS } from '../lib/catalog.ts';
import { REPO_DIR } from '../lib/env.ts';
import type { E2eContext } from './context.ts';
import { registerSystem } from './flows-topics.ts';
import { deliveryOn, send, settled, to } from './notifications.ts';
import { check, sleep, waitFor } from './support.ts';

const BATCH_SIZE = 30;
/** On the second worker's command line, so it can be found and stopped. */
const MARKER = 'e2e-second-worker';
/** The second worker exits on its own after this long even if this script dies first. */
const MAX_LIFETIME_SECONDS = 600;
const READY = /\(worker role\) listening/;

/** Starts `node dist/main.js` in the worker role in the notification-api container and waits until it listens. */
function startSecondWorker(compose: string[]): Promise<ChildProcess> {
  const [command = 'podman', ...prefix] = compose;
  const args = [
    ...prefix,
    'exec',
    '-T',
    '-e',
    'NOTIFICATION_ROLE=worker',
    '-e',
    'PORT=3001',
    '-w',
    '/app/apps/notification-api',
    'notification-api',
    'timeout',
    String(MAX_LIFETIME_SECONDS),
    'node',
    '--import',
    './dist/instrumentation.js',
    'dist/main.js',
    MARKER,
  ];
  const child = spawn(command, args, { cwd: REPO_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`The second worker did not start within 2 minutes:\n${output.slice(-2000)}`));
    }, 120_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (READY.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => reject(new Error(`Could not run ${command}: ${error.message}`)));
    child.on('exit', (code) => reject(new Error(`The second worker exited (${code}):\n${output.slice(-2000)}`)));
  });
}

function stopSecondWorker(compose: string[], child: ChildProcess): void {
  const [command = 'podman', ...prefix] = compose;
  const result = spawnSync(command, [...prefix, 'exec', '-T', 'notification-api', 'pkill', '-f', MARKER], {
    cwd: REPO_DIR,
    stdio: 'ignore',
  });
  if (result.status !== 0) console.error(`e2e: stopping the second worker: pkill exited ${result.status}`);
  child.kill();
}

/** Webhook ids of the batch, as received; waits until every delivery has arrived, then a little longer for repeats. */
async function receivedIds(ctx: E2eContext, path: string): Promise<string[]> {
  await waitFor(
    `${BATCH_SIZE} webhooks at the receiver`,
    async () => ((await ctx.receiver.requests(path)).length >= BATCH_SIZE ? true : undefined),
    { timeoutMs: 120_000 },
  );
  await sleep(5000);
  return (await ctx.receiver.requests(path)).map((request) => request.headers['webhook-id'] ?? '(none)');
}

export async function twoWorkers(ctx: E2eContext): Promise<void> {
  const systemId = `batch-${ctx.run}`;
  const path = `/batch/${ctx.run}`;
  await registerSystem(ctx.notify.a, systemId, `${ctx.receiverInternalUrl}${path}`);
  const worker = await startSecondWorker(ctx.compose);
  try {
    const sends = Array.from({ length: BATCH_SIZE }, (_, index) =>
      send(ctx.notify.a, {
        type: TYPE_KEYS.permitStatus,
        data: { permitNumber: `W-${ctx.run}-${index}`, status: 'batch' },
        idempotencyKey: `workers-${ctx.run}-${index}`,
        audience: to({ kind: 'system', systemId }),
      }),
    );
    const notificationIds = await Promise.all(sends);
    const received = await receivedIds(ctx, path);
    const details = await Promise.all(notificationIds.map((id) => settled(ctx.notify.a, id)));
    const expected = details.map((found) => deliveryOn(found, 'webhook').id);
    check(new Set(received).size === received.length, `${received.length - new Set(received).size} webhooks repeated`);
    check(received.length === BATCH_SIZE, `The receiver got ${received.length} webhooks, expected ${BATCH_SIZE}`);
    check(
      expected.every((id) => received.includes(id)),
      'A delivery id in history never reached the receiver',
    );
  } finally {
    stopSecondWorker(ctx.compose, worker);
  }
}
