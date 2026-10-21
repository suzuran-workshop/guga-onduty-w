/**
 * rest repo 装配 —— qw-pages（PostgREST）轨。
 *
 * ctx 由调用方（repos/index.ts）注入 rest + auth 依赖：
 *  - rest：@homurajs/db createRestDb（qw-pages 注入 SUPABASE_URL/ANON_KEY）。
 *  - auth stores 由 @homurajs/auth createRest*Store 跑在同一个 rest 上（buildAuth 已装配）。
 *
 * 能力边界（docs §2.1）：无 join/聚合/count/offset/事务 → 应用侧补偿（见 _base.ts）。
 */
import type { PasswordProvider, UserStore } from '@homurajs/auth';
import type { RestDb } from '@homurajs/db';
import type { Repos } from '../types.js';
import type { RestCtx } from './_base.js';

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

export interface CreateRestReposOptions {
  rest: RestDb;
  /** users-repo 需要的 auth 依赖（PasswordProvider + UserStore） */
  passwordProvider: PasswordProvider;
  userStore: UserStore;
}

export function createRestRepos(opts: CreateRestReposOptions): Repos {
  const ctx: RestCtx = { rest: opts.rest };
  const authDeps = { passwordProvider: opts.passwordProvider, userStore: opts.userStore };

  return {
    campuses: createCampusesRepo(ctx),
    grades: createGradesRepo(ctx),
    classes: createClassesRepo(ctx),
    groups: createGroupsRepo(ctx),
    users: createUsersRepo(ctx, authDeps),
    tags: createTagsRepo(ctx),
    templates: createTemplatesRepo(ctx),
    records: createRecordsRepo(ctx),
    appeals: createAppealsRepo(ctx),
    summary: createSummaryRepo(ctx),
    statistics: createStatisticsRepo(ctx),
    awards: createAwardsRepo(ctx),
    settings: createSettingsRepo(ctx),
  };
}
