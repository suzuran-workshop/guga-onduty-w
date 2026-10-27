/**
 * 系统设置页 —— 校区开关 + 钉钉集成（通讯录/推送日志/周报）+ 模板导入导出。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Switch/Card/Button → shadcn Switch（checked + onCheckedChange）。
 *  - GET /settings 返回 key-value map（Record<string,string>），非数组。
 *  - PUT /settings 去掉硬编码 campus_id（后端从 profile 取），body {settings:[{key,value}]}，value 是 'true'/'false'。
 *  - 模板导出：api.get('/templates/export') → JSON Blob 下载；导入：input[type=file] 读 JSON → POST /templates/import。
 *
 * 2026-10-23（需求 4：教师免登录收推送）：
 *  - 新增「钉钉集成」节。这是整条推送链的**前置配置入口**：钉钉没有「按姓名查 userid」的接口，
 *    管理员必须先在这里引入组织通讯录，ConfigPage 的班主任下拉才有数据、扣分推送才找得到人。
 *    缺这一节时，通讯录恒为空，班主任绑不上，需求 4 在真实环境里根本跑不起来。
 *  - 按产品要求**只引入组织通讯录，不含家校通讯录**（sync 端点 includeFamily 恒 false）。
 *  - 移除死开关 `auto_notify_teachers`：全仓零消费方（只有 seed/白名单/这个 Switch 三处），
 *    关掉它推送照发——一个撒谎的开关摆在真实状态区旁边只会误导管理员。
 *    推送是否启用由**凭证是否配齐**决定，下方状态区如实展示（含未启用原因）。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Upload, Users, RefreshCw, Send, Inbox, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { getCurrentWeek, formatTime } from '@/lib/week';
import type {
  ContactsSyncResult, DingtalkContact, NotificationLog,
  NotificationKind, NotificationStatus, Pagination,
} from '@guga-onduty-w/shared';

type SettingsMap = Record<string, string>;

/** GET /dingtalk/status 的返回形状 */
interface DingtalkStatus {
  enabled: boolean;
  reason: string | null;
  agentId: string | null;
  capabilities: string[];
  oauth: boolean;
  contacts: boolean;
  message: boolean;
  apps: boolean;
}

const STATUS_VARIANT: Record<NotificationStatus, 'secondary' | 'success' | 'destructive' | 'warning'> = {
  pending: 'warning',
  sent: 'success',
  failed: 'destructive',
  skipped: 'secondary',
};

const KINDS: NotificationKind[] = ['record_deduction', 'record_positive', 'weekly_report'];
const STATUSES: NotificationStatus[] = ['pending', 'sent', 'failed', 'skipped'];

