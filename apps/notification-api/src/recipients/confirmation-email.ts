import { renderParts } from '../templates/renderer.js';

/**
 * The built-in confirmation email (KTD15). It is not in the catalog, but it renders with the same sandboxed Liquid
 * and MJML as catalog templates.
 */
const CONFIRMATION_TEMPLATE = {
  subject: 'Confirm your email address',
  html: `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Confirm that {{ address }} is your email address to receive notifications there.</mj-text>
        <mj-button href="{{ confirmUrl }}">Confirm email address</mj-button>
        <mj-text>The link expires in 24 hours. If you did not add this address, you can ignore this email.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`,
  text: `Confirm that {{ address }} is your email address to receive notifications there:

{{ confirmUrl }}

The link expires in 24 hours. If you did not add this address, you can ignore this email.`,
} as const;

export interface ConfirmationContent {
  subject: string;
  html: string;
  text: string;
}

/** Renders the confirmation email for `address` with its link. */
export async function renderConfirmationEmail(
  address: string,
  confirmUrl: string,
  timeZone: string,
): Promise<ConfirmationContent> {
  const rendered = await renderParts({
    channel: 'email',
    parts: CONFIRMATION_TEMPLATE,
    fragments: {},
    locale: { language: 'en-CA', timeZone },
    data: { address, confirmUrl },
    envelope: { type: 'contact-point-confirmation', recipientId: '' },
    strict: false,
  });
  if (rendered.channel !== 'email') throw new Error('The confirmation email rendered for another channel');
  return { subject: rendered.subject, html: rendered.html, text: rendered.text };
}
