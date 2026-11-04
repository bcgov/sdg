import mjml2html from 'mjml';

/** One problem MJML's validator found. */
interface MjmlIssue {
  line?: number;
  tagName?: string;
  message?: string;
}

function hasIssues(error: unknown): error is Error & { errors: MjmlIssue[] } {
  return error instanceof Error && 'errors' in error && Array.isArray(error.errors);
}

/** `line 3 (mj-bogus): …`, leaving out the formatted message's file path, which is the server's working directory. */
function describeIssues(issues: readonly MjmlIssue[]): string {
  return issues.map((issue) => `line ${issue.line ?? '?'} (${issue.tagName ?? 'mjml'}): ${issue.message}`).join('; ');
}

/**
 * Compiles Liquid-rendered MJML to email HTML (KTD6). `strict` (on save) rejects any validation issue; otherwise
 * MJML renders past them, since the template passed strict validation when it was saved. `mj-include` is ignored,
 * so templates never read files, and no web fonts are added.
 */
export async function compileMjml(source: string, { strict }: { strict: boolean }): Promise<string> {
  try {
    const { html } = await mjml2html(source, {
      validationLevel: strict ? 'strict' : 'soft',
      ignoreIncludes: true,
      fonts: {},
    });
    return html;
  } catch (error) {
    if (hasIssues(error)) throw new Error(`MJML is not valid: ${describeIssues(error.errors)}`, { cause: error });
    throw error;
  }
}
