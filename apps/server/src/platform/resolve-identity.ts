/**
 * 教师身份解析 —— 「当前登录用户」→「钉钉 userid」（2026-10-23，需求 4）。
 *
 * 背景：classes.teacherDingtalkId 存的是钉钉 userid（推送目标 + 班主任权威关联），
 * 而系统内登录态是 profile.userId（本系统 users.id）。二者经 auth SDK 的
 * oauth2_identity_links 表关联：教师用钉钉 OAuth 登录后，SDK 会写入
 * {userId, provider:'dingtalk', providerSub}。故解析路径是
 *   profile.userId → linkStore.findByUserId → provider==='dingtalk' 的 link.providerSub
 *
 * ⚠ 关键不确定性（未实测，IdP 仓库 ../oauth2-dingtalk 不在本机）：
 * providerSub 是否等于钉钉**企业内 userid**，取决于该 IdP 的 mapUser 实现。
 * 钉钉 OAuth 的 userinfo 通常返回 openId/unionId，未必等于企业 userid
 * （asyncsend_v2 的 userid_list 要的是后者）。homura module-oauth2.md 也记载
 * userinfo 的 email 是 `<openId>@dingtalk.internal` 合成值，暗示 sub 可能是 openId。
 *
 * 因此本函数是 **best-effort**：解析不出就返回 null，调用方必须 fail-closed
 * （不放行），并引导教师改用钉钉推送里的免登录令牌链接——那条路径绑定
 * teacherDingtalkId，不依赖此解析，是本需求的主路径。
 * 待 IdP 联调确认 providerSub 语义后，可据此收紧或放宽。
 */
import type { OAuth2LinkStore } from '@homurajs/auth';

/** 钉钉在 oauth2_identity_links 里的 provider 标识（与 auth/build.ts 装配时一致） */
export const DINGTALK_PROVIDER = 'dingtalk';

/**
 * 解析登录用户的钉钉 userid。返回 null 表示无法解析（未走钉钉登录 / 无 link）。
 */
export async function resolveDingtalkUserId(
  linkStore: OAuth2LinkStore,
  userId: string,
): Promise<string | null> {
  const links = await linkStore.findByUserId(userId);
  const dt = links.find((l) => l.provider === DINGTALK_PROVIDER);
  return dt?.providerSub || null;
}
