import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ConsoleGuard } from '../auth/audience.guards.js';
import { PeopleSearchService } from './people-search.service.js';
import {
  peopleSearchResultSchema,
  peopleSearchSchema,
  type PeopleSearch,
  type PeopleSearchResult,
} from './principals.schemas.js';

/**
 * People search for administrators choosing whom a flag override targets. The query travels in a POST body so names
 * and emails stay out of request logs (KTD9).
 */
@ApiTags('console')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@ApiForbiddenResponse({ description: 'Not an administrator' })
@Controller({ path: 'console/people', version: '1' })
@UseGuards(ConsoleGuard)
export class PeopleConsoleController {
  private readonly people: PeopleSearchService;

  constructor(@Inject(PeopleSearchService) people: PeopleSearchService) {
    this.people = people;
  }

  @Post('search')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'People who signed in to an app in the audience, by name, at most 20',
    standardSchema: peopleSearchResultSchema,
  })
  @ApiBadRequestResponse({ description: 'A query under 2 characters once trimmed, or an unknown audience' })
  search(@Body({ schema: peopleSearchSchema }) body: PeopleSearch): Promise<PeopleSearchResult> {
    return this.people.search(body);
  }
}
