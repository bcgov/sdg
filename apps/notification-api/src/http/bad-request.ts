import { BadRequestException, HttpStatus } from '@nestjs/common';

/** The body of a 400 that lists problems: one summary, and each problem on its own. */
export interface BadRequestBody {
  readonly statusCode: HttpStatus.BAD_REQUEST;
  readonly error: 'Bad Request';
  readonly message: string;
  readonly errors: readonly string[];
}

/** A 400 with a summary `message` and every problem in `errors`, the one shape for a list of problems. */
export function badRequest(message: string, errors: readonly string[]): BadRequestException {
  const body: BadRequestBody = {
    statusCode: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message,
    errors: [...errors],
  };
  return new BadRequestException(body);
}
