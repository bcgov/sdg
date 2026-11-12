import { json, startHttpStub, type HttpStub, type StubResponder } from '@repo/server-core/testing';

export { json, unreachable, type ReceivedRequest, type StubResponder } from '@repo/server-core/testing';

/** A stand-in for core-api on a loopback port: records every request and answers with `respond`. */
export type CoreApiStub = HttpStub;

/** Answers like core-api's GET /api/v1/gateway/me for a registered client, with a cookie the gateway must drop. */
const defaultRespond: StubResponder = json(
  200,
  { clientId: 'partner-client', displayName: 'Partner', enabled: true },
  { 'set-cookie': 'core=1' },
);

export function startCoreApiStub(): Promise<CoreApiStub> {
  return startHttpStub(defaultRespond);
}
