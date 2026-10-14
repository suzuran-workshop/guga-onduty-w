/**
 * statistics 路由 —— 排名/趋势/看板/CSV 导出（全 GET，只读）。
 *
 * 迁移要点（对照旧 routes/statistics.ts）：
 *  - 所有读走 resolveCampusId 隔离。
 *  - 周次/日期逻辑收敛到 utils/week.js（修复旧代码 getCurrentWeek 重复实现）。
 *  - trend 的 class_id 必填；weeks 默认 4，用 recentWeeks 生成周列表。
 *  - dashboard 用 todayRange（本地时区当日 epoch 区间，修复旧代码 UTC 边界 bug）。
 *  - **CSV 转义修复**：旧代码只对 comment 转义，其他字段含逗号/引号会破格。
 *    此处所有字段统一转义（含逗号/引号/换行的用双引号包裹，内部 " 转 ""），前置 BOM。
 *  - recordedAt 是 epoch 毫秒 → CSV 格式化为 ISO 字符串。
 */
import { Hono } from 'hono';
import type { RouteDeps } from './_deps.js';
import { resolveCampusId } from '../middleware/profile.js';
import { ok, ApiError } from '../http/respond.js';
import { recentWeeks, todayRange, getCurrentWeek } from '../utils/week.js';

/** CSV 字段转义（修复旧代码只转义 comment 的 bug）：统一引号包裹 + 内部 " 转 "" */
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // 全字段用双引号包裹，内部双引号翻倍 —— 对含逗号/引号/换行的值都安全
  return `"${s.replace(/"/g, '""')}"`;
}

export function createStatisticsRoutes(deps: RouteDeps): Hono {
  const { repos } = deps;
  const app = new Hono();

  // GET /ranking —— 班级排名
  app.get('/ranking', async (c) => {
    const ranking = await repos.statistics.ranking(
      resolveCampusId(c),
      c.req.query('week') || undefined,
      c.req.query('grade_id') || undefined,
    );
    return ok(c, ranking);
  });

  // GET /trend —— 班级趋势（近 N 周）
  app.get('/trend', async (c) => {
    const classId = c.req.query('class_id');
    if (!classId) throw ApiError.badRequest('请指定班级');
    const weeks = Number(c.req.query('weeks') || '4') || 4;
    const weekList = recentWeeks(weeks);
    const trend = await repos.statistics.trend(classId, weekList);
    return ok(c, trend);
  });

  // GET /dashboard —— 看板统计
  app.get('/dashboard', async (c) => {
    const { dayStart, dayEnd } = todayRange();
    const stats = await repos.statistics.dashboard(
      resolveCampusId(c),
      dayStart,
      dayEnd,
      getCurrentWeek(),
    );
    return ok(c, stats);
  });

  // GET /export —— CSV 导出（转义修复）
  app.get('/export', async (c) => {
    const rows = await repos.records.listForExport(
      resolveCampusId(c),
      c.req.query('start_week') || undefined,
      c.req.query('end_week') || undefined,
    );

    const headers = ['ID', '班级', '年级', '标签', '分数', '备注', '周次', '记录时间', '记录人', '状态'];
    const lines = [
      '﻿' + headers.map(csvField).join(','), // BOM + 表头（Excel 中文兼容）
      ...rows.map((r) =>
        [
          r.id,
          r.className,
          r.gradeName,
          r.tagName ?? '',
          r.score ?? '',
          r.comment ?? '',
          r.week,
          new Date(r.recordedAt).toISOString(),
          r.recorderName,
          r.status,
        ]
          .map(csvField)
          .join(','),
      ),
    ];
    const csv = lines.join('\n');

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header(
      'Content-Disposition',
      `attachment; filename="records_${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return c.body(csv);
  });

  return app;
}
