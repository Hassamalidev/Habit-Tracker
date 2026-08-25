/** Date helpers that stay in local time.
 *
 * `new Date("2026-08-24")` parses as UTC midnight, which lands on the 23rd for
 * anyone west of Greenwich. Every conversion here goes through the numeric
 * constructor instead, so a day never shifts under the user.
 */

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

export function addMonths(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function dayNumber(iso: string): number {
  return parseISO(iso).getDate();
}

/** 0 = Monday .. 6 = Sunday, matching the backend and Python's weekday(). */
export function weekdayIndex(iso: string): number {
  return (parseISO(iso).getDay() + 6) % 7;
}

export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function isWeekend(iso: string): boolean {
  return weekdayIndex(iso) >= 5;
}

export function formatDay(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function formatDayLong(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function shiftDays(iso: string, delta: number): string {
  const date = parseISO(iso);
  date.setDate(date.getDate() + delta);
  return toISO(date);
}

export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
