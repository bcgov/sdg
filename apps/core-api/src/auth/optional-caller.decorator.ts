import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Caller, CallerRequest } from './caller.js';

/** The caller `OptionalSharedGuard` resolved for this request, or undefined when it came without a token. */
export function optionalCaller(context: ExecutionContext): Caller | undefined {
  return context.switchToHttp().getRequest<CallerRequest>().caller;
}

/**
 * The caller on a route behind `OptionalSharedGuard`: a portal or console person, or undefined for an anonymous
 * request. `@CurrentCaller()` throws without a caller, so routes that admit anonymous callers use this instead.
 */
export const OptionalCaller: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Caller | undefined => optionalCaller(context),
);
