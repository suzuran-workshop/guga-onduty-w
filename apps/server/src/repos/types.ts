/**
 * Repository 契约 —— db 无关的领域接口。
 *
 * 路由层只依赖这些接口，不碰 drizzle/SQL 细节。装配（repos/index.ts）：
 * drizzle 实现覆盖 sqlite + pg（表对象按方言注入，同一份源码对方言无感）。
 *
 * 通用约定：
 *  - 所有 id 为 uuid string。
 *  - campusId 强制隔离：写操作的 campusId 由调用方（路由，取自 profile）传入，repo 不信任请求体。
 *  - 多语句操作用事务（drizzle: db.transaction，sqlite 同步 / pg 异步，统一 await）。
 *  - 返回领域对象（camelCase，见 @guga-onduty-w/shared）；JSON 列已反序列化为数组。
 */
import type {
  Campus, Grade, Class, DutyGroup, Tag, Template, RecordWithDetails, RecordLog,
  Appeal, AppealWithDetails, DailySummary, Award, AwardCandidate, UserView, UserProfile, User,
  ClassRanking, TrendPoint, DashboardStats, RecordStatus, UserRole, Pagination,
} from '@guga-onduty-w/shared';

/** 分页结果 */
export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

// ── 校区 ────────────────────────────────────────────────────────────
export interface CampusesRepo {
  listAll(): Promise<Campus[]>;
  listForCampus(campusId: string): Promise<Campus[]>;
  findById(id: string): Promise<Campus | null>;
  create(input: { name: string; code: string }): Promise<Campus>;
  update(id: string, input: { name: string; code: string }): Promise<Campus | null>;
  remove(id: string): Promise<void>;
}

// ── 年级 ────────────────────────────────────────────────────────────
export interface GradesRepo {
  listByCampus(campusId: string): Promise<Grade[]>;
  findById(id: string): Promise<Grade | null>;
  create(input: { campusId: string; name: string; sortOrder?: number }): Promise<Grade>;
  update(id: string, input: { name: string; sortOrder?: number }): Promise<Grade | null>;
  remove(id: string): Promise<void>;
}

// ── 班级 ────────────────────────────────────────────────────────────
export interface ClassesRepo {
  listByCampus(campusId: string, gradeId?: string): Promise<Class[]>;
  findById(id: string): Promise<Class | null>;
  /** 记录创建时取校区/年级归属 + 班主任（申诉校验「只能申诉自己班」用） */
  findOwnership(id: string): Promise<{ campusId: string; gradeId: string; teacherUserId: string | null } | null>;
  /** 反查某教师任班主任的班级（钉钉周报按教师聚合、申诉归属校验用） */
  listByTeacher(teacherUserId: string): Promise<Class[]>;
  create(input: { campusId: string; gradeId: string; name: string; classTeacher?: string | null; teacherUserId?: string | null }): Promise<Class>;
  update(id: string, input: { name: string; classTeacher?: string | null; teacherUserId?: string | null }): Promise<Class | null>;
  remove(id: string): Promise<void>;
}

// ── 值周小组（成员双写：dutyGroups.members + userProfiles.groupId，事务一致）──
export interface GroupsRepo {
  listByCampus(campusId: string): Promise<DutyGroup[]>;
  create(input: { campusId: string; name: string; members?: string[] }): Promise<DutyGroup>;
  update(id: string, input: { name: string; members?: string[] }): Promise<DutyGroup | null>;
  remove(id: string): Promise<void>;
}

// ── 用户（auth users 身份锚点 + userProfiles 业务档案）──────────────
export interface UsersRepo {
  list(campusId?: string, role?: UserRole): Promise<UserView[]>;
  findProfile(userId: string): Promise<UserProfile | null>;
  /** 建号：auth register（user+password）+ 建 profile，事务/顺序保证 */
  create(input: {
    campusId: string; username: string; password: string;
    displayName: string; role: UserRole; groupId?: string | null;
  }): Promise<UserView>;
  update(userId: string, input: { displayName: string; role: UserRole; groupId?: string | null }): Promise<UserView | null>;
  remove(userId: string): Promise<void>;
  /** /auth/me：身份 + 档案 + 校区名 */
  findMe(userId: string): Promise<{ user: User; profile: UserProfile; campusName: string } | null>;
}

