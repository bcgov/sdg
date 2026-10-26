import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthUser } from '../types.js';
import type { AuthRequest } from './request.js';

/** Injects `request.user` (set by an auth guard); `undefined` on unguarded routes. */
export const CurrentUser: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined =>
    context.switchToHttp().getRequest<AuthRequest>().user,
);
