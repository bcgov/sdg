import type { DynamicModule, InjectionToken, OptionalFactoryDependency } from '@nestjs/common';

/** `forRootAsync` options shared by the auth modules. */
export interface AsyncModuleOptions<TOptions> {
  imports?: DynamicModule['imports'];
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: never[]) => TOptions | Promise<TOptions>;
}
