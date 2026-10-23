/**
 * 前后端共享类型契约 —— 值周管理领域模型。
 *
 * ⚠ 迁移说明（docs/MIGRATION-HOMURA.md §2.2）：
 *  - 所有实体 id 从 integer 改为 **uuid string**（身份模型统一到 auth SDK 的 uuid 锚点）。
 *  - 字段一律 **camelCase**，与 drizzle schema 列名 / API wire 两者一致，消除映射层。
 *  - 用户拆分为 `User`（auth 身份锚点：id/username/nickname/avatarUrl）+
 *    `UserProfile`（业务档案：campusId/role/displayName/groupId）。
 *  - 时间戳统一 epoch 毫秒（number）。
 */

// ── 枚举（与 server/src/schema/enums.ts 单一真源对齐）──────────────────
export type UserRole = 'admin' | 'teacher' | 'student';
/**
 * 2026-10-23：移除 `appeal_approved`。申诉通过不再是「撤销记录」的终态，而是「管理员调分后记录回
 * active 照常计分」（需求：修改而非撤销）。调分历史见 recordLogs 的 `adjust` 动作。
 */
export type RecordStatus = 'active' | 'revoked' | 'appealing';
export type AppealStatus = 'pending' | 'approved' | 'rejected';
export type TagCategory = 'positive' | 'negative' | 'neutral';
/** 2026-10-23：`appeal_approve` → `adjust`（申诉通过表现为调分，reason 含审批意见） */
export type RecordAction = 'create' | 'revoke' | 'appeal' | 'adjust' | 'appeal_reject';

// ── 实体 ────────────────────────────────────────────────────────────
export interface Campus {
  id: string;
  name: string;
  code: string;
  createdAt: number;
}

export interface Grade {
  id: string;
  campusId: string;
  name: string;
  sortOrder: number;
  campusName?: string;
}

export interface Class {
  id: string;
  gradeId: string;
  campusId: string;
  name: string;
  /** 班主任展示名（自由文本，仅展示） */
  classTeacher: string | null;
  /**
   * 班主任**钉钉 userid**（权威关联，2026-10-23 新增：扣分推送目标 + 申诉归属校验）。
   * ⚠ 不是本系统 users.id——钉钉 userid 形如 `0252163856461532927016`，非 uuid。
   * 由管理员从「引入组织通讯录」的联系人中下拉指定；未绑定为 null。
   */
  teacherDingtalkId: string | null;
  gradeName?: string;
  campusName?: string;
}

