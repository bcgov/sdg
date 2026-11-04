import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { z } from 'zod';

import type { Env } from '../config/env.js';

export const CHECK_TIMEOUT_MS = 3000;

/** The fetch the readiness checks use (the global one; tests stand in for the issuer). */
export const HTTP_FETCH = Symbol('HTTP_FETCH');
export type HttpFetch = typeof fetch;

const discoverySchema = z.object({ jwks_uri: z.url() });
const jwksSchema = z.object({ keys: z.array(z.object({ kty: z.string() })).min(1) });

@Injectable()
export class DependencyIndicators {
  private readonly health: HealthIndicatorService;
  private readonly fetch: HttpFetch;
  private readonly issuerUrl: string;

  constructor(
    @Inject(HealthIndicatorService) health: HealthIndicatorService,
    @Inject(HTTP_FETCH) httpFetch: HttpFetch,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.health = health;
    this.fetch = httpFetch;
    this.issuerUrl = config.get('KEYCLOAK_ISSUER_URL', { infer: true });
  }

  /** The issuer's discovery document and the JWKS it names are reachable and hold at least one key. */
  issuer(): PromiseLike<HealthIndicatorResult<'issuer'>> {
    return this.health
      .check('issuer')
      .attempt(async () => {
        const discovery = discoverySchema.parse(
          await this.getJson(`${this.issuerUrl}/.well-known/openid-configuration`),
        );
        jwksSchema.parse(await this.getJson(discovery.jwks_uri));
      })
      .withTimeout(CHECK_TIMEOUT_MS);
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GET ${new URL(url).pathname} responded ${response.status}`);
    return response.json();
  }
}
