/**
 * 免登录申诉页（2026-10-23，需求 4）—— 教师从钉钉推送点链接直达，不进系统、不用账密。
 *
 * 为什么存在：需求 4 的前提是「教师不需要专门进入系统」。她在班级里收到扣分推送，
 * 点开链接就该能填理由提交。若这条路要求登录，等于把「不进系统」的前提自己推翻。
 *
 * 路由位置：`/appeal/:token`，与 `/bigscreen` 平级挂在 ProtectedRoute **之外**（见 App.tsx）。
 * 数据源：`publicApi`（`/api/public/appeal/:token`），同样在 `/api/v1/*` 登录闸门之外。
 *
 * 状态机：后端用 **200 + tokenState** 表达全部业务态（而非 404/410）——「过期」「已使用」
 * 是正常结局不是异常。故本页把 tokenState 直接映射成 `appeals.public.state.<state>` 文案，
 * 每种失效原因都有可自助排障的说明（避免笼统的「链接失效」让人不知所措）。
 */
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Building2, CheckCircle2, Camera, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ApiClientError, publicApi } from '@/api/client';
import { cn } from '@/lib/utils';
import type { AppealTokenPeek, AppealTokenState, PublicAppealRecord } from '@guga-onduty-w/shared';

/** 与后端 MAX_REASON_LENGTH 同值（前端先拦一道给即时反馈，服务端是最终裁决） */
const MAX_REASON = 2000;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'blocked'; state: AppealTokenState; record?: PublicAppealRecord }
  | { kind: 'ready'; record: PublicAppealRecord }
  | { kind: 'done' };

