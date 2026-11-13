import { z } from 'zod';

/** GET /api/v1/shared/flags: each flag that is on for the caller, mapped to true. A key it doesn't name is off (R10). */
export const flagListSchema = z.record(z.string(), z.literal(true));
export type FlagList = z.infer<typeof flagListSchema>;

/** GET /api/v1/shared/hello-world, when `hello_world` is on for the caller. */
export const helloWorldSchema = z.object({ message: z.literal('Hello, world!') });
export type HelloWorld = z.infer<typeof helloWorldSchema>;
