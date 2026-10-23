/**
 * repo 装配入口 —— drizzle 双方言（sqlite/pg，docs §2.1）。
 *
 * 按方言注入匹配的 tables + authTables；路由层只依赖 Repos 接口（repos/types.ts），不感知方言。
 * 历史：曾有 rest 轨（PostgREST / qw-pages），已于 2026-10-23 移除（见 DECISIONS.md ADR-7）。
 */
import { pgAuthTables, sqliteAuthTables } from '@homurajs/auth/tables';
import * as pgTables from '../schema/pg.js';
import * as sqliteTables from '../schema/sqlite.js';
import type { DbHandle, Tables } from '../db/client.js';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { Repos } from './types.js';
import { createDrizzleRepos } from './drizzle/index.js';

export interface CreateReposOptions {
  /** users-repo 需要的 auth 依赖（PasswordProvider + UserStore） */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export function createRepos(handle: DbHandle, opts: CreateReposOptions): Repos {
  // 按方言注入表对象（sqlite 用 sqliteTables/sqliteAuthTables，pg 用 pg*）
  const tables: Tables =
    handle.dialect === 'pg' ? (pgTables as unknown as Tables) : (sqliteTables as Tables);
  const authTables =
    handle.dialect === 'pg'
      ? (pgAuthTables as unknown as typeof sqliteAuthTables)
      : sqliteAuthTables;

  return createDrizzleRepos({
    db: handle.db,
    tables,
    authTables,
    tx: handle.tx,
    passwordProvider: opts.passwordProvider,
    userStore: opts.userStore,
  });
}
