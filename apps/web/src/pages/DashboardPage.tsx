/**
 * 看板页 —— 值周域落地页（今日统计 + 本周 Top5 + 最新记录）。
 *
 * 迁移：Fluent Card/Table/Spinner → shadcn；数据走 useAsync + Promise.all。
 */
import { useTranslation } from 'react-i18next';
import { RefreshCw, TrendingUp, FileText, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import type { DashboardStats, ClassRanking, RecordWithDetails, RecordStatus } from '@guga-onduty-w/shared';

interface DashData {
  stats: DashboardStats;
  ranking: ClassRanking[];
  recent: RecordWithDetails[];
}

// 用 RecordStatus 而非 string 收窄键集：状态枚举变动时 TS 会直接报错，避免留下死键
const RECORD_STATUS_LABEL: Record<RecordStatus, string> = {
  active: 'records.status.active',
  revoked: 'records.status.revoked',
  appealing: 'records.status.appealing',
};

export default function DashboardPage() {
  const { t } = useTranslation();
  const { data, loading, reload } = useAsync<DashData>(async () => {
    const [stats, ranking, recent] = await Promise.all([
      api.get<DashboardStats>('/statistics/dashboard'),
      api.get<ClassRanking[]>('/statistics/ranking'),
      api.get<RecordWithDetails[]>('/records', { pageSize: 10 }),
    ]);
    return { stats: stats.data, ranking: ranking.data, recent: recent.data };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('nav.dashboard')}</h1>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          {t('common.refresh')}
        </Button>
      </div>

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
                  <div className="truncate font-medium">{r.className} · {r.tags.map((tg) => tg.name).join('、') || t('records.comment')}</div>
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
