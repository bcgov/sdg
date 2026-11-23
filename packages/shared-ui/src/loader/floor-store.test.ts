import { afterEach, describe, expect, it, vi } from 'vitest';

import { floorKey, readFloor, rememberFloor } from './floor-store.ts';

const KEY = floorKey('test', 1);

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function insecure(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError');
}

function throwingStorage(): Storage {
  const storage = memoryStorage();
  storage.getItem = insecure;
  storage.setItem = insecure;
  return storage;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('floorKey', () => {
  it('names the keyset and the major', () => {
    expect(floorKey('prod', 1)).toBe('sdg-header:floor:prod:v1');
  });
});

describe('readFloor', () => {
  it('returns the remembered floor', () => {
    expect(readFloor(() => memoryStorage({ [KEY]: '200' }), KEY)).toBe(200);
  });

  it('returns undefined and logs the fallback when nothing is remembered', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(readFloor(() => memoryStorage(), KEY)).toBeUndefined();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/^shared-ui: .*manifest floor alone/), { key: KEY });
  });

  it('returns undefined and logs the fallback when the stored value is not a floor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readFloor(() => memoryStorage({ [KEY]: 'nope' }), KEY)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^shared-ui: .*manifest floor alone/), {
      key: KEY,
      value: 'nope',
    });
  });

  it('returns undefined and logs the fallback when storage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readFloor(throwingStorage, KEY)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^shared-ui: .*manifest floor alone/), {
      key: KEY,
      error: expect.any(DOMException),
    });
  });

  it('returns undefined and logs the fallback when getting storage itself throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readFloor(insecure, KEY)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('rememberFloor', () => {
  it('stores the floor', () => {
    const storage = memoryStorage();
    rememberFloor(() => storage, KEY, 250);
    expect(storage.getItem(KEY)).toBe('250');
  });

  it('logs and does not throw when storage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => rememberFloor(throwingStorage, KEY, 250)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^shared-ui: /), {
      key: KEY,
      floor: 250,
      error: expect.any(DOMException),
    });
  });
});
