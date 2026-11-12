import type { DocumentBuilder } from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from './bff.options.js';

/** Registers the session cookie as the `session` security scheme the BFF's routes declare (SwaggerOptions.configure). */
export function addSessionCookieAuth(builder: DocumentBuilder, cookieName: string): DocumentBuilder {
  return builder.addCookieAuth(cookieName, { type: 'apiKey', in: 'cookie', name: cookieName }, SESSION_SECURITY_SCHEME);
}
