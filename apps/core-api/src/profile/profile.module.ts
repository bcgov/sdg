import { Module } from '@nestjs/common';

import { ProfilePortalController } from './profile.portal.controller.js';

/** The resident's live profile; the userinfo client comes from the global AuthModule. */
@Module({ controllers: [ProfilePortalController] })
export class ProfileModule {}
