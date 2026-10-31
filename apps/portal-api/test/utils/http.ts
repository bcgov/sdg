import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import type { Request, Response } from 'express';
import { vi } from 'vitest';

export function isRequest(value: unknown): value is Request {
  return typeof value === 'object' && value !== null;
}

export function isResponse(value: unknown): value is Response {
  return typeof value === 'object' && value !== null;
}

export function createRequest(options: {
  method?: string;
  url?: string;
  originalUrl?: string;
  baseUrl?: string;
  route?: { path: unknown };
}): Request {
  const req = new IncomingMessage(new Socket());
  if (options.method !== undefined) req.method = options.method;
  if (options.url !== undefined) {
    Object.defineProperty(req, 'url', {
      value: options.url,
      writable: true,
      configurable: true,
    });
  }
  const customReq: unknown = Object.assign(req, {
    originalUrl: options.originalUrl,
    baseUrl: options.baseUrl ?? '',
    route: options.route,
  });
  if (isRequest(customReq)) return customReq;
  throw new Error('Invalid request');
}

export function createResponse(): Response {
  const listeners = new Map<string, Array<() => void>>();
  const mock: unknown = {
    statusCode: 200,
    getHeader: vi.fn<() => undefined>(() => undefined),
    setHeader: vi.fn<() => void>(),
    on: vi.fn<(event: string, listener: () => void) => unknown>((event: string, listener: () => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return mock;
    }),
    once: vi.fn<(event: string, listener: () => void) => unknown>((event: string, listener: () => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return mock;
    }),
    emit: vi.fn<(event: string) => boolean>((event: string) => {
      const list = listeners.get(event) ?? [];
      for (const listener of list) listener();
      return true;
    }),
    end: vi.fn<() => void>(),
  };
  if (isResponse(mock)) return mock;
  throw new Error('Invalid response');
}
