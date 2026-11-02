import { AuthError } from '@repo/auth';
import { describe, expect, it } from 'vitest';

import { describeError } from './describe-error.js';

/** Shaped like openid-client's ResponseBodyError for a rejected token request. */
function tokenEndpointError(): Error {
  return Object.assign(new Error('server responded with an error in the response body'), {
    name: 'ResponseBodyError',
    code: 'OAUTH_RESPONSE_BODY_ERROR',
    error: 'unauthorized_client',
    error_description: 'Invalid client or Invalid client credentials',
    status: 401,
  });
}

// Bug 06/09-B1: what portal-api logs for an error, so its cause chain and IdP error reach the logs.
describe('describeError', () => {
  it('keeps an AuthError code and detail and its openid-client cause (error, error_description, status)', () => {
    const summary = describeError(
      new AuthError('callback_failed', { detail: 'OAUTH_RESPONSE_BODY_ERROR', cause: tokenEndpointError() }),
    );
    expect(summary).toMatchObject({
      type: 'AuthError',
      message: 'Authorization callback failed',
      code: 'callback_failed',
      detail: 'OAUTH_RESPONSE_BODY_ERROR',
      cause: {
        type: 'ResponseBodyError',
        code: 'OAUTH_RESPONSE_BODY_ERROR',
        error: 'unauthorized_client',
        error_description: 'Invalid client or Invalid client credentials',
        status: 401,
      },
    });
    expect(summary.stack).toContain('AuthError');
    expect(summary.cause?.stack).toContain('ResponseBodyError');
  });

  it('describes non-Error values by type and string value', () => {
    expect(describeError('boom')).toEqual({ type: 'string', message: 'boom' });
    expect(describeError({ a: 1 })).toEqual({ type: 'object', message: '[object Object]' });
    expect(describeError(undefined)).toEqual({ type: 'undefined', message: 'undefined' });
  });

  it('copies only allow-listed fields, never other properties such as a response or headers', () => {
    const error = Object.assign(new Error('fetch failed'), {
      response: { headers: { authorization: 'Bearer t0ken' } },
      headers: { cookie: 'portal.sid=s3cret' },
      config: { clientSecret: 'shh' },
      status: '500',
    });
    const summary = describeError(error);
    expect(Object.keys(summary).toSorted()).toEqual(['message', 'stack', 'type']);
    for (const secret of ['t0ken', 's3cret', 'shh']) expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it('stops following the cause chain at a fixed depth (and on a cycle)', () => {
    const cyclic = new Error('loop');
    cyclic.cause = cyclic;
    expect(describeError(cyclic).cause).toBeUndefined();

    let deep: Error = new Error('level 9');
    for (let level = 8; level >= 0; level -= 1) deep = new Error(`level ${level}`, { cause: deep });
    let depth = 0;
    for (let node = describeError(deep).cause; node; node = node.cause) depth += 1;
    expect(depth).toBe(4);
    expect(describeError(deep).message).toBe('level 0');
  });
});
