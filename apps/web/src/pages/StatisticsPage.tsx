/**
 * 统计排名页 —— 三 Tab（班级排名 / 趋势图 / 明细）+ CSV 导出。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Tab/Table/Select → shadcn Tabs/Table/Select。
 *  - 手写 div 柱状图 → **recharts** 折线图（LineChart，dataKey=totalScore）。
 *  - 字段 snake_case → camelCase（ClassRanking/TrendPoint/RecordWithDetails）。
 *  - CSV 导出：window.open（无法带 cookie）→ api.download（fetch+blob，同源带 cookie）。
 *  - rank 奖牌配色（金/银/铜）。
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { getCurrentWeek, formatTime } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { ClassRanking, TrendPoint, RecordWithDetails, Class, Grade } from '@guga-onduty-w/shared';

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'bg-yellow-500 text-yellow-950';
  if (rank === 2) return 'bg-gray-400 text-gray-900';
  if (rank === 3) return 'bg-amber-700 text-amber-50';
  return 'bg-muted text-muted-foreground';
}

export default function StatisticsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'ranking' | 'trend' | 'detail'>('ranking');
  const [rankings, setRankings] = useState<ClassRanking[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [detail, setDetail] = useState<RecordWithDetails[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [week, setWeek] = useState(getCurrentWeek());
  const [selClass, setSelClass] = useState('');
  const [selGrade, setSelGrade] = useState('');

  useEffect(() => {
    api.get<Class[]>('/classes').then((r) => setClasses(r.data));
    api.get<Grade[]>('/grades').then((r) => setGrades(r.data));
  }, []);

  const loadRanking = useCallback(async () => {
    const r = await api.get<ClassRanking[]>('/statistics/ranking', { week, grade_id: selGrade || undefined });
    setRankings(r.data);
  }, [week, selGrade]);

  const loadDetail = useCallback(async () => {
    const r = await api.get<RecordWithDetails[]>('/records', { week, pageSize: 100 });
    setDetail(r.data);
  }, [week]);

  useEffect(() => {
    if (tab === 'ranking') loadRanking();
  }, [tab, loadRanking]);

  useEffect(() => {
    if (tab === 'trend' && selClass) {
      api.get<TrendPoint[]>('/statistics/trend', { class_id: selClass, weeks: 8 }).then((r) => setTrend(r.data));
    }
  }, [tab, selClass]);

  useEffect(() => {
    if (tab === 'detail') loadDetail();
  }, [tab, loadDetail]);

  async function onExport() {
    try {
      // api.download 只接 path+filename，query 拼进 path（跳过空值）
      const params = new URLSearchParams();
      if (week) { params.set('start_week', week); params.set('end_week', week); }
      const qs = params.toString();
      await api.download(`/statistics/export${qs ? `?${qs}` : ''}`, `records_${week}.csv`);
      toast.success(t('common.success'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  const selClassObj = classes.find((c) => c.id === selClass);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('stats.title')}</h1>
        <div className="flex items-center gap-2">
          <Input className="w-32" value={week} onChange={(e) => setWeek(e.target.value)} />
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-4" />{t('stats.exportCSV')}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="ranking">{t('stats.ranking')}</TabsTrigger>
          <TabsTrigger value="trend">{t('stats.trend')}</TabsTrigger>
          <TabsTrigger value="detail">{t('stats.detail')}</TabsTrigger>
        </TabsList>

        {/* 排名 */}
        <TabsContent value="ranking">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 w-48">
                <Select value={selGrade || '__all__'} onValueChange={(v) => setSelGrade(v === '__all__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder={t('stats.selectGrade')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t('stats.selectGrade')}</SelectItem>
                    {grades.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {rankings.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t('common.noData')}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{t('stats.className')}</TableHead>
                      <TableHead className="text-right">{t('stats.totalScore')}</TableHead>
                      <TableHead className="text-right">{t('stats.positiveCount')}</TableHead>
                      <TableHead className="text-right">{t('stats.negativeCount')}</TableHead>
                      <TableHead className="text-right">{t('stats.recordCount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankings.map((r) => (
                      <TableRow key={r.classId}>
                        <TableCell>
                          <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs font-bold', rankBadgeClass(r.rank))}>{r.rank}</span>
                        </TableCell>
                        <TableCell className="font-medium">{r.gradeName} {r.className}</TableCell>
                        <TableCell className={cn('text-right font-semibold', r.totalScore >= 0 ? 'text-success' : 'text-destructive')}>
                          {r.totalScore >= 0 ? '+' : ''}{r.totalScore}
                        </TableCell>
                        <TableCell className="text-right text-success">{r.positiveCount}</TableCell>
                        <TableCell className="text-right text-destructive">{r.negativeCount}</TableCell>
                        <TableCell className="text-right">{r.recordCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 趋势（recharts 折线图）*/}
        <TabsContent value="trend">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 w-56">
                <Select value={selClass} onValueChange={setSelClass}>
                  <SelectTrigger><SelectValue placeholder={t('stats.selectClass')} /></SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.gradeName} {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {trend.length > 0 ? (
                <div>
                  <div className="mb-3 flex items-center gap-1 font-semibold">
                    <TrendingUp className="size-4" />
                    {selClassObj ? `${selClassObj.gradeName} ${selClassObj.name}` : ''} {t('stats.recentTrend')}
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="week" tickFormatter={(w: string) => w.slice(6)} className="text-xs" fontSize={12} />
                      <YAxis fontSize={12} />
                      <RTooltip
                        formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v}`, t('stats.totalScore')]}
                        contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))' }}
                      />
                      <Line type="monotone" dataKey="totalScore" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">{t('stats.selectClass')}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 明细 */}
        <TabsContent value="detail">
          <Card>
            <CardContent className="pt-6">
              {detail.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t('common.noData')}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('records.class')}</TableHead>
                      <TableHead>{t('records.tag')}</TableHead>
                      <TableHead>{t('records.score')}</TableHead>
                      <TableHead>{t('records.comment')}</TableHead>
                      <TableHead>{t('records.time')}</TableHead>
                      <TableHead>{t('records.recorder')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.gradeName} {r.className}</TableCell>
                        <TableCell>{r.tags.map((tg) => tg.name).join('、') || '--'}</TableCell>
                        <TableCell className={cn('font-semibold', (r.score ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
                          {r.score != null ? `${r.score >= 0 ? '+' : ''}${r.score}` : '--'}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{r.comment || '--'}</TableCell>
                        <TableCell className="text-sm">{formatTime(r.recordedAt).slice(0, 16)}</TableCell>
                        <TableCell className="text-sm">{r.recorderName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
