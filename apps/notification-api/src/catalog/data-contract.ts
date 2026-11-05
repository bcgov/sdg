import { z } from 'zod';

/**
 * A Notification type's data contract (R13): the subset of JSON Schema the platform supports. The top level is an
 * object; properties are `string`, `number`, `integer`, `boolean`, `object` (with `properties` and optional
 * `required`) or `array` (with `items`). `description` is the only annotation. Any other keyword is rejected, so a
 * contract never claims a constraint sends are not checked against.
 */
export type ScalarType = 'string' | 'number' | 'integer' | 'boolean';

export interface ScalarProperty {
  type: ScalarType;
  description?: string | undefined;
}

export interface ArrayProperty {
  type: 'array';
  items: ContractProperty;
  description?: string | undefined;
}

export interface ObjectProperty {
  type: 'object';
  properties: Record<string, ContractProperty>;
  required?: string[] | undefined;
  description?: string | undefined;
}

export type ContractProperty = ScalarProperty | ArrayProperty | ObjectProperty;
export type DataContract = ObjectProperty;
export type ContractType = ContractProperty['type'];

/** Names a Liquid template can address as `{{ holder.name }}`. */
const propertyNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Must be a letter or underscore, then letters, digits or underscores');

const descriptionSchema = z.string().max(500).optional();

const scalarSchema = z.strictObject({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  description: descriptionSchema,
});

const arraySchema: z.ZodType<ArrayProperty> = z.strictObject({
  type: z.literal('array'),
  get items(): z.ZodType<ContractProperty> {
    return propertySchema;
  },
  description: descriptionSchema,
});

const objectSchema: z.ZodType<ObjectProperty> = z
  .strictObject({
    type: z.literal('object'),
    get properties(): z.ZodType<Record<string, ContractProperty>> {
      return z.record(propertyNameSchema, propertySchema);
    },
    required: z.array(propertyNameSchema).optional(),
    description: descriptionSchema,
  })
  .superRefine((object, ctx) => {
    for (const [index, name] of (object.required ?? []).entries()) {
      if (!Object.hasOwn(object.properties, name)) {
        ctx.addIssue({ code: 'custom', message: `${name} is required but not a property`, path: ['required', index] });
      }
    }
  })
  .meta({ id: 'DataContractObject' });

const propertySchema: z.ZodType<ContractProperty> = z
  .union([scalarSchema, arraySchema, objectSchema])
  .meta({ id: 'DataContractProperty' });

/** Validates a data contract when the admin defines a type. */
export const dataContractSchema: z.ZodType<DataContract> = objectSchema;

const scalarValidators: Record<ScalarType, () => z.ZodType> = {
  string: () => z.string(),
  number: () => z.number(),
  integer: () => z.int(),
  boolean: () => z.boolean(),
};

function propertyValidator(property: ContractProperty): z.ZodType {
  if (property.type === 'array') return z.array(propertyValidator(property.items));
  if (property.type === 'object') return objectValidator(property);
  return scalarValidators[property.type]();
}

function objectValidator(object: ObjectProperty): z.ZodObject {
  const required = new Set(object.required ?? []);
  const shape = Object.fromEntries(
    Object.entries(object.properties).map(([name, property]) => {
      const validator = propertyValidator(property);
      return [name, required.has(name) ? validator : validator.optional()];
    }),
  );
  return z.object(shape);
}

/**
 * The zod validator a send's data must satisfy (R28). Keys the contract does not define are dropped, so templates
 * only ever see contracted data.
 */
export function contractValidator(contract: DataContract): z.ZodType<Record<string, unknown>> {
  return objectValidator(contract);
}

/** One field of a contract. Array items appear under the `[]` segment. */
export interface ContractField {
  path: string[];
  type: ContractType;
  /** Whether the field's own object requires it; array items are always required. */
  required: boolean;
  description?: string;
}

function fieldOf(path: string[], property: ContractProperty, required: boolean): ContractField {
  return {
    path,
    type: property.type,
    required,
    ...(property.description === undefined ? {} : { description: property.description }),
  };
}

/** Adds the field at `path` and the fields nested in it to `fields`. */
function collectFields(fields: ContractField[], path: string[], property: ContractProperty, required: boolean): void {
  fields.push(fieldOf(path, property, required));
  if (property.type === 'object') collectObjectFields(fields, path, property);
  if (property.type === 'array') collectFields(fields, [...path, '[]'], property.items, true);
}

function collectObjectFields(fields: ContractField[], path: string[], object: ObjectProperty): void {
  const required = new Set(object.required ?? []);
  for (const [name, property] of Object.entries(object.properties)) {
    collectFields(fields, [...path, name], property, required.has(name));
  }
}

/** Every field of the contract, depth first in definition order, with whether it is required. */
export function contractFields(contract: DataContract): ContractField[] {
  const fields: ContractField[] = [];
  collectObjectFields(fields, [], contract);
  return fields;
}

const scalarSamples: Record<ScalarType, (path: string[]) => unknown> = {
  string: (path) => path.findLast((segment) => segment !== '[]') ?? 'text',
  number: () => 1.5,
  integer: () => 1,
  boolean: () => true,
};

/** Supplies a sample value for a field, or `undefined` for the default. */
export type SampleHook = (field: ContractField) => unknown;

function sampleValue(path: string[], property: ContractProperty, required: boolean, hook?: SampleHook): unknown {
  const supplied = hook?.(fieldOf(path, property, required));
  if (supplied !== undefined) return supplied;
  if (property.type === 'array') return [sampleValue([...path, '[]'], property.items, true, hook)];
  if (property.type === 'object') return sampleObject(path, property, hook);
  return scalarSamples[property.type](path);
}

function sampleObject(path: string[], object: ObjectProperty, hook?: SampleHook): Record<string, unknown> {
  const required = new Set(object.required ?? []);
  return Object.fromEntries(
    Object.entries(object.properties).map(([name, property]) => [
      name,
      sampleValue([...path, name], property, required.has(name), hook),
    ]),
  );
}

/**
 * Data that fills every field, required and optional, for template previews. Strings default to their field name;
 * `hook` overrides any field's value.
 */
export function sampleData(contract: DataContract, hook?: SampleHook): Record<string, unknown> {
  return sampleObject([], contract, hook);
}

function requiredSample(path: string[], property: ContractProperty): unknown {
  if (property.type === 'array') return [requiredSample([...path, '[]'], property.items)];
  if (property.type === 'object') return requiredObject(path, property);
  return scalarSamples[property.type](path);
}

function requiredObject(path: string[], object: ObjectProperty): Record<string, unknown> {
  const required = new Set(object.required ?? []);
  return Object.fromEntries(
    Object.entries(object.properties)
      .filter(([name]) => required.has(name))
      .map(([name, property]) => [name, requiredSample([...path, name], property)]),
  );
}

/**
 * Data with only the required fields (each array with one item), for the save-time render that catches a template
 * printing an optional field outside `if` or `default` (R23).
 */
export function requiredSampleData(contract: DataContract): Record<string, unknown> {
  return requiredObject([], contract);
}
