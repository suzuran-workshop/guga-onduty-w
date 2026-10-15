/**
 * 每日小结页 —— 新增小结（留空自动生成周排名摘要）+ 周排名表 + 历史小结。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Card/Input/Textarea + 原生 table → shadcn。
 *  - POST /summaries 去掉硬编码 campus_id（后端从 profile 取，修复多校区硬编码 bug）。
 *  - 自动生成摘要 autoSummary：拉 ranking 拼 markdown（保留旧逻辑），字段改 camelCase。
 *  - 历史小结 pre-wrap 展示。
 */
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/api/client';
import { getCurrentWeek } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { DailySummary, ClassRanking } from '@guga-onduty-w/shared';

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'bg-yellow-500 text-yellow-950';
  if (rank === 2) return 'bg-gray-400 text-gray-900';
  if (rank === 3) return 'bg-amber-700 text-amber-50';
  return 'bg-muted text-muted-foreground';
}

export default function SummaryPage() {
  const { t } = useTranslation();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [rankings, setRankings] = useState<ClassRanking[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [week, setWeek] = useState(getCurrentWeek());
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    api.get<DailySummary[]>('/summaries', { week }).then((r) => setSummaries(r.data));
    api.get<ClassRanking[]>('/statistics/ranking', { week }).then((r) => setRankings(r.data));
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  /** 留空时自动生成本周排名摘要（markdown） */
  function autoSummary(): string {
    if (rankings.length === 0) return t('summary.autoContent');
    let txt = `## ${t('summary.weekRanking', { week })}\n\n`;
    for (const r of rankings.slice(0, 5)) {
      txt += `- ${r.gradeName} ${r.className}: ${r.totalScore >= 0 ? '+' : ''}${r.totalScore} (${t('stats.negativeCount')}${r.negativeCount}, ${t('stats.positiveCount')}${r.positiveCount})\n`;
    }
    return txt;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/summaries', { week, date, content: content || autoSummary() });
      toast.success(t('summary.created'));
      setShowForm(false);
      setContent('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('summary.title')}</h1>
        <div className="flex items-center gap-2">
          <Input className="w-32" value={week} onChange={(e) => setWeek(e.target.value)} />
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="size-4" />{showForm ? t('common.close') : t('summary.newSummary')}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('common.week')}</Label>
                  <Input value={week} onChange={(e) => setWeek(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t('summary.date')}</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('summary.content')}</Label>
                <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('summary.autoHint')} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
                <Button type="submit" disabled={loading}>{loading ? t('common.loading') : t('common.submit')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* 周排名 */}
      {rankings.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-3 font-semibold">{t('summary.weekRanking', { week })}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{t('records.class')}</TableHead>
                  <TableHead className="text-right">{t('records.score')}</TableHead>
                  <TableHead className="text-right">{t('stats.positiveCount')}</TableHead>
                  <TableHead className="text-right">{t('stats.negativeCount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankings.map((r, i) => (
                  <TableRow key={r.classId}>
                    <TableCell>
                      <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs font-bold', rankBadgeClass(i + 1))}>{i + 1}</span>
                    </TableCell>
                    <TableCell>{r.gradeName} {r.className}</TableCell>
                    <TableCell className={cn('text-right font-semibold', r.totalScore >= 0 ? 'text-success' : 'text-destructive')}>
                      {r.totalScore >= 0 ? '+' : ''}{r.totalScore}
                    </TableCell>
                    <TableCell className="text-right text-success">{r.positiveCount}</TableCell>
                    <TableCell className="text-right text-destructive">{r.negativeCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 历史小结 */}
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-1 font-semibold">
            <FileText className="size-4" />{t('summary.historySummaries')}
          </div>
          {summaries.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('common.noData')}</div>
          ) : (
            <div className="space-y-3">
              {summaries.map((s) => (
                <div key={s.id} className="rounded-lg bg-muted p-4">
                  <div className="mb-1 text-xs text-muted-foreground">{s.date} | {s.week}</div>
                  <div className="whitespace-pre-wrap text-sm">{s.content}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
