/**
 * 周次工具（前端）—— 与后端 src/utils/week.ts + src/duty/date.ts 口径一致。
 *
 * 两组能力：
 *  1. 值周周次字符串（YYYY-Www）—— POST /records 的 week 字段、排名/趋势用。
 *  2. 值班周导航（周一锚点 + 7 天日期）—— 值班大表矩阵用。
 *
 * ⚠ 一律用**本地日历日**（startOfDay 归一），避免 UTC 存储丢学期首末日（外部 PRD 记录的 P2 bug）。
 */

// ── 值周周次 ────────────────────────────────────────────────────────
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

// ── 值班周导航（本地日历日）─────────────────────────────────────────
/** YYYY-MM-DD（本地日历日，与后端 dateKey 一致） */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 解析 YYYY-MM-DD 为本地午夜（不用 UTC，避免时区偏移丢日） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** 归一到本地午夜 */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 该日期所在周的周一（周日归上一周）——与后端 mondayOf 一致 */
export function mondayOf(d: Date): Date {
  const day = startOfDay(d);
  const dow = day.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  day.setDate(day.getDate() + diff);
  return day;
}

/** 以 anchor 所在周为基准偏移 off 周，返回该周周一 */
export function mondayOffset(anchor: Date, off: number): Date {
  const mon = mondayOf(anchor);
  mon.setDate(mon.getDate() + off * 7);
  return mon;
}

/** MM-DD 短格式（矩阵列头展示） */
export function shortDate(s: string): string {
  return s.slice(5);
}

/** 分钟数 → HH:mm（时段展示，480 → 08:00） */
export function minuteToHHmm(min: number | null): string {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 到岗率 → 百分比字符串 */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
