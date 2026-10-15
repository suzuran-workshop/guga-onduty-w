/**
 * 周次工具（前端）—— 与后端 src/utils/week.ts 口径一致。
 *
 * 值周周次字符串（YYYY-Www）—— POST /records 的 week 字段、排名/趋势用。
 *
 * ⚠ 一律用**本地日历日**，避免 UTC 存储丢学期首末日。
 */

export function weekOf(date: Date): string {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function getCurrentWeek(): string {
  return weekOf(new Date());
}

/** epoch 毫秒 → 本地时间字符串（列表展示） */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('zh-CN', { hour12: false });
}

/** epoch 毫秒 → 日期（YYYY-MM-DD） */
export function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  return dateKey(d);
}

/** YYYY-MM-DD（本地日历日） */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
