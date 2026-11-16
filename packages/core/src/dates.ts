/** Calendar dates as 'YYYY-MM-DD' strings. All math is on UTC days (no DST drift). */
export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Days since 1970-01-01 (day 0 is a Thursday). */
export function toDayNumber(date: IsoDate): number {
  if (!isIsoDate(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return (toDayNumber(date) + 4) % 7;
}

/** 1–12 */
export function monthOf(date: IsoDate): number {
  return Number(date.slice(5, 7));
}

/** Today's calendar date in the given IANA zone (default America/Chicago, SPEC A-7). */
export function todayIn(timeZone = 'America/Chicago', now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
