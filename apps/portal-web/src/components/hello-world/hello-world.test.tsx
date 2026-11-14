import { FlagProvider, FLAGS_PATH } from '@repo/feature-flags';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HelloWorld } from '.';

const HELLO_WORLD_PATH = '/api/v1/shared/hello-world';

const fetchMock = vi.fn<typeof fetch>();

/** Answers the flags and hello-world requests; anything else is a test bug. */
function answer(flags: Record<string, boolean>, helloWorld: () => Response) {
  fetchMock.mockImplementation((input) => {
    if (input === FLAGS_PATH) return Promise.resolve(Response.json(flags));
    if (input === HELLO_WORLD_PATH) return Promise.resolve(helloWorld());
    return Promise.reject(new Error(`unexpected request to ${JSON.stringify(input)}`));
  });
}

const helloWorldCalls = () => fetchMock.mock.calls.filter(([input]) => input === HELLO_WORLD_PATH);

/** Retries on and quick, so a missing `retry: false` would show up as extra requests within the test. */
function renderHelloWorld() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FlagProvider>
        <HelloWorld />
      </FlagProvider>
    </QueryClientProvider>,
  );
}

/** Lets any retry (delay 0) fire before requests are counted. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe('HelloWorld', () => {
  it('Should show the endpoint message when hello_world is on (R13, AE2)', async () => {
    answer({ hello_world: true }, () => Response.json({ message: 'Hello, world!' }));
    renderHelloWorld();
    expect(await screen.findByText('Hello, world!')).toBeInTheDocument();
    const [, init] = helloWorldCalls()[0]!;
    expect(init?.credentials).toBe('same-origin');
  });

  it('Should send no hello-world request and render nothing when hello_world is off (R13, AE1)', async () => {
    answer({}, () => Response.json({ message: 'Hello, world!' }));
    const { container } = renderHelloWorld();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(FLAGS_PATH, expect.anything()));
    await settle();
    expect(helloWorldCalls()).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['404', 404],
    ['500', 500],
  ])('Should render nothing after a %s and send only one request (R13)', async (_label, status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const responses: Response[] = [];
    answer({ hello_world: true }, () => {
      const response = Response.json({ statusCode: status }, { status });
      responses.push(response);
      return response;
    });
    const { container } = renderHelloWorld();
    await waitFor(() => expect(helloWorldCalls()).toHaveLength(1));
    await settle();
    expect(helloWorldCalls()).toHaveLength(1);
    expect(container).toBeEmptyDOMElement();
    // An unread body leaves the request open in Chromium.
    expect(responses[0]!.bodyUsed).toBe(true);
    // A 404 is the normal "not for you" answer; only a real failure is logged, and never shown.
    expect(warn).toHaveBeenCalledTimes(status === 404 ? 0 : 1);
  });

  it('Should render nothing when the endpoint answers an unexpected body (R13)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer({ hello_world: true }, () => Response.json({ greeting: 'hi' }));
    const { container } = renderHelloWorld();
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });
});
