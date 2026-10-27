/**
 * 流动红旗页 —— 候选参考 + 管理员人工确认颁发（2026-10-23，需求 3）。
 *
 * 语义变更（与旧版的根本差别）：旧版一个按钮「自动评选各年级最高分班级并直接落库」，
 * 颁发权在系统手里；现在**颁发权归人**——系统只算出每年级第一名作**参考**（GET /candidates，
 * 只读不落库），管理员勾选后显式颁发（POST /awards {class_ids}），且**可改选候选之外的班级**。
 *
 * 迁移要点：
 *  - Award.className/gradeName 是可选字段（repo 可能不 join），故用 classes 表兜底显示名。
 *  - alreadyAwarded 的候选默认不勾选（重复颁同一班同一周会被 UNIQUE 静默忽略，勾选只会误导）。
 *  - 幂等由后端保证（UNIQUE(campusId,classId,week) + onConflictDoNothing），前端重复点安全。
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Award as AwardIcon, Flag, X, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentWeek, formatTime } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { Award, AwardCandidate, Class } from '@guga-onduty-w/shared';

export default function AwardsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [awards, setAwards] = useState<Award[]>([]);
  const [week, setWeek] = useState(getCurrentWeek());
  const [loading, setLoading] = useState(false);

  // ── 候选（参考）与人工勾选 ──────────────────────────────────────
  const [candidates, setCandidates] = useState<AwardCandidate[] | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classes, setClasses] = useState<Class[]>([]);
  /** 「改选其他班级」的待加入项 */
  const [extraClass, setExtraClass] = useState('');

  const load = useCallback(() => {
    api.get<Award[]>('/awards', { week }).then((r) => setAwards(r.data)).catch(() => {});
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // 班级列表用于「改选候选之外的班级」+ 兜底显示名
    api.get<Class[]>('/classes').then((r) => setClasses(r.data)).catch(() => {});
  }, []);

  /** 周次变化时候选与勾选状态作废（候选是「某周的参考」，跨周沿用会颁错周） */
  useEffect(() => {
    setCandidates(null);
    setSelected(new Set());
  }, [week]);

  /** 已颁发的班级集合（该周）——用于禁用重复勾选并兜底显示 */
  const awardedClassIds = new Set(awards.map((a) => a.classId));

  async function loadCandidates() {
    setCandidatesLoading(true);
    try {
      const r = await api.get<AwardCandidate[]>('/awards/candidates', { week });
      setCandidates(r.data);
      // 默认勾选：每年级第一名且该周尚未颁发（管理员可再增删）
      setSelected(new Set(r.data.filter((c) => !c.alreadyAwarded && !awardedClassIds.has(c.classId)).map((c) => c.classId)));
      if (r.data.length === 0) toast.error(t('awards.noCandidates'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setCandidatesLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGrant() {
    const classIds = [...selected];
    if (classIds.length === 0) { toast.error(t('awards.needSelection')); return; }
    if (!confirm(t('awards.confirmAward', { week, count: classIds.length }))) return;
    setLoading(true);
    try {
      const r = await api.post<Award[]>('/awards', { week, class_ids: classIds });
      const n = Array.isArray(r.data) ? r.data.length : classIds.length;
      toast.success(t('awards.awardedCount', { count: n }));
      setSelected(new Set());
      setCandidates(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setLoading(false);
    }
  }

  async function onRemove(id: string) {
    if (!confirm(t('common.delete'))) return;
    try {
      await api.delete(`/awards/${id}`);
      toast.success(t('common.success'));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  /** 显示名兜底：Award.className 可选，缺失时从班级表取 */
  const nameOf = (a: Award) => {
    if (a.className) return `${a.gradeName ?? ''} ${a.className}`.trim();
    const c = classes.find((x) => x.id === a.classId);
    return c ? `${c.gradeName ?? ''} ${c.name}`.trim() : a.classId;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('awards.title')}</h1>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t('common.week')}</Label>
          <Input className="w-32" value={week} onChange={(e) => setWeek(e.target.value)} />
          {isAdmin && candidates === null && (
            <Button variant="outline" onClick={loadCandidates} disabled={candidatesLoading}>
              <Search className="size-4" />
              {candidatesLoading ? t('common.loading') : t('awards.viewCandidates')}
            </Button>
          )}
        </div>
      </div>

      {/* 候选 + 人工颁发（admin only） */}
      {isAdmin && candidates !== null && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{t('awards.candidates')} · {week}</div>
                <p className="text-xs text-muted-foreground">{t('awards.candidatesHint')}</p>
              </div>
              <Badge variant="secondary">{t('common.selected', { count: selected.size })}</Badge>
            </div>

            {candidates.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t('awards.noCandidates')}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t('common.grade')}</TableHead>
                    <TableHead>{t('common.class')}</TableHead>
                    <TableHead className="text-right">{t('awards.rank')}</TableHead>
                    <TableHead className="text-right">{t('awards.totalScore')}</TableHead>
                    <TableHead className="w-24">{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => {
                    const awarded = c.alreadyAwarded || awardedClassIds.has(c.classId);
                    return (
                      <TableRow key={c.classId} className={cn(awarded && 'opacity-60')}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={selected.has(c.classId)}
                            disabled={awarded}
                            onChange={() => toggle(c.classId)}
                            aria-label={c.className}
                          />
                        </TableCell>
                        <TableCell className="text-sm">{c.gradeName}</TableCell>
                        <TableCell className="font-medium">{c.className}</TableCell>
                        <TableCell className="text-right tabular-nums">#{c.rank}</TableCell>
                        <TableCell className={cn('text-right font-semibold tabular-nums', c.totalScore >= 0 ? 'text-success' : 'text-destructive')}>
                          {c.totalScore >= 0 ? '+' : ''}{c.totalScore}
                        </TableCell>
                        <TableCell>
                          {awarded
                            ? <Badge variant="secondary">{t('awards.alreadyAwarded')}</Badge>
                            : <Badge variant="success">{t('awards.awardable')}</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* 改选候选之外的班级：颁发权归人，系统只提供参考 */}
            <div className="space-y-2 border-t pt-4">
              <Label className="text-xs text-muted-foreground">{t('awards.grantHint')}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={extraClass} onValueChange={setExtraClass}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={t('awards.pickOther')} />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={awardedClassIds.has(c.id)}>
                        {c.gradeName} {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!extraClass || selected.has(extraClass)}
                  onClick={() => { toggle(extraClass); setExtraClass(''); }}
                >
                  <Flag className="size-4" />
                  {t('awards.addToSelection')}
                </Button>
                {selected.size > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    <X className="size-4" />{t('common.clearAll')}
                  </Button>
                )}
              </div>
              {/* 已选班级一览（含候选外的手工添加项） */}
              {selected.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  {[...selected].map((id) => {
                    const cand = candidates.find((c) => c.classId === id);
                    const cls = classes.find((c) => c.id === id);
                    const label = cand ? `${cand.gradeName} ${cand.className}` : cls ? `${cls.gradeName} ${cls.name}` : id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggle(id)}
                        className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary"
                        title={t('common.delete')}
                      >
                        <Flag className="size-3" />
                        {label}
                        <X className="size-3 opacity-60" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="secondary" onClick={() => { setCandidates(null); setSelected(new Set()); }}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleGrant} disabled={loading || selected.size === 0}>
                <AwardIcon className="size-4" />
                {loading ? t('awards.awarding') : t('awards.confirmSelected')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 本周已颁发 */}
      {awards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">{t('awards.noRecords')}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {awards.map((a) => (
            <Card key={a.id} className="border-t-4 border-t-primary">
              <CardContent className="flex flex-col items-center gap-2 pt-6 text-center">
                <Flag className="size-8 text-primary" />
                <div className="text-lg font-bold">{nameOf(a)}</div>
                <div className="text-sm text-muted-foreground">{a.week} {t('awards.title')}</div>
                {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('awards.awardedAt')}: {formatTime(a.awardedAt).slice(0, 16)}
                </div>
                {isAdmin && (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => onRemove(a.id)}>
                    <X className="size-3" />{t('common.delete')}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
