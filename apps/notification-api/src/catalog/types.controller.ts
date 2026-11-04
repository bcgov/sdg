import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  createTypeSchema,
  typeListSchema,
  typeParamsSchema,
  typeSchema,
  type CreateType,
  type TypeParams,
  type TypeResponse,
} from './catalog.schemas.js';
import { TypesService } from './types.service.js';

/** Admin endpoints (R13, R14): define Notification types with their data contract and delivery policy. */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(AdminGuard)
@Controller({ path: 'admin/types', version: '1' })
export class AdminTypesController {
  private readonly types: TypesService;

  constructor(@Inject(TypesService) types: TypesService) {
    this.types = types;
  }

  @Post()
  @ApiCreatedResponse({ description: 'The new Notification type', standardSchema: typeSchema })
  create(@Body({ schema: createTypeSchema }) input: CreateType): Promise<TypeResponse> {
    return this.types.create(input);
  }

  @Get()
  @ApiOkResponse({ description: 'Every Notification type, by key', standardSchema: typeListSchema })
  list(): Promise<TypeResponse[]> {
    return this.types.list();
  }

  @Get(':typeKey')
  @ApiOkResponse({ description: 'The Notification type', standardSchema: typeSchema })
  get(@Param({ schema: typeParamsSchema }) { typeKey }: TypeParams): Promise<TypeResponse> {
    return this.types.get(typeKey);
  }
}
