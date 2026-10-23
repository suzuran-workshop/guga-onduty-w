/**
 * ensure-env —— 冷启动配置自愈，彻底消除「缺少必需的环境变量 SESSION_SECRET」。
 *
 * 为什么需要（实测根因链）：
 *  1. `applyEnvFile()`（config.ts 顶层）读的是 **homura.config.env**，不是 `.env`
 *     （@homurajs/core 的 `CONFIG_FILE_NAME` 常量），文件缺失时静默 no-op。
 *  2. 真正读 `.env` 的是 `defineConfig().load()` 内部的 **`process.loadEnvFile()`**
 *     （Node 内置，以 **cwd** 为基准，文件不存在的异常被 try/catch 吞掉）。
 *  3. `sessionSecret` 是 defineConfig 里唯一的 `required: true` 项 → 缺失即 fail-fast 抛错。
 *  4. **第二颗地雷**：`@homurajs/auth` 的 SessionManager 强制 secret **>= 32 字节**，
 *     而 `.env.example` 里是 `SESSION_SECRET=<redacted>`（10 字节）——
 *     照 AGENTS.md 冷启动指引直接 `cp .env.example .env` 只会换一个错误继续失败。
 *
 * 为什么挂在 `loadConfig()` 而不只挂 package.json 钩子：
 *  钩子（predev/prestart/preseed）只在 `pnpm dev|start|seed` 时触发，而
 *  `node dist/index.js`、直接 `tsx src/index.ts`、测试台架调 `bootstrap()` 都会绕过它。
 *  由 `loadConfig()` 调用才能覆盖**所有入口**，这才叫「永远解决」。
 *
 * 设计取舍：
 *  - **真实 env 优先**：`process.loadEnvFile()` 不覆盖已存在的 env（实测 Node 26），
 *    故 `process.env.SESSION_SECRET` 已可用时**完全不触碰 .env** ——
 *    测试台架（tests/helpers/harness.ts 直接注入 process.env）因此零文件系统副作用。
 *  - **生成的 secret 必须落盘**，不能只在内存里生成。否则每次重启 secret 都变，
 *    所有已签发的 session/refresh token 立即失效 —— 那是比 fail-fast 更难查的静默降级。
 *  - **只改 SESSION_SECRET 一行，绝不重写整个文件**：用户可能已改过 PORT/DB_PATH 等，
 *    覆盖会丢配置。故「就地替换该行」而非「从模板重新生成」。
 *  - 路径基于 `import.meta.url` 解析到 apps/server，**不依赖 cwd**（`process.loadEnvFile()`
 *    以 cwd 为基准，而 `pnpm --filter` 与直接 `tsx` 的 cwd 不同）。
 *    src/ 与编译后 dist/ 都在 apps/server 下一层，故两层 dirname 对两种形态都成立。
 *
 * 运行：由 loadConfig() 自动调用；也可 `tsx src/ensure-env.ts` 单独执行。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** apps/server 根目录（本文件在 src/ 下；编译后在 dist/ 下，层级相同）。
 *  fileURLToPath 已处理 Windows 盘符前缀，无需再做 pathname 的 `/C:` 剥离。 */
const SERVER_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(SERVER_ROOT, '.env');
const EXAMPLE_PATH = join(SERVER_ROOT, '.env.example');

/** @homurajs/auth SessionManager 的硬约束：HS256 强度要求 >= 32 字节 */
const MIN_SECRET_BYTES = 32;

/** `.env.example` 里 secret 项的占位值（core 的 help() 对 secret:true 输出此串） */
const PLACEHOLDER = '<redacted>';

const SECRET_KEY = 'SESSION_SECRET';

/** 生成 >= 32 字节的 secret。base64url 无换行/引号，可安全裸写进 .env */
function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * 判定 secret 是否可用。三种不可用情形：
 *  - 缺失（键不存在 / undefined）
 *  - 占位值 `<redacted>`（直接 cp .env.example 的结果）
 *  - 长度不足 32 字节（会在 SessionManager 构造时抛错）
 */
function isUsableSecret(value: string | undefined): value is string {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === PLACEHOLDER) return false;
  return Buffer.byteLength(trimmed, 'utf8') >= MIN_SECRET_BYTES;
}

/** 读取 .env 中某个键的当前值；键不存在返回 undefined（与「值为空串」区分） */
function readKey(content: string, key: string): string | undefined {
  const m = new RegExp(`^${key}=([^\\r\\n]*)`, 'm').exec(content);
  return m ? (m[1] ?? '') : undefined;
}

