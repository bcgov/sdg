import type { DataContract } from '@repo/notification-database';
import { describe, expect, it } from 'vitest';

import { contractFields, contractValidator, dataContractSchema, sampleData } from './data-contract.js';

const permitContract: DataContract = {
  type: 'object',
  properties: {
    permitNumber: { type: 'string', description: 'The permit as printed' },
    fee: { type: 'number' },
    renewals: { type: 'integer' },
    paid: { type: 'boolean' },
    holder: {
      type: 'object',
      properties: { name: { type: 'string' }, phone: { type: 'string' } },
      required: ['name'],
    },
    conditions: { type: 'array', items: { type: 'string' } },
  },
  required: ['permitNumber', 'holder'],
};

const issues = (input: unknown): string[] => {
  const result = dataContractSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('data contract definition', () => {
  it('accepts objects with typed, nested and required properties', () => {
    expect(dataContractSchema.parse(permitContract)).toEqual(permitContract);
  });

  it('rejects a required property that is not defined', () => {
    expect(issues({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'b'] })).toEqual([
      'required.1: b is required but not a property',
    ]);
  });

  it('rejects a nested required property that is not defined', () => {
    const contract = {
      type: 'object',
      properties: { holder: { type: 'object', properties: {}, required: ['name'] } },
    };
    expect(issues(contract)).toEqual(['properties.holder.required.0: name is required but not a property']);
  });

  it('rejects a top level that is not an object, an unsupported type and unsupported keywords', () => {
    expect(issues({ type: 'string' })).not.toEqual([]);
    expect(issues({ type: 'object', properties: { a: { type: 'null' } } })).not.toEqual([]);
    expect(issues({ type: 'object', properties: { a: { type: 'string', format: 'email' } } })).not.toEqual([]);
    expect(issues({ type: 'object', properties: { a: { type: 'array' } } })).not.toEqual([]);
  });

  it('rejects property names templates cannot address', () => {
    expect(issues({ type: 'object', properties: { 'permit number': { type: 'string' } } })).not.toEqual([]);
  });
});

describe('contractValidator', () => {
  const validate = contractValidator(permitContract);

  it('accepts data that satisfies the contract and drops keys it does not define', () => {
    const data = {
      permitNumber: 'P-1',
      holder: { name: 'Jane' },
      conditions: ['no fires'],
      renewals: 2,
      unexpected: 'x',
    };
    expect(validate.parse(data)).toEqual({
      permitNumber: 'P-1',
      holder: { name: 'Jane' },
      conditions: ['no fires'],
      renewals: 2,
    });
  });

  it('rejects missing required fields, at any depth', () => {
    const result = validate.safeParse({ holder: {} });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['permitNumber', 'holder.name']);
  });

  it('rejects values of the wrong type, including a fractional integer', () => {
    const result = validate.safeParse({
      permitNumber: 7,
      holder: { name: 'Jane' },
      renewals: 1.5,
      paid: 'yes',
      conditions: [1],
    });
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'permitNumber',
      'renewals',
      'paid',
      'conditions.0',
    ]);
  });
});

describe('contractFields', () => {
  it('lists every field with its path, type and whether its object requires it', () => {
    expect(contractFields(permitContract)).toEqual([
      { path: ['permitNumber'], type: 'string', required: true, description: 'The permit as printed' },
      { path: ['fee'], type: 'number', required: false },
      { path: ['renewals'], type: 'integer', required: false },
      { path: ['paid'], type: 'boolean', required: false },
      { path: ['holder'], type: 'object', required: true },
      { path: ['holder', 'name'], type: 'string', required: true },
      { path: ['holder', 'phone'], type: 'string', required: false },
      { path: ['conditions'], type: 'array', required: false },
      { path: ['conditions', '[]'], type: 'string', required: true },
    ]);
  });
});

describe('sampleData', () => {
  it('fills every field with a value the contract accepts', () => {
    const sample = sampleData(permitContract);
    expect(sample).toEqual({
      permitNumber: 'permitNumber',
      fee: 1.5,
      renewals: 1,
      paid: true,
      holder: { name: 'name', phone: 'phone' },
      conditions: ['conditions'],
    });
    expect(contractValidator(permitContract).parse(sample)).toEqual(sample);
  });

  it('takes a hook that supplies the value for a field, falling back to the default when it returns undefined', () => {
    const sample = sampleData(permitContract, (field) =>
      field.path.join('.') === 'holder.name' ? 'Jane Doe' : undefined,
    );
    expect(sample).toMatchObject({ permitNumber: 'permitNumber', holder: { name: 'Jane Doe', phone: 'phone' } });
  });
});
