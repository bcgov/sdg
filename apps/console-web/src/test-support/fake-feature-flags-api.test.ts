import { describe, expect, it } from 'vitest';

import { FEATURE_FLAGS_PATH, FLAG_HISTORY_PATH, PEOPLE_SEARCH_PATH } from '../api/feature-flags';
import { fakeFeatureFlagsApi, flag, flagEvent, person } from './fake-feature-flags-api';

describe('FakeFeatureFlagsApi', () => {
  it('Should accept string, URL, and Request inputs in fetch (lines 111-112)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });

    const fromString = await fetch(FEATURE_FLAGS_PATH);
    expect(fromString.status).toBe(200);

    const fromUrl = await fetch(new URL(`https://console.example.test${FEATURE_FLAGS_PATH}`));
    expect(fromUrl.status).toBe(200);

    const fromRequest = await fetch(new Request(`https://console.example.test${FEATURE_FLAGS_PATH}`));
    expect(fromRequest.status).toBe(200);

    expect(api.callsTo('GET', FEATURE_FLAGS_PATH)).toHaveLength(3);
  });

  it('Should answer 404 for unknown paths and unsupported methods on flag and override routes (lines 182, 189, 195)', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')] });

    const unmatchedPath = await fetch(`${FEATURE_FLAGS_PATH}/hello_world/extra/segment`);
    expect(unmatchedPath.status).toBe(404);

    const unsupportedFlagMethod = await fetch(`${FEATURE_FLAGS_PATH}/hello_world`, { method: 'POST' });
    expect(unsupportedFlagMethod.status).toBe(404);

    const unsupportedOverrideMethod = await fetch(`${FEATURE_FLAGS_PATH}/hello_world/overrides/p-1`, { method: 'GET' });
    expect(unsupportedOverrideMethod.status).toBe(404);
  });

  it('Should handle auth, refusals, delegation, CRUD, overrides, history, and people search', async () => {
    const ada = person('Ada', 'resident');
    const grace = person('Grace', 'resident', { email: null });
    const zoe = person('Zoe', 'console-user');
    const api = fakeFeatureFlagsApi({
      flags: [flag('alpha', { audience: 'both' })],
      people: [zoe, ada, grace],
      events: [flagEvent(1, 'alpha', 'created')],
    });

    // Delegated non-flag path
    expect((await fetch('/api/v1/console/service-clients')).status).toBe(200);

    // Signed out -> 401
    api.consoleApi.signedIn = false;
    expect((await fetch(FEATURE_FLAGS_PATH)).status).toBe(401);
    api.consoleApi.signedIn = true;

    // One-shot refusal
    api.refuseNext('GET', FEATURE_FLAGS_PATH, () => new Response(null, { status: 503 }));
    expect((await fetch(FEATURE_FLAGS_PATH)).status).toBe(503);

    // Create validation, conflict, and success
    expect((await fetch(FEATURE_FLAGS_PATH, { method: 'POST', body: JSON.stringify({ key: 'Bad' }) })).status).toBe(
      400,
    );
    expect((await fetch(FEATURE_FLAGS_PATH, { method: 'POST', body: JSON.stringify({ key: 'alpha' }) })).status).toBe(
      409,
    );
    expect(
      (
        await fetch(FEATURE_FLAGS_PATH, {
          method: 'POST',
          body: JSON.stringify({ key: 'beta', description: 'desc', enabled: true, rolloutPct: 50, audience: 'portal' }),
        })
      ).status,
    ).toBe(201);

    // Flag detail, update (no-op and actual change), missing flag, history
    expect((await fetch(`${FEATURE_FLAGS_PATH}/missing`)).status).toBe(404);
    expect((await fetch(`${FEATURE_FLAGS_PATH}/beta`)).status).toBe(200);
    expect(
      (
        await fetch(`${FEATURE_FLAGS_PATH}/beta`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: true }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${FEATURE_FLAGS_PATH}/beta`, {
          method: 'PATCH',
          body: JSON.stringify({ description: null, enabled: false, rolloutPct: 25, audience: 'both' }),
        })
      ).status,
    ).toBe(200);
    expect((await fetch(FLAG_HISTORY_PATH)).status).toBe(200);

    // Overrides: missing person, wrong audience, set/repeat/flip/sort, remove missing/existing
    const portalOnly = await fetch(FEATURE_FLAGS_PATH, {
      method: 'POST',
      body: JSON.stringify({ key: 'portal_only', audience: 'portal' }),
    });
    expect(portalOnly.status).toBe(201);
    expect(
      (
        await fetch(`${FEATURE_FLAGS_PATH}/portal_only/overrides/${zoe.principalId}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${FEATURE_FLAGS_PATH}/portal_only/overrides/unknown`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: true }),
        })
      ).status,
    ).toBe(404);

    // Set overrides in both orders to cover sort comparator in both directions
    await fetch(`${FEATURE_FLAGS_PATH}/alpha/overrides/${zoe.principalId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    await fetch(`${FEATURE_FLAGS_PATH}/alpha/overrides/${ada.principalId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    await fetch(`${FEATURE_FLAGS_PATH}/alpha/overrides/${grace.principalId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    await fetch(`${FEATURE_FLAGS_PATH}/alpha/overrides/${ada.principalId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    await fetch(`${FEATURE_FLAGS_PATH}/alpha/overrides/${ada.principalId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });

    expect((await fetch(`${FEATURE_FLAGS_PATH}/alpha/overrides/missing`, { method: 'DELETE' })).status).toBe(404);
    expect((await fetch(`${FEATURE_FLAGS_PATH}/alpha/overrides/${ada.principalId}`, { method: 'DELETE' })).status).toBe(
      204,
    );

    // People search: valid audience ('console', 'portal') and fallback audience, null email
    expect(
      (
        await fetch(PEOPLE_SEARCH_PATH, {
          method: 'POST',
          body: JSON.stringify({ query: '', audience: 'invalid' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(PEOPLE_SEARCH_PATH, {
          method: 'POST',
          body: JSON.stringify({ query: '', audience: 'console' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(PEOPLE_SEARCH_PATH, {
          method: 'POST',
          body: JSON.stringify({ query: '', audience: 'both' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(PEOPLE_SEARCH_PATH, {
          method: 'POST',
          body: JSON.stringify({ query: 'grace', audience: 'portal' }),
        })
      ).status,
    ).toBe(200);

    // Delete flag
    expect((await fetch(`${FEATURE_FLAGS_PATH}/beta`, { method: 'DELETE' })).status).toBe(204);
  });
});
