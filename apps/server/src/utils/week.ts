/**
 * 周次工具 —— 单一真源（修复旧代码 statistics.ts 里 getCurrentWeek 重复实现）。
 *
 * 周次格式：`YYYY-Www`（如 2026-W41）。
 * ⚠ 现有算法非严格 ISO-8601（跨年可能错位），但为保持与历史数据/前端一致，
 *   本次沿用旧口径（与 routes/statistics.ts 的 getCurrentWeek 逐字等价），仅收敛到一处。
 *   ISO 化是独立改进项，不在本次底层替换范围（会改变 week 字符串，破坏历史数据匹配）。
 */

/** 给定日期算周次字符串 */
export function weekOf(date: Date): string {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** 当前周次 */
export function getCurrentWeek(): string {
  return weekOf(new Date());
}

/**
 * 最近 N 周的周次列表（升序，末位是当周）—— trend 接口用。
 * 复刻旧 statistics/trend 的 weekList 生成逻辑。
 */
export function recentWeeks(n: number, from: Date = new Date()): string[] {
  const list: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from);
    d.setDate(d.getDate() - i * 7);
    list.push(weekOf(d));
  }
  return list;
}

/** 当日本地时区的 epoch 区间 [start, end)（dashboard 判「今日」，修复旧代码 UTC 边界 bug） */
export function todayRange(from: Date = new Date()): { dayStart: number; dayEnd: number } {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStart: start.getTime(), dayEnd: end.getTime() };
}
