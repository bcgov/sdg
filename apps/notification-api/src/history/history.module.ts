import { Module } from '@nestjs/common';

import { AdminHistoryController, SenderHistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';

/** Delivery history for senders and admins (R12, R43, R55): the API role's. */
@Module({
  controllers: [SenderHistoryController, AdminHistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
