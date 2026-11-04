import { z } from 'zod';

import { defineIntegrationType } from '../integration-type.js';

/**
 * The built-in in-app integration: the delivery engine writes the item to the recipient's inbox in notification-api's
 * own database, so there is nothing to configure and no outbound connection.
 */
export const inAppIntegration = defineIntegrationType({
  key: 'in-app',
  channel: 'in-app',
  configSchema: z.strictObject({}),
  secretFields: [],
});
