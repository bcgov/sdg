// Environment for the local scripts (login, seed, e2e): apps/notification-api/.env, with the process env winning.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** apps/notification-api, wherever the script is run from. */
export const APP_DIR: string = fileURLToPath(new URL('../..', import.meta.url));
/** The repo root, where compose.yaml is. */
export const REPO_DIR: string = fileURLToPath(new URL('../../../..', import.meta.url));

/** Loads apps/notification-api/.env when present. Variables already set in the process env are kept. */
export function loadAppEnv(): void {
  const file = `${APP_DIR}.env`;
  if (existsSync(file)) process.loadEnvFile(file);
}

const value = (name: string): string | undefined => {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === '' ? undefined : raw;
};

/** A required variable; throws naming it (never a value) when it is unset or blank. */
export function requiredEnv(name: string): string {
  const raw = value(name);
  if (raw === undefined) throw new Error(`${name} is not set (apps/notification-api/.env or the environment)`);
  return raw;
}

/** An optional variable, or `fallback` when it is unset or blank. */
export function optionalEnv(name: string, fallback: string): string;
export function optionalEnv(name: string): string | undefined;
export function optionalEnv(name: string, fallback?: string): string | undefined {
  return value(name) ?? fallback;
}

/** Drops trailing slashes from a base URL. */
export function baseUrl(raw: string): string {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === '/') end -= 1;
  return raw.slice(0, end);
}

/** Logs a script's fatal error and exits non-zero. For each entry point's `unhandledRejection` and top-level catch. */
export function exitWithError(script: string): (error: unknown) => never {
  return (error) => {
    console.error(`${script}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  };
}
