/** Test helpers for BFFs built on bff-core: a stand-in for core-api. Never import from production code. */
export {
  CORE_API_PROFILE,
  json,
  PRINCIPAL_ID,
  startCoreApiStub,
  unreachable,
  type CoreApiStub,
  type ReceivedRequest,
  type StubResponder,
} from './core-api-stub.js';
