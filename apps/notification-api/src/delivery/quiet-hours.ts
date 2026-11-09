/** A recipient's quiet hours (R40): local `HH:MM` times, the window running from `start` up to `end`. */
export interface QuietHours {
  readonly start: string;
  readonly end: string;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE_MS = 60_000;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  if (hours === undefined || minutes === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Not an HH:MM time: ${time}`);
  }
  return hours * 60 + minutes;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
}

/** The wall-clock date and time of `instant` in `timeZone`. */
function localTime(instant: Date, timeZone: string): LocalDateTime {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts['year'] ?? 0,
    month: parts['month'] ?? 0,
    day: parts['day'] ?? 0,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
  };
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const local = localTime(new Date(instant), timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return asUtc - Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}

const HALF_DAY_MS = 12 * 60 * MINUTE_MS;

/**
 * The instant the wall clock in `timeZone` shows `local`, trying the offsets in force half a day either side. A
 * repeated fall-back time maps to its first occurrence; a time skipped by a spring-forward change maps to the same
 * distance past the jump (02:30 becomes 03:30).
 */
function instantOf(local: LocalDateTime, timeZone: string): Date {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const [first = wall, second = wall] = [
    wall - offsetAt(wall - HALF_DAY_MS, timeZone),
    wall - offsetAt(wall + HALF_DAY_MS, timeZone),
  ].toSorted((a, b) => a - b);
  if (first + offsetAt(first, timeZone) === wall) return new Date(first);
  return new Date(second);
}

/** Whether `minute` (minutes after local midnight) is inside the window. A window from a time to itself is empty. */
function inWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * The first instant at or after `at` outside the recipient's quiet hours in `timeZone` (R40): `at` itself outside the
 * window, else the window's local end time, computed with Intl so it holds across DST changes.
 */
export function nextAllowedInstant(at: Date, quietHours: QuietHours, timeZone: string): Date {
  const start = minutesOf(quietHours.start);
  const end = minutesOf(quietHours.end);
  const local = localTime(at, timeZone);
  const minute = local.hour * 60 + local.minute;
  if (!inWindow(minute, start, end)) return at;
  // A window that crosses midnight and started today ends tomorrow.
  const endsTomorrow = start > end && minute >= start;
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day + (endsTomorrow ? 1 : 0)));
  return instantOf(
    {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
      hour: Math.floor(end / 60),
      minute: end % 60,
    },
    timeZone,
  );
}
