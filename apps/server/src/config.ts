/**
 * 配置装载 —— 配置即文档（@homurajs/core defineConfig）。
 *
 * 修复现有缺陷：JWT_SECRET 硬编码 fallback（生产不设 env 即用公开弱密钥）→
 * SESSION_SECRET 设为 required，缺失即 fail fast（启动期抛错，不带病上线）。
 *
 * 再修一处：required 的 fail-fast 虽安全，但冷启动体验极差——照 AGENTS.md 指引
 * `cp .env.example .env` 后仍会失败（模板里 SESSION_SECRET 是 10 字节的 `<redacted>`，
 * 撞 @homurajs/auth 的 >=32 字节硬约束）。故 loadConfig() 先调 ensureEnv() 自愈：
 * 真实 env 优先，否则确保 .env 里有随机生成的 >=32 字节密钥（落盘，重启不失效）。
 * 挂在 loadConfig 而非 package.json 钩子，才能覆盖 `node dist/index.js`、
 * 直接 `tsx src/index.ts`、测试台架 bootstrap() 等**所有入口**。
 *
 * 加载顺序（core README 硬约束）：applyEnvFile(process.env) 必须在 load() 之前，
 * 以便从随产物携带的 homura.config.env 注入密钥（部署期投递通道，真实 env 优先）。
 */
import { defineConfig, parses, applyEnvFile, createLogger } from '@homurajs/core';
import { ensureEnv } from './ensure-env.js';

/** 部署期配置文件（homura.config.env）并入 env（真实 env 优先于文件） */
applyEnvFile(process.env);

