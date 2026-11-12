import {
  baseUrl,
  serviceEnvShape,
  urlWithProtocol,
  type BaseUrl,
  type ServiceEnvShape,
  type UrlWithProtocol,
} from '@repo/server-core';
import { z } from 'zod';

/** The settings every BFF reads on top of `serviceEnvShape`. Type aliases: z.object() needs an index signature. */
export type BffEnvShape = ServiceEnvShape & {
  APP_URL: BaseUrl;
  DATABASE_URL: UrlWithProtocol;
  SESSION_SECRET: z.ZodString;
  SESSION_TTL_SECONDS: z.ZodDefault<z.ZodCoercedNumber>;
  KEYCLOAK_ISSUER_URL: BaseUrl;
  KEYCLOAK_CLIENT_ID: z.ZodString;
  KEYCLOAK_CLIENT_SECRET: z.ZodString;
  CORE_API_URL: BaseUrl;
};

/** The parsed `bffEnvShape`: what `bffOptionsFromEnv` reads. */
export type BffEnv = z.infer<z.ZodObject<BffEnvShape>>;

/** Spread into a BFF's `z.object({ … })`: `z.object({ ...bffEnvShape('portal-api') })`. */
export function bffEnvShape(serviceName: string): BffEnvShape {
  return {
    ...serviceEnvShape(serviceName),
    APP_URL: baseUrl(['http:', 'https:']),
    // This BFF's own login; its sessions table lives in that login's schema.
    DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']),
    SESSION_SECRET: z.string().min(32),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(28_800),
    KEYCLOAK_ISSUER_URL: baseUrl(['https:']),
    // This BFF's own confidential client (portal: BC Services Card; console: IDIR).
    KEYCLOAK_CLIENT_ID: z.string().min(1),
    KEYCLOAK_CLIENT_SECRET: z.string().min(1),
    // core-api's in-cluster URL: sign-in upserts the principal there and this BFF's audiences are forwarded to it.
    CORE_API_URL: baseUrl(['http:', 'https:']),
  };
}
