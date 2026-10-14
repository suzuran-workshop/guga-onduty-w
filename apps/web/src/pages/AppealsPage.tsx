/**
 * 申诉管理页 —— 状态筛选 + 申诉卡片列表 + admin 批准/驳回。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Card/Badge/Select → shadcn。
 *  - 字段 snake_case → camelCase（AppealWithDetails：teacherName/reviewerName/recordInfo/reviewComment/createdAt/reviewedAt）。
 *  - **审批走 records 路由**：POST /records/{recordId}/appeal/approve|reject（用 a.recordId，非 appeal id）。
 *  - RBAC：user.role → profile.role（仅 admin 可审批）。
 *  - 状态 Badge 配色（pending=warning/approved=success/rejected=destructive）。
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, AlertCircle, Filter } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { formatTime } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { AppealWithDetails, AppealStatus } from '@class-duty/shared';

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

export default function AppealsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [appeals, setAppeals] = useState<AppealWithDetails[]>([]);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    api.get<AppealWithDetails[]>('/appeals', { status: filter || undefined, pageSize: 50 }).then((r) => setAppeals(r.data));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function onApprove(recordId: string) {
    const comment = prompt(t('appeals.reviewComment'), t('appeals.approved')) ?? t('appeals.approved');
    try {
      await api.post(`/records/${recordId}/appeal/approve`, { review_comment: comment });
      toast.success(t('appeals.approvedOk'));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function onReject(recordId: string) {
    const comment = prompt(t('appeals.reviewComment'), t('appeals.rejected')) ?? t('appeals.rejected');
    try {
      await api.post(`/records/${recordId}/appeal/reject`, { review_comment: comment });
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
                    {a.recordInfo?.className} · {a.recordInfo?.tagName || '--'}
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
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => onApprove(a.recordId)}>
                    <CheckCircle2 className="size-4" />{t('appeals.approve')}
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
    </div>
  );
}
