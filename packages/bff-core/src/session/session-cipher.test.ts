import { describe, expect, it } from 'vitest';

import { decryptSession, deriveSessionKey, encryptSession } from './session-cipher.js';

const SECRET = 'test-session-secret-at-least-32-characters';
const key = deriveSessionKey(SECRET, 'portal-session-store');

describe('session cipher', () => {
  it('round-trips a payload bound to its session id', () => {
    const payload = encryptSession(key, '{"auth":{"tokens":"secret"}}', 'sid-1');
    expect(payload).not.toContain('secret');
    expect(decryptSession(key, payload, 'sid-1')).toBe('{"auth":{"tokens":"secret"}}');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSession(key, 'same', 'sid-1')).not.toBe(encryptSession(key, 'same', 'sid-1'));
  });

  it('derives a different key for each BFF from the same secret', () => {
    const consoleKey = deriveSessionKey(SECRET, 'console-session-store');
    expect(consoleKey.equals(key)).toBe(false);
    expect(deriveSessionKey(SECRET, 'portal-session-store').equals(key)).toBe(true);
    const payload = encryptSession(key, 'hello', 'sid-1');
    expect(() => decryptSession(consoleKey, payload, 'sid-1')).toThrow('unable to authenticate data');
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
      decryptSession(
        deriveSessionKey('another-secret-of-at-least-32-characters', 'portal-session-store'),
        payload,
        'sid-1',
      ),
    ).toThrow('unable to authenticate data');
    expect(() => decryptSession(key, 'not-a-payload', 'sid-1')).toThrow('Malformed session payload');
  });
});
