/**
 * Digest day boundaries. "오늘" = 전날 21:00 KST ~ 당일 21:00 KST, 웹훅 수신 시각 기준.
 * KST has no DST, so a fixed +09:00 offset is exact.
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DIGEST_HOUR_KST = 21;
export const EDIT_WINDOW_MS = 60 * 60 * 1000;

function parseDate(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid digest date: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** 21:00 KST on the given calendar day, as a UTC Date. */
export function digestCutoff(date: string): Date {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d, DIGEST_HOUR_KST, 0, 0) - KST_OFFSET_MS);
}

/** [start, end) UTC bounds for the digest day `date` (YYYY-MM-DD, KST). */
export function digestDayBounds(date: string): { start: Date; end: Date } {
  const end = digestCutoff(date);
  return { start: new Date(end.getTime() - 24 * 60 * 60 * 1000), end };
}

/** Format a Date as the KST calendar date YYYY-MM-DD. */
export function kstDateString(d: Date): string {
  const shifted = new Date(d.getTime() + KST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Which digest date a received timestamp belongs to (after 21:00 KST → next day's digest). */
export function digestDateFor(now: Date): string {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  if (shifted.getUTCHours() >= DIGEST_HOUR_KST) {
    shifted.setUTCDate(shifted.getUTCDate() + 1);
  }
  return kstDateString(new Date(shifted.getTime() - KST_OFFSET_MS));
}

/** The digest date the 21:00 cron should publish when it runs at `now`. */
export function digestDateForCron(now: Date): string {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  // Cron runs at/after 21:00 KST → today's date. If it ran early (before 21:00) treat as today too
  // (manual trigger); callers may pass an explicit date instead.
  return kstDateString(new Date(shifted.getTime() - KST_OFFSET_MS));
}

/** Edit window = published_at + 60분, derived (no lock column). */
export function editWindowOpen(publishedAt: Date | null | undefined, now: Date): boolean {
  if (!publishedAt) return false;
  return now.getTime() < publishedAt.getTime() + EDIT_WINDOW_MS;
}

export function editDeadline(publishedAt: Date): Date {
  return new Date(publishedAt.getTime() + EDIT_WINDOW_MS);
}

const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** "9/22 (월)" for a YYYY-MM-DD digest date. */
export function formatDigestDateKo(date: string): string {
  const { y, m, d } = parseDate(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d} (${WEEKDAYS_KO[dow]})`;
}
