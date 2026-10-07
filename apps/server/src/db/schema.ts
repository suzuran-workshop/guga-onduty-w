import { getDb } from './connection.js';

const DDL = `
CREATE TABLE IF NOT EXISTS campuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(campus_id, name)
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade_id INTEGER NOT NULL REFERENCES grades(id),
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  class_teacher TEXT,
  UNIQUE(campus_id, grade_id, name)
);

CREATE TABLE IF NOT EXISTS duty_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  members TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')),
  group_id INTEGER REFERENCES duty_groups(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#FFAACC',
  category TEXT CHECK(category IN ('positive','negative','neutral')) DEFAULT 'positive',
  is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  tag_ids TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  recorder_id INTEGER NOT NULL REFERENCES users(id),
  tag_id INTEGER REFERENCES tags(id),
  score REAL,
  comment TEXT,
  images TEXT,
  week TEXT NOT NULL,
  recorded_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','revoked','appealing','appeal_approved'))
);

CREATE TABLE IF NOT EXISTS record_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  action TEXT NOT NULL,
  operator_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  week TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  notified_teachers TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES records(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewer_id INTEGER REFERENCES users(id),
  review_comment TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  week TEXT NOT NULL,
  category TEXT DEFAULT 'overall',
  note TEXT,
  awarded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(campus_id, key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_records_campus_week ON records(campus_id, week);
CREATE INDEX IF NOT EXISTS idx_records_class ON records(class_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);
CREATE INDEX IF NOT EXISTS idx_classes_campus ON classes(campus_id);
CREATE INDEX IF NOT EXISTS idx_users_campus ON users(campus_id);
CREATE INDEX IF NOT EXISTS idx_tags_campus ON tags(campus_id);
CREATE INDEX IF NOT EXISTS idx_record_logs_record ON record_logs(record_id);
`;

export function runMigrations(): void {
  const db = getDb();
  db.exec(DDL);
  console.log('Database schema initialized.');
}