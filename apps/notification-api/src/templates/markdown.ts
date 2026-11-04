import { micromark } from 'micromark';

/**
 * In-app Markdown to sanitized HTML (R24). micromark follows CommonMark and, by default, escapes raw HTML (so a
 * `<script>` tag is text) and drops link and image URLs whose protocol is not http(s), mailto, irc(s) or xmpp.
 */
export function markdownToHtml(markdown: string): string {
  return micromark(markdown);
}
