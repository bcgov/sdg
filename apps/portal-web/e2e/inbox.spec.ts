import { expect, type Page, type Route, test } from '@playwright/test';

const user = { id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' };

const items = [1, 2, 3].map((n) => ({
  id: `i-${n}`,
  notificationId: `n-${n}`,
  type: 'general',
  title: `Notification ${n}`,
  body: `<p>Body ${n}</p>`,
  excerpt: `Excerpt ${n}`,
  actionUrl: null,
  language: 'en',
  readAt: n === 3 ? '2026-11-05T09:00:00.000Z' : null,
  acknowledgedAt: null,
  createdAt: `2026-11-05T1${n}:00:00.000Z`,
}));

/** portal-api's relay, faked in the browser: two unread of three, one item per page, and a stream that ends. */
function fulfillNotifications(route: Route) {
  const url = new URL(route.request().url());
  const byNotification = /\/inbox\/by-notification\/([^/]+)$/u.exec(url.pathname)?.[1];
  const item = items.find(({ notificationId }) => notificationId === byNotification);
  if (item) return route.fulfill({ json: item });
  const read = /\/inbox\/([^/]+)\/read$/u.exec(url.pathname)?.[1];
  const readItem = items.find(({ id }) => id === read);
  if (readItem && route.request().method() === 'POST') {
    return route.fulfill({ json: { ...readItem, readAt: '2026-11-05T15:00:00.000Z' } });
  }
  if (url.pathname.endsWith('/inbox/unread-count')) return route.fulfill({ json: { unread: 2 } });
  if (url.pathname.endsWith('/inbox/stream')) {
    return route.fulfill({ body: ': open\n\n', contentType: 'text/event-stream' });
  }
  if (url.pathname.endsWith('/inbox')) {
    const unread = url.searchParams.get('unread') === 'true';
    return route.fulfill({
      json: { items: unread ? items.filter((i) => i.readAt === null) : items, nextCursor: null },
    });
  }
  return route.fulfill({ status: 404, json: { statusCode: 404 } });
}

async function mockSignedIn(page: Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: user }));
  await page.route('**/api/v1/notifications/**', fulfillNotifications);
}

test.describe('portal-web inbox', () => {
  test('shows the bell with the unread count, and "View all" opens the inbox page', async ({ page }) => {
    await mockSignedIn(page);
    await page.goto('/');

    const bell = page.getByRole('banner').getByRole('button', { name: 'Notifications, 2 unread' });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveText('2');

    await bell.click();
    const popover = page.getByRole('dialog', { name: 'Notifications' });
    await expect(popover).toBeVisible();
    await expect(popover.getByText('Notification 1')).toBeVisible();

    await popover.getByRole('link', { name: 'View all' }).click();
    await expect(page).toHaveURL(/\/inbox$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    const list = page.getByRole('main').getByRole('list', { name: 'Notifications' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Unread (2)' })).toBeVisible();

    await page.getByRole('link', { name: 'Unread (2)' }).click();
    await expect(page).toHaveURL(/\/inbox\?tab=unread$/u);
    await expect(list.getByRole('listitem')).toHaveCount(2);
  });

  test('clicking an inbox row opens its notification page and marks it read', async ({ page }) => {
    await mockSignedIn(page);
    const read = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/notifications/inbox/i-1/read'),
    );
    await page.goto('/inbox');

    const list = page.getByRole('main').getByRole('list', { name: 'Notifications' });
    await list.getByRole('link', { name: 'Notification 1' }).click();

    await expect(page).toHaveURL(/\/inbox\/n-1$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Notification 1' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Body 1')).toBeVisible();
    await read;
    await page.getByRole('link', { name: 'Back to inbox' }).click();
    await expect(page).toHaveURL(/\/inbox$/u);
  });
});
