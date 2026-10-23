/**
 * ensure-env 单测 —— 验证冷启动配置自愈的幂等性、真实 env 优先、三种不可用 secret 的修复，
 * 以及「只改 SESSION_SECRET、不覆盖用户其他配置」的核心承诺。
 *
 * 全程用临时目录 + 独立 env 对象注入，绝不触碰真实 apps/server/.env（零副作用）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnv } from '../src/ensure-env.js';

const VALID = 'a'.repeat(43); // >= 32 字节，可用
const SHORT = 'tooshort'; // < 32 字节，不可用
const PLACEHOLDER = '<redacted>'; // 模板占位值，不可用

function readSecretFromFile(envPath: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  return extractSecret(readFileSync(envPath, 'utf8'));
}

function extractSecret(content: string): string | undefined {
  const m = /^SESSION_SECRET=([^\r\n]*)/m.exec(content);
  return m ? m[1] : undefined;
}

describe('ensureEnv 冷启动自愈', () => {
  let dir: string;
  let envPath: string;
  let examplePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ensure-env-'));
    envPath = join(dir, '.env');
    examplePath = join(dir, '.env.example');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('真实 env 已有可用 secret → 不触碰 .env（source=env）', () => {
    const env: Record<string, string | undefined> = { SESSION_SECRET: VALID };
    const r = ensureEnv({ envPath, examplePath, env });
    expect(r.source).toBe('env');
    expect(r.secretGenerated).toBe(false);
    expect(existsSync(envPath)).toBe(false); // 关键：不产生文件系统副作用
  });

  it('.env 不存在 + 有模板 → 从模板创建并生成 >=32 字节 secret', () => {
    writeFileSync(examplePath, `PORT=3000\nSESSION_SECRET=${PLACEHOLDER}\n`, 'utf8');
    const env: Record<string, string | undefined> = {};
    const r = ensureEnv({ envPath, examplePath, env });
    expect(r.created).toBe(true);
    expect(r.secretGenerated).toBe(true);
    expect(env.SESSION_SECRET).toBeDefined();
    expect(Buffer.byteLength(env.SESSION_SECRET!, 'utf8')).toBeGreaterThanOrEqual(32);
    expect(readSecretFromFile(envPath)).toBe(env.SESSION_SECRET); // 落盘值 == 返回值
  });

  it('三种不可用 secret（缺失 / 短 / 占位）都被替换成可用值', () => {
    for (const bad of [undefined, SHORT, PLACEHOLDER, '']) {
      // 每轮重建 .env
      if (bad === undefined) {
        writeFileSync(examplePath, 'PORT=3000\n', 'utf8'); // 模板里根本没有 SESSION_SECRET
        if (existsSync(envPath)) rmSync(envPath);
      } else {
        writeFileSync(envPath, `SESSION_SECRET=${bad}\n`, 'utf8');
      }
      const env: Record<string, string | undefined> = {};
      const r = ensureEnv({ envPath, examplePath, env });
      expect(r.secretGenerated, `bad=${JSON.stringify(bad)}`).toBe(true);
      expect(Buffer.byteLength(env.SESSION_SECRET!, 'utf8')).toBeGreaterThanOrEqual(32);
    }
  });

  it('幂等：secret 已可用时重复调用不改值、不重写文件', () => {
    writeFileSync(envPath, `SESSION_SECRET=${VALID}\nPORT=3000\n`, 'utf8');
    const before = readFileSync(envPath, 'utf8');
    const env1: Record<string, string | undefined> = {};
    const r1 = ensureEnv({ envPath, examplePath, env: env1 });
    expect(r1.secretGenerated).toBe(false);
    expect(env1.SESSION_SECRET).toBe(VALID); // 从文件灌进 env
    const env2: Record<string, string | undefined> = {};
    const r2 = ensureEnv({ envPath, examplePath, env: env2 });
    expect(r2.secretGenerated).toBe(false);
    expect(readFileSync(envPath, 'utf8')).toBe(before); // 文件逐字节未变
  });

  it('只改 SESSION_SECRET，保留用户改过的其他键（PORT）', () => {
    writeFileSync(envPath, `PORT=4321\nDB_PATH=./data/custom.db\nSESSION_SECRET=${SHORT}\n`, 'utf8');
    const env: Record<string, string | undefined> = {};
    ensureEnv({ envPath, examplePath, env });
    const after = readFileSync(envPath, 'utf8');
    expect(after).toContain('PORT=4321');
    expect(after).toContain('DB_PATH=./data/custom.db');
    expect(extractSecret(after)).not.toBe(SHORT); // 短 secret 已被替换
    expect(Buffer.byteLength(extractSecret(after)!, 'utf8')).toBeGreaterThanOrEqual(32);
  });

  it('缺失键时追加而非破坏：保留既有键、追加 SESSION_SECRET', () => {
    writeFileSync(envPath, 'PORT=3000\nLOG_LEVEL=info\n', 'utf8');
    const env: Record<string, string | undefined> = {};
    ensureEnv({ envPath, examplePath, env });
    const after = readFileSync(envPath, 'utf8');
    expect(after).toContain('PORT=3000');
    expect(after).toContain('LOG_LEVEL=info');
    expect(/^SESSION_SECRET=/m.test(after)).toBe(true);
    // 追加的键单独成行，未拼到上一行末尾
    expect(/LOG_LEVEL=info\r?\nSESSION_SECRET=/.test(after) || /LOG_LEVEL=info\r?\n\r?\nSESSION_SECRET=/.test(after)).toBe(true);
  });

  it('CRLF 文件保持 CRLF 换行风格', () => {
    writeFileSync(envPath, `PORT=3000\r\nSESSION_SECRET=${SHORT}\r\n`, 'utf8');
    const env: Record<string, string | undefined> = {};
    ensureEnv({ envPath, examplePath, env });
    const after = readFileSync(envPath, 'utf8');
    expect(after).toContain('\r\n');
    expect(extractSecret(after)).not.toBe(SHORT);
  });

  it('无模板无 .env → 从零创建只含 SESSION_SECRET 的文件', () => {
    const env: Record<string, string | undefined> = {};
    const r = ensureEnv({ envPath, examplePath: join(dir, 'nope'), env });
    expect(r.created).toBe(true);
    expect(r.secretGenerated).toBe(true);
    expect(readSecretFromFile(envPath)).toBe(env.SESSION_SECRET);
  });
});
