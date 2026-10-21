/**
 * records repo（rest 实现）—— 核心表。
 * 语义对齐 drizzle/records-repo：
 *  - create：insert record + recordLogs（无事务 → 顺序执行，log 先后不影响最终一致）。
 *  - revoke：只允许 active/appealing → revoked（状态机前置条件在 update filter 上，REVIEW #4/#11）；
 *    仅当确有行被更新时才写 log（幂等）。
 *  - join：records 页 → 批查 classes/grades/tags/userProfiles → JS 拼接；
 *    recorder 缺失兜底 '已删除用户'（leftJoin + COALESCE 语义）。
 *  - 分页：过滤+排序全量后 paginateRows 切页（total = 过滤后长度）。
 */
import type { RestFilters } from '@homurajs/db';
import type { RecordWithDetails, RecordStatus } from '@guga-onduty-w/shared';
import type { RecordsRepo, Paged } from '../types.js';
import { type RestCtx, tbl, indexByIds, paginateRows, num, jsonArr, uuid } from './_base.js';

function toDetails(
  r: any,
  cls?: any, grade?: any, tag?: any, recorder?: any,
): RecordWithDetails {
  return {
    id: r.id,
    campusId: r.campusId,
    classId: r.classId,
    recorderId: r.recorderId,
    tagId: r.tagId ?? null,
    score: r.score === null || r.score === undefined ? null : num(r.score),
    comment: r.comment ?? null,
    images: jsonArr(r.images),
    week: r.week,
    status: r.status as RecordStatus,
    recordedAt: num(r.recordedAt),
    className: cls?.name ?? '',
    gradeName: grade?.name ?? '',
    recorderName: recorder?.displayName ?? '已删除用户',
    tagName: tag?.name ?? null,
    tagColor: tag?.color ?? null,
  };
}

export function createRecordsRepo(ctx: RestCtx): RecordsRepo {
  const records = tbl<any>(ctx.rest, 'records');
  const recordLogs = tbl<any>(ctx.rest, 'recordLogs');
  const classes = tbl<any>(ctx.rest, 'classes');
  const grades = tbl<any>(ctx.rest, 'grades');
  const tags = tbl<any>(ctx.rest, 'tags');
  const userProfiles = tbl<any>(ctx.rest, 'userProfiles');

  /** records 行 → RecordWithDetails（批查四张关联表，各单次 in 查询） */
  async function decorate(rows: any[]): Promise<RecordWithDetails[]> {
    const cmap = await indexByIds(classes, 'id', rows.map((r) => r.classId));
    const gmap = await indexByIds(grades, 'id', Array.from(cmap.values()).map((c) => c.gradeId));
    const tmap = await indexByIds(tags, 'id', rows.map((r) => r.tagId));
    const pmap = await indexByIds(userProfiles, 'userId', rows.map((r) => r.recorderId));
    return rows.map((r) =>
      toDetails(r, cmap.get(r.classId), gmap.get(cmap.get(r.classId)?.gradeId ?? ''), tmap.get(r.tagId ?? ''), pmap.get(r.recorderId)),
    );
  }

  return {
    async list(filter): Promise<Paged<RecordWithDetails>> {
      const { campusId, classId, week, status, page, pageSize } = filter;
      const filters: RestFilters = { campusId };
      if (classId) filters.classId = classId;
      if (week) filters.week = week;
      if (status) filters.status = status;
      const rows = await records.select(filters, { order: 'recordedAt.desc' });
      const { data, pagination } = paginateRows(rows, page, pageSize);
      return { data: await decorate(data), pagination };
    },

    async findByIdWithDetails(id): Promise<RecordWithDetails | null> {
      const rows = await records.select({ id }, { limit: 1 });
      if (!rows[0]) return null;
      const [detail] = await decorate(rows);
      return detail;
    },

    async create(input): Promise<RecordWithDetails> {
      const id = uuid();
      await records.insert({
        id,
        campusId: input.campusId,
        classId: input.classId,
        recorderId: input.recorderId,
        tagId: input.tagId ?? null,
        score: input.score ?? null,
        comment: input.comment ?? null,
        images: input.images && input.images.length > 0 ? input.images : null,
        week: input.week,
        status: 'active',
        recordedAt: input.recordedAt,
      });
      await recordLogs.insert({
        id: uuid(),
        recordId: id,
        action: 'create',
        operatorId: input.recorderId,
        reason: null,
      });
      const detail = await this.findByIdWithDetails(id);
      if (!detail) throw new Error('记录创建后回查失败');
      return detail;
    },

    async revoke(id, operatorId, reason): Promise<void> {
      // REVIEW #4/#11：状态迁移合法性——只允许 active/appealing → revoked（终态不可再撤回）。
      const updated = await records.update({ status: 'revoked' }, { id, status: ['active', 'appealing'] });
      // 仅当确有行被更新时才写 log（幂等：已终态的记录不重复记日志）
      if (updated.length > 0) {
        await recordLogs.insert({
          id: uuid(),
          recordId: id,
          action: 'revoke',
          operatorId,
          reason,
        });
      }
    },

    async listForExport(campusId, startWeek, endWeek): Promise<RecordWithDetails[]> {
      const filters: RestFilters = { campusId };
      if (startWeek) filters.week = { op: 'gte', value: startWeek };
      if (endWeek) filters.week = { op: 'lte', value: endWeek };
      const rows = await records.select(filters, { order: 'recordedAt.desc' });
      return decorate(rows);
    },
  };
}