// ── 标签 ────────────────────────────────────────────────────────────
export interface TagsRepo {
  listByCampus(campusId: string, category?: string): Promise<Tag[]>;
  findById(id: string): Promise<Tag | null>;
  findByIds(ids: string[]): Promise<Tag[]>;
  create(input: { campusId: string; name: string; score: number; color?: string; category?: string; isSystem?: boolean }): Promise<Tag>;
  /** 部分更新语义（修复现有缺字段静默重置 bug）：只改传入的字段 */
  update(id: string, input: { name?: string; score?: number; color?: string; category?: string }): Promise<Tag | null>;
  remove(id: string): Promise<void>;
}

// ── 模板 ────────────────────────────────────────────────────────────
export interface TemplatesRepo {
  listByCampus(campusId: string): Promise<Template[]>; // 含展开 tags（批量查，修复 N+1）
  findById(id: string): Promise<Template | null>;
  create(input: { campusId: string; name: string; tagIds: string[] }): Promise<Template>;
  update(id: string, input: { name: string; tagIds: string[] }): Promise<Template | null>;
  remove(id: string): Promise<void>;
  exportByCampus(campusId: string): Promise<{ name: string; tagIds: string[] }[]>;
  importMany(campusId: string, data: { name: string; tagIds: string[] }[]): Promise<number>; // 事务，返回导入数
}

// ── 值周记录（核心）─────────────────────────────────────────────────
export interface RecordsRepo {
  list(filter: {
    campusId: string; classId?: string; week?: string; status?: RecordStatus;
    page: number; pageSize: number;
  }): Promise<Paged<RecordWithDetails>>;
  findByIdWithDetails(id: string): Promise<RecordWithDetails | null>;
  /**
   * 事务：insert record + record_log；images 为 storage objectKey 数组。
   * **score 由 repo 按 tagIds 求和写入**（标签分权威，不接受 score 传值）——
   * 从结构上杜绝「评分模块自行修改分数」。tagIds 必须已校验属本校区（路由负责）。
   */
  create(input: {
    campusId: string; classId: string; recorderId: string; tagIds: string[];
    comment?: string | null; images?: string[] | null;
    week: string; recordedAt: number;
  }): Promise<RecordWithDetails>;
  /**
   * 多班级批量创建（需求：班级平铺多选，一次给多个班级相同评价）。
   * **每班级落一条独立记录**（各自 id/status，可独立申诉/撤回）；单事务保证全成或全败。
   * score 同样由 repo 按 tagIds 求和（各记录分数相同，因标签集相同）。
   */
  createMany(input: {
    campusId: string; classIds: string[]; recorderId: string; tagIds: string[];
    comment?: string | null; images?: string[] | null;
    week: string; recordedAt: number;
  }): Promise<RecordWithDetails[]>;
  /** 软删（revoke）：事务 update status + log */
  revoke(id: string, operatorId: string, reason: string): Promise<void>;
  /**
   * 调整记录分数（需求：申诉通过是「修改而非撤销」）。事务：
   * update record（tagIds→新集、score→按新 tagIds 重算、status→active）+ log 'adjust'。
   * 记录回 active 后调整后的分数照常计分（SCORED_STATUSES 含 active）。
   */
  adjust(id: string, input: { tagIds: string[]; operatorId: string; reason: string }): Promise<RecordWithDetails>;
  /**
   * 记录操作日志（含申诉调分史）。2026-10-23 新增读取路径——
   * 此前 recordLogs 是纯写表（全仓无 select），而「申诉通过=调分回 active」把调分史
   * 从 record.status 迁移到了日志里，故必须可查，否则调分不可追溯。
   * 按时间升序（先 create 后 adjust），含操作人姓名。
   */
  listLogs(recordId: string): Promise<RecordLog[]>;
  /** 导出行（CSV） */
  listForExport(campusId: string, startWeek?: string, endWeek?: string): Promise<RecordWithDetails[]>;
}

