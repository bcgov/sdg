import type { AuthUser } from '../types.js';

/** Minimal structural view of the HTTP request the bindings read and write. */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}
