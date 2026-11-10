/** Test helpers for BFF apps built on bff-core: the real AppModule against stand-ins. Never import from production code. */
export {
  authorizeBff,
  bffTestEnv,
  bffTestKit,
  createBffTestApp,
  signInBff,
  type BffTestApp,
  type BffTestAppConfig,
  type BffTestAppOptions,
  type BffTestDatabase,
  type BffTestEnv,
  type BffTestKit,
  type IdTokenClaims,
  type SignedIn,
} from './test-app.js';