/** auth SDK 身份锚点（users 表） */
export interface User {
  id: string;
  username: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 业务档案（userProfiles 表）——「你能做什么」 */
export interface UserProfile {
  userId: string;
  campusId: string;
  displayName: string;
  role: UserRole;
  groupId: string | null;
}

/** 列表页返回的用户视图（身份 + 档案 + 关联名） */
export interface UserView {
  id: string;
  username: string | null;
  campusId: string;
  displayName: string;
  role: UserRole;
  groupId: string | null;
  groupName: string | null;
  campusName: string;
  createdAt: number;
}

export interface DutyGroup {
  id: string;
  campusId: string;
  name: string;
  /** 成员 userId(uuid) 数组 */
  members: string[] | null;
  createdAt: number;
}

export interface Tag {
  id: string;
  campusId: string;
  name: string;
  score: number;
  color: string;
  category: TagCategory;
  isSystem: number;
  createdAt: number;
}

export interface Template {
  id: string;
  campusId: string;
  name: string;
  /** tag id(uuid) 数组 */
  tagIds: string[];
  createdAt: number;
  /** 展开的标签（列表接口附带） */
  tags?: Tag[];
}

/**
 * 值周记录领域对象。
 * ⚠ 命名为 DutyRecord（非 Record）—— 避免遮蔽 TS 内置 Record<K,V> 工具类型
 *   （遮蔽会让同文件/导入方的 Record<string,string> 等写法全部失效）。
 */
export interface DutyRecord {
  id: string;
  campusId: string;
  classId: string;
  recorderId: string;
  /** 评价标签 id 数组（2026-10-23 从单值 tagId 改为多值）；可为 null/空（未选标签，0 分） */
  tagIds: string[] | null;
  /** 分数 = 所选标签分之和（服务端按 tagIds 求和，标签分为权威，不接受前端传值） */
  score: number;
  comment: string | null;
  /** 图片 storage objectKey 数组；读取走 /files/<key> 代理 */
  images: string[] | null;
  week: string;
  status: RecordStatus;
  recordedAt: number;
}

export interface RecordWithDetails extends DutyRecord {
  className: string;
  gradeName: string;
  recorderName: string;
  /** 所选标签的完整对象（含 name/score/color/category），按 tagIds 顺序；未选为空数组 */
  tags: Tag[];
}

export interface Appeal {
  id: string;
  recordId: string;
  teacherId: string;
  reason: string;
  status: AppealStatus;
  reviewerId: string | null;
  reviewComment: string | null;
  createdAt: number;
  reviewedAt: number | null;
}

export interface AppealRecordInfo {
  score: number;
  comment: string | null;
  week: string;
  recordedAt: number;
  recordStatus: RecordStatus;
  className: string;
  /** 关联记录的标签（2026-10-23 多标签：从单值 tagName 改为对象数组） */
  tags: Tag[];
}

export interface AppealWithDetails extends Appeal {
  teacherName: string;
  reviewerName: string | null;
  recordInfo: AppealRecordInfo | null;
  /** 关联记录的校区（详情端点做跨校区隔离用，REVIEW #9；来自 join records.campusId） */
  campusId: string | null;
}

export interface RecordLog {
  id: string;
  recordId: string;
  action: RecordAction;
  operatorId: string;
  reason: string | null;
  createdAt: number;
  /** 操作人姓名（join userProfiles；用户已删则为「已删除用户」）—— 仅读取日志时填充 */
  operatorName?: string;
}

export interface DailySummary {
  id: string;
  campusId: string;
  week: string;
  date: string;
  content: string;
  notifiedTeachers: string[] | null;
  createdAt: number;
}

export interface Award {
  id: string;
  campusId: string;
  classId: string;
  week: string;
  category: string;
  note: string | null;
  awardedAt: number;
  className?: string;
  gradeName?: string;
}

export interface Setting {
  id: string;
  campusId: string;
  key: string;
  value: string;
}

// ── 统计 ────────────────────────────────────────────────────────────
export interface ClassRanking {
  rank: number;
  classId: string;
  className: string;
  gradeId: string;
  gradeName: string;
  totalScore: number;
  positiveCount: number;
  negativeCount: number;
  recordCount: number;
}

export interface TrendPoint {
  week: string;
  totalScore: number;
}

export interface DashboardStats {
  todayRecords: number;
  todayPositive: number;
  todayNegative: number;
  weekTopClass: string | null;
  weekTopScore: number | null;
}

// ── API 契约 ────────────────────────────────────────────────────────
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  pagination?: Pagination;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ── 请求体 ──────────────────────────────────────────────────────────
export interface LoginRequest {
  username: string;
  password: string;
}

/** GET /api/v1/auth/me —— 身份 + 档案 + 校区名 */
export interface MeResponse {
  user: User;
  profile: UserProfile;
  campusName: string;
}

export interface CreateUserRequest {
  campusId: string;
  username: string;
  password?: string;
  displayName: string;
  role: UserRole;
  groupId?: string | null;
}

export interface UpdateUserRequest {
  displayName: string;
  role: UserRole;
  groupId?: string | null;
}

/**
 * 创建值周记录请求。2026-10-23 变更（需求：班级平铺多选 + 标签多选）：
 *  - classIds：一次可选多个班级，服务端为**每个班级落一条独立记录**（各自 id/status，可独立申诉/撤回）。
 *  - tagIds：可多选标签，分数由服务端按标签分求和（标签分权威，**不接受 score 传值**）。
 *  - 含任一扣分标签（category=negative 或 score<0）时 images 必填（扣分必拍照）。
 * 注意：实际 HTTP 走 multipart（FormData），字段为 class_ids[]/tag_ids[]/images[]，见 routes/records.ts。
 */
export interface CreateRecordRequest {
  classIds: string[];
  tagIds: string[];
  comment?: string | null;
  week: string;
  images?: string[] | null;
}

export interface CreateAppealRequest {
  reason: string;
}

/**
 * 申诉裁决请求。2026-10-23 变更（需求：申诉通过是「修改而非撤销」）：
 * approve 时管理员给出调整后的 tagIds（分数随之重算），记录回 active 照常计分；
 * reject 时记录回 active、分数不变。reviewComment 记入 recordLogs 的 adjust/appeal_reject。
 */
export interface AppealReviewRequest {
  reviewComment?: string | null;
  /** 仅 approve 用：调整后的标签集；服务端按此重算 score。省略则保持原 tagIds */
  tagIds?: string[];
}

export interface CreateSummaryRequest {
  week: string;
  date: string;
  content: string;
  notifiedTeachers?: string[] | null;
}

/**
 * 人工颁发流动红旗请求。2026-10-23 变更（需求：仅管理员人工颁发，系统只提供参考）：
 * 不再由系统自动评选落库，而是管理员从候选中挑选班级后显式颁发。
 */
export interface AwardRequest {
  week: string;
  /** 要颁发红旗的班级（可多选）；服务端逐个校验归属与唯一约束 */
  classIds: string[];
  category?: string;
  note?: string | null;
}

/**
 * 流动红旗候选（系统提供的**参考**，不落库）。
 * 由 statistics.ranking 按年级取第一名派生——管理员可采纳，也可改选其他班级。
 */
export interface AwardCandidate {
  classId: string;
  className: string;
  gradeId: string;
  gradeName: string;
  totalScore: number;
  /** 该年级内排名（候选通常取 rank=1） */
  rank: number;
  /** 该周是否已颁发过（避免重复颁旗；对应 UNIQUE(campusId,classId,week)） */
  alreadyAwarded: boolean;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

// ── SSE 事件 ────────────────────────────────────────────────────────
export interface RecordCreatedEvent {
  recordId: string;
  className: string;
  /** 所选标签名（2026-10-23 多标签：从单值 tagName 改为数组）；未选标签为空数组 */
  tagNames: string[];
  points: number;
  timestamp: number;
  campusId: string;
}

// ── 钉钉域（2026-10-23，需求 4：教师免登录收推送）─────────────────────
// 与 server/src/schema/enums.ts 的 NOTIFICATION_KINDS / NOTIFICATION_STATUSES 单一真源对齐

/** 通知种类 */
export type NotificationKind = 'record_deduction' | 'record_positive' | 'weekly_report';

/**
 * 通知状态。⚠ `sent` 的判定不能只看 asyncsend_v2 的 errcode:0——那是「已受理」，
 * 发给不存在的 userid 也返 0；必须查 getsendresult 回执确认已投递才置 sent。
 */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/** 钉钉通讯录联系人（本地缓存，源自组织通讯录，**不含家校通讯录**） */
export interface DingtalkContact {
  /** 钉钉 userid（企业内唯一，非本系统 users.id） */
  userId: string;
  unionId: string | null;
  name: string;
  mobile: string | null;
  title: string | null;
  avatarUrl: string | null;
  /** 所属部门 id 列表（同一人可属多部门） */
  deptIds: number[] | null;
  /** 部门名路径（冗余存储，展示用） */
  deptNames: string[] | null;
  syncedAt: number;
}

/** 通讯录写入入参（同步时用） */
export interface DingtalkContactInput {
  userId: string;
  unionId?: string | null;
  name: string;
  mobile?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  deptIds?: number[] | null;
  deptNames?: string[] | null;
  syncedAt: number;
}

/** 通讯录同步结果（管理员在设置里触发「引入整个组织通讯录」） */
export interface ContactsSyncResult {
  /** 本次写入/更新的联系人数 */
  synced: number;
  /** 拉到的部门数 */
  depts: number;
  /** 个别部门拉取失败（尽力而为，不中断整体） */
  truncated: boolean;
  errors: Array<{ deptId: number; message: string }>;
  /** 家校通讯录（本系统**不引入**；此处仅回报探测结果供管理员知情） */
  family: { included: false; reason: string };
  syncedAt: number;
}

/** 通知日志领域对象 */
export interface NotificationLog {
  id: string;
  campusId: string;
  /** 收件人本系统 users.id（可空：通讯录里的人可能还没有系统账号） */
  recipientUserId: string | null;
  /** 收件人钉钉 userid（推送实际目标） */
  recipientPlatformId: string;
  kind: NotificationKind;
  status: NotificationStatus;
  recordId: string | null;
  week: string | null;
  title: string | null;
  /** 幂等键（仅周报填写） */
  dedupeKey: string | null;
  /** 钉钉 asyncsend_v2 的 task_id */
  providerTaskId: string | null;
  error: string | null;
  createdAt: number;
  sentAt: number | null;
}

/** 通知入库入参 */
export interface NotificationLogInput {
  campusId: string;
  recipientUserId?: string | null;
  recipientPlatformId: string;
  kind: NotificationKind;
  recordId?: string | null;
  week?: string | null;
  title?: string | null;
  dedupeKey?: string | null;
}
