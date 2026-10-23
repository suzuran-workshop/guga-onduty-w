/**
 * 业务枚举值 —— pg / sqlite 两份 schema 的 check 约束共享此单一真源，防止漂移。
 * 与 packages/shared 的联合类型对齐（UserRole / RecordStatus / AppealStatus / TagCategory / RecordAction）。
 */

export const ROLES = ['admin', 'teacher', 'student'] as const;

/**
 * 记录状态。2026-10-23 变更（需求「申诉后管理员修改而非撤销」）：
 *  - 移除 `appeal_approved`：旧语义是「申诉通过 → 记录踢出计分（全额撤销）」，
 *    新语义是「申诉通过 → 管理员调整分数，记录回 active 并照常计分」。
 *    故不再有「申诉通过」这个终态；调分后记录就是 active（分数已是调整后的值）。
 *  - `appealing`：申诉中，罚分暂仍生效（计入 SCORED_STATUSES），待管理员裁决。
 */
export const RECORD_STATUSES = ['active', 'revoked', 'appealing'] as const;

export const APPEAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const TAG_CATEGORIES = ['positive', 'negative', 'neutral'] as const;

/**
 * 记录操作日志动作。2026-10-23 变更：
 *  - 移除 `appeal_approve`、新增 `adjust`：申诉通过现在表现为「调分」（记录回 active + 分数改为调整后值），
 *    故日志记 `adjust`（reason 含申诉审批意见）。申诉本身的裁决状态由 appeals 表权威记录，
 *    recordLogs 只需反映「记录分数被调整」这一事实。
 */
export const RECORD_ACTIONS = ['create', 'revoke', 'appeal', 'adjust', 'appeal_reject'] as const;

/**
 * 计分口径的单一真源（statistics-repo / awards-repo 共用，消除原 4 份重复定义）：
 *  - `active`：正常记录，计分。
 *  - `appealing`：申诉中，罚分暂仍生效（申诉未裁决前不擅自撤销），计分。
 *  - `revoked`：已撤回，不计分。
 * 申诉通过（adjust）后记录回 active，调整后的分数照常计分——这正是「修改而非撤销」的落点。
 */
export const SCORED_STATUSES = ['active', 'appealing'] as const;

/**
 * 通知种类（2026-10-23 新增，需求 4：教师免登录收钉钉推送）。
 *  - `record_deduction`：扣分即时推送（附申诉链接）
 *  - `record_positive`：加分即时推送（不带申诉链接，仅告知）
 *  - `weekly_report`：每周得分扣分总计
 */
export const NOTIFICATION_KINDS = ['record_deduction', 'record_positive', 'weekly_report'] as const;

/**
 * 通知状态（2026-10-23 新增）。
 *  - `pending`：已入库待发送（凭证缺失或异步队列中）
 *  - `sent`：钉钉受理且回执确认已投递（read 或 unread）
 *  - `failed`：钉钉返回错误，或回执显示 invalid/failed（⚠ asyncsend_v2 的 errcode:0
 *    只代表「已受理」，发给不存在的 userid 也返 0，必须查 getsendresult 才能判失败）
 *  - `skipped`：主动跳过（如班级未绑定班主任、该周周报已发过）
 */
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;

/** 枚举值 → SQL IN 列表字面量（`'a', 'b'`）。值为本地常量，无注入面。 */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

