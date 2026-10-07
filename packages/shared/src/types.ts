// ============================================================
// 校园值周应用 - 共享类型定义
// ============================================================

// --- 角色 ---
export type UserRole = 'admin' | 'teacher' | 'student';

// --- 记录状态 ---
export type RecordStatus = 'active' | 'revoked' | 'appealing' | 'appeal_approved';

// --- 申诉状态 ---
export type AppealStatus = 'pending' | 'approved' | 'rejected';

// --- 标签分类 ---
export type TagCategory = 'positive' | 'negative' | 'neutral';

// --- 记录操作 ---
export type RecordAction = 'revoke' | 'appeal' | 'appeal_approve' | 'appeal_reject';

// --- 校区 ---
export interface Campus {
  id: number;
  name: string;
  code: string;
  created_at: string;
}

// --- 年级 ---
export interface Grade {
  id: number;
  campus_id: number;
  name: string;
  sort_order: number;
}

// --- 班级 ---
export interface Class {
  id: number;
  grade_id: number;
  campus_id: number;
  name: string;
  class_teacher: string | null;
  grade_name?: string;
}

// --- 用户 ---
export interface User {
  id: number;
  campus_id: number;
  username: string;
  display_name: string;
  role: UserRole;
  group_id: number | null;
  created_at: string;
}

export interface UserWithPassword extends User {
  password_hash: string;
}

// --- 值周小组 ---
export interface DutyGroup {
  id: number;
  campus_id: number;
  name: string;
  members: string; // JSON array of user IDs
  created_at: string;
}

// --- 评价标签 ---
export interface Tag {
  id: number;
  campus_id: number;
  name: string;
  score: number;
  color: string;
  category: TagCategory;
  is_system: boolean;
  created_at: string;
}

// --- 标签模板 ---
export interface Template {
  id: number;
  campus_id: number;
  name: string;
  tag_ids: string; // JSON array of tag IDs
  created_at: string;
}

// --- 值周记录 ---
export interface Record {
  id: number;
  campus_id: number;
  class_id: number;
  recorder_id: number;
  tag_id: number | null;
  score: number | null;
  comment: string | null;
  images: string | null; // JSON array of file paths
  week: string;
  recorded_at: string;
  status: RecordStatus;
}

export interface RecordWithDetails extends Record {
  class_name: string;
  grade_name: string;
  recorder_name: string;
  tag_name: string | null;
  tag_color: string | null;
}

// --- 申诉 ---
export interface Appeal {
  id: number;
  record_id: number;
  teacher_id: number;
  reason: string;
  status: AppealStatus;
  reviewer_id: number | null;
  review_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface AppealWithDetails extends Appeal {
  teacher_name: string;
  reviewer_name: string | null;
  record_info: {
    class_name: string;
    tag_name: string;
    score: number;
    comment: string | null;
    week: string;
    recorded_at: string;
  };
}

// --- 操作日志 ---
export interface RecordLog {
  id: number;
  record_id: number;
  action: RecordAction;
  operator_id: number;
  reason: string | null;
  created_at: string;
}

// --- 每日小结 ---
export interface DailySummary {
  id: number;
  campus_id: number;
  week: string;
  date: string;
  content: string;
  notified_teachers: string | null;
  created_at: string;
}

// --- 流动红旗 ---
export interface Award {
  id: number;
  campus_id: number;
  class_id: number;
  week: string;
  category: string;
  note: string | null;
  awarded_at: string;
  class_name?: string;
  grade_name?: string;
}

// --- 系统设置 ---
export interface Setting {
  id: number;
  campus_id: number;
  key: string;
  value: string;
}

// --- 统计数据 ---
export interface ClassRanking {
  rank: number;
  class_id: number;
  class_name: string;
  grade_id: number;
  grade_name: string;
  total_score: number;
  positive_count: number;
  negative_count: number;
  record_count: number;
}

export interface TrendPoint {
  week: string;
  total_score: number;
}

export interface DashboardStats {
  today_records: number;
  today_positive: number;
  today_negative: number;
  week_top_class: string | null;
  week_top_score: number | null;
}

// --- API 响应 ---
export interface ApiResponse<T> {
  success: true;
  data: T;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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

// --- JWT Payload ---
export interface JwtPayload {
  sub: number;
  username: string;
  display_name: string;
  role: UserRole;
  campus_id: number;
  iat?: number;
  exp?: number;
}

// --- 请求体类型 ---
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface CreateRecordRequest {
  class_id: number;
  tag_id: number;
  score: number;
  comment?: string;
}

export interface CreateAppealRequest {
  record_id: number;
  reason: string;
}

export interface AppealReviewRequest {
  review_comment?: string;
}

export interface CreateSummaryRequest {
  campus_id: number;
  week: string;
  date: string;
  content: string;
  notified_teachers?: number[];
}

export interface AwardRequest {
  campus_id: number;
  week: string;
  grade_id?: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}