export default function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsMap>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // ── 钉钉集成状态 ──────────────────────────────────────────────────
  const [dt, setDt] = useState<DingtalkStatus | null>(null);
  const [contacts, setContacts] = useState<DingtalkContact[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // ── 推送日志 ──────────────────────────────────────────────────────
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logPagination, setLogPagination] = useState<Pagination | null>(null);
  const [logKind, setLogKind] = useState<string>('__all__');
  const [logStatus, setLogStatus] = useState<string>('__all__');
  const [busyLogId, setBusyLogId] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);

  // ── 周报 ──────────────────────────────────────────────────────────
  const [week, setWeek] = useState(getCurrentWeek());
  const [weeklyBusy, setWeeklyBusy] = useState(false);

  useEffect(() => {
    api.get<SettingsMap>('/settings').then((r) => setSettings(r.data)).catch(() => {});
    api.get<DingtalkStatus>('/dingtalk/status').then((r) => setDt(r.data)).catch(() => {});
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const r = await api.get<DingtalkContact[]>('/dingtalk/contacts', { limit: 500 });
      setContacts(r.data);
      // 最近同步时间取所有联系人里的最大值（每次 sync 会整体刷新 syncedAt）
      const max = r.data.reduce((acc, c) => Math.max(acc, c.syncedAt ?? 0), 0);
      setLastSyncedAt(max > 0 ? max : null);
    } catch { /* 未同步/无权限：留空，UI 显示「尚未引入」 */ }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const r = await api.get<NotificationLog[]>('/dingtalk/notifications', {
        page: logPage,
        pageSize: 20,
        kind: logKind === '__all__' ? undefined : logKind,
        status: logStatus === '__all__' ? undefined : logStatus,
      });
      setLogs(r.data);
      setLogPagination(r.pagination ?? null);
    } catch { /* 未配凭证时端点仍可用（只是没数据）；失败则留空 */ }
  }, [logPage, logKind, logStatus]);

  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  async function toggle(key: string) {
    const nv = settings[key] === 'true' ? 'false' : 'true';
    try {
      await api.put('/settings', { settings: [{ key, value: nv }] });
      setSettings((prev) => ({ ...prev, [key]: nv }));
      toast.success(t('settings.savedOk'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  /** 引入整个组织通讯录（不含家校）。这是班主任绑定与推送的前置步骤 */
  async function handleSync() {
    setSyncing(true);
    try {
      const r = await api.post<ContactsSyncResult>('/dingtalk/sync');
      const d = r.data;
      toast.success(t('settings.dingtalk.syncOk', { synced: d.synced, depts: d.depts }));
      if (d.truncated) {
        toast.warning(t('settings.dingtalk.syncTruncated', { count: d.errors.length }));
      }
      await loadContacts();
      // 通讯录变了 → 推送日志里的收件人名也要刷新（靠 userid 反查姓名）
      loadLogs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleResend(id: string) {
    setBusyLogId(id);
    try {
      await api.post(`/dingtalk/notifications/${id}/resend`);
      toast.success(t('settings.dingtalk.resendOk'));
      loadLogs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setBusyLogId(null);
    }
  }

  async function handleFlush() {
    setFlushing(true);
    try {
      const r = await api.post<{ sent: number; failed: number }>('/dingtalk/notifications/flush');
      toast.success(t('settings.dingtalk.flushOk', { sent: r.data.sent, failed: r.data.failed }));
      loadLogs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setFlushing(false);
    }
  }

  /** 发/补发周报（dedupeKey 幂等，重复点安全） */
  async function handleWeekly() {
    if (!week) { toast.error(t('common.failed')); return; }
    setWeeklyBusy(true);
    try {
      const r = await api.post<{ sent: number; skipped: number; failed: number }>(
        '/dingtalk/weekly-report', { week },
      );
      toast.success(t('settings.dingtalk.weeklyOk', {
        sent: r.data.sent, skipped: r.data.skipped, failed: r.data.failed,
      }));
      loadLogs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setWeeklyBusy(false);
    }
  }

  async function handleExport() {
    try {
      const r = await api.get<{ name: string; tagIds: string[] }[]>('/templates/export');
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'templates.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function handleImport(file: File) {
    try {
      const data = JSON.parse(await file.text());
      const r = await api.post<{ imported: number }>('/templates/import', { data });
      toast.success(`${t('common.import')}: ${r.data.imported}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  /** 收件人显示名：通知存的是钉钉 userid（对人不可读），用通讯录反查 */
  const recipientName = (platformId: string) => {
    if (!platformId) return '—';
    const c = contacts.find((x) => x.userId === platformId);
    return c ? c.name : platformId;
  };

  const dtEnabled = dt?.enabled ?? false;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>

      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <div className="mb-4 font-semibold">{t('settings.campusSettings')}</div>

          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <Label className="text-base">{t('settings.appealToggle')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings.appealDesc')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {settings.appeal_enabled === 'true' ? t('settings.enabled') : t('settings.disabled')}
              </span>
              <Switch checked={settings.appeal_enabled === 'true'} onCheckedChange={() => toggle('appeal_enabled')} />
            </div>
          </div>

          <Separator />

          <div className="pt-5">
            <div className="mb-3 font-semibold">{t('config.tabs.templates')}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="size-4" />{t('settings.exportTemplates')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />{t('settings.importTemplates')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImport(f);
                  e.target.value = ''; // 允许重复选同一文件
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 钉钉集成（需求 4 的前置配置入口）────────────────────────── */}
      <Card className="max-w-3xl">
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{t('settings.dingtalk.section')}</div>
            <Badge variant={dtEnabled ? 'success' : 'secondary'}>
              {dtEnabled ? t('settings.dingtalk.statusEnabled') : t('settings.dingtalk.statusDisabled')}
            </Badge>
          </div>

          {/* 未启用时给出可操作原因：推送不是「坏了」，而是凭证没配 —— 二者排障路径完全不同 */}
          {!dtEnabled && (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t('settings.dingtalk.disabledReason')}：</span>
              {dt?.reason ?? t('settings.dingtalk.noReason')}
              <br />
              <span className="text-muted-foreground">{t('settings.dingtalk.noReason')}</span>
            </p>
          )}

          {/* ① 组织通讯录（班主任绑定与推送的数据来源） */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium">
                <Users className="size-4" />{t('settings.dingtalk.contacts')}
              </div>
              <div className="flex items-center gap-2">
                {lastSyncedAt && (
                  <span className="text-xs text-muted-foreground">
                    {t('settings.dingtalk.lastSynced')}: {formatTime(lastSyncedAt).slice(0, 16)}
                  </span>
                )}
                <Button size="sm" onClick={handleSync} disabled={syncing || !dt?.contacts}>
                  <RefreshCw className={syncing ? 'size-4 animate-spin' : 'size-4'} />
                  {syncing ? t('settings.dingtalk.syncing') : t('settings.dingtalk.syncContacts')}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.dingtalk.contactsHint')}</p>
            {contacts.length === 0 ? (
              <div className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                {t('settings.dingtalk.contactsEmpty')}
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {t('settings.dingtalk.contactsCount', { count: contacts.length })}
                </div>
                {/* 只列前若干条：整份通讯录可能上百人，此处仅为让管理员确认「拉到了、是谁」，
                    完整选择在 ConfigPage 的班主任下拉里（带部门名消歧） */}
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {contacts.slice(0, 50).map((c) => (
                    <div key={c.userId} className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
                      <span className="font-medium">{c.name}</span>
                      <span className="truncate text-muted-foreground">
                        {[c.title, c.deptNames?.join(' / ')].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <Separator />

          {/* ② 教师周报 */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-medium">
              <FileText className="size-4" />{t('settings.dingtalk.weeklyReport')}
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.dingtalk.weeklyReportHint')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="w-32" value={week} onChange={(e) => setWeek(e.target.value)} />
              <Button size="sm" variant="outline" onClick={handleWeekly} disabled={weeklyBusy || !dtEnabled}>
                <Send className="size-4" />
                {weeklyBusy ? t('common.loading') : t('settings.dingtalk.sendWeekly')}
              </Button>
            </div>
          </div>

          <Separator />

          {/* ③ 推送日志（审计 + 补发） */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium">
                <Inbox className="size-4" />{t('settings.dingtalk.notifications')}
              </div>
              <Button size="sm" variant="outline" onClick={handleFlush} disabled={flushing || !dtEnabled}>
                {flushing ? t('common.loading') : t('settings.dingtalk.flush')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.dingtalk.notificationsHint')}</p>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={logKind} onValueChange={(v) => { setLogKind(v); setLogPage(1); }}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('settings.dingtalk.kindAll')}</SelectItem>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{t(`settings.dingtalk.kind.${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={logStatus} onValueChange={(v) => { setLogStatus(v); setLogPage(1); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('settings.dingtalk.filterAll')}</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`settings.dingtalk.statusKind.${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => loadLogs()}>
                <RefreshCw className="size-4" />{t('common.refresh')}
              </Button>
            </div>

            {logs.length === 0 ? (
              <div className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
                {t('settings.dingtalk.notificationsEmpty')}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">{t('common.status')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('settings.dingtalk.recipient')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('settings.dingtalk.message')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('common.week')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('records.time')}</th>
                      <th className="px-2 py-1.5 text-right font-medium">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((n) => (
                      <tr key={n.id} className="border-t">
                        <td className="px-2 py-1.5">
                          <Badge variant={STATUS_VARIANT[n.status]}>
                            {t(`settings.dingtalk.statusKind.${n.status}`)}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5">{recipientName(n.recipientPlatformId)}</td>
                        <td className="max-w-[220px] px-2 py-1.5">
                          <div className="truncate">{t(`settings.dingtalk.kind.${n.kind}`)}{n.title ? ` · ${n.title}` : ''}</div>
                          {/* 失败原因直接摊开：钉钉的错误信息（invalid userid / 权限不足）是排障唯一线索 */}
                          {n.error && <div className="truncate text-destructive" title={n.error}>{n.error}</div>}
                        </td>
                        <td className="px-2 py-1.5">{n.week ?? '—'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatTime(n.createdAt).slice(5, 16)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {/* 已送达的不给重发（重发会重复打扰教师）；待发/失败/跳过可重发 */}
                          {n.status !== 'sent' && n.recipientPlatformId && (
                            <Button
                              size="sm" variant="ghost"
                              disabled={busyLogId === n.id || !dtEnabled}
                              onClick={() => handleResend(n.id)}
                            >
                              {busyLogId === n.id ? t('common.loading') : t('settings.dingtalk.resend')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(logPagination?.totalPages ?? 0) > 1 && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Button size="sm" variant="outline" disabled={logPage <= 1} onClick={() => setLogPage((p) => p - 1)}>
                  {t('common.prev')}
                </Button>
                <span>{logPage} / {logPagination?.totalPages}</span>
                <Button
                  size="sm" variant="outline"
                  disabled={logPage >= (logPagination?.totalPages ?? 1)}
                  onClick={() => setLogPage((p) => p + 1)}
                >
                  {t('common.next')}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