// ── 申诉 ────────────────────────────────────────────────────────────
export interface AppealsRepo {
  list(filter: {
    campusId?: string; teacherId?: string; status?: string; page: number; pageSize: number;
  }): Promise<Paged<AppealWithDetails>>;
  findById(id: string): Promise<AppealWithDetails | null>;
  /** 事务：update record.status→appealing + insert appeal + log（修复现有非原子 bug） */
  create(input: { recordId: string; teacherId: string; reason: string; campusId: string }): Promise<Appeal>;
  /**
   * 事务：update appeal(approved) + **调整 record 分数**（tagIds→新集、score 重算、status→active）+ log 'adjust'。
   * 需求：申诉通过是「修改而非撤销」——管理员给出调整后的标签集，记录回 active 照常计分。
   * tagIds 省略则保持原标签集（仅状态从 appealing 回 active）。
   */
  approve(recordId: string, reviewerId: string, opts: { reviewComment: string | null; tagIds?: string[] }): Promise<void>;
  /** 事务：update appeal(rejected) + record(status appealing→active，分数不变) + log */
  reject(recordId: string, reviewerId: string, reviewComment: string | null): Promise<void>;
}

// ── 每日小结 ────────────────────────────────────────────────────────
export interface SummaryRepo {
  listByCampus(campusId: string, week?: string): Promise<DailySummary[]>;
  create(input: { campusId: string; week: string; date: string; content: string; notifiedTeachers?: string[] | null }): Promise<DailySummary>;
}

// ── 统计 ────────────────────────────────────────────────────────────
export interface StatisticsRepo {
  /** 班级排名：有效口径 SCORED_STATUSES（active+appealing；见 schema/enums.ts） */
  ranking(campusId: string, week?: string, gradeId?: string): Promise<ClassRanking[]>;
  /** 班级趋势：campusId 强制隔离（REVIEW #3，修复跨校区泄漏） */
  trend(campusId: string, classId: string, weeks: string[]): Promise<TrendPoint[]>;
  /** dayStart/dayEnd 为当日 epoch 毫秒区间 [start,end)（路由按本地时区算，修复 UTC 边界 bug） */
  dashboard(campusId: string, dayStart: number, dayEnd: number, week: string): Promise<DashboardStats>;
}

// ── 流动红旗 ────────────────────────────────────────────────────────
export interface AwardsRepo {
  listByCampus(campusId: string, week?: string): Promise<Award[]>;
  /**
   * 候选参考（需求：仅管理员人工颁发，系统只提供参考）。**只读，不落库**。
   * 由 ranking 按年级取第一名派生；alreadyAwarded 标记该周是否已颁（避免重复）。
   * gradeId 可选（限定某年级），否则全校区各年级第一名。
   */
  candidates(campusId: string, week: string, gradeId?: string | null): Promise<AwardCandidate[]>;
  /**
   * 人工颁发（需求：管理员从候选挑选后显式颁发）。事务批量 insert；
   * 幂等靠 UNIQUE(campusId,classId,week) + onConflictDoNothing（重复颁同一班同一周不报错、不重复）。
   * 返回本次实际新增的奖项。
   */
  grant(campusId: string, week: string, classIds: string[], opts?: { category?: string; note?: string | null }): Promise<Award[]>;
  remove(id: string): Promise<void>;
}

// ── 系统设置 ────────────────────────────────────────────────────────
export interface SettingsRepo {
  getMap(campusId: string): Promise<Record<string, string>>;
  upsertMany(campusId: string, entries: { key: string; value: string }[]): Promise<void>; // 事务
}

/** 全部 repo 集合（createRepos 按形态装配） */
export interface Repos {
  campuses: CampusesRepo;
  grades: GradesRepo;
  classes: ClassesRepo;
  groups: GroupsRepo;
  users: UsersRepo;
  tags: TagsRepo;
  templates: TemplatesRepo;
  records: RecordsRepo;
  appeals: AppealsRepo;
  summary: SummaryRepo;
  statistics: StatisticsRepo;
  awards: AwardsRepo;
  settings: SettingsRepo;
}
