/**
 * 看板页 —— 统一巡查职责平台的落地页（改良：值周统计 + 值班执勤同框）。
 *
 * 哲学价值（docs/REVIEW-PHILOSOPHY.md §1 断点3）：看板是每个用户登录后第一眼，
 * 融合前只有值周一半。改良后新增「我的今日执勤」条——教师/值周生在此直接看到自己
 * 今天要不要到岗、是否已打卡，一键跳打卡页。让「统一巡查职责」在最常用的门面兑现。
 *
 * 迁移：Fluent Card/Table/Spinner → shadcn；数据走 useAsync + Promise.all。
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, TrendingUp, FileText, Clock, ClipboardCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import type { DashboardStats, ClassRanking, RecordWithDetails, TodayTask } from '@class-duty/shared';

interface DashData {
  stats: DashboardStats;
  ranking: ClassRanking[];
  recent: RecordWithDetails[];
}

const RECORD_STATUS_LABEL: Record<string, string> = {
  active: 'records.status.active',
  revoked: 'records.status.revoked',
  appealing: 'records.status.appealing',
  appeal_approved: 'records.status.appeal_approved',
};

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, loading, reload } = useAsync<DashData>(async () => {
    const [stats, ranking, recent] = await Promise.all([
      api.get<DashboardStats>('/statistics/dashboard'),
      api.get<ClassRanking[]>('/statistics/ranking'),
      api.get<RecordWithDetails[]>('/records', { pageSize: 10 }),
    ]);
    return { stats: stats.data, ranking: ranking.data, recent: recent.data };
  }, []);

  // 我的今日执勤（值班域）——失败不拖垮看板（softFetch 精神）
  const { data: myTasks } = useAsync<TodayTask[]>(async () => {
    try {
      return (await api.get<TodayTask[]>('/duty/checkins/today')).data;
    } catch {
      return [];
    }
  }, []);

  const todoTasks = (myTasks ?? []).filter((x) => !x.checkedIn);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('nav.dashboard')}</h1>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          {t('common.refresh')}
        </Button>
      </div>

      {/* 我的今日执勤条（改良：值班域上浮到落地页）*/}
      {(myTasks ?? []).length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                <ClipboardCheck className="size-5 text-primary" />
              </div>
              <div>
                <div className="font-medium">{t('duty.checkin.todayTasks')}</div>
                <div className="text-xs text-muted-foreground">
                  {todoTasks.length > 0
                    ? `${todoTasks.length} ${t('duty.checkin.todo')} · ${todoTasks.map((x) => x.locationName).filter(Boolean).join('、')}`
                    : t('duty.checkin.done')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {todoTasks.length === 0 && <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" />{t('duty.checkin.checkedIn')}</Badge>}
              <Button size="sm" onClick={() => navigate('/duty/checkin')}>
                {t('nav.dutyCheckin')}<ArrowRight className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4 统计卡 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileText} label={t('dashboard.todayRecords')} value={data?.stats.todayRecords ?? 0} />
        <StatCard icon={TrendingUp} label={t('dashboard.todayPositive')} value={data?.stats.todayPositive ?? 0} tone="success" />
        <StatCard icon={TrendingUp} label={t('dashboard.todayNegative')} value={data?.stats.todayNegative ?? 0} tone="destructive" />
        <StatCard icon={Clock} label={t('dashboard.weekBest')} value={data?.stats.weekTopClass ?? '—'} sub={data?.stats.weekTopScore != null ? `${data.stats.weekTopScore}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 本周 Top5 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('dashboard.weekTop5')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{t('stats.className')}</TableHead>
                  <TableHead className="text-right">{t('stats.totalScore')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.ranking ?? []).slice(0, 5).map((r) => (
                  <TableRow key={r.classId}>
                    <TableCell><RankBadge rank={r.rank} /></TableCell>
                    <TableCell>{r.className}</TableCell>
                    <TableCell className="text-right font-medium">{r.totalScore}</TableCell>
                  </TableRow>
                ))}
                {data && data.ranking.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">{t('common.noData')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* 最新记录 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('dashboard.recentRecords')}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 space-y-2 overflow-y-auto">
            {(data?.recent ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.className} · {r.tagName ?? t('records.comment')}</div>
                  <div className="text-xs text-muted-foreground">{r.recorderName} · {r.week}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={r.score != null && r.score < 0 ? 'text-destructive' : 'text-success'}>{r.score ?? 0}</span>
                  <Badge variant={r.status === 'active' ? 'success' : r.status === 'revoked' ? 'secondary' : 'warning'}>
                    {t(RECORD_STATUS_LABEL[r.status])}
                  </Badge>
                </div>
              </div>
            ))}
            {data && data.recent.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">{t('common.noData')}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone }: {
  icon: typeof FileText; label: string; value: string | number; sub?: string; tone?: 'success' | 'destructive';
}) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-foreground';
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? 'bg-yellow-400 text-yellow-950' : rank === 2 ? 'bg-gray-300 text-gray-800' : rank === 3 ? 'bg-amber-600 text-amber-50' : 'bg-muted text-muted-foreground';
  return <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${medal}`}>{rank}</span>;
}
