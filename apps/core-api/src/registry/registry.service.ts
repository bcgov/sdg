import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  serviceClientEvents,
  serviceClients,
  type ServiceClient,
  type ServiceClientAction,
  type ServiceClientEvent,
} from '@repo/database';
import { and, asc, desc, eq, lt } from 'drizzle-orm';

import type { KeycloakClients } from '../auth/caller.js';
import { KEYCLOAK_CLIENTS } from '../auth/principal.resolver.js';
import { InjectDatabase, type Database } from '../database/database.module.js';
import type {
  AddServiceClient,
  HistoryPage,
  HistoryQuery,
  ServiceClientEventView,
  ServiceClientView,
} from './registry.schemas.js';

/** The administrator making a registry change: their principal id and current display name. */
export interface Actor {
  principalId: string;
  name: string;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function toView(row: ServiceClient): ServiceClientView {
  return {
    clientId: row.clientId,
    displayName: row.displayName,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEventView(row: ServiceClientEvent): ServiceClientEventView {
  return {
    id: row.id,
    clientId: row.clientId,
    action: row.action,
    actor: { principalId: row.actorPrincipalId, name: row.actorName },
    createdAt: row.createdAt.toISOString(),
  };
}

const missing = (clientId: string): NotFoundException =>
  new NotFoundException(`No service client ${clientId} is registered`);

/**
 * The service-account registry. Every change commits together with its history event; enabling or disabling a client
 * already in that state changes nothing and records nothing. Reads are uncached, so a change applies to the next
 * gateway request (R21).
 */
@Injectable()
export class RegistryService {
  private readonly db: Database;
  private readonly reserved: ReadonlySet<string>;

  constructor(@InjectDatabase() db: Database, @Inject(KEYCLOAK_CLIENTS) clients: KeycloakClients) {
    this.db = db;
    this.reserved = new Set([clients.portal, ...(clients.admin === undefined ? [] : [clients.admin])]);
  }

  async list(): Promise<ServiceClientView[]> {
    const rows = await this.db.select().from(serviceClients).orderBy(asc(serviceClients.clientId));
    return rows.map(toView);
  }

  async find(clientId: string): Promise<ServiceClientView | undefined> {
    const [row] = await this.db.select().from(serviceClients).where(eq(serviceClients.clientId, clientId)).limit(1);
    return row === undefined ? undefined : toView(row);
  }

  /** 400 for the portal or admin client id, 409 when the client id is already registered. */
  async add(input: AddServiceClient, actor: Actor): Promise<ServiceClientView> {
    if (this.reserved.has(input.clientId)) {
      throw new BadRequestException('The portal and admin clients cannot be registered as service accounts');
    }
    return await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(serviceClients).values(input).onConflictDoNothing().returning();
      if (created === undefined) throw new ConflictException(`Service client ${input.clientId} is already registered`);
      await record(tx, created.clientId, 'added', actor);
      return toView(created);
    });
  }

  /** Enables or disables a client; 404 when it is not registered. */
  setEnabled(clientId: string, enabled: boolean, actor: Actor): Promise<ServiceClientView> {
    return this.db.transaction(async (tx) => {
      const [changed] = await tx
        .update(serviceClients)
        .set({ enabled })
        .where(and(eq(serviceClients.clientId, clientId), eq(serviceClients.enabled, !enabled)))
        .returning();
      if (changed !== undefined) {
        await record(tx, clientId, enabled ? 'enabled' : 'disabled', actor);
        return toView(changed);
      }
      const [current] = await tx.select().from(serviceClients).where(eq(serviceClients.clientId, clientId)).limit(1);
      if (current === undefined) throw missing(clientId);
      return toView(current);
    });
  }

  /** Removes a client and records the removal; its earlier history stays. 404 when it is not registered. */
  remove(clientId: string, actor: Actor): Promise<void> {
    return this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(serviceClients)
        .where(eq(serviceClients.clientId, clientId))
        .returning({ clientId: serviceClients.clientId });
      if (removed === undefined) throw missing(clientId);
      await record(tx, clientId, 'removed', actor);
    });
  }

  /** The whole log, newest first, `limit` events before the event id `before`. */
  async history({ limit, before }: HistoryQuery): Promise<HistoryPage> {
    const rows = await this.db
      .select()
      .from(serviceClientEvents)
      .where(before === undefined ? undefined : lt(serviceClientEvents.id, before))
      .orderBy(desc(serviceClientEvents.id))
      .limit(limit + 1);
    const events = rows.slice(0, limit).map(toEventView);
    return { events, nextBefore: rows.length > limit ? (events.at(-1)?.id ?? null) : null };
  }
}

async function record(tx: Transaction, clientId: string, action: ServiceClientAction, actor: Actor): Promise<void> {
  await tx
    .insert(serviceClientEvents)
    .values({ clientId, action, actorPrincipalId: actor.principalId, actorName: actor.name });
}
