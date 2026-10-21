/**
 * settings repo（rest 实现）—— key-value，getMap + upsertMany。
 * 语义对齐 drizzle/settings-repo：
 *  - getMap：查该校区所有行，JS reduce 成 Record<string,string>。
 *  - upsertMany：组合唯一键 (campusId,key)，PostgREST upsertOn 仅支持单列 →
 *    逐条 select-then-update-or-insert（无事务，逐条自洽）。
 */
import type { SettingsRepo } from '../types.js';
import { type RestCtx, tbl, uuid } from './_base.js';

export function createSettingsRepo(ctx: RestCtx): SettingsRepo {
  const settings = tbl<any>(ctx.rest, 'settings');

  return {
    async getMap(campusId): Promise<Record<string, string>> {
      const rows = await settings.select({ campusId });
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;
      return map;
    },

    async upsertMany(campusId, entries): Promise<void> {
      if (entries.length === 0) return;
      for (const e of entries) {
        const existing = await settings.select({ campusId, key: e.key }, { limit: 1 });
        if (existing[0]) {
          await settings.update({ value: e.value }, { id: existing[0].id });
        } else {
          await settings.insert({ id: uuid(), campusId, key: e.key, value: e.value });
        }
      }
    },
  };
}
