import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import { FragmentsService } from './fragments.service.js';
import {
  fragmentParamsSchema,
  fragmentVersionListSchema,
  fragmentVersionSchema,
  saveFragmentSchema,
  type FragmentParams,
  type FragmentVersionResponse,
  type SaveFragment,
} from './templates.schemas.js';

const SAVED = 'The new version, saved after every current template using it rendered with it';

/** Admin endpoints (R22): shared layouts, which templates name with `{% layout "name" %}`. */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(AdminGuard)
@Controller({ path: 'admin/layouts', version: '1' })
export class AdminLayoutsController {
  private readonly fragments: FragmentsService;

  constructor(@Inject(FragmentsService) fragments: FragmentsService) {
    this.fragments = fragments;
  }

  @Get()
  @ApiOkResponse({ description: 'The current version of each layout', standardSchema: fragmentVersionListSchema })
  list(): Promise<FragmentVersionResponse[]> {
    return this.fragments.listCurrent('layout');
  }

  @Post(':name/versions')
  @ApiCreatedResponse({ description: SAVED, standardSchema: fragmentVersionSchema })
  save(
    @Param({ schema: fragmentParamsSchema }) { name }: FragmentParams,
    @Body({ schema: saveFragmentSchema }) { source }: SaveFragment,
  ): Promise<FragmentVersionResponse> {
    return this.fragments.save('layout', name, source);
  }

  @Get(':name/versions')
  @ApiOkResponse({ description: 'Every version, newest first', standardSchema: fragmentVersionListSchema })
  versions(@Param({ schema: fragmentParamsSchema }) { name }: FragmentParams): Promise<FragmentVersionResponse[]> {
    return this.fragments.versions('layout', name);
  }
}

/** Admin endpoints (R22): shared partials, which templates name with `{% include "name" %}` or `{% render %}`. */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(AdminGuard)
@Controller({ path: 'admin/partials', version: '1' })
export class AdminPartialsController {
  private readonly fragments: FragmentsService;

  constructor(@Inject(FragmentsService) fragments: FragmentsService) {
    this.fragments = fragments;
  }

  @Get()
  @ApiOkResponse({ description: 'The current version of each partial', standardSchema: fragmentVersionListSchema })
  list(): Promise<FragmentVersionResponse[]> {
    return this.fragments.listCurrent('partial');
  }

  @Post(':name/versions')
  @ApiCreatedResponse({ description: SAVED, standardSchema: fragmentVersionSchema })
  save(
    @Param({ schema: fragmentParamsSchema }) { name }: FragmentParams,
    @Body({ schema: saveFragmentSchema }) { source }: SaveFragment,
  ): Promise<FragmentVersionResponse> {
    return this.fragments.save('partial', name, source);
  }

  @Get(':name/versions')
  @ApiOkResponse({ description: 'Every version, newest first', standardSchema: fragmentVersionListSchema })
  versions(@Param({ schema: fragmentParamsSchema }) { name }: FragmentParams): Promise<FragmentVersionResponse[]> {
    return this.fragments.versions('partial', name);
  }
}
