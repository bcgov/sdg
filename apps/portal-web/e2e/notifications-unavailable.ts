import type { Page } from '@playwright/test';

/**
 * Answers portal-api's notification relay with 404, as portal-api does when its relay is off, so the header's bell
 * hides rather than showing its load-failure state. For signed-in specs that aren't about notifications.
 */
export async function mockNotificationsUnavailable(page: Page): Promise<void> {
  await page.route('**/api/v1/notifications/**', (route) =>
    route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } }),
  );
}
