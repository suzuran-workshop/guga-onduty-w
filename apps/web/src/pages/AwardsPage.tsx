/**
 * 流动红旗页 —— 按周查看 + 一键自动评选颁发。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Card/Input/Button + 内联 style → shadcn + Tailwind。
 *  - POST /awards 去掉硬编码 campus_id（后端从 profile 取 + 自动评选各年级第一名）。
 *  - 字段 snake_case → camelCase（Award：className/gradeName/awardedAt(epoch)）。
 *  - awardedAt 用 formatTime 格式化。
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Award as AwardIcon, Flag } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { getCurrentWeek, formatTime } from '@/lib/week';
import type { Award } from '@guga-onduty-w/shared';

export default function AwardsPage() {
  const { t } = useTranslation();
  const [awards, setAwards] = useState<Award[]>([]);
  const [week, setWeek] = useState(getCurrentWeek());
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    api.get<Award[]>('/awards', { week }).then((r) => setAwards(r.data));
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAward() {
    if (!confirm(t('awards.confirmAward', { week }))) return;
    setLoading(true);
    try {
      await api.post('/awards', { week });
      toast.success(t('awards.awardedOk'));
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
        <h1 className="text-2xl font-semibold">{t('awards.title')}</h1>
        <div className="flex items-center gap-2">
          <Input className="w-32" value={week} onChange={(e) => setWeek(e.target.value)} />
          <Button onClick={handleAward} disabled={loading}>
            <AwardIcon className="size-4" />
            {loading ? t('awards.awarding') : t('awards.awardButton')}
          </Button>
        </div>
      </div>

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
                <div className="text-lg font-bold">{a.gradeName} {a.className}</div>
                <div className="text-sm text-muted-foreground">{a.week} {t('awards.title')}</div>
                {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('awards.awardedAt')}: {formatTime(a.awardedAt).slice(0, 16)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
