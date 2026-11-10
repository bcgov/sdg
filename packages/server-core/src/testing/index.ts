/** Test helpers for services built on server-core: a loopback stand-in for an upstream. Never import from production code. */
export {
  json,
  startHttpStub,
  unreachable,
  type HttpStub,
  type ReceivedRequest,
  type StubResponder,
} from './http-stub.js';
