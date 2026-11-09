/** A platform default email integration for tests (R46). The password is a test value, not a real secret. */
export const PLATFORM_SMTP_ENV = {
  DEFAULT_SMTP_HOST: 'smtp.platform.example.com',
  DEFAULT_SMTP_PORT: '587',
  DEFAULT_SMTP_SECURE: 'false',
  DEFAULT_SMTP_USER: 'platform',
  DEFAULT_SMTP_PASSWORD: 'platform-test-password',
  DEFAULT_SMTP_FROM: 'notify@platform.example.com',
} as const;

/** A sender's own `smtp` integration (F4). */
export const SENDER_SMTP = {
  type: 'smtp',
  config: {
    host: 'smtp.permits.example.com',
    port: 465,
    secure: true,
    user: 'permits',
    password: 'permits-test-password',
    from: 'permits@example.com',
  },
} as const;

export const integrationPath = (senderId: string, channel: string): string =>
  `/api/v1/senders/${senderId}/integrations/${channel}`;
