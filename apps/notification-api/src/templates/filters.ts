import type { Liquid } from 'liquidjs';

/** Who a render formats for (R24): the rendered template's language and the recipient's IANA time zone. */
export interface RenderLocale {
  language: string;
  timeZone: string;
}

const DATE_STYLES = ['short', 'medium', 'long', 'full'] as const;
type DateStyle = (typeof DATE_STYLES)[number];

/** `2027-03-04`: a calendar date with no time or zone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateStyle(style: unknown, fallback: DateStyle): DateStyle {
  if (style === undefined) return fallback;
  const match = DATE_STYLES.find((candidate) => candidate === style);
  if (!match) throw new Error(`The style must be one of ${DATE_STYLES.join(', ')}`);
  return match;
}

/** A Date for ISO 8601 text, epoch milliseconds or a Date; null when the value is none of those. */
function toDate(value: unknown): Date | null {
  const date =
    value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** A number for a number or numeric text; null otherwise. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Formats in the template's language and the recipient's zone. A date-only value is a calendar date, so it is
 * formatted as that day everywhere rather than as midnight UTC shifted into the recipient's zone.
 */
function formatDate(locale: RenderLocale, value: unknown, options: Intl.DateTimeFormatOptions): unknown {
  const date = toDate(value);
  if (!date) return value;
  const timeZone = typeof value === 'string' && DATE_ONLY.test(value) ? 'UTC' : locale.timeZone;
  return new Intl.DateTimeFormat(locale.language, { ...options, timeZone }).format(date);
}

/**
 * Registers the formatting filters on an engine (R24), replacing Liquid's strftime `date`. Like Liquid's own
 * filters, a value that is not a date or number renders unchanged; an unknown style or currency fails the render.
 *
 * - `{{ expires_at | date: "long" }}`: short, medium (default), long or full.
 * - `{{ starts_at | time: "short" }}`: the time of day, same styles (default short).
 * - `{{ count | number }}`.
 * - `{{ fee | currency: "CAD" }}`: an ISO 4217 code, CAD by default.
 */
export function registerFilters(engine: Liquid, locale: RenderLocale): void {
  engine.registerFilter('date', (value: unknown, style?: unknown) =>
    formatDate(locale, value, { dateStyle: dateStyle(style, 'medium') }),
  );
  engine.registerFilter('time', (value: unknown, style?: unknown) =>
    formatDate(locale, value, { timeStyle: dateStyle(style, 'short') }),
  );
  engine.registerFilter('number', (value: unknown) => {
    const number = toNumber(value);
    return number === null ? value : new Intl.NumberFormat(locale.language).format(number);
  });
  engine.registerFilter('currency', (value: unknown, code: unknown = 'CAD') => {
    if (typeof code !== 'string') throw new Error('The currency must be an ISO 4217 code, such as CAD');
    const number = toNumber(value);
    return number === null
      ? value
      : new Intl.NumberFormat(locale.language, { style: 'currency', currency: code }).format(number);
  });
}