const config = defineConfig({
  // ── 监听 ──
  port: { env: 'PORT', default: 3000, parse: parses.int, description: '监听端口' },
  host: { env: 'HOST', parse: parses.string, description: '监听地址（缺省 0.0.0.0）' },
  trustProxy: {
    env: 'TRUST_PROXY',
    default: false,
    parse: parses.boolean,
    description: '是否在反向代理后（决定 cookie Secure 与 X-Forwarded-* 可信度）',
  },

  // ── 数据方言（双方言）──
  dbDialect: {
    env: 'DB_DIALECT',
    default: 'sqlite',
    parse: parses.string,
    description: "数据方言：'sqlite' | 'pg'（缺省 sqlite）",
  },
  dbPath: {
    env: 'DB_PATH',
    default: './data/app.db',
    parse: parses.string,
    description: 'sqlite 数据库文件路径（dialect=sqlite 时用）',
  },
  databaseUrl: {
    env: 'DATABASE_URL',
    parse: parses.string,
    secret: true,
    description: 'PostgreSQL 连接串（dialect=pg 时必填）',
  },

  // ── 认证（@homurajs/auth SessionManager）──
  sessionSecret: {
    env: 'SESSION_SECRET',
    parse: parses.string,
    required: true,
    secret: true,
    description: 'session HS256 签名密钥（>=32 bytes，必填）',
  },

  // ── 对象存储 ──
  // 注：自 e74c6d9 起 storage 用 DB 分块后端（createDrizzleFileStore），不再读本地根目录，
  // 故此项目前无消费方（保留以兼容既有 .env / 备将来切回 local-fs 后端时用，见 ADR-3/ADR-7）。
  storageRoot: {
    env: 'STORAGE_ROOT',
    default: './data/files',
    parse: parses.string,
    description: 'local-fs 存储后端根目录（当前 DB 后端不读，保留备用）',
  },

  // ── 静态资源 / CORS ──
  assetsDir: {
    env: 'HOMURA_ASSETS_DIR',
    parse: parses.string,
    description: '前端静态资源目录（缺省由 RuntimeAdapter.assetsDir 按形态算）',
  },
  corsOrigins: {
    env: 'CORS_ORIGINS',
    default: 'http://localhost:5173,http://127.0.0.1:5173',
    parse: parses.string,
    description: 'CORS 允许的来源（逗号分隔）；修复现有硬编码 localhost 缺陷',
  },

  // ── 钉钉集成（需求 4：教师免登录收推送）──────────────────────────
  // 全部可选：**缺省不启用**，此时推送落库标记 pending + 打日志，凭证到位后可补发，
  // 不阻塞记录创建主链路（降级优先于「配了才能用」）。
  appBaseUrl: {
    env: 'APP_BASE_URL',
    parse: parses.string,
    description: '应用对外基址（拼钉钉消息里的申诉链接用，须公网可达）；未配则不推送申诉链接',
  },
  dingtalkAppKey: {
    env: 'DINGTALK_APP_KEY',
    parse: parses.string,
    description: '钉钉企业应用 AppKey（配置即启用推送能力）',
  },
  dingtalkAppSecret: {
    env: 'DINGTALK_APP_SECRET',
    parse: parses.string,
    secret: true,
    description: '钉钉企业应用 AppSecret',
  },
  dingtalkAgentId: {
    env: 'DINGTALK_AGENT_ID',
    parse: parses.string,
    description: '钉钉工作通知 agentId（asyncsend_v2 必需；无法从 AppKey 反推，需后台查看或调 listMicroApps）',
  },
  oauthDingtalkOrgId: {
    env: 'OAUTH_DINGTALK_ORG_ID',
    parse: parses.string,
    description: 'oauth2-dingtalk 组织标识（配置即启用钉钉扫码登录，教师免账密）',
  },
  oauthDingtalkBaseUrl: {
    env: 'OAUTH_DINGTALK_BASE_URL',
    parse: parses.string,
    description: 'oauth2-dingtalk 部署地址（缺省线上 dingtalk.auth.xrl.im）',
  },
  oauthRedirectUri: {
    env: 'OAUTH_REDIRECT_URI',
    parse: parses.string,
    description: 'OAuth2 回调地址（本地开发须写 :5173 走 Vite proxy，否则 cookie 落错域）',
  },

  // ── 周报定时器（需求 4：每周得分扣分总计）────────────────────────
  weeklyReportDay: {
    env: 'WEEKLY_REPORT_DAY',
    default: 5,
    parse: parses.int,
    description: '周报推送的星期几（0=周日…5=周五，缺省周五）',
  },
  weeklyReportHour: {
    env: 'WEEKLY_REPORT_HOUR',
    default: 17,
    parse: parses.int,
    description: '周报推送的小时（0-23，缺省 17 点）',
  },
  weeklyReportEnabled: {
    env: 'WEEKLY_REPORT_ENABLED',
    default: true,
    parse: parses.boolean,
    description: '是否启用进程内周报定时器（多实例部署应关掉，避免重复推送；靠管理员补发）',
  },

  // ── 申诉令牌 ──────────────────────────────────────────────────────
  appealTokenTtlHours: {
    env: 'APPEAL_TOKEN_TTL_HOURS',
    default: 72,
    parse: parses.int,
    description: '免登录申诉链接有效期（小时，缺省 72）；一次性消费，用后失效',
  },

  // ── 日志 ──
  logLevel: {
    env: 'LOG_LEVEL',
    default: 'info',
    parse: parses.string,
    description: "日志级别：'debug' | 'info' | 'warn' | 'error'",
  },
});

export type AppConfig = ReturnType<typeof config.load>;

/** 加载并校验配置（缺 required 项即抛错）。先自愈 SESSION_SECRET，避免冷启动 fail-fast。 */
export function loadConfig(): AppConfig {
  ensureEnv();
  return config.load();
}

/** 生成 .env.example 片段（配置即文档） */
export function configHelp(): string {
  return config.help();
}

/** 全局 logger（JSON lines，敏感字段打码） */
export function createAppLogger(cfg: AppConfig) {
  return createLogger({ level: cfg.get('logLevel') as 'debug' | 'info' | 'warn' | 'error' });
}
