import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard.js';
import { CredentialGuard } from '../auth/credential.guard.js';
import { CurrentCredential } from '../auth/current-principal.decorator.js';
import type { LinkedCredential } from '../auth/directories.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  broadcasterParamsSchema,
  createTopicSchema,
  platformTopicListSchema,
  platformTopicSchema,
  topicListSchema,
  topicParamsSchema,
  topicSchema,
  type BroadcasterParams,
  type CreateTopic,
  type PlatformTopicResponse,
  type TopicParams,
  type TopicResponse,
} from './catalog.schemas.js';
import { TopicsService } from './topics.service.js';

/** Admin endpoints (R15): platform topics and which senders may broadcast to them. */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(AdminGuard)
@Controller({ path: 'admin/topics', version: '1' })
export class AdminTopicsController {
  private readonly topics: TopicsService;

  constructor(@Inject(TopicsService) topics: TopicsService) {
    this.topics = topics;
  }

  @Post()
  @ApiCreatedResponse({ description: 'The new platform topic', standardSchema: platformTopicSchema })
  create(@Body({ schema: createTopicSchema }) input: CreateTopic): Promise<PlatformTopicResponse> {
    return this.topics.createPlatform(input);
  }

  @Get()
  @ApiOkResponse({ description: 'Every platform topic, by key', standardSchema: platformTopicListSchema })
  list(): Promise<PlatformTopicResponse[]> {
    return this.topics.listPlatform();
  }

  @Get(':topicId')
  @ApiOkResponse({ description: 'The platform topic', standardSchema: platformTopicSchema })
  get(@Param({ schema: topicParamsSchema }) { topicId }: TopicParams): Promise<PlatformTopicResponse> {
    return this.topics.getPlatform(topicId);
  }

  @Put(':topicId/broadcasters/:senderId')
  @ApiOkResponse({ description: 'The topic with the sender granted', standardSchema: platformTopicSchema })
  grant(
    @Param({ schema: broadcasterParamsSchema }) { topicId, senderId }: BroadcasterParams,
  ): Promise<PlatformTopicResponse> {
    return this.topics.grantBroadcast(topicId, senderId);
  }

  @Delete(':topicId/broadcasters/:senderId')
  @ApiOkResponse({ description: 'The topic with the sender revoked', standardSchema: platformTopicSchema })
  revoke(
    @Param({ schema: broadcasterParamsSchema }) { topicId, senderId }: BroadcasterParams,
  ): Promise<PlatformTopicResponse> {
    return this.topics.revokeBroadcast(topicId, senderId);
  }
}

/** Credential endpoints (R16): the sender's own topics, and the platform topics it may broadcast to. */
@ApiTags('topics')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(CredentialGuard)
@Controller({ path: 'topics', version: '1' })
export class TopicsController {
  private readonly topics: TopicsService;

  constructor(@Inject(TopicsService) topics: TopicsService) {
    this.topics = topics;
  }

  @Post()
  @ApiCreatedResponse({ description: "The new topic, owned by the credential's sender", standardSchema: topicSchema })
  create(
    @CurrentCredential() credential: LinkedCredential,
    @Body({ schema: createTopicSchema }) input: CreateTopic,
  ): Promise<TopicResponse> {
    return this.topics.createForSender(credential.senderId, input);
  }

  @Get()
  @ApiOkResponse({
    description: "The sender's own topics, then the platform topics it may broadcast to",
    standardSchema: topicListSchema,
  })
  list(@CurrentCredential() credential: LinkedCredential): Promise<TopicResponse[]> {
    return this.topics.listForSender(credential.senderId);
  }

  @Get(':topicId')
  @ApiOkResponse({ description: 'A topic the sender may broadcast to', standardSchema: topicSchema })
  get(
    @CurrentCredential() credential: LinkedCredential,
    @Param({ schema: topicParamsSchema }) { topicId }: TopicParams,
  ): Promise<TopicResponse> {
    return this.topics.getForSender(credential.senderId, topicId);
  }
}