/** 就地替换某个键的值；键不存在则追加到文件末尾 */
function upsertKey(content: string, key: string, value: string, eol: string): string {
  const re = new RegExp(`^${key}=[^\\r\\n]*`, 'm');
  if (re.test(content)) return content.replace(re, `${key}=${value}`);
  // 追加：确保前面有换行分隔，避免拼到上一行末尾
  const sep = content.length === 0 || content.endsWith('\n') ? '' : eol;
  return `${content}${sep}${key}=${value}${eol}`;
}

/** 探测文件换行风格，写回时保持一致（Windows 仓库常见 CRLF） */
function detectEol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

export interface EnsureEnvResult {
  /** .env 原先是否不存在（本次新建） */
  created: boolean;
  /** 是否生成并写入了新 secret */
  secretGenerated: boolean;
  /** 生效的 secret 来自真实 env 还是 .env 文件 */
  source: 'env' | 'file';
  /** .env 绝对路径 */
  path: string;
}

/**
 * 可注入项。缺省用模块级路径与 process.env —— 生产走这条。
 * 测试注入临时路径与独立 env 对象，避免触碰真实 apps/server/.env（零副作用）。
 */
export interface EnsureEnvOptions {
  /** .env 路径（缺省 apps/server/.env） */
  envPath?: string;
  /** 模板路径（缺省 apps/server/.env.example） */
  examplePath?: string;
  /** 环境变量对象（缺省 process.env）。会就地写入生效的 secret */
  env?: Record<string, string | undefined>;
}

/**
 * 确保 SESSION_SECRET 可用：优先认真实 env，否则确保 .env 里有可用值。
 * 幂等——已可用时不做任何写入。
 */
export function ensureEnv(opts: EnsureEnvOptions = {}): EnsureEnvResult {
  const envPath = opts.envPath ?? ENV_PATH;
  const examplePath = opts.examplePath ?? EXAMPLE_PATH;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);

  // 真实 env 优先：loadEnvFile 不覆盖已存在的 env，故 env 可用时无需触碰 .env。
  if (isUsableSecret(env[SECRET_KEY])) {
    return { created: false, secretGenerated: false, source: 'env', path: envPath };
  }

  const existed = existsSync(envPath);
  // 内容来源：已有 .env（保留用户改动）> .env.example（保留全部键与中文注释）> 空
  const content = existed
    ? readFileSync(envPath, 'utf8')
    : existsSync(examplePath)
      ? readFileSync(examplePath, 'utf8')
      : '';

  const eol = detectEol(content);
  const current = readKey(content, SECRET_KEY);

  if (isUsableSecret(current)) {
    // .env 里已有可用值但 env 没有 → 说明 loadEnvFile 还没跑（本函数先于 load()）。
    // 主动灌进 env，使随后 config.load() 能读到；文件不动（幂等）。
    env[SECRET_KEY] = current.trim();
    return { created: false, secretGenerated: false, source: 'file', path: envPath };
  }

  const secret = generateSecret();
  writeFileSync(envPath, upsertKey(content, SECRET_KEY, secret, eol), 'utf8');
  env[SECRET_KEY] = secret;

  return { created: !existed, secretGenerated: true, source: 'file', path: envPath };
}

/** 人类可读摘要。**刻意不打印 secret 值**（core 的 logger 会遮蔽含 secret 的键，但不依赖它） */
function report(r: EnsureEnvResult): void {
  if (!r.secretGenerated) {
    const where = r.source === 'env' ? '真实环境变量' : r.path;
    console.log(`✓ SESSION_SECRET 就绪（来源：${where}）`);
    return;
  }
  const parts = [r.created ? '已从 .env.example 创建' : '已就地修复'];
  parts.push(`生成 ${SECRET_KEY}（>= ${MIN_SECRET_BYTES} 字节，随机且已落盘）`);
  console.log(`✓ .env ${parts.join('，')}：${r.path}`);
  console.log('  提示：该密钥已写入 .env（已被 .gitignore 忽略）。生产部署请改用受控注入，勿提交此文件。');
}

// 直接运行守卫（与 src/db/seed.ts 同款 ESM idiom，避免 import 即执行）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    report(ensureEnv());
  } catch (e) {
    console.error('ensure-env 失败:', e);
    process.exit(1);
  }
}
