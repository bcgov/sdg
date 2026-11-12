import { json, startHttpStub, type HttpStub, type StubResponder } from '@repo/server-core/testing';

export { json, unreachable, type ReceivedRequest, type StubResponder } from '@repo/server-core/testing';

/** The principal every accepted sign-in gets from the stub. */
export const PRINCIPAL_ID = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5d6e';
/** The profile core-api answers a sign-in with: Keycloak userinfo's, which may differ from the ID token's claims. */
export const CORE_API_PROFILE: { readonly name: string; readonly email: string | null } = {
  name: 'Ada King, Countess of Lovelace',
  email: 'ada.king@example.com',
};

/** A stand-in for core-api on a loopback port: records every request and answers with `respond`. */
export type CoreApiStub = HttpStub;

/** Accepts every principal login, answering as core-api does, and echoes forwarded calls. */
const defaultRespond: StubResponder = (req, res) => {
  if (req.url === '/internal/principals/login') {
    return json(200, { principalId: PRINCIPAL_ID, ...CORE_API_PROFILE })(req, res);
  }
  return json(200, { forwarded: req.url }, { 'set-cookie': 'core=1' })(req, res);
};

/** Starts a {@link CoreApiStub} on a free loopback port. */
export function startCoreApiStub(): Promise<CoreApiStub> {
  return startHttpStub(defaultRespond);
}