export default function PublicAppealPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams<{ token: string }>();

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** 后端返回的业务错误码/消息（提交失败时显示，比笼统文案可操作） */
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const peek: AppealTokenPeek = await publicApi.peekAppeal(token);
      if (peek.tokenState === 'ok' && peek.record) {
        setPhase({ kind: 'ready', record: peek.record });
      } else {
        setPhase({ kind: 'blocked', state: peek.tokenState, record: peek.record });
      }
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof ApiClientError ? err.message : t('appeals.public.loadFailed'),
      });
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = reason.trim();
    if (!text) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await publicApi.submitAppeal(token, text);
      setPhase({ kind: 'done' });
    } catch (err) {
      // 提交失败不烧令牌（后端语义）：教师改一改理由还能再交，故留在表单页并显示原因
      setSubmitError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── 提交成功 ─────────────────────────────────────────────────────
  if (phase.kind === 'done') {
    return (
      <Shell>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="size-6 text-success" />
            </div>
            <CardTitle className="text-xl">{t('appeals.public.submitted')}</CardTitle>
            <CardDescription>{t('appeals.public.submittedHint')}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            {t('appeals.public.backToDingtalk')}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── 加载中 ───────────────────────────────────────────────────────
  if (phase.kind === 'loading') {
    return (
      <Shell>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            {t('common.loading')}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── 网络/服务端错误（可重试）──────────────────────────────────────
  if (phase.kind === 'error') {
    return (
      <Shell>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="size-6 text-destructive" />
            </div>
            <CardTitle className="text-xl">{t('appeals.public.loadFailed')}</CardTitle>
            <CardDescription>{phase.message}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="size-4" />
              {t('appeals.public.retry')}
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ── 令牌不可用（过期/已用/换绑…）：按 state 给精确说明 ───────────────
  if (phase.kind === 'blocked') {
    const st = phase.state;
    // i18n 的 state.* 子键与 AppealTokenState 一一对应（'ok' 不会走到这里）
    const titleKey = `appeals.public.state.${st}`;
    const hintKey = `appeals.public.state.${st}_hint`;
    return (
      <Shell>
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-warning/10">
              <AlertTriangle className="size-6 text-warning" />
            </div>
            <CardTitle className="text-xl">{t(titleKey)}</CardTitle>
            <CardDescription>{t(hintKey)}</CardDescription>
          </CardHeader>
          {/* 有记录详情就顺带展示：教师至少能看到被申诉的是哪条，不必回钉钉翻消息 */}
          {/* 不传 token：链接失效后只给摘要，照片（证据材料）不再提供 */}
          {phase.record && <RecordCard record={phase.record} />}
        </Card>
      </Shell>
    );
  }

  // ── 可申诉：展示记录 + 理由表单 ───────────────────────────────────
  const record = phase.record;
  const tooLong = reason.length > MAX_REASON;
  return (
    <Shell>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="size-6 text-primary" />
          </div>
          <CardTitle className="text-xl">{t('appeals.public.title')}</CardTitle>
          <CardDescription>{t('appeals.public.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <RecordCard record={record} token={token} />

          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reason">{t('appeals.public.reasonLabel')}</Label>
              <Textarea
                id="reason"
                rows={5}
                value={reason}
                onChange={(e) => { setReason(e.target.value); setSubmitError(null); }}
                placeholder={t('appeals.public.reasonPlaceholder')}
                maxLength={MAX_REASON}
                required
              />
              <div className="flex items-start justify-between gap-2">
                {/* 提交失败的原因（令牌未被烧，改改理由还能再交）；与字数统计分列两端，不混在一行 */}
                <span className="flex-1 text-xs text-destructive">{submitError ?? ''}</span>
                <span className={cn('shrink-0 text-xs tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
                  {reason.length}/{MAX_REASON}
                </span>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !reason.trim() || tooLong}>
              {submitting ? t('appeals.public.submitting') : t('appeals.public.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

/** 页面外壳：与 LoginPage 同风格（居中卡片 + muted 背景）。移动端优先——教师在手机上打开 */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-muted p-4">{children}</div>;
}

/**
 * 被申诉记录的只读摘要（扣分标签、分数、说明、现场照片）。
 * token 用于拼令牌作用域的图片 URL（见 publicApi.appealImageUrl：/files/* 需登录，公开页用不了）。
 */
function RecordCard({ record, token }: { record: PublicAppealRecord; token?: string }) {
  const { t } = useTranslation();
  // 图片按**序号**取（0..imageCount-1），不持有 objectKey —— 越权面为零
  const imageIndexes = token ? Array.from({ length: record.imageCount }, (_, i) => i) : [];
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('appeals.public.recordInfo')}</span>
        <Badge variant={record.score >= 0 ? 'success' : 'destructive'}>
          {t('appeals.public.score')} {record.score >= 0 ? '+' : ''}{record.score}
        </Badge>
      </div>
      <dl className="space-y-1.5">
        <Row label={t('appeals.public.className')} value={record.className} />
        <Row label={t('appeals.public.week')} value={record.week} />
        {record.tags.length > 0 && (
          <div className="flex items-start gap-2">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">{t('appeals.public.tags')}</dt>
            <dd className="flex flex-wrap gap-1">
              {record.tags.map((tg) => (
                <span
                  key={tg.name}
                  className="rounded border px-1.5 py-0.5 text-xs"
                  style={{ color: tg.color }}
                >
                  {tg.name} ({tg.score >= 0 ? '+' : ''}{tg.score})
                </span>
              ))}
            </dd>
          </div>
        )}
        {record.comment && <Row label={t('appeals.public.comment')} value={record.comment} />}
      </dl>
      {record.imageCount > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Camera className="size-3" />
            {t('appeals.public.photos')} · {t('appeals.public.photosCount', { count: record.imageCount })}
          </div>
          <div className="flex flex-wrap gap-2">
            {imageIndexes.map((i) => {
              const url = publicApi.appealImageUrl(token!, i);
              return (
                <a key={i} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" className="h-16 w-16 rounded-md border object-cover" loading="lazy" />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex-1 break-words">{value}</dd>
    </div>
  );
}
