import { z } from 'zod';

/** A Notification type's key. U6's catalog defines the types; grants and scopes name them by key. */
export const typeKeySchema = z.string().min(1).max(128).meta({ description: 'A Notification type key' });

export const senderParamsSchema = z.object({ senderId: z.uuid() });
export type SenderParams = z.infer<typeof senderParamsSchema>;

export const grantParamsSchema = senderParamsSchema.extend({ typeKey: typeKeySchema });
export type GrantParams = z.infer<typeof grantParamsSchema>;

export const credentialParamsSchema = senderParamsSchema.extend({ credentialId: z.uuid() });
export type CredentialParams = z.infer<typeof credentialParamsSchema>;

export const createSenderSchema = z.object({ name: z.string().trim().min(1).max(200) });
export type CreateSender = z.infer<typeof createSenderSchema>;

/** A person as the IdP identifies them (R6). */
export const ownerSchema = z.object({
  issuer: z.string().min(1).meta({ description: 'The IdP issuer URL (the token `iss`)' }),
  subject: z.string().min(1).meta({ description: 'The IdP subject (the token `sub`)' }),
});
export type Owner = z.infer<typeof ownerSchema>;

export const senderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  owners: z.array(ownerSchema),
  grantedTypes: z.array(typeKeySchema),
  /** Never the secret: it is returned once, when the URL is set (KTD10). */
  callbackUrl: z.url().nullable(),
});
export type SenderResponse = z.infer<typeof senderSchema>;

/** https only: failure callbacks carry delivery details (R7). */
export const setCallbackSchema = z.object({
  url: z.url({ protocol: /^https$/, error: 'Must be an https:// URL' }),
});
export type SetCallback = z.infer<typeof setCallbackSchema>;

export const callbackResponseSchema = z.object({
  url: z.url(),
  secret: z.string().meta({
    description: 'The Standard Webhooks signing secret (`whsec_…`). Shown only in this response: store it now.',
  }),
});
export type CallbackResponse = z.infer<typeof callbackResponseSchema>;

export const linkCredentialSchema = z.object({
  clientId: z.string().min(1).max(255).meta({ description: 'The Keycloak service-account client id' }),
});
export type LinkCredential = z.infer<typeof linkCredentialSchema>;

export const setScopesSchema = z.object({
  typeKeys: z.array(typeKeySchema).meta({ description: "A subset of the sender's granted types" }),
});
export type SetScopes = z.infer<typeof setScopesSchema>;

export const credentialSchema = z.object({
  id: z.uuid(),
  clientId: z.string(),
  scopedTypes: z.array(typeKeySchema),
});
export type CredentialResponse = z.infer<typeof credentialSchema>;

export const credentialListSchema = z.array(credentialSchema);
