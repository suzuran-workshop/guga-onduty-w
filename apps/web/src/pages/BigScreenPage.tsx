/**
 * 数字大屏 —— 统一巡查职责平台门面（改良 B：兑现主人「值周是更详细的值班」洞察到可见层）。
 *
 * 哲学价值（docs/REVIEW-PHILOSOPHY.md §1 断点3）：
 *  大屏是访客/领导第一眼看的地方。融合前它只展示值周一半；改良后**值周履职 + 值班执勤同框**，
 *  让「统一巡查职责平台」名副其实。标题从「校园值周数字大屏」改为「校园值班·值周数字大屏」。
 *
 * 布局（上→下）：
 *  1. 标题栏（时钟 + SSE 实时指示灯 + 周次）
 *  2. 值周 KPI（4 卡）：今日记录/加分/扣分/最优班级
 *  3. **值班执勤条（改良 B 新增）**：今日到岗率 + 应到/实到/班次/待执勤/已换班
 *  4. 主区两栏：本周班级排名 Top10（值周） | 今日值班矩阵缩略（值班，地点×7天三态 pill）
 *  5. 实时记录流（SSE）
 *
 * 数据：值周走 statistics/*，值班走 duty/attendance + duty/matrix（均为已有端点，前端聚合）。
 * 实时：SSE(record_created/revoked) 触发重拉；值班数据随 60s 兜底轮询刷新。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, MonitorUp, TrendingUp, TrendingDown, ClipboardCheck, Users } from 'lucide-react';
import { api } from '@/api/client';
import { getCurrentWeek, dateKey, shortDate } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { ClassRanking, RecordWithDetails, DashboardStats, AttendanceStats, MatrixView, PillState } from '@class-duty/shared';

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'bg-yellow-500 text-yellow-950';
  if (rank === 2) return 'bg-gray-400 text-gray-900';
  if (rank === 3) return 'bg-amber-700 text-amber-50';
  return 'bg-white/10 text-white/60';
}

const PILL_DOT: Record<PillState, string> = {
  swapped: 'bg-gradient-to-r from-indigo-400 to-purple-400',
  done: 'bg-green-400',
  pending: 'bg-amber-400',
};

export default function BigScreenPage() {
  const { t } = useTranslation();
  const [rankings, setRankings] = useState<ClassRanking[]>([]);
  const [records, setRecords] = useState<RecordWithDetails[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [attendance, setAttendance] = useState<AttendanceStats | null>(null);
  const [matrix, setMatrix] = useState<MatrixView | null>(null);
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('zh-CN'));
  const [live, setLive] = useState(false);
  const week = getCurrentWeek();
  const today = dateKey(new Date());
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const monthStart = today.slice(0, 8) + '01';
      const [r, rec, st, att, mx] = await Promise.all([
        api.get<ClassRanking[]>('/statistics/ranking', { week }),
        api.get<RecordWithDetails[]>('/records', { pageSize: 20 }),
        api.get<DashboardStats>('/statistics/dashboard'),
        // 值班到岗率（本月范围）+ 本周矩阵
        api.get<AttendanceStats>('/duty/attendance', { date_from: monthStart, date_to: today }),
        api.get<MatrixView>('/duty/matrix', { week: today }),
      ]);
      setRankings(r.data);
      setRecords(rec.data);
      setStats(st.data);
      setAttendance(att.data);
      setMatrix(mx.data);
    } catch {
      /* 未登录或网络错：大屏显示空，不崩溃（部分源失败不拖垮整体，softFetch 精神） */
    }
  }, [week, today]);

  useEffect(() => {
    refresh();
    const clock = setInterval(() => setTime(new Date().toLocaleTimeString('zh-CN')), 1000);
    // SSE 实时订阅（同源自动带 cookie）
    const es = new EventSource('/api/v1/sse/records', { withCredentials: true });
    esRef.current = es;
    es.addEventListener('connected', () => setLive(true));
    es.addEventListener('record_created', () => refresh());
    es.addEventListener('record_revoked', () => refresh());
    es.onerror = () => setLive(false);
    const fallback = setInterval(refresh, 60000);
    return () => {
      clearInterval(clock);
      clearInterval(fallback);
      es.close();
      esRef.current = null;
    };
  }, [refresh]);

  // 值周 KPI
  const kpis: { val: string | number; label: string; color: string; icon?: typeof TrendingUp }[] = [
    { val: stats?.todayRecords ?? '-', label: t('bigscreen.todayRecords'), color: 'text-white' },
    { val: `+${stats?.todayPositive ?? 0}`, label: t('bigscreen.todayPositive'), color: 'text-green-400', icon: TrendingUp },
    { val: stats?.todayNegative ?? 0, label: t('bigscreen.todayNegative'), color: 'text-red-400', icon: TrendingDown },
    { val: stats?.weekTopClass || '-', label: t('bigscreen.bestClass'), color: 'text-yellow-300' },
  ];

  // 今日值班矩阵（只取今天那一列，展示地点×履职者三态）
  const todayColIdx = matrix?.matrix.columns.findIndex((c) => c.date === today) ?? -1;
  const todayDutyCells = matrix?.matrix.rows
    .map((row) => ({ location: row.locationName, pills: todayColIdx >= 0 ? row.cells[todayColIdx].pills : [] }))
    .filter((x) => x.pills.length > 0) ?? [];

  return (
    <div className="bigscreen p-8">
      {/* 标题栏 */}
      <div className="bigscreen-header mb-6 rounded-xl p-6 text-center text-white">
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

      {/* 值周 KPI */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <div key={i} className="bigscreen-card p-5 text-center">
              <div className={cn('font-bold', i === 3 ? 'text-xl' : 'text-3xl', k.color)}>{k.val}</div>
              <div className="mt-1 flex items-center justify-center gap-1 text-xs text-white/60">
                {Icon && <Icon className="size-3.5" />} {k.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* 值班执勤条（改良 B 新增）—— 统一平台的另一半 */}
      <div className="bigscreen-card mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 font-semibold text-teal-300">
          <ClipboardCheck className="size-4" />{t('bigscreen.dutySection')}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <DutyStat label={t('bigscreen.dutyAttendance')} value={attendance ? `${Math.round(attendance.rate * 100)}%` : '—'} big tone="text-teal-300" />
          <DutyStat label={t('bigscreen.dutyScheduled')} value={attendance?.scheduled ?? 0} />
          <DutyStat label={t('bigscreen.dutyCheckedIn')} value={attendance?.checkedIn ?? 0} tone="text-green-400" />
          <DutyStat label={t('bigscreen.dutyPending')} value={matrix?.summary.pending ?? 0} tone="text-amber-400" />
          <DutyStat label={t('bigscreen.dutySwapped')} value={matrix?.summary.swapped ?? 0} tone="text-indigo-300" />
        </div>
        {/* 到岗率进度条 */}
        {attendance && (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-green-400 transition-all duration-500" style={{ width: `${Math.round(attendance.rate * 100)}%` }} />
          </div>
        )}
      </div>

      {/* 主区：值周排名 | 今日值班矩阵 */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* 值周排名 Top10 */}
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

        {/* 今日值班矩阵（地点×履职者三态）*/}
        <div className="bigscreen-card p-6">
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-2">
            <span className="flex items-center gap-2 font-semibold text-teal-300"><Users className="size-4" />{t('bigscreen.dutySection')} · {shortDate(today)}</span>
            <span className="flex gap-2 text-xs text-white/50">
              <Legend dot={PILL_DOT.done} label={t('duty.pill.done')} />
              <Legend dot={PILL_DOT.pending} label={t('duty.pill.pending')} />
              <Legend dot={PILL_DOT.swapped} label={t('duty.pill.swapped')} />
            </span>
          </div>
          <div className="max-h-[40vh] space-y-2 overflow-y-auto">
            {todayDutyCells.length === 0 && <div className="py-8 text-center text-sm text-white/40">{t('duty.schedule.empty')}</div>}
            {todayDutyCells.map((cell, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                <span className="text-sm text-white/70">{cell.location}</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {cell.pills.map((p, j) => (
                    <span key={j} title={`${p.userName} · ${t('duty.pill.' + p.state)}`}
                      className={cn('inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white')}>
                      <span className={cn('size-2 rounded-full', PILL_DOT[p.state])} />
                      {p.userName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 实时记录流 */}
      <div className="bigscreen-card p-6">
        <div className="mb-4 border-b border-white/10 pb-2 font-semibold text-sky-300">{t('bigscreen.liveFeed')}</div>
        <div className="max-h-[30vh] overflow-y-auto">
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
          {records.length === 0 && <div className="py-8 text-center text-sm text-white/40">{t('bigscreen.noRecords')}</div>}
        </div>
      </div>
    </div>
  );
}

function DutyStat({ label, value, tone, big }: { label: string; value: string | number; tone?: string; big?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn('font-bold text-white', big ? 'text-3xl' : 'text-2xl', tone)}>{value}</div>
      <div className="mt-1 text-xs text-white/50">{label}</div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('size-2 rounded-full', dot)} />{label}
    </span>
  );
}
