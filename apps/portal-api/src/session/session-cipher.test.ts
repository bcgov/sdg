import { describe, expect, it } from 'vitest';

import { decryptSession, deriveSessionKey, encryptSession } from './session-cipher.js';

const key = deriveSessionKey('test-session-secret-at-least-32-characters');

describe('session cipher', () => {
  it('round-trips a payload bound to its session id', () => {
    const payload = encryptSession(key, '{"auth":{"tokens":"secret"}}', 'sid-1');
    expect(payload).not.toContain('secret');
    expect(decryptSession(key, payload, 'sid-1')).toBe('{"auth":{"tokens":"secret"}}');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSession(key, 'same', 'sid-1')).not.toBe(encryptSession(key, 'same', 'sid-1'));
  });

  it('rejects a tampered ciphertext, another session id, another key and a malformed payload', () => {
    const payload = encryptSession(key, 'hello', 'sid-1');
    const [iv, tag, ciphertext] = payload.split('.');
    const flipped = Buffer.from(ciphertext ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => decryptSession(key, `${iv}.${tag}.${flipped.toString('base64url')}`, 'sid-1')).toThrow(
      'unable to authenticate data',
    );
    expect(() => decryptSession(key, payload, 'sid-2')).toThrow('unable to authenticate data');
    expect(() =>
      decryptSession(deriveSessionKey('another-secret-of-at-least-32-characters'), payload, 'sid-1'),
    ).toThrow('unable to authenticate data');
    expect(() => decryptSession(key, 'not-a-payload', 'sid-1')).toThrow('Malformed session payload');
  });
});
