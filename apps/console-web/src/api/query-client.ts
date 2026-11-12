import { QueryClient } from '@tanstack/react-query';

/**
 * No automatic retries: every console-api refusal has its own handling, and a 503 offers the administrator a
 * retry instead of silently repeating the call.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
