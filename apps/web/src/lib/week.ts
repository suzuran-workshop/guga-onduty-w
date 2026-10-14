/**
 * 周次工具（前端）—— 与后端 src/utils/week.ts 口径一致。
 * POST /records 需要前端传 week 字段，故前端也要算当前周。
 * 格式：YYYY-Www（如 2026-W41）。
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
  return new Date(epochMs).toISOString().slice(0, 10);
}
