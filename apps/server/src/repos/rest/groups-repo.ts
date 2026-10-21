/**
 * groups repo（rest 实现）—— 成员双写（dutyGroups.members + userProfiles.groupId）。
 * 语义对齐 drizzle/groups-repo：无事务 → 顺序执行 + best-effort（幂等设计补偿）；
 * members 是 JSON 数组列（PostgREST 返回已解析数组，jsonArr 兜底）。
 */
import type { DutyGroup } from '@guga-onduty-w/shared';
import type { GroupsRepo } from '../types.js';
import { type RestCtx, tbl, jsonArr, num, uuid } from './_base.js';

function toGroup(r: any): DutyGroup {
  return {
    id: r.id,
    campusId: r.campusId,
    name: r.name,
    members: jsonArr(r.members),
    createdAt: num(r.createdAt),
  };
}

export function createGroupsRepo(ctx: RestCtx): GroupsRepo {
  const dutyGroups = tbl<any>(ctx.rest, 'dutyGroups');
  const userProfiles = tbl<any>(ctx.rest, 'userProfiles');

  return {
    async listByCampus(campusId): Promise<DutyGroup[]> {
      const rows = await dutyGroups.select({ campusId }, { order: 'name.asc' });
      return rows.map(toGroup);
    },

    async create(input): Promise<DutyGroup> {
      const id = uuid();
      const members = input.members ?? [];
      await dutyGroups.insert({
        id, campusId: input.campusId, name: input.name,
        members: members.length > 0 ? members : null,
      });
      // 回填成员 groupId（批量 in 过滤）
      if (members.length > 0) {
        await userProfiles.update({ groupId: id }, { userId: members });
      }
      const rows = await dutyGroups.select({ id }, { limit: 1 });
      return toGroup(rows[0]);
    },

    async update(id, input): Promise<DutyGroup | null> {
      const members = input.members ?? [];
      // 1. 清旧成员 groupId（仅限仍属于本组的）
      await userProfiles.update({ groupId: null }, { groupId: id });
      // 2. 更新组本身
      await dutyGroups.update({ name: input.name, members: members.length > 0 ? members : null }, { id });
      // 3. 设新成员 groupId
      if (members.length > 0) {
        await userProfiles.update({ groupId: id }, { userId: members });
      }
      const rows = await dutyGroups.select({ id }, { limit: 1 });
      return rows[0] ? toGroup(rows[0]) : null;
    },

    async remove(id): Promise<void> {
      await userProfiles.update({ groupId: null }, { groupId: id });
      await dutyGroups.remove({ id });
    },
  };
}
