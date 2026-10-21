/**
 * summary repo（rest 实现）—— 每日小结，只 list + create。
 * 语义对齐 drizzle/summary-repo：orderBy date desc → createdAt desc；
 * notifiedTeachers JSON 列（jsonArr 兜底）；唯一约束 (campusId,date) 预判。
 */
import type { RestFilters } from '@homurajs/db';
import type { DailySummary } from '@guga-onduty-w/shared';
import type { SummaryRepo } from '../types.js';
import { type RestCtx, tbl, num, jsonArr, uuid, dupError } from './_base.js';

function toSummary(r: any): DailySummary {
  return {
    id: r.id,
    campusId: r.campusId,
    week: r.week,
    date: r.date,
    content: r.content,
    notifiedTeachers: jsonArr(r.notifiedTeachers),
    createdAt: num(r.createdAt),
  };
}

export function createSummaryRepo(ctx: RestCtx): SummaryRepo {
  const dailySummaries = tbl<any>(ctx.rest, 'dailySummaries');

  return {
    async listByCampus(campusId, week?): Promise<DailySummary[]> {
      const filters: RestFilters = { campusId };
      if (week) filters.week = week;
      const rows = await dailySummaries.select(filters, { order: 'date.desc,createdAt.desc' });
      return rows.map(toSummary);
    },

    async create(input): Promise<DailySummary> {
      // 唯一预判：(campusId,date)（drizzle 轨走 DB UNIQUE）
      const dup = await dailySummaries.select({ campusId: input.campusId, date: input.date }, { limit: 1 });
      if (dup[0]) throw dupError('dailySummaries', 'campusId, date');
      const id = uuid();
      await dailySummaries.insert({
        id,
        campusId: input.campusId,
        week: input.week,
        date: input.date,
        content: input.content,
        notifiedTeachers: input.notifiedTeachers ?? null,
      });
      const rows = await dailySummaries.select({ id }, { limit: 1 });
      if (!rows[0]) throw new Error('小结创建后回查失败');
      return toSummary(rows[0]);
    },
  };
}
