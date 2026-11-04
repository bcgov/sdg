import type { SecretCipher } from '../crypto/secret-cipher.js';
import { integrationType } from './registry.js';

type Config = Readonly<Record<string, unknown>>;

/** A secret field is sealed at (row id, `config.<field>`), so it opens only in the row and field it was sealed for. */
const location = (rowId: string, field: string) => ({ rowId, field: `config.${field}` });

function secretFieldsOf(typeKey: string): readonly string[] {
  const type = integrationType(typeKey);
  if (!type) throw new Error(`Unknown integration type ${typeKey}`);
  return type.secretFields;
}

/** The configuration as stored: each secret field that is set replaced by its sealed value (R48, KTD11). */
export function sealSecretFields(cipher: SecretCipher, typeKey: string, rowId: string, config: Config): Config {
  const sealed: Record<string, unknown> = { ...config };
  for (const field of secretFieldsOf(typeKey)) {
    const value = config[field];
    if (typeof value === 'string') sealed[field] = cipher.encrypt(value, location(rowId, field));
  }
  return sealed;
}

/** The stored configuration with its secret fields opened, for a delivery attempt. */
export function openSecretFields(cipher: SecretCipher, typeKey: string, rowId: string, stored: Config): Config {
  const opened: Record<string, unknown> = { ...stored };
  for (const field of secretFieldsOf(typeKey)) {
    const value = stored[field];
    if (typeof value === 'string') opened[field] = cipher.decrypt(value, location(rowId, field));
  }
  return opened;
}

/** What a read returns: the configuration without its secret fields, and which of them are set. */
export function maskSecretFields(typeKey: string, stored: Config): { config: Config; secretFieldsSet: string[] } {
  const config: Record<string, unknown> = { ...stored };
  const secretFieldsSet: string[] = [];
  for (const field of secretFieldsOf(typeKey)) {
    if (field in config) secretFieldsSet.push(field);
    delete config[field];
  }
  return { config, secretFieldsSet };
}
