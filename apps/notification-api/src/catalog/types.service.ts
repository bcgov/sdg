import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { notificationTypes } from '../database/schema/index.js';
import type { CreateType, TypeResponse } from './catalog.schemas.js';

const typeColumns = {
  key: notificationTypes.key,
  displayName: notificationTypes.displayName,
  dataContract: notificationTypes.dataContract,
  defaultLanguage: notificationTypes.defaultLanguage,
  policy: notificationTypes.policy,
};

/** The admin-curated catalog of Notification types (R13, R14). */
@Injectable()
export class TypesService {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  /** Defines a type. The request schema validated its contract and policy and canonicalized its language. 409 when the key is taken. */
  async create(input: CreateType): Promise<TypeResponse> {
    const [created] = await this.db
      .insert(notificationTypes)
      .values(input)
      .onConflictDoNothing({ target: notificationTypes.key })
      .returning(typeColumns);
    if (!created) throw new ConflictException('A Notification type with this key already exists');
    return created;
  }

  list(): Promise<TypeResponse[]> {
    return this.db.select(typeColumns).from(notificationTypes).orderBy(asc(notificationTypes.key));
  }

  async get(key: string): Promise<TypeResponse> {
    const type = await this.find(key);
    if (!type) throw new NotFoundException();
    return type;
  }

  /** The type with its data contract and policy, for sends (U9) and templates (U5); null when there is none. */
  async find(key: string): Promise<TypeResponse | null> {
    const [type] = await this.db.select(typeColumns).from(notificationTypes).where(eq(notificationTypes.key, key));
    return type ?? null;
  }
}
