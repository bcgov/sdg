import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RelayStreamController } from './relay-stream.controller.js';
import { ConfirmRelayController, RelayController, RelayEnabledGuard } from './relay.controller.js';
import { RelayService } from './relay.service.js';
import { SameOriginJsonGuard } from './same-origin-json.guard.js';
import { TokenRefreshService } from './token-refresh.service.js';

/** portal-api's relay to notification-api (R56): recipient endpoints for signed-in users and the public confirm route. */
@Module({
  imports: [AuthModule],
  // The stream route first: Nest registers routes in this order, and RelayController ends in a catch-all (KTD6).
  controllers: [RelayStreamController, RelayController, ConfirmRelayController],
  providers: [RelayService, TokenRefreshService, RelayEnabledGuard, SameOriginJsonGuard],
})
export class NotificationsModule {}
