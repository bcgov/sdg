import { Inject, Injectable } from '@nestjs/common';

import type { LinkedCredential } from '../auth/directories.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { notifications } from '../database/schema/index.js';
import { RecipientsService } from '../recipients/recipients.service.js';
import { RenderService } from '../templates/render.service.js';
import { audienceColumns } from './audience.js';
import { IdempotencyService, requestHash } from './idempotency.service.js';
import { SendValidator, type ValidatedSend } from './send-validation.js';
import type { SendRequest, SendResponse } from './send.schemas.js';

/** What a send returns, and whether it replayed an earlier one (KTD13). */
export interface SendOutcome {
  response: SendResponse;
  replayed: boolean;
}

/** A live use of the key committed while this send was being accepted. */
class KeyTakenError extends Error {}

/**
 * Accepts sends (R26–R29): checks them up front, then in one transaction upserts the recipients they name, records
 * the notification with its pinned templates and policy (KTD7) and records the idempotency key (KTD13). Workers
 * expand and deliver it later.
 */
@Injectable()
export class SendService {
  private readonly db: NotificationDatabase;
  private readonly validator: SendValidator;
  private readonly idempotency: IdempotencyService;
  private readonly recipients: RecipientsService;
  private readonly render: RenderService;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(SendValidator) validator: SendValidator,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(RecipientsService) recipients: RecipientsService,
    @Inject(RenderService) render: RenderService,
  ) {
    this.db = db;
    this.validator = validator;
    this.idempotency = idempotency;
    this.recipients = recipients;
    this.render = render;
  }

  async send(credential: LinkedCredential, request: SendRequest): Promise<SendOutcome> {
    const { senderId } = credential;
    const type = await this.validator.scopedType(credential, request.type);
    const hash = requestHash(request);
    // A replay returns the original as it was accepted, without checking it against today's catalog again.
    const used = await this.idempotency.find(senderId, request.idempotencyKey);
    if (used) return { response: this.idempotency.replay(used, hash), replayed: true };

    const validated = await this.validator.validate(senderId, type, request);
    try {
      return { response: await this.accept(credential, request, validated, hash), replayed: false };
    } catch (error) {
      if (!(error instanceof KeyTakenError)) throw error;
      const committed = await this.idempotency.find(senderId, request.idempotencyKey);
      if (!committed) throw new Error('The idempotency key was taken, but its use is not visible', { cause: error });
      return { response: this.idempotency.replay(committed, hash), replayed: true };
    }
  }

  private accept(
    credential: LinkedCredential,
    request: SendRequest,
    { type, data, systems }: ValidatedSend,
    hash: string,
  ): Promise<SendResponse> {
    const { senderId, credentialId } = credential;
    return this.db.transaction(async (tx) => {
      const [audience, pinned] = await Promise.all([
        audienceColumns(this.recipients, senderId, request.audience, systems, tx),
        this.render.pin(type, tx),
      ]);
      const [row] = await tx
        .insert(notifications)
        .values({ senderId, credentialId, typeKey: type.key, data, ...audience, pinned, policy: type.policy })
        .returning({ notificationId: notifications.id, status: notifications.status });
      if (!row) throw new Error('Inserting the notification returned no row');
      if (!(await this.idempotency.claim(tx, senderId, request.idempotencyKey, hash, row.notificationId))) {
        throw new KeyTakenError();
      }
      return row;
    });
  }
}
