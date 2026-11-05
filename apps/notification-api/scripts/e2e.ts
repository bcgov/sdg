import { setUp, type E2eContext } from './e2e/context.ts';
import { directSendWithEscalation, portalContactPoints } from './e2e/flows-recipients.ts';
import { publicFormFollowUp, senderCredentialSetup, senderEmailIntegration } from './e2e/flows-senders.ts';
import { topicBroadcast } from './e2e/flows-topics.ts';
import { twoWorkers } from './e2e/flows-workers.ts';
// `pnpm --filter notification-api e2e`: the spike's end-to-end run against the local compose stack, with real
// Keycloak tokens, Mailpit and the webhook receiver. Manual only; CI runs the unit and integration tests (R5).
// It DROPS and re-migrates the local `notification` database, seeds it (seed.ts), then drives F1–F6 and a two-worker
// check, printing PASS or FAIL per flow. Exit code 0: every flow passed. 1: setup or any flow failed.
//
// Before running: the stack is up (`podman compose up -d`), Caddy's root is trusted (`pnpm stack:trust`), and you
// signed in at https://sdg.localhost as the same person who signs in to notification-api below, with the
// notification-api client's `admin` role. Takes about three minutes (F1 waits out a one-minute escalation delay).
//
// Reads apps/notification-api/.env (gitignored; the process env wins). Required:
//   DATABASE_URL                    the local `notification` database from the host, e.g.
//                                   postgres://portal:portal@localhost:5432/notification (must be localhost)
//   KEYCLOAK_ISSUER_URL             the realm
//   SENDER_CREDENTIAL_A_CLIENT_ID   a Keycloak service-account client (linked, scoped to every type)
//   SENDER_CREDENTIAL_A_CLIENT_SECRET
//   SENDER_CREDENTIAL_B_CLIENT_ID   a second service-account client (linked, scoped to form-received)
//   SENDER_CREDENTIAL_B_CLIENT_SECRET
//   PORTAL_SESSION_COOKIE           the `portal.sid` cookie's value from https://sdg.localhost (browser dev tools)
//   NOTIFICATION_ADMIN_TOKEN        optional: an admin token from login.ts; when unset, signs in through the browser
//                                   (NOTIFICATION_CLIENT_ID, NOTIFICATION_CLIENT_SECRET, NOTIFICATION_LOGIN_PORT)
// Optional, with their defaults:
//   NOTIFICATION_API_BASE_URL       https://notify.sdg.localhost
//   PORTAL_URL                      https://sdg.localhost
//   MAILPIT_URL                     http://localhost:8025
//   WEBHOOK_RECEIVER_URL            http://localhost:8090 (from the host)
//   WEBHOOK_RECEIVER_INTERNAL_URL   http://webhook-receiver:8080 (from notification-api)
//   E2E_COMPOSE                     podman compose (or: docker compose), runs the second worker
import { exitWithError, loadAppEnv } from './lib/env.ts';

interface Flow {
  id: string;
  name: string;
  run: (ctx: E2eContext) => Promise<void>;
}

// F2 runs before F4, which switches the sender's email from the platform default to its own integration.
const FLOWS: readonly Flow[] = [
  { id: 'F5', name: 'Sender credential setup', run: senderCredentialSetup },
  { id: 'F2', name: 'Public form follow-up', run: publicFormFollowUp },
  { id: 'F4', name: 'Sender brings its own email integration', run: senderEmailIntegration },
  { id: 'F3', name: 'Portal user manages contact points', run: portalContactPoints },
  { id: 'F6', name: 'Topic broadcast', run: topicBroadcast },
  { id: 'F1', name: 'Direct send with escalation', run: directSendWithEscalation },
  { id: 'W2', name: 'Two workers deliver each webhook exactly once', run: twoWorkers },
];

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Runs the flows one after another (they share the recipient), returning how many failed. */
async function runFlows(ctx: E2eContext, flows: readonly Flow[]): Promise<number> {
  const [flow, ...rest] = flows;
  if (flow === undefined) return 0;
  const started = Date.now();
  let failed = 0;
  try {
    await flow.run(ctx);
    console.log(`PASS ${flow.id} ${flow.name} (${Math.round((Date.now() - started) / 1000)} s)`);
  } catch (error) {
    failed = 1;
    console.log(`FAIL ${flow.id} ${flow.name}: ${reason(error)}`);
  }
  return failed + (await runFlows(ctx, rest));
}

async function main(): Promise<number> {
  loadAppEnv();
  let ctx: E2eContext;
  try {
    ctx = await setUp();
    console.log(`PASS setup (reset, seed, credential tokens, portal recipient; run ${ctx.run})`);
  } catch (error) {
    console.log(`FAIL setup: ${reason(error)}`);
    return 1;
  }
  const failed = await runFlows(ctx, FLOWS);
  console.log(failed === 0 ? `All ${FLOWS.length} checks passed` : `${failed} of ${FLOWS.length} checks failed`);
  return failed === 0 ? 0 : 1;
}

process.on('unhandledRejection', exitWithError('e2e'));
try {
  process.exit(await main());
} catch (error) {
  exitWithError('e2e')(error);
}
