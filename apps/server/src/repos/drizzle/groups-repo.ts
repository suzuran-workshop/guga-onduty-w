/**
 * groups repo（drizzle 实现）—— 成员双写事务化。
 *
 * 迁移要点（对照旧 routes/groups.ts）：
 *  - dutyGroups.members（JSON 数组）与 userProfiles.groupId 是冗余双写。
 *    旧代码 POST/PUT/DELETE 的多条 UPDATE 无事务，中途失败即数据不一致 —— 此处全部事务化。
 *  - members 存 userId(uuid) 数组；回填 userProfiles.groupId 用 inArray 批量 update（非循环单条）。
 */
import { eq, and, asc, inArray, sql } from 'drizzle-orm';
import type { DutyGroup } from '@class-duty/shared';
import type { GroupsRepo } from '../types.js';
import { DrizzleCtx, num } from './_base.js';

function toGroup(r: any): DutyGroup {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    members: Array.isArray(r.members) ? r.members : (r.members ? JSON.parse(r.members) : null),
    createdAt: num(r.createdAt),
  };
}

export function createGroupsRepo(ctx: DrizzleCtx): GroupsRepo {
  const { tables: T } = ctx;
  const db = ctx.db as any;
  const { dutyGroups, userProfiles } = T;

  return {
    async listByCampus(campusId): Promise<DutyGroup[]> {
      const rows = await db
        .select()
        .from(dutyGroups)
        .where(eq(dutyGroups.campusId, campusId))
        .orderBy(asc(dutyGroups.name));
      return rows.map(toGroup);
    },

    async create(input): Promise<DutyGroup> {
      const id = crypto.randomUUID();
      const members = input.members ?? [];
      await ctx.tx(async (tx: any) => {
        await tx.insert(dutyGroups).values({
          id, campusId: input.campusId, name: input.name,
          members: members.length > 0 ? members : null,
        }).run();
        // 回填成员 groupId（批量，非循环单条）
        if (members.length > 0) {
          await tx.update(userProfiles).set({ groupId: id }).where(inArray(userProfiles.userId, members)).run();
        }
      });
      const rows = await db.select().from(dutyGroups).where(eq(dutyGroups.id, id)).limit(1);
      return toGroup(rows[0]);
    },

    async update(id, input): Promise<DutyGroup | null> {
      const members = input.members ?? [];
      await ctx.tx(async (tx: any) => {
        // 1. 清旧成员 groupId（仅限仍属于本组的，避免误清已改组的用户）
        await tx.update(userProfiles).set({ groupId: null }).where(eq(userProfiles.groupId, id)).run();
        // 2. 更新组本身
        await tx.update(dutyGroups)
          .set({ name: input.name, members: members.length > 0 ? members : null })
          .where(eq(dutyGroups.id, id)).run();
        // 3. 设新成员 groupId
        if (members.length > 0) {
          await tx.update(userProfiles).set({ groupId: id }).where(inArray(userProfiles.userId, members)).run();
        }
      });
      const rows = await db.select().from(dutyGroups).where(eq(dutyGroups.id, id)).limit(1);
      return rows[0] ? toGroup(rows[0]) : null;
    },

    async remove(id): Promise<void> {
      await ctx.tx(async (tx: any) => {
        await tx.update(userProfiles).set({ groupId: null }).where(eq(userProfiles.groupId, id)).run();
        await tx.delete(dutyGroups).where(eq(dutyGroups.id, id)).run();
      });
    },
  };
}
