import type { Page } from '@playwright/test';

export const admin = { id: '0b6f8d0e-5c43-4a8e-9a43-2f1a3d9e7c11', name: 'Ada Lovelace', email: 'ada@gov.bc.ca' };

/** Fakes console-api's /api/auth/me in the browser, so the signed-out suite needs no API or Keycloak. */
export async function mockSession(page: Page, signedIn: () => boolean): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    signedIn()
      ? route.fulfill({ json: admin })
      : route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
  );
}

/** A signed-in administrator with one registered client and its history, all answered in the browser. */
export async function mockRegistry(page: Page): Promise<void> {
  await mockSession(page, () => true);
  const at = '2026-11-02T18:00:00.000Z';
  await page.route('**/api/v1/console/service-clients/history**', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 1,
            clientId: 'billing-1',
            action: 'added',
            actor: { principalId: admin.id, name: admin.name },
            createdAt: at,
          },
        ],
        nextBefore: null,
      },
    }),
  );
  await page.route('**/api/v1/console/service-clients', (route) =>
    route.fulfill({
      json: [{ clientId: 'billing-1', displayName: 'Billing', enabled: true, createdAt: at, updatedAt: at }],
    }),
  );
}
