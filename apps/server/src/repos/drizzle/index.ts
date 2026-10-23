/**
 * drizzle repo 装配 —— sqlite/pg 双方言共用这一份装配。
 *
 * ctx 由调用方（repos/index.ts）按方言注入 db + tables + authTables：
 *  - sqlite：tables = sqliteSchema 业务表，authTables = sqliteAuthTables
 *  - pg：tables = pgSchema 业务表，authTables = pgAuthTables
 * parity 门禁保证两套表列名/主键一致，故 13 个 repo 源码对方言无感。
 */
import type { Database } from '@homurajs/db';
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { Tables } from '../../db/client.js';
import type { Repos } from '../types.js';
import type { DrizzleCtx, AuthTables } from './_base.js';

import { createCampusesRepo } from './campuses-repo.js';
import { createGradesRepo } from './grades-repo.js';
import { createClassesRepo } from './classes-repo.js';
import { createGroupsRepo } from './groups-repo.js';
import { createUsersRepo } from './users-repo.js';
import { createTagsRepo } from './tags-repo.js';
import { createTemplatesRepo } from './templates-repo.js';
import { createRecordsRepo } from './records-repo.js';
import { createAppealsRepo } from './appeals-repo.js';
import { createSummaryRepo } from './summary-repo.js';
import { createStatisticsRepo } from './statistics-repo.js';
import { createAwardsRepo } from './awards-repo.js';
import { createSettingsRepo } from './settings-repo.js';
import {
  createDingtalkContactsRepo,
  createNotificationsRepo,
  createAppealTokensRepo,
} from './dingtalk-repo.js';

export interface CreateDrizzleReposOptions {
  db: Database;
  tables: Tables;
  authTables: AuthTables;
  tx<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  /** users-repo 需要的 auth 依赖（PasswordProvider + UserStore） */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export function createDrizzleRepos(opts: CreateDrizzleReposOptions): Repos {
  const ctx: DrizzleCtx = {
    db: opts.db,
    tables: opts.tables,
    authTables: opts.authTables,
    tx: opts.tx,
  };

  return {
    campuses: createCampusesRepo(ctx),
    grades: createGradesRepo(ctx),
    classes: createClassesRepo(ctx),
    groups: createGroupsRepo(ctx),
    users: createUsersRepo(ctx, { passwordProvider: opts.passwordProvider, userStore: opts.userStore }),
    tags: createTagsRepo(ctx),
    templates: createTemplatesRepo(ctx),
    records: createRecordsRepo(ctx),
    appeals: createAppealsRepo(ctx),
    summary: createSummaryRepo(ctx),
    statistics: createStatisticsRepo(ctx),
    awards: createAwardsRepo(ctx),
    settings: createSettingsRepo(ctx),
    dingtalkContacts: createDingtalkContactsRepo(ctx),
    notifications: createNotificationsRepo(ctx),
    appealTokens: createAppealTokensRepo(ctx),
  };
}
