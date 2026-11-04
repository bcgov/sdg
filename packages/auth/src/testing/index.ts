/** Test helpers for consumers: an in-process OpenID Provider that signs tokens. Never import from production code. */
export { CLIENT_ID, CLIENT_SECRET, startFakeIdp, type FakeIdp, type SignOptions } from '../test-support/fake-idp.js';
