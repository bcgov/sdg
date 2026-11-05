import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard.js';
import { CredentialGuard } from '../auth/credential.guard.js';
import { CurrentCredential } from '../auth/current-principal.decorator.js';
import type { LinkedCredential } from '../auth/directories.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  historyQuerySchema,
  notificationDetailSchema,
  notificationPageSchema,
  notificationParamsSchema,
  type HistoryQuery,
  type NotificationDetail,
  type NotificationPage,
  type NotificationParams,
} from './history.schemas.js';
import { HistoryService } from './history.service.js';

const LIST = {
  description: 'Notifications matching every filter given, newest first',
  standardSchema: notificationPageSchema,
};
const DETAIL = {
  description:
    'The notification, its roll-up by delivery status, its deliveries with their attempts, and its in-app items',
  standardSchema: notificationDetailSchema,
};

/** Credential endpoints (R12, R43, R55): the history of the credential's own sender. */
@ApiTags('notifications')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(CredentialGuard)
@Controller({ path: 'notifications', version: '1' })
export class SenderHistoryController {
  private readonly history: HistoryService;

  constructor(@Inject(HistoryService) history: HistoryService) {
    this.history = history;
  }

  @Get()
  @ApiOkResponse(LIST)
  list(
    @CurrentCredential() credential: LinkedCredential,
    @Query({ schema: historyQuerySchema }) query: HistoryQuery,
  ): Promise<NotificationPage> {
    return this.history.list(credential.senderId, query);
  }

  @Get(':notificationId')
  @ApiOkResponse(DETAIL)
  @ApiNotFoundResponse({ description: 'No notification of this sender with this id' })
  get(
    @CurrentCredential() credential: LinkedCredential,
    @Param({ schema: notificationParamsSchema }) { notificationId }: NotificationParams,
  ): Promise<NotificationDetail> {
    return this.history.get(credential.senderId, notificationId);
  }
}

/** Admin endpoints (R12): every sender's history. */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(AdminGuard)
@Controller({ path: 'admin/notifications', version: '1' })
export class AdminHistoryController {
  private readonly history: HistoryService;

  constructor(@Inject(HistoryService) history: HistoryService) {
    this.history = history;
  }

  @Get()
  @ApiOkResponse(LIST)
  list(@Query({ schema: historyQuerySchema }) query: HistoryQuery): Promise<NotificationPage> {
    return this.history.list(null, query);
  }

  @Get(':notificationId')
  @ApiOkResponse(DETAIL)
  @ApiNotFoundResponse({ description: 'No notification with this id' })
  get(
    @Param({ schema: notificationParamsSchema }) { notificationId }: NotificationParams,
  ): Promise<NotificationDetail> {
    return this.history.get(null, notificationId);
  }
}
