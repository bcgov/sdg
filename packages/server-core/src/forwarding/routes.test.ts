import { describe, expect, it } from 'vitest';

import { AUDIENCES, classifyPath } from './routes.js';

describe('route contract', () => {
  it('has the four audiences', () => {
    expect(AUDIENCES).toEqual(['portal', 'console', 'gateway', 'shared']);
  });

  it.each([
    ['/api/v1/portal/x', 'portal'],
    ['/api/v1/console/x', 'console'],
    ['/api/v1/gateway/clients/a/b', 'gateway'],
    ['/api/v1/shared/me', 'shared'],
    ['/api/v2/portal/x', 'portal'],
    ['/api/v12/console', 'console'],
    ['/api/v1/portal/', 'portal'],
  ])('classifies %s as %s', (path, audience) => {
    expect(classifyPath(path)).toBe(audience);
  });

  it.each([
    '/api/v1/unknown/x',
    '/api/auth/me',
    '/api/auth/login',
    '/healthz/ready',
    '/internal/principals/login',
    '/api/v1/internal/principals/login',
    '/api/internal/x',
    '/api/v0/portal/x',
    '/api/v01/portal/x',
    '/api/vx/portal/x',
    '/api/v1/portalx/y',
    '/api/v1/Portal/x',
    '/api/v1',
    '/api/portal/x',
    '/v1/portal/x',
    '/metrics',
    '',
  ])('does not classify %s', (path) => {
    expect(classifyPath(path)).toBeUndefined();
  });
});
