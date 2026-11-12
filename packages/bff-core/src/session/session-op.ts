import type { Request } from 'express';

import './session.types.js';

/** Promisified `req.session` operations, so handlers can await them and errors propagate. */
export function sessionOp(req: Request, op: 'save' | 'regenerate' | 'destroy'): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session[op]((error: unknown) => {
      if (!error) resolve();
      else reject(error instanceof Error ? error : new Error(`Session ${op} failed`, { cause: error }));
    });
  });
}
