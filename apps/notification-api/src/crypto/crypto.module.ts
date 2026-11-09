import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { SecretCipher } from './secret-cipher.js';

/** Provides the {@link SecretCipher} keyed by NOTIFICATION_ENCRYPTION_KEY. Global: inject it with `@Inject(SecretCipher)`. */
@Global()
@Module({
  providers: [
    {
      provide: SecretCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new SecretCipher(config.get('NOTIFICATION_ENCRYPTION_KEY', { infer: true })),
    },
  ],
  exports: [SecretCipher],
})
export class CryptoModule {}
