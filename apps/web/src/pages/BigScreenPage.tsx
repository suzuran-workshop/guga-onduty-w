/**
 * 数字大屏 —— 全屏展示 + **SSE 实时推送**（修复旧代码 30s 轮询、且后端 SSE 前端从没接的死代码）。
 *
 * 迁移要点（对照旧 BigScreenPage）：
 *  - Fluent Text + 内联深色样式 → Tailwind + .bigscreen 作用域类（index.css）。
 *  - 数据刷新：30s setInterval 轮询 → EventSource 订阅 /api/v1/sse/records 实时推送。
 *    SSE 事件（record_created/record_revoked）到达即重拉排名/记录/看板（事件是「变更信号」，
 *    载荷非完整数据，与后端 SSE 设计一致）。保留 60s 兜底轮询 + EventSource 断线重连。
 *  - 字段 snake_case → camelCase 领域类型；recordedAt 是 epoch。
 *  - cookie 登录态：EventSource 同源自动带 HttpOnly cookie（大屏设备需已登录，与旧行为一致）。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, MonitorUp, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '@/api/client';
import { getCurrentWeek } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { ClassRanking, RecordWithDetails, DashboardStats } from '@class-duty/shared';

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'bg-yellow-500 text-yellow-950';
  if (rank === 2) return 'bg-gray-400 text-gray-900';
  if (rank === 3) return 'bg-amber-700 text-amber-50';
  return 'bg-white/10 text-white/60';
}

export default function BigScreenPage() {
  const { t } = useTranslation();
  const [rankings, setRankings] = useState<ClassRanking[]>([]);
  const [records, setRecords] = useState<RecordWithDetails[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('zh-CN'));
  const [live, setLive] = useState(false);
  const week = getCurrentWeek();
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, rec, st] = await Promise.all([
        api.get<ClassRanking[]>('/statistics/ranking', { week }),
        api.get<RecordWithDetails[]>('/records', { pageSize: 20 }),
        api.get<DashboardStats>('/statistics/dashboard'),
      ]);
      setRankings(r.data);
      setRecords(rec.data);
      setStats(st.data);
    } catch {
      /* 未登录或网络错：大屏显示空，不崩溃 */
    }
  }, [week]);

  useEffect(() => {
    refresh();

    // 时钟
    const clock = setInterval(() => setTime(new Date().toLocaleTimeString('zh-CN')), 1000);

    // SSE 实时订阅（同源自动带 cookie）
    const es = new EventSource('/api/v1/sse/records', { withCredentials: true });
    esRef.current = es;
    es.addEventListener('connected', () => setLive(true));
    es.addEventListener('record_created', () => refresh());
    es.addEventListener('record_revoked', () => refresh());
    es.onerror = () => {
      setLive(false);
      // 断线时浏览器会自动重连；这里仅标记非实时态
    };

    // 兜底轮询（60s，防 SSE 长时间静默或断连期间数据陈旧）
    const fallback = setInterval(refresh, 60000);

    return () => {
      clearInterval(clock);
      clearInterval(fallback);
      es.close();
      esRef.current = null;
    };
  }, [refresh]);

  const kpis: { val: string | number; label: string; color: string; icon?: typeof TrendingUp }[] = [
    { val: stats?.todayRecords ?? '-', label: t('bigscreen.todayRecords'), color: 'text-white' },
    { val: `+${stats?.todayPositive ?? 0}`, label: t('bigscreen.todayPositive'), color: 'text-green-400', icon: TrendingUp },
    { val: stats?.todayNegative ?? 0, label: t('bigscreen.todayNegative'), color: 'text-red-400', icon: TrendingDown },
    { val: stats?.weekTopClass || '-', label: t('bigscreen.bestClass'), color: 'text-yellow-300' },
  ];

  return (
    <div className="bigscreen p-8">
      {/* 标题栏 */}
      <div className="bigscreen-header mb-8 rounded-xl p-8 text-center text-white">
        <div className="mb-2 flex items-center justify-center gap-2 text-sm opacity-80">
          <Clock className="size-4" /> {time}
          <span className={cn('ml-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', live ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/60')}>
            <span className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-green-400' : 'bg-white/40')} />
            {live ? t('bigscreen.live') : '—'}
          </span>
        </div>
        <h1 className="flex items-center justify-center gap-3 text-4xl font-bold">
          <MonitorUp className="size-8" /> {t('bigscreen.title')}
        </h1>
        <div className="mt-2 text-lg opacity-85">{week} {t('common.week')}</div>
      </div>

      {/* KPI */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <div key={i} className="bigscreen-card p-6 text-center">
              <div className={cn('font-bold', i === 3 ? 'text-xl' : 'text-3xl', k.color)}>{k.val}</div>
              <div className="mt-1 flex items-center justify-center gap-1 text-xs text-white/60">
                {Icon && <Icon className="size-3.5" />} {k.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* 排名 + 实时流 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bigscreen-card p-6">
          <div className="mb-4 border-b border-white/10 pb-2 font-semibold text-yellow-300">{t('bigscreen.weekRankingTop10')}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/50">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">{t('records.class')}</th>
                <th className="px-3 py-2 text-left">{t('records.score')}</th>
                <th className="px-3 py-2 text-left">+/-</th>
              </tr>
            </thead>
            <tbody>
              {rankings.slice(0, 10).map((r) => (
                <tr key={r.classId} className="border-b border-white/5">
                  <td className="px-3 py-2">
                    <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs font-bold', rankBadgeClass(r.rank))}>{r.rank}</span>
                  </td>
                  <td className="px-3 py-2">{r.gradeName} {r.className}</td>
                  <td className={cn('px-3 py-2 font-semibold', r.totalScore >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {r.totalScore >= 0 ? '+' : ''}{r.totalScore}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-green-400">+{r.positiveCount}</span> / <span className="text-red-400">-{r.negativeCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bigscreen-card p-6">
          <div className="mb-4 border-b border-white/10 pb-2 font-semibold text-sky-300">{t('bigscreen.liveFeed')}</div>
          <div className="max-h-[60vh] overflow-y-auto">
            {records.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-white/5 py-2.5">
                <div>
                  <span className="font-medium">{r.gradeName} {r.className}</span>
                  <span className="ml-3 text-xs text-white/50">{r.tagName || '--'}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={cn('text-base font-semibold', (r.score ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {r.score != null ? `${r.score >= 0 ? '+' : ''}${r.score}` : '--'}
                  </span>
                  <span className="text-xs text-white/40">{new Date(r.recordedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
            {records.length === 0 && (
              <div className="py-10 text-center text-sm text-white/40">{t('bigscreen.noRecords')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
