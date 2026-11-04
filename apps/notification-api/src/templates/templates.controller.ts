import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard.js';
import { typeParamsSchema, type TypeParams } from '../catalog/catalog.schemas.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  previewQuerySchema,
  previewSchema,
  saveTemplateSchema,
  templateParamsSchema,
  templateVersionListSchema,
  templateVersionParamsSchema,
  templateVersionSchema,
  type PreviewQuery,
  type PreviewResponse,
  type SaveTemplate,
  type TemplateParams,
  type TemplateVersionParams,
  type TemplateVersionResponse,
} from './templates.schemas.js';
import { VersionsService } from './versions.service.js';

/** Admin endpoints (R21–R23, R25): a type's templates per channel and language, their versions and previews. */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(AdminGuard)
@Controller({ path: 'admin/types/:typeKey/templates', version: '1' })
export class AdminTemplatesController {
  private readonly versions: VersionsService;

  constructor(@Inject(VersionsService) versions: VersionsService) {
    this.versions = versions;
  }

  @Get()
  @ApiOkResponse({
    description: 'The current version of each of the type’s templates',
    standardSchema: templateVersionListSchema,
  })
  list(@Param({ schema: typeParamsSchema }) { typeKey }: TypeParams): Promise<TemplateVersionResponse[]> {
    return this.versions.listCurrent(typeKey);
  }

  @Post(':channel/:language/versions')
  @ApiCreatedResponse({
    description: 'The new version, saved after it rendered with full and required-only sample data',
    standardSchema: templateVersionSchema,
  })
  save(
    @Param({ schema: templateParamsSchema }) params: TemplateParams,
    @Body({ schema: saveTemplateSchema }) { parts }: SaveTemplate,
  ): Promise<TemplateVersionResponse> {
    return this.versions.save(params, parts);
  }

  @Get(':channel/:language/versions')
  @ApiOkResponse({ description: 'Every version, newest first', standardSchema: templateVersionListSchema })
  listVersions(@Param({ schema: templateParamsSchema }) params: TemplateParams): Promise<TemplateVersionResponse[]> {
    return this.versions.versions(params);
  }

  @Get(':channel/:language/versions/:version')
  @ApiOkResponse({ description: 'One version', standardSchema: templateVersionSchema })
  getVersion(
    @Param({ schema: templateVersionParamsSchema }) { version, ...params }: TemplateVersionParams,
  ): Promise<TemplateVersionResponse> {
    return this.versions.version(params, version);
  }

  @Get(':channel/:language/preview')
  @ApiOkResponse({
    description: 'The current (or given) version rendered with sample data for every field',
    standardSchema: previewSchema,
  })
  preview(
    @Param({ schema: templateParamsSchema }) params: TemplateParams,
    @Query({ schema: previewQuerySchema }) query: PreviewQuery,
  ): Promise<PreviewResponse> {
    return this.versions.preview(params, query);
  }
}
