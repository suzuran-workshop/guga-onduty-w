/**
 * 启动期错误的人性化报告 —— 把「一坨堆栈」换成「该怎么办」。
 *
 * 纵深防御：SESSION_SECRET 已由 ensureEnv() 自愈（见 config.ts），正常情况下不会再撞。
 * 但万一将来新增 required 配置又漏了自愈，用户看到的应是可操作指引而非堆栈。
 * index.ts 与 db/seed.ts 共用此函数，保证两条冷启动入口的错误体验一致。
 */

/** 判定是否为 @homurajs/core defineConfig 的配置缺失错误 */
function isConfigError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('缺少必需的环境变量');
}

/**
 * 报告启动/种子失败并按类型退出。
 * 配置类错误 → 打印修复指引（指向 ensure-env / .env.example），不 dump 堆栈；
 * 其余 → 保留完整堆栈（真实 bug 需要它定位）。
 */
export function reportFatal(context: string, err: unknown): never {
  if (isConfigError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n${context}失败：${msg}\n`);
    console.error('修复方式（任选其一）：');
    console.error('  1) 运行 pnpm --filter @guga-onduty-w/server ensure-env 自动生成 .env（推荐）');
    console.error('  2) cp apps/server/.env.example apps/server/.env，再把 SESSION_SECRET 改成 >=32 字节的随机串');
    console.error('     注意：模板里的 <redacted> 只有 10 字节，直接用会撞 @homurajs/auth 的 >=32 字节约束。\n');
    process.exit(1);
  }
  console.error(`${context}失败:`, err);
  process.exit(1);
}
