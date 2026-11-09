/**
 * A template part that cannot render: a Liquid error, MJML that does not compile, a webhook payload that is not
 * JSON, or an in-app action link that is not https or relative. Saving rejects it (R23); a delivery fails with it
 * (R24).
 */
export class TemplateRenderError extends Error {
  readonly part: string;

  constructor(part: string, message: string, options?: ErrorOptions) {
    super(`${part}: ${message}`, options);
    this.name = 'TemplateRenderError';
    this.part = part;
  }
}

/** An error's message, or the thrown value as a string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs `render` for `part`, reporting any failure as that part's TemplateRenderError. */
export async function renderingPart<T>(part: string, render: () => Promise<T>): Promise<T> {
  try {
    return await render();
  } catch (error) {
    if (error instanceof TemplateRenderError) throw error;
    throw new TemplateRenderError(part, errorMessage(error), { cause: error });
  }
}
