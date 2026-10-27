/**
 * 申诉管理页 —— 状态筛选 + 申诉卡片列表 + admin 批准（**可调整评分**）/ 驳回。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Card/Badge/Select → shadcn。
 *  - 字段 snake_case → camelCase（AppealWithDetails：teacherName/reviewerName/recordInfo/reviewComment/createdAt/reviewedAt）。
 *  - **审批走 records 路由**：POST /records/{recordId}/appeal/approve|reject（用 a.recordId，非 appeal id）。
 *  - RBAC：user.role → profile.role（仅 admin 可审批）。
 *  - 状态 Badge 配色（pending=warning/approved=success/rejected=destructive）。
 *
 * 2026-10-27（需求 3 的「修改而非撤销」落到 UI）：
 *  批准不再是 `prompt()` 填一句话就完事。后端 approve 早就支持 `tag_ids`（按调整后标签集
 *  重算分数、记录回 active 照常计分），但前端从不传它 —— 于是管理员在界面上只能
 *  「原样通过」或「驳回」，**无法表达「教师说得对，把 -1 改成 +2」**。
 *  而教师申诉的典型诉求正是「这次扣分不对」，管理员若认同就必须改分，否则只能违心驳回。
 *  故改为对话框：勾选调整后的标签集，分数只读重算（标签分权威，不可手填），附审批意见。
 *  不改动标签即为「原样通过」；清空标签即「本次不扣分」（score=0，记录仍 active 计入记录数）。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, AlertCircle, Filter, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { formatTime } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { AppealWithDetails, AppealStatus, Tag } from '@guga-onduty-w/shared';

const STATUS_VARIANT: Record<AppealStatus, 'warning' | 'success' | 'destructive'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
};

function StatusIcon({ status }: { status: AppealStatus }) {
  if (status === 'pending') return <AlertCircle className="size-4 text-warning" />;
  if (status === 'approved') return <CheckCircle2 className="size-4 text-success" />;
  return <XCircle className="size-4 text-destructive" />;
}

/** 待批准的申诉（打开调分对话框的上下文） */
interface AdjustTarget {
  appeal: AppealWithDetails;
  /** 该校区全部标签（供勾选）；null = 尚未加载 */
  tags: Tag[] | null;
}

