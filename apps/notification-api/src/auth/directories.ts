import { Injectable } from '@nestjs/common';

/** A Keycloak service-account client linked to a sender (R8). */
export interface LinkedCredential {
  readonly senderId: string;
  readonly credentialId: string;
  /** The subset of the sender's granted Notification types this credential may send. */
  readonly scopedTypes: readonly string[];
}

/** Resolves a Keycloak client id to the credential it is linked as, if any. */
export interface CredentialDirectory {
  findByClientId(clientId: string): Promise<LinkedCredential | null>;
}

/** A person, as the IdP identifies them. Sender owners are named this way (R6). */
export interface PersonRef {
  readonly issuer: string;
  readonly subject: string;
}

/** Answers whether a person owns a sender. */
export interface SenderOwnership {
  isOwner(senderId: string, person: PersonRef): Promise<boolean>;
}

export const CREDENTIAL_DIRECTORY = Symbol('CREDENTIAL_DIRECTORY');
export const SENDER_OWNERSHIP = Symbol('SENDER_OWNERSHIP');

/** Holds links in memory: none until `link` is called, so every client id resolves to null by default. */
@Injectable()
export class InMemoryCredentialDirectory implements CredentialDirectory {
  private readonly links = new Map<string, LinkedCredential>();

  link(clientId: string, credential: LinkedCredential): void {
    this.links.set(clientId, credential);
  }

  findByClientId(clientId: string): Promise<LinkedCredential | null> {
    return Promise.resolve(this.links.get(clientId) ?? null);
  }
}

const ownerKey = (senderId: string, person: PersonRef): string =>
  JSON.stringify([senderId, person.issuer, person.subject]);

/** Holds owners in memory: nobody owns anything until `addOwner` is called, so it denies by default. */
@Injectable()
export class InMemorySenderOwnership implements SenderOwnership {
  private readonly owners = new Set<string>();

  addOwner(senderId: string, person: PersonRef): void {
    this.owners.add(ownerKey(senderId, person));
  }

  isOwner(senderId: string, person: PersonRef): Promise<boolean> {
    return Promise.resolve(this.owners.has(ownerKey(senderId, person)));
  }
}
