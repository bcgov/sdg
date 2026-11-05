import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import type { LinkedCredential } from '../auth/directories.js';
import type { TypeResponse } from '../catalog/catalog.schemas.js';
import { contractValidator } from '../catalog/data-contract.js';
import { policyChannels, type DeliveryPolicy } from '../catalog/policy.js';
import { TopicsService } from '../catalog/topics.service.js';
import { TypesService } from '../catalog/types.service.js';
import { IntegrationResolver } from '../integrations/resolver.service.js';
import { RecipientsService } from '../recipients/recipients.service.js';
import type { Audience, SendRequest } from './send.schemas.js';

/** A send that passed every request-time check (R28). */
export interface ValidatedSend {
  type: TypeResponse;
  /** The data with the keys the contract does not declare dropped. */
  data: Record<string, unknown>;
  /** The sender's system recipient ids, by their index in the audience's recipient list. */
  systems: ReadonlyMap<number, string>;
}

interface AudienceCheck {
  errors: string[];
  systems: Map<number, string>;
}

/** `path: message`, as the validation pipe formats its errors. */
const problem = (path: readonly PropertyKey[], message: string): string => `${path.map(String).join('.')}: ${message}`;

/**
 * R28's request-time checks. The scope check runs first and alone (403); the others run together and are reported
 * together (400), each at the path of what failed, so one bad recipient rejects the whole send and says which.
 */
@Injectable()
export class SendValidator {
  private readonly types: TypesService;
  private readonly topics: TopicsService;
  private readonly integrations: IntegrationResolver;
  private readonly recipients: RecipientsService;

  constructor(
    @Inject(TypesService) types: TypesService,
    @Inject(TopicsService) topics: TopicsService,
    @Inject(IntegrationResolver) integrations: IntegrationResolver,
    @Inject(RecipientsService) recipients: RecipientsService,
  ) {
    this.types = types;
    this.topics = topics;
    this.integrations = integrations;
    this.recipients = recipients;
  }

  /** The type, when the credential is scoped to it (R8). A scope only ever names types that exist. */
  async scopedType(credential: LinkedCredential, typeKey: string): Promise<TypeResponse> {
    const type = credential.scopedTypes.includes(typeKey) ? await this.types.find(typeKey) : null;
    if (!type) throw new ForbiddenException('This credential is not scoped to the type');
    return type;
  }

  /** The data contract, the policy's integrations, the topic and the system recipients. 400 with every problem. */
  async validate(senderId: string, type: TypeResponse, request: SendRequest): Promise<ValidatedSend> {
    const parsed = contractValidator(type.dataContract).safeParse(request.data);
    const dataErrors = parsed.success
      ? []
      : parsed.error.issues.map((issue) => problem(['data', ...issue.path], issue.message));
    const [channelErrors, audience] = await Promise.all([
      this.integrationErrors(senderId, type.policy),
      this.checkAudience(senderId, request.audience),
    ]);
    const errors = [...dataErrors, ...channelErrors, ...audience.errors];
    if (!parsed.success || errors.length > 0) throw new BadRequestException(errors);
    return { type, data: parsed.data, systems: audience.systems };
  }

  /** Each policy channel needs an integration for the sender. In-app is never a policy channel and always has one (R38). */
  private async integrationErrors(senderId: string, policy: DeliveryPolicy): Promise<string[]> {
    const channels = policyChannels(policy);
    const resolved = await Promise.all(channels.map((channel) => this.integrations.resolve(senderId, channel)));
    return channels
      .filter((_channel, index) => resolved[index] === null)
      .map((channel) =>
        problem(['type'], `The policy needs ${channel}, which has no usable integration for this sender`),
      );
  }

  /** A topic the sender may broadcast to (R15, R16); system recipients the sender registered (R33). */
  private async checkAudience(senderId: string, audience: Audience): Promise<AudienceCheck> {
    const check: AudienceCheck = { errors: [], systems: new Map() };
    if (audience.kind === 'topic') {
      const topic = await this.topics.broadcastable(senderId, audience.topicId);
      if (!topic) check.errors.push(problem(['audience', 'topicId'], 'No topic this sender may broadcast to'));
    }
    if (audience.kind !== 'recipients') return check;
    const systems = audience.recipients.flatMap((recipient, index) =>
      recipient.kind === 'system' ? [{ index, systemId: recipient.systemId }] : [],
    );
    const found = await this.recipients.findSystems(
      senderId,
      systems.map(({ systemId }) => systemId),
    );
    for (const { index, systemId } of systems) {
      const recipientId = found.get(systemId);
      if (recipientId) check.systems.set(index, recipientId);
      else
        check.errors.push(problem(['audience', 'recipients', index, 'systemId'], 'No system recipient with this id'));
    }
    return check;
  }
}
