/**
 * Repository 契约 —— db 无关的领域接口。
 *
 * 路由层只依赖这些接口，不碰 drizzle/rest/SQL 细节。三轨装配（repos/index.ts）：
 *  - drizzle 实现覆盖 sqlite + pg（表对象按方言注入，同一份源码）
 *  - rest 实现覆盖 qw-pages（PostgREST API）
 *
 * 通用约定：
 *  - 所有 id 为 uuid string。
 *  - campusId 强制隔离：写操作的 campusId 由调用方（路由，取自 profile）传入，repo 不信任请求体。
 *  - 多语句操作用事务（drizzle: db.transaction；rest: 无事务，best-effort + 幂等设计补偿）。
 *  - 返回领域对象（camelCase，见 @class-duty/shared）；JSON 列已反序列化为数组。
 */
import type {
  Campus, Grade, Class, DutyGroup, Tag, Template, RecordWithDetails,
  Appeal, AppealWithDetails, DailySummary, Award, UserView, UserProfile, User,
  ClassRanking, TrendPoint, DashboardStats, RecordStatus, UserRole, Pagination,
} from '@class-duty/shared';

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
  /** 记录创建时取校区/年级归属 */
  findOwnership(id: string): Promise<{ campusId: string; gradeId: string } | null>;
  create(input: { campusId: string; gradeId: string; name: string; classTeacher?: string | null }): Promise<Class>;
  update(id: string, input: { name: string; classTeacher?: string | null }): Promise<Class | null>;
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
  /** 事务：insert record + record_log；images 为 storage objectKey 数组 */
  create(input: {
    campusId: string; classId: string; recorderId: string; tagId?: string | null;
    score?: number | null; comment?: string | null; images?: string[] | null;
    week: string; recordedAt: number;
  }): Promise<RecordWithDetails>;
  /** 软删（revoke）：事务 update status + log */
  revoke(id: string, operatorId: string, reason: string): Promise<void>;
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
  /** 事务：update appeal(approved) + record(appeal_approved) + log */
  approve(recordId: string, reviewerId: string, reviewComment: string | null): Promise<void>;
  /** 事务：update appeal(rejected) + record(回滚 active) + log */
  reject(recordId: string, reviewerId: string, reviewComment: string | null): Promise<void>;
}

// ── 每日小结 ────────────────────────────────────────────────────────
export interface SummaryRepo {
  listByCampus(campusId: string, week?: string): Promise<DailySummary[]>;
  create(input: { campusId: string; week: string; date: string; content: string; notifiedTeachers?: string[] | null }): Promise<DailySummary>;
}

// ── 统计 ────────────────────────────────────────────────────────────
export interface StatisticsRepo {
  /** 班级排名：有效口径 active+appealing+appeal_approved（修复 appeal_approved 不计分 bug） */
  ranking(campusId: string, week?: string, gradeId?: string): Promise<ClassRanking[]>;
  trend(classId: string, weeks: string[]): Promise<TrendPoint[]>;
  /** dayStart/dayEnd 为当日 epoch 毫秒区间 [start,end)（路由按本地时区算，修复 UTC 边界 bug） */
  dashboard(campusId: string, dayStart: number, dayEnd: number, week: string): Promise<DashboardStats>;
}

// ── 流动红旗 ────────────────────────────────────────────────────────
export interface AwardsRepo {
  listByCampus(campusId: string, week?: string): Promise<Award[]>;
  /** 自动评选：每年级第一名，幂等（UNIQUE 约束 + onConflict 跳过），事务批量 */
  autoAward(campusId: string, week: string, gradeId?: string | null): Promise<Award[]>;
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
