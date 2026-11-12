import { Module } from '@nestjs/common';

import { PrincipalsModule } from '../principals/principals.module.js';
import { GatewayGuard } from './gateway.guard.js';
import { RegistryConsoleController } from './registry.console.controller.js';
import { RegistryGatewayController } from './registry.gateway.controller.js';
import { RegistryService } from './registry.service.js';

/** The service-account registry: its console routes, and the gateway audience it authorizes. */
@Module({
  imports: [PrincipalsModule],
  controllers: [RegistryConsoleController, RegistryGatewayController],
  providers: [RegistryService, GatewayGuard],
  exports: [RegistryService, GatewayGuard],
})
export class RegistryModule {}
