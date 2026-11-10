import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import type { CallerRequest } from '../auth/caller.js';
import { PrincipalResolver } from '../auth/principal.resolver.js';
import type { ServiceClientView } from './registry.schemas.js';
import { RegistryService } from './registry.service.js';

/** The request once `GatewayGuard` admitted it: the caller's registry entry rides along for the handler. */
export interface GatewayRequest extends CallerRequest {
  serviceClient?: ServiceClientView;
}

/**
 * `/api/v<N>/gateway/*`: client-credentials tokens from registered, enabled clients (R9). The resolver answers 401/503
 * to a token it cannot verify; this guard then looks the client up, uncached, on every request, so a disabled or
 * removed client is refused on its next call even with an unexpired token (R20, R21). A registry miss is a 403.
 */
@Injectable()
export class GatewayGuard implements CanActivate {
  private readonly logger = new Logger(GatewayGuard.name);
  private readonly resolver: PrincipalResolver;
  private readonly registry: RegistryService;

  constructor(
    @Inject(PrincipalResolver) resolver: PrincipalResolver,
    @Inject(RegistryService) registry: RegistryService,
  ) {
    this.resolver = resolver;
    this.registry = registry;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GatewayRequest>();
    const caller = await this.resolver.resolve(request);
    if (caller.kind !== 'service-account') throw new ForbiddenException();
    const entry = await this.registry.find(caller.clientId);
    if (entry === undefined || !entry.enabled) {
      this.logger.warn({
        msg: 'Refused a gateway call from a service client that is not registered and enabled',
        clientId: caller.clientId,
        registered: entry !== undefined,
      });
      throw new ForbiddenException('This client is not registered or is disabled');
    }
    request.serviceClient = entry;
    return true;
  }
}

/** The registry entry `GatewayGuard` admitted. Use it only on routes behind that guard. */
export const CurrentServiceClient: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ServiceClientView => {
    const { serviceClient } = context.switchToHttp().getRequest<GatewayRequest>();
    if (serviceClient === undefined) throw new Error('@CurrentServiceClient() used on a route without GatewayGuard');
    return serviceClient;
  },
);
