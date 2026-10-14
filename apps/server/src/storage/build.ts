/**
 * 对象存储装配 —— @homurajs/storage local-fs 后端 + /files 代理路由。
 *
 * 迁移要点（docs §2.6）：
 *  - 旧代码 writeFileSync 落盘 + 无读取端点（图片死数据）→ storage.uploadFile + /files/<key> 代理。
 *  - records.images 存 objectKey（不再存自造相对路径）。
 *
 * 形态边界：
 *  - standalone（sqlite/pg）：local-fs 后端（rootDir 可写）。
 *  - qw-pages：local 后端不可用（应用根只读），正解是 db 后端 —— 但 @homurajs/storage@26.10.15
 *    发布缺失 ./db、./tables 子路径文件（发包 bug，见 MIGRATION §2.6 注），故 rest 轨 storage 待该包修复。
 *    本次 rest 轨 repo 也未实现（P4），storage 在 rest 轨暂不可用，buildStorage 会 warn。
 */
import type { FileStorage } from '@homurajs/storage';
import { createLocalStorage } from '@homurajs/storage/local';
import { createFileProxyRoutes } from '@homurajs/storage/proxy';
import type { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { DbHandle } from '../db/client.js';

/** 构造存储后端（当前仅 local-fs；rest 轨待 storage 包修复后接 db 后端） */
export function buildStorage(cfg: AppConfig, handle: DbHandle, logger?: { warn: (m: string, f?: any) => void }): FileStorage {
  if (handle.kind === 'rest') {
    logger?.warn('storage: rest 轨（qw-pages）暂用 local 后端兜底，正式需 db 后端（@homurajs/storage 发包缺失 ./db，见 MIGRATION §2.6）');
  }
  return createLocalStorage({ rootDir: cfg.get('storageRoot') });
}

/** /files/<key> 代理下载路由（统一入口，presign 弱后端自动降级到它） */
export function buildFileRoutes(storage: FileStorage): Hono {
  return createFileProxyRoutes(storage);
}
