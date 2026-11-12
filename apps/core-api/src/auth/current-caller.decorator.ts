import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Caller, CallerRequest } from './caller.js';

/** The caller an audience guard resolved for this request. Use it only on routes behind one of those guards. */
export const CurrentCaller: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Caller => {
    const { caller } = context.switchToHttp().getRequest<CallerRequest>();
    if (caller === undefined) throw new Error('@CurrentCaller() used on a route without an audience guard');
    return caller;
  },
);
