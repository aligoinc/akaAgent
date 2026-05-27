export const VN_TZ_OFFSET_MIN = 7 * 60;
const WORK_START_MIN = 8 * 60 + 30;
const WORK_END_WEEKDAY_MIN = 18 * 60;
const WORK_END_SATURDAY_MIN = 17 * 60;
function toVnWall(now: Date): Date { return new Date(now.getTime() + VN_TZ_OFFSET_MIN * 60 * 1000); }
function makeVnDate(y: number, m: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, m, d, h, mi, 0, 0) - VN_TZ_OFFSET_MIN * 60 * 1000);
}
function vnDateAtMorning(refWall: Date, addDays: number): Date {
  return makeVnDate(refWall.getUTCFullYear(), refWall.getUTCMonth(), refWall.getUTCDate() + addDays, 8, 30);
}
function daysUntilNextMonday(dow: number, includeToday: boolean): number {
  if (dow === 1 && includeToday) return 0;
  const diff = (1 + 7 - dow) % 7;
  return diff === 0 ? 7 : diff;
}
export function computeCskhDueDate(nowUtc: Date = new Date()): Date {
  const wall = toVnWall(nowUtc);
  const dow = wall.getUTCDay();
  const m = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  if ((dow === 6 && m >= WORK_END_SATURDAY_MIN) || dow === 0) return vnDateAtMorning(wall, daysUntilNextMonday(dow, false));
  if (dow === 6) { if (m < WORK_START_MIN) return vnDateAtMorning(wall, 0); return nowUtc; }
  if (m < WORK_START_MIN) return vnDateAtMorning(wall, 0);
  if (m < WORK_END_WEEKDAY_MIN) return nowUtc;
  return vnDateAtMorning(wall, 1);
}
