// `pnpm --filter notification-api send --topic <id>` or `send --issuer <iss> --subject <sub>`: sends one test
// notification (`permit-status`) as sender credential A, to a topic the sender may broadcast to (the seed prints its
// platform topic's id) or to one user by issuer and subject (for a direct-mode tester: the iss and sub of the token
// their page signs in with). Prints the new notification's id.
//
// Reads apps/notification-api/.env (the process env wins):
//   NOTIFICATION_API_BASE_URL          default https://notify.sdg.localhost
//   KEYCLOAK_ISSUER_URL                the realm the credential's client is in
//   SENDER_CREDENTIAL_A_CLIENT_ID      a credential the seed linked (scoped to every seed type)
//   SENDER_CREDENTIAL_A_CLIENT_SECRET  its secret
// Prints the base URL and issuer first (stderr), then the id (stdout; never a token or secret).
// Exit code 0: sent. 1: no audience given (usage, before any call), missing settings, or a call failed.
import { baseUrl, exitWithError, loadAppEnv, optionalEnv, printTarget, requiredEnv } from './lib/env.ts';
import { api, bearer } from './lib/http.ts';
import { SEND_USAGE, UsageError, audienceFromArgs, sendTestNotification } from './lib/send-notification.ts';
import { clientCredentialsToken } from './lib/tokens.ts';

/** Sends the notification `argv` addresses and returns its id. UsageError before anything else when it names none. */
export async function runSend(argv: readonly string[]): Promise<string> {
  const audience = audienceFromArgs(argv);
  const notifyUrl = baseUrl(optionalEnv('NOTIFICATION_API_BASE_URL', 'https://notify.sdg.localhost'));
  const issuer = requiredEnv('KEYCLOAK_ISSUER_URL');
  const clientId = requiredEnv('SENDER_CREDENTIAL_A_CLIENT_ID');
  const clientSecret = requiredEnv('SENDER_CREDENTIAL_A_CLIENT_SECRET');
  printTarget('send', notifyUrl, issuer);
  const token = await clientCredentialsToken(issuer, clientId, clientSecret);
  return sendTestNotification(api(notifyUrl, bearer(token)), audience);
}

if (import.meta.main) {
  process.on('unhandledRejection', exitWithError('send'));
  try {
    loadAppEnv();
    console.log(`send: notification ${await runSend(process.argv.slice(2))}`);
  } catch (error) {
    if (error instanceof UsageError) console.error(SEND_USAGE);
    exitWithError('send')(error);
  }
}
