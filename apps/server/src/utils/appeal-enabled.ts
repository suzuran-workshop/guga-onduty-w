/**
 * 申诉开关判定（settings.appeal_enabled）—— 两个申诉入口共用的唯一裁决点。
 *
 * 为什么要有这个文件：`appeal_enabled` 曾是**死开关**（只有 seed/白名单/前端 Switch 三处，
 * 零消费方）——管理员关掉它，申诉照样能提交，是个撒谎的 UI。2026-10-27 起真正接上：
 * 系统内申诉（routes/records.ts）与免登录令牌申诉（routes/appeal-token.ts）都过这里。
 *
 * ⚠ 判定语义：**只有显式 `'false'` 才禁用**，键缺失/为空一律放行。
 * 理由：settings 是按校区存的 key-value，新校区从未写入过该键时 map 里没有它；
 * 若把「缺失」当禁用，新校区会全员无法申诉，且管理员在设置页看到开关是「关」
 * 却怎么点都不生效（因为 PUT 白名单校验通过后写入的才是权威值）——
 * 「缺失=允许」才是对未知状态安全的那一侧（申诉是教师的救济渠道，默认不该堵死）。
 */
import type { Repos } from '../repos/types.js';

/** 申诉开关的 settings 键名（与 routes/settings.ts 白名单、seed.ts 同一字面量） */
export const APPEAL_ENABLED_KEY = 'appeal_enabled';

/**
 * 该校区是否允许申诉。
 * 返回 true 表示允许（键缺失或非 'false' 的任何值）；仅当显式写入 'false' 时返回 false。
 */
export async function isAppealEnabled(repos: Repos, campusId: string): Promise<boolean> {
  const map = await repos.settings.getMap(campusId);
  return map[APPEAL_ENABLED_KEY] !== 'false';
}
