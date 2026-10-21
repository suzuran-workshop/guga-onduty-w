/**
 * appeals repo（rest 实现）—— 申诉状态机。
 * 语义对齐 drizzle/appeals-repo：
 *  - create：update records.status→appealing（仅 active）+ insert appeal + log。
 *  - approve：update appeal(approved,仅 pending) + record(appeal_approved) + log。
 *  - reject：update appeal(rejected,仅 pending) + record(回滚 active,仅 appealing，REVIEW #4)
 *    + log（仅在申诉确被处理时）。
 *  - list：campusId 过滤走 records.campusId（appeals 无该列）→ 先查该校区 recordId 集合再 in 过滤；
 *    teacher/reviewer 姓名来自 userProfiles.displayName。
 */
import type { RestFilters } from '@homurajs/db';
import type { Appeal, AppealWithDetails, AppealRecordInfo } from '@guga-onduty-w/shared';
import type { AppealsRepo, Paged } from '../types.js';
import { type RestCtx, tbl, indexByIds, paginateRows, num, uuid } from './_base.js';

export function createAppealsRepo(ctx: RestCtx): AppealsRepo {
  const appeals = tbl<any>(ctx.rest, 'appeals');
  const records = tbl<any>(ctx.rest, 'records');
  const recordLogs = tbl<any>(ctx.rest, 'recordLogs');
  const classes = tbl<any>(ctx.rest, 'classes');
  const tags = tbl<any>(ctx.rest, 'tags');
  const userProfiles = tbl<any>(ctx.rest, 'userProfiles');

  /** appeal 行 → AppealWithDetails（批查 userProfiles/records/classes/tags） */
  async function decorate(rows: any[]): Promise<AppealWithDetails[]> {
    const pmap = await indexByIds(userProfiles, 'userId', rows.flatMap((r) => [r.teacherId, r.reviewerId]));
    const rmap = await indexByIds(records, 'id', rows.map((r) => r.recordId));
    const recs = Array.from(rmap.values());
    const cmap = await indexByIds(classes, 'id', recs.map((r) => r.classId));
    const tmap = await indexByIds(tags, 'id', recs.map((r) => r.tagId));
    return rows.map((r) => {
      const rec = rmap.get(r.recordId);
      const recordInfo: AppealRecordInfo | null = rec
        ? {
            score: rec.score === null || rec.score === undefined ? null : num(rec.score),
            comment: rec.comment ?? null,
            week: rec.week,
            recordedAt: num(rec.recordedAt),
            recordStatus: rec.status,
            className: cmap.get(rec.classId)?.name ?? '',
            tagName: tmap.get(rec.tagId ?? '')?.name ?? null,
          }
        : null;
      return {
        id: r.id,
        recordId: r.recordId,
        teacherId: r.teacherId,
        reason: r.reason,
        status: r.status,
        reviewerId: r.reviewerId ?? null,
        reviewComment: r.reviewComment ?? null,
        createdAt: num(r.createdAt),
        reviewedAt: r.reviewedAt === null || r.reviewedAt === undefined ? null : num(r.reviewedAt),
        teacherName: pmap.get(r.teacherId)?.displayName ?? '',
        reviewerName: pmap.get(r.reviewerId ?? '')?.displayName ?? null,
        recordInfo,
        campusId: rec?.campusId ?? null,
      };
    });
  }

  return {
    async list(filter): Promise<Paged<AppealWithDetails>> {
      const { campusId, teacherId, status, page, pageSize } = filter;
      const filters: RestFilters = {};
      if (teacherId) filters.teacherId = teacherId;
      if (status) filters.status = status;
      // campusId 过滤：appeals 表无 campusId 列 → 先取该校区 recordId 集合（drizzle join records 语义）
      if (campusId) {
        const recs = await records.select({ campusId });
        const ids = recs.map((r) => String(r.id));
        if (ids.length === 0) {
          return { data: [], pagination: { page, pageSize, total: 0, totalPages: 1 } };
        }
        filters.recordId = ids;
      }
      const rows = await appeals.select(
        Object.keys(filters).length > 0 ? filters : undefined,
        { order: 'createdAt.desc' },
      );
      const { data, pagination } = paginateRows(rows, page, pageSize);
      return { data: await decorate(data), pagination };
    },

    async findById(id): Promise<AppealWithDetails | null> {
      const rows = await appeals.select({ id }, { limit: 1 });
      if (!rows[0]) return null;
      const [detail] = await decorate(rows);
      return detail;
    },

    async create(input): Promise<Appeal> {
      const id = uuid();
      // 仅 active 记录可申诉（复刻 drizzle WHERE status='active' 语义）
      await records.update({ status: 'appealing' }, { id: input.recordId, status: 'active' });
      await appeals.insert({
        id, recordId: input.recordId, teacherId: input.teacherId,
        reason: input.reason, status: 'pending', reviewerId: null,
        reviewComment: null, reviewedAt: null,
      });
      await recordLogs.insert({
        id: uuid(), recordId: input.recordId,
        action: 'appeal', operatorId: input.teacherId, reason: input.reason,
      });
      const rows = await appeals.select({ id }, { limit: 1 });
      const r = rows[0];
      return {
        id: r.id, recordId: r.recordId, teacherId: r.teacherId, reason: r.reason,
        status: r.status, reviewerId: r.reviewerId ?? null, reviewComment: r.reviewComment ?? null,
        createdAt: num(r.createdAt), reviewedAt: r.reviewedAt === null || r.reviewedAt === undefined ? null : num(r.reviewedAt),
      };
    },

    async approve(recordId, reviewerId, reviewComment): Promise<void> {
      await appeals.update(
        { status: 'approved', reviewerId, reviewComment, reviewedAt: Date.now() },
        { recordId, status: 'pending' },
      );
      await records.update({ status: 'appeal_approved' }, { id: recordId });
      await recordLogs.insert({
        id: uuid(), recordId, action: 'appeal_approve',
        operatorId: reviewerId, reason: reviewComment ?? '申诉审批通过',
      });
    },

    async reject(recordId, reviewerId, reviewComment): Promise<void> {
      // 仅当申诉仍 pending 才处理（防重复审批）
      const appealRes = await appeals.update(
        { status: 'rejected', reviewerId, reviewComment, reviewedAt: Date.now() },
        { recordId, status: 'pending' },
      );
      // REVIEW #4：record 回滚 active 必须带状态前置——仅 appealing 才回滚；
      // revoked/appeal_approved 为终态，驳回不能把已撤回记录「复活」重新计分。
      await records.update({ status: 'active' }, { id: recordId, status: 'appealing' });
      if (appealRes.length > 0) {
        await recordLogs.insert({
          id: uuid(), recordId, action: 'appeal_reject',
          operatorId: reviewerId, reason: reviewComment ?? '申诉被驳回',
        });
      }
    },
  };
}
