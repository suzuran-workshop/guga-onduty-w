/**
 * 业务枚举值 —— pg / sqlite 两份 schema 的 check 约束共享此单一真源，防止漂移。
 * 与 packages/shared 的联合类型对齐（UserRole / RecordStatus / AppealStatus / TagCategory / RecordAction）。
 */

export const ROLES = ['admin', 'teacher', 'student'] as const;
export const RECORD_STATUSES = ['active', 'revoked', 'appealing', 'appeal_approved'] as const;
export const APPEAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const TAG_CATEGORIES = ['positive', 'negative', 'neutral'] as const;
/** 修复：现有 DDL 的 action 无 CHECK，且实际写入 'create' 不在 shared RecordAction 中 —— 此处补全 */
export const RECORD_ACTIONS = ['create', 'revoke', 'appeal', 'appeal_approve', 'appeal_reject'] as const;

// ── 值班域枚举（docs/DUTY-FUSION.md §2）──────────────────────────────
/** 排班类型：teaching=教师执勤（粗粒度巡查）、dutyWeek=值周生值周（细粒度巡查）—— 融合点 */
export const DUTY_KINDS = ['teaching', 'dutyWeek'] as const;
/** 单双周规则：everyweek=每周、odd=奇数周、even=偶数周 */
export const WEEK_PARITIES = ['everyweek', 'odd', 'even'] as const;
/** 调班类型：swap=交换、proxy=代理 */
export const SWAP_TYPES = ['swap', 'proxy'] as const;
/** 调班/巡查状态 */
export const SWAP_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const INSPECT_STATUSES = ['present', 'absent'] as const;

/** 枚举值 → SQL IN 列表字面量（`'a', 'b'`）。值为本地常量，无注入面。 */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}
