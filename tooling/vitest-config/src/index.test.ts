import { describe, expect, it } from 'vitest';

import { defineNodeTestConfig, defineReactTestConfig } from './index.ts';

describe('defineNodeTestConfig', () => {
  it('runs src tests in node with v8 coverage over src', () => {
    const { test } = defineNodeTestConfig();
    expect(test?.environment).toBe('node');
    expect(test?.include).toEqual(['src/**/*.{test,spec}.{ts,tsx}']);
    expect(test?.passWithNoTests).toBe(true);
    expect(test?.coverage?.provider).toBe('v8');
    expect(test?.coverage && 'include' in test.coverage && test.coverage.include).toEqual(['src/**/*.{ts,tsx}']);
  });

  it('merges overrides without losing defaults', () => {
    const { test } = defineNodeTestConfig({ test: { testTimeout: 10_000 } });
    expect(test?.testTimeout).toBe(10_000);
    expect(test?.environment).toBe('node');
    expect(test?.passWithNoTests).toBe(true);
  });
});

describe('defineReactTestConfig', () => {
  it('runs in jsdom with the shared defaults', () => {
    const { test } = defineReactTestConfig();
    expect(test?.environment).toBe('jsdom');
    expect(test?.include).toEqual(['src/**/*.{test,spec}.{ts,tsx}']);
    expect(test?.coverage?.provider).toBe('v8');
  });
});
