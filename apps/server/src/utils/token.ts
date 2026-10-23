/**
 * 令牌工具 —— 申诉免登录链接的哈希（2026-10-23，需求 4）。
 *
 * 令牌**只存 SHA-256 哈希**：明文仅在创建时返回一次（拼进钉钉消息的链接），
 * 数据库泄漏也无法反推可用链接。路由侧收到明文 token 后哈希再查，两端共用此函数。
 */
import { createHash } from 'node:crypto';

/** SHA-256 hex（64 字符） */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