export default function AppealsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [appeals, setAppeals] = useState<AppealWithDetails[]>([]);
  const [filter, setFilter] = useState('');

  // ── 调分对话框状态 ────────────────────────────────────────────────
  const [target, setTarget] = useState<AdjustTarget | null>(null);
  const [selTagIds, setSelTagIds] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  /** 校区标签缓存（admin 可跨校区审批，故按 campusId 分别缓存；用 useRef 才能真正跨渲染留存） */
  const tagCache = useRef(new Map<string, Tag[]>());

  const load = useCallback(() => {
    api.get<AppealWithDetails[]>('/appeals', { status: filter || undefined, pageSize: 50 })
      .then((r) => setAppeals(r.data))
      .catch(() => {});
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  /** 打开调分对话框：预填当前标签集（不改动即「原样通过」），并按记录校区拉可选标签 */
  async function openAdjust(a: AppealWithDetails) {
    const currentIds = (a.recordInfo?.tags ?? []).map((tg) => tg.id);
    setSelTagIds(new Set(currentIds));
    setComment('');
    setTarget({ appeal: a, tags: tagCache.current.get(a.campusId ?? '') ?? null });
    if (a.campusId && !tagCache.current.has(a.campusId)) {
      try {
        // admin 可跨校区审批，故显式带 campus_id（非 admin 会被 resolveCampusId 忽略，但审批本就仅 admin）
        const r = await api.get<Tag[]>('/tags', { campus_id: a.campusId });
        tagCache.current.set(a.campusId, r.data);
        setTarget((prev) => (prev && prev.appeal.id === a.id ? { ...prev, tags: r.data } : prev));
      } catch {
        /* 拉不到标签仍可用：管理员可原样通过或只改意见 */
      }
    }
  }

  function closeAdjust() {
    setTarget(null);
    setSelTagIds(new Set());
    setComment('');
  }

  function toggleTag(id: string) {
    setSelTagIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 调整后分数 = Σ 所选标签分（与后端 sumScore 同口径；只读展示，不可手填） */
  const currentScore = target?.appeal.recordInfo?.score ?? 0;
  // 标签全集未加载完时回退到「申诉自带的当前标签」：初始勾选恰好就是它们，
  // 故加载中也能算出正确分数，不会显示「-1 → +0」这种并未发生的剧变。
  const availableTags = target?.tags ?? target?.appeal.recordInfo?.tags ?? [];
  const selectedTags = availableTags.filter((tg) => selTagIds.has(tg.id));
  const newScore = selectedTags.reduce((acc, tg) => acc + tg.score, 0);
  // 「未改动」必须比**标签集合**而不是比分数：两组不同标签可能同分同数量
  // （如 {-1,+1} 与 {0,0}），按分数比会把真实改动误报成「原样通过」，
  // 让管理员以为自己的调整没生效。
  const originalIds = (target?.appeal.recordInfo?.tags ?? []).map((tg) => tg.id).sort();
  const selectedIds = [...selTagIds].sort();
  const unchanged = originalIds.length === selectedIds.length
    && originalIds.every((id, i) => id === selectedIds[i]);

  async function submitAdjust() {
    if (!target) return;
    const { appeal } = target;
    setBusy(true);
    try {
      await api.post(`/records/${appeal.recordId}/appeal/approve`, {
        review_comment: comment.trim() || null,
        // 始终显式传标签集：空数组是**有意义的**（本次不扣分 → score 0，记录仍 active 计入记录数），
        // 省略则后端保持原集。二者语义不同，故不用「为空就省略」的写法。
        tag_ids: [...selTagIds],
      });
      toast.success(t('appeals.adjust.adjustedOk', {
        score: `${newScore >= 0 ? '+' : ''}${newScore}`,
      }));
      closeAdjust();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function onReject(recordId: string) {
    const commentText = prompt(t('appeals.reviewComment'), t('appeals.rejected')) ?? t('appeals.rejected');
    try {
      await api.post(`/records/${recordId}/appeal/reject`, { review_comment: commentText });
      toast.success(t('appeals.rejectedOk'));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('appeals.title')}</h1>
        <div className="flex w-44 items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <Select value={filter || '__all__'} onValueChange={(v) => setFilter(v === '__all__' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder={t('appeals.allStatus')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('appeals.allStatus')}</SelectItem>
              <SelectItem value="pending">{t('appeals.pending')}</SelectItem>
              <SelectItem value="approved">{t('appeals.approved')}</SelectItem>
              <SelectItem value="rejected">{t('appeals.rejected')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {appeals.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{t('common.noData')}</CardContent></Card>
      ) : (
        appeals.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex items-start justify-between gap-4 pt-6">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <StatusIcon status={a.status} />
                  <span className="font-semibold">
                    {a.recordInfo?.className} · {a.recordInfo?.tags.map((tg) => tg.name).join('、') || '--'}
                  </span>
                  <Badge variant={STATUS_VARIANT[a.status]}>{t(`appeals.${a.status}`)}</Badge>
                </div>

                {a.recordInfo && (
                  <div className="text-sm text-muted-foreground">
                    <span>{t('records.score')}：</span>
                    <span className={cn('font-semibold', (a.recordInfo.score ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
                      {a.recordInfo.score != null ? `${a.recordInfo.score >= 0 ? '+' : ''}${a.recordInfo.score}` : '--'}
                    </span>
                    {a.recordInfo.comment && <span> | {a.recordInfo.comment}</span>}
                    <span className="ml-2">{a.recordInfo.week} | {formatTime(a.recordInfo.recordedAt).slice(0, 16)}</span>
                  </div>
                )}

                <div className="rounded-lg bg-muted p-3">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">{t('appeals.teacher')}：{a.teacherName}</div>
                  <div className="text-sm">{a.reason}</div>
                </div>

                {a.reviewComment && (
                  <div className="rounded-lg bg-primary/10 p-3">
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      {t('appeals.reviewer')}：{a.reviewerName} {a.reviewedAt ? formatTime(a.reviewedAt).slice(0, 16) : ''}
                    </div>
                    <div className="text-sm">{a.reviewComment}</div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">{t('common.submit')} {formatTime(a.createdAt).slice(0, 16)}</div>
              </div>

              {profile?.role === 'admin' && a.status === 'pending' && (
                <div className="flex shrink-0 flex-col gap-2">
                  {/* 批准 = 打开调分对话框（不是 prompt 填一句话） */}
                  <Button size="sm" onClick={() => void openAdjust(a)}>
                    <SlidersHorizontal className="size-4" />{t('appeals.approve')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onReject(a.recordId)}>
                    <XCircle className="size-4" />{t('appeals.reject')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {/* ── 批准并调整评分 ─────────────────────────────────────────── */}
      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) closeAdjust(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('appeals.adjust.title')}</DialogTitle>
            <DialogDescription>{t('appeals.adjust.desc')}</DialogDescription>
          </DialogHeader>

          {target && (
            <div className="space-y-4">
              {/* 当前状态：让管理员看清「从什么改成什么」 */}
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('appeals.adjust.currentTags')}</span>
                  {target.appeal.recordInfo?.tags.length
                    ? target.appeal.recordInfo.tags.map((tg) => (
                      <span key={tg.id} className="rounded border px-1.5 py-0.5 text-xs" style={{ color: tg.color }}>
                        {tg.name} ({tg.score >= 0 ? '+' : ''}{tg.score})
                      </span>
                    ))
                    : <span className="text-xs text-muted-foreground">--</span>}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {t('appeals.adjust.currentScore')}：
                    <b className={cn(currentScore >= 0 ? 'text-success' : 'text-destructive')}>
                      {currentScore >= 0 ? '+' : ''}{currentScore}
                    </b>
                  </span>
                  <span aria-hidden>→</span>
                  <span>
                    {t('appeals.adjust.newScore')}：
                    <b className={cn('text-base', newScore >= 0 ? 'text-success' : 'text-destructive')}>
                      {newScore >= 0 ? '+' : ''}{newScore}
                    </b>
                  </span>
                  {unchanged && <Badge variant="secondary">{t('appeals.adjust.unchanged')}</Badge>}
                </div>
              </div>

              {/* 标签勾选（分数由标签决定，不可手填） */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>{t('records.tagMulti')}</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelTagIds(new Set())}>
                    {t('appeals.adjust.clearTags')}
                  </Button>
                </div>
                {target.tags === null ? (
                  <div className="py-3 text-center text-xs text-muted-foreground">{t('common.loading')}</div>
                ) : target.tags.length === 0 ? (
                  <div className="py-3 text-center text-xs text-muted-foreground">{t('common.noData')}</div>
                ) : (
                  <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                    {target.tags.map((tg) => {
                      const on = selTagIds.has(tg.id);
                      return (
                        <button
                          key={tg.id}
                          type="button"
                          onClick={() => toggleTag(tg.id)}
                          aria-pressed={on}
                          className={cn('rounded-md border px-2.5 py-1 text-xs transition-colors', on ? 'font-medium' : 'hover:bg-accent')}
                          style={on
                            ? { borderColor: tg.color, backgroundColor: `${tg.color}1a`, color: tg.color }
                            : { color: tg.color }}
                        >
                          {tg.name} ({tg.score >= 0 ? '+' : ''}{tg.score})
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t('appeals.adjust.hint')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-comment">{t('appeals.adjust.commentLabel')}</Label>
                <Textarea
                  id="review-comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('appeals.adjust.commentPlaceholder')}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={closeAdjust}>{t('common.cancel')}</Button>
            <Button onClick={() => void submitAdjust()} disabled={busy || !target}>
              <CheckCircle2 className="size-4" />
              {busy ? t('appeals.adjust.submitting') : t('appeals.adjust.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
