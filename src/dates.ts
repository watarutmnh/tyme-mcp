/**
 * Parse a date input for use in Tyme JXA scripts.
 *
 * Date-only strings are interpreted in the server's local timezone to avoid
 * the UTC interpretation of `new Date("YYYY-MM-DD")`. Callers embed the result
 * into JXA scripts via `toISOString()` so the resolved instant is preserved.
 *
 * JS Date silently rolls over out-of-range calendar components
 * (e.g. "2026-02-30" becomes Mar 2), so calendar validity is checked
 * lexically before construction.
 */
export function parseDateInput(
  input: string,
  opts: { endOfDay?: boolean; dateOnly?: boolean } = {},
): Date {
  const parts = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/);
  if (parts) {
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const daysInMonth = new Date(Number(parts[1]), month, 0).getDate();
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
      throw new Error(`Invalid date: "${input}" (no such calendar date)`);
    }
  }

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  if (opts.dateOnly && !isDateOnly) {
    throw new Error(
      `Invalid date: "${input}" (expected a date-only value, e.g. "2026-03-01")`,
    );
  }

  let date: Date;
  if (isDateOnly && parts) {
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    date = opts.endOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day);
  } else {
    date = new Date(input);
  }

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid date: "${input}" (expected ISO 8601, e.g. "2026-03-01" or "2026-03-01T09:00:00")`,
    );
  }

  return date;
}
