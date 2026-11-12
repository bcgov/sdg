import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

import { fakeConsoleApi, type FakeConsoleApi } from './fake-console-api';
import { stubViewport } from './match-media';
import { renderAt } from './render';

/** Renders a signed-in page and waits for the shell; the sidebar is the element the toggle controls. */
export async function renderShell(path: string, consoleApi: FakeConsoleApi = fakeConsoleApi()) {
  const rendered = renderAt(path);
  const toggle = await screen.findByRole('button', { name: /sidebar$/ });
  const sidebar = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  if (!sidebar) throw new Error('the toggle controls no element');
  return { ...rendered, consoleApi, toggle, sidebar };
}

/** Renders a signed-in page on a narrow screen (below 768px) and waits for the top-bar toggle that opens the panel. */
export async function renderMobileShell(path: string, consoleApi: FakeConsoleApi = fakeConsoleApi()) {
  const viewport = stubViewport(true);
  const rendered = renderAt(path);
  const toggle = await screen.findByRole('button', { name: 'Open navigation' });
  return { ...rendered, consoleApi, viewport, toggle };
}

type User = ReturnType<typeof userEvent.setup>;

/** Presses Tab until the element has focus, at most `pressesLeft` times. */
async function pressTabUntil(user: User, element: HTMLElement, pressesLeft: number): Promise<void> {
  if (document.activeElement === element || pressesLeft === 0) return;
  await user.tab();
  return pressTabUntil(user, element, pressesLeft - 1);
}

/** Tabs to an element, so react-aria sees keyboard focus (tooltips open only on visible focus). */
export async function tabTo(user: User, element: HTMLElement): Promise<void> {
  await pressTabUntil(user, element, 20);
  expect(element).toHaveFocus();
}
