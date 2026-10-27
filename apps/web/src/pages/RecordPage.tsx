/**
 * 值周记录页 —— 多班级平铺多选 + 多标签求和 + 扣分必拍照 + 模板快选 + 筛选/分页/撤回/申诉。
 *
 * 2026-10-23 重写（需求 1）——巡查节奏是「站在走廊给一排班级打同一批分」，旧交互与之错配：
 *  - 班级：Select 单选下拉 → **平铺 chip 网格多选**（含按年级分组、全选/清空、已选计数）。
 *    一次提交给每个班级各落一条**独立**记录（各自 id/status，可独立申诉/撤回）。
 *  - 标签：chip 单选覆盖 → **Set toggle 多选**；分数 = Σ 所选标签分，**只读展示**。
 *    标签分是权威，前端不再传 score（旧代码 `<Input type="number">` 可编辑，等于允许评分模块
 *    自行改分——服务端也已忽略 score，故此处纯展示）。
 *  - 图片：无任何校验 → **含扣分标签则必拍照**（前后端同口径：category==='negative' || score<0）。
 *    前端先拦一道给即时反馈，服务端是最终裁决（防绕过）。
 *  - 模板快选：只取 `tp.tags?.[0]` → **套用模板全部标签**（多选落地后才真正可用）。
 *  - 修复既有 bug：提交成功后未重置已选班级（下一条记录会静默沿用上次选择）；
 *    分页「下一页」按钮文案错用 `common.confirm`（显示成「确认」）。
 *
 * ⚠ 多选零新依赖：仓库无 ui/checkbox、无 components.json（17 个 shadcn 组件是手抄内联的），
 *   故沿用既有 chip button 模式，风格统一。
 */
import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Upload, ChevronLeft, ChevronRight, X, Camera } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { uploadChunked } from '@homurajs/storage/chunk-client';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentWeek, formatTime } from '@/lib/week';
import { cn } from '@/lib/utils';
import type { Tag, Class, Template, RecordWithDetails, Pagination, RecordStatus } from '@guga-onduty-w/shared';

const STATUS_VARIANT: Record<RecordStatus, 'success' | 'secondary' | 'warning'> = {
  active: 'success',
  revoked: 'secondary',
  appealing: 'warning',
};

const MAX_IMAGES = 9;

/** 扣分判定：与 routes/records.ts 同口径（点了扣分标签即须拍照） */
const isDeductionTag = (tg: Tag) => tg.category === 'negative' || tg.score < 0;

export default function RecordPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [records, setRecords] = useState<RecordWithDetails[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // ── 多选状态（Set，toggle 语义）─────────────────────────────────
  const [selClassIds, setSelClassIds] = useState<Set<string>>(new Set());
  const [selTagIds, setSelTagIds] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [week] = useState(getCurrentWeek());
  const [images, setImages] = useState<File[]>([]);

  const [fWeek, setFWeek] = useState(getCurrentWeek());
  const [fClass, setFClass] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      const r = await api.get<RecordWithDetails[]>('/records', { page, pageSize: 20, week: fWeek, class_id: fClass || undefined });
      setRecords(r.data);
      setPagination(r.pagination ?? null);
    } catch {
      /* 错误已由 client 统一处理 */
    }
  }, [page, fWeek, fClass]);

  useEffect(() => {
    api.get<Tag[]>('/tags').then((r) => setTags(r.data));
    api.get<Class[]>('/classes').then((r) => setClasses(r.data));
    api.get<Template[]>('/templates').then((r) => setTemplates(r.data));
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // ── 派生：分数只读求和 + 是否扣分（驱动「必拍照」）─────────────────
  /** 按 tags 数组顺序取选中项（Set 无序，展示要稳定） */
  const selectedTags = useMemo(() => tags.filter((tg) => selTagIds.has(tg.id)), [tags, selTagIds]);
  /** 分数 = Σ 标签分。仅展示用——服务端按 tagIds 重算，前端传值会被忽略 */
  const totalScore = useMemo(() => selectedTags.reduce((acc, tg) => acc + tg.score, 0), [selectedTags]);
  const needPhoto = useMemo(() => selectedTags.some(isDeductionTag), [selectedTags]);
  /** 班级按年级分组（平铺但分组，避免 36 个班一坨） */
  const classesByGrade = useMemo(() => {
    const map = new Map<string, Class[]>();
    for (const c of classes) {
      const key = c.gradeName ?? '';
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return [...map.entries()];
  }, [classes]);

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }
  function toggleClass(id: string) { setSelClassIds((s) => toggle(s, id)); }
  function toggleTag(id: string) { setSelTagIds((s) => toggle(s, id)); }

  /** 模板快选：套用模板的**全部**标签（旧实现只取 tags[0]，多选落地后才有意义） */
  function applyTemplate(tp: Template) {
    const ids = (tp.tagIds ?? tp.tags?.map((x) => x.id) ?? []).filter((id) => tags.some((tg) => tg.id === id));
    if (ids.length === 0) {
      toast.error(t('common.noData'));
      return;
    }
    // 覆盖式套用（模板是「一组预设」，与已选混在一起会让人困惑）
    setSelTagIds(new Set(ids));
    setShowForm(true);
    toast.success(t('records.templateApplied', { name: tp.name, count: ids.length }));
  }

  function resetForm() {
    setSelClassIds(new Set()); // ← 修复既有 bug：旧代码提交后不重置班级，下一条会静默沿用
    setSelTagIds(new Set());
    setComment('');
    setImages([]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // 前端即时校验（服务端是最终裁决，防绕过）
    if (selClassIds.size === 0) { toast.error(t('records.needClass')); return; }
    if (selTagIds.size === 0) { toast.error(t('records.needTag')); return; }
    if (needPhoto && images.length === 0) { toast.error(t('records.needPhoto')); return; }

    setSubmitting(true);
    try {
      // 图片走分块上传（chunk-client → /api/v1/files/{init,chunk,complete}）：
      // 历史为绕开 qw-pages 网关单请求体 ~1MB 上限，该形态已移除（ADR-7）；分块逻辑保留、照常工作。
      const credFetch: typeof fetch = (input, init) => fetch(input, { ...init, credentials: 'include' });
      const objectKeys: string[] = [];
      for (const img of images) {
        const r = await uploadChunked(img, {
          ns: 'records',
          initUrl: '/api/v1/files/init',
          chunkUrl: '/api/v1/files/chunk',
          completeUrl: '/api/v1/files/complete',
          fetchImpl: credFetch,
        });
        objectKeys.push(r.objectKey);
      }

      const fd = new FormData();
      // 多值字段用 append（旧代码 set 单值 → 后端 form.getAll('class_ids') 恒空 → 400）
      for (const cid of selClassIds) fd.append('class_ids', cid);
      for (const tid of selTagIds) fd.append('tag_ids', tid);
      fd.set('week', week);
      if (comment.trim()) fd.set('comment', comment.trim());
      // ⚠ 不再传 score：分数由服务端按 tagIds 求和（标签分权威）
      objectKeys.forEach((k) => fd.append('image_keys', k));

      const r = await api.upload<RecordWithDetails[]>('/records', fd);
      const n = Array.isArray(r.data) ? r.data.length : selClassIds.size;
      toast.success(t('records.createdMany', { count: n }));
      setShowForm(false);
      resetForm();
      loadRecords();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('records.uploadFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm(t('records.confirmRevoke'))) return;
    try {
      await api.delete(`/records/${id}`);
      toast.success(t('records.revokedOk'));
      loadRecords();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function onAppeal(id: string) {
    const reason = prompt(t('records.appealReason'));
    if (!reason) return;
    try {
      await api.post(`/records/${id}/appeal`, { reason });
      toast.success(t('records.appealedOk'));
      loadRecords();
    } catch (err) {
      // 教师未用钉钉登录 → 后端 fail-closed 拒绝，提示改用推送里的免登录链接
      const msg = err instanceof Error ? err.message : t('common.failed');
      toast.error(msg.includes('钉钉') ? `${msg}\n${t('records.appealNeedDingtalk')}` : msg);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('records.title')}</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="size-4" />
          {showForm ? t('common.close') : t('records.newRecord')}
        </Button>
      </div>

      {/* 模板快选：套用模板全部标签 */}
      {templates.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('records.quickTemplate')}</Label>
          <div className="flex flex-wrap gap-2">
            {templates.map((tp) => (
              <Button key={tp.id} variant="outline" size="sm" onClick={() => applyTemplate(tp)}>
                {tp.name}
                {tp.tagIds?.length ? <span className="ml-1 text-xs text-muted-foreground">({tp.tagIds.length})</span> : null}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* 新增表单 */}
      {showForm && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* ① 班级平铺多选 */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>{t('records.classMulti')}</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t('common.selected', { count: selClassIds.size })}
                    </span>
                    <Button
                      type="button" variant="ghost" size="sm"
                      onClick={() => setSelClassIds(new Set(classes.map((c) => c.id)))}
                    >
                      {t('common.selectAll')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelClassIds(new Set())}>
                      {t('common.clearAll')}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t('records.classMultiHint')}</p>
                {classesByGrade.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">{t('common.noData')}</div>
                ) : (
                  <div className="space-y-3">
                    {classesByGrade.map(([gradeName, list]) => (
                      <div key={gradeName} className="space-y-1.5">
                        {gradeName && <div className="text-xs font-medium text-muted-foreground">{gradeName}</div>}
                        <div className="flex flex-wrap gap-2">
                          {list.map((c) => {
                            const on = selClassIds.has(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => toggleClass(c.id)}
                                aria-pressed={on}
                                className={cn(
                                  'rounded-md border px-3 py-1.5 text-sm transition-colors',
                                  on ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                                )}
                              >
                                {c.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ② 标签多选 + 分数只读求和 */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>{t('records.tagMulti')}</Label>
                  {selTagIds.size > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelTagIds(new Set())}>
                      {t('common.clearAll')}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t('records.tagMultiHint')}</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tg) => {
                    const on = selTagIds.has(tg.id);
                    const deduction = isDeductionTag(tg);
                    return (
                      <button
                        key={tg.id}
                        type="button"
                        onClick={() => toggleTag(tg.id)}
                        aria-pressed={on}
                        className={cn(
                          'rounded-md border px-3 py-1 text-sm transition-colors',
                          on ? 'font-medium' : 'hover:bg-accent',
                        )}
                        style={on
                          ? { borderColor: tg.color, backgroundColor: `${tg.color}1a`, color: tg.color }
                          : { color: tg.color }}
                      >
                        {tg.name} ({tg.score >= 0 ? '+' : ''}{tg.score})
                        {deduction && <Camera className="ml-1 inline size-3 opacity-60" />}
                      </button>
                    );
                  })}
                </div>

                {/* 分数：只读展示（不可编辑 = 标签分权威） */}
                <div className="grid gap-4 pt-1 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t('records.score')} · {t('records.scoreAuto')}</Label>
                    <div className={cn(
                      'rounded-md border bg-muted/40 px-3 py-2 text-lg font-semibold tabular-nums',
                      totalScore >= 0 ? 'text-success' : 'text-destructive',
                    )}>
                      {totalScore >= 0 ? '+' : ''}{totalScore}
                    </div>
                    <p className="text-xs text-muted-foreground">{t('records.scoreLocked')}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t('records.week')}</Label>
                    <Input value={week} disabled />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('records.comment')}</Label>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('records.commentPlaceholder')} />
              </div>

              {/* ③ 图片上传（含扣分标签时必填） */}
              <div className="space-y-2">
                <Label>
                  {t('records.uploadImage')} · {t('records.maxImages')}
                  {needPhoto && <span className="ml-2 text-destructive">* {t('records.needPhoto')}</span>}
                </Label>
                {needPhoto && <p className="text-xs text-muted-foreground">{t('records.needPhotoHint')}</p>}
                <label
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-sm text-muted-foreground hover:bg-accent',
                    needPhoto && images.length === 0 && 'border-destructive/60',
                  )}
                >
                  <Upload className="mb-2 size-5" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => setImages((prev) => [...prev, ...Array.from(e.target.files || [])].slice(0, MAX_IMAGES))}
                  />
                  {t('records.uploadImage')}
                </label>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {images.map((img, i) => (
                      <div key={i} className="relative">
                        <img src={URL.createObjectURL(img)} alt="" className="h-[72px] w-[72px] rounded-md border object-cover" />
                        <button
                          type="button"
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {selClassIds.size > 1 ? t('records.createdMany', { count: selClassIds.size }) : ''}
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => { setShowForm(false); resetForm(); }}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={submitting || selClassIds.size === 0 || selTagIds.size === 0 || (needPhoto && images.length === 0)}
                  >
                    {submitting ? t('common.loading') : t('common.submit')}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* 筛选 */}
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('records.filterByWeek')}</Label>
            <Input value={fWeek} onChange={(e) => { setFWeek(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-2">
            <Label>{t('records.filterByClass')}</Label>
            <Select value={fClass} onValueChange={(v) => { setFClass(v === '__all__' ? '' : v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder={t('common.all')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('common.all')}</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.gradeName} {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 列表 */}
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 font-semibold">{t('records.recordList')} ({pagination?.total ?? 0})</div>
          {records.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('common.noData')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('records.class')}</TableHead>
                  <TableHead>{t('records.tag')}</TableHead>
                  <TableHead>{t('records.score')}</TableHead>
                  <TableHead>{t('records.comment')}</TableHead>
                  <TableHead>{t('records.week')}</TableHead>
                  <TableHead>{t('records.recorder')}</TableHead>
                  <TableHead>{t('records.time')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.gradeName} {r.className}</TableCell>
                    <TableCell>
                      {r.tags.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {r.tags.map((tg) => (
                            <span
                              key={tg.id}
                              className="rounded border px-2 py-0.5 text-xs"
                              style={{ color: tg.color ?? undefined }}
                            >
                              {tg.name}
                            </span>
                          ))}
                        </span>
                      ) : (
                        '--'
                      )}
                    </TableCell>
                    <TableCell className={cn('font-semibold', r.score >= 0 ? 'text-success' : 'text-destructive')}>
                      {`${r.score >= 0 ? '+' : ''}${r.score}`}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-sm">{r.comment || '--'}</TableCell>
                    <TableCell>{r.week}</TableCell>
                    <TableCell className="text-sm">{r.recorderName}</TableCell>
                    <TableCell className="text-sm">{formatTime(r.recordedAt).slice(0, 16)}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{t(`records.status.${r.status}`)}</Badge></TableCell>
                    <TableCell>
                      {r.status === 'active' && (
                        <div className="flex gap-1">
                          {profile?.role === 'admin' && (
                            <Button size="sm" variant="ghost" onClick={() => onRevoke(r.id)}>{t('records.revoke')}</Button>
                          )}
                          {profile?.role === 'teacher' && (
                            <Button size="sm" variant="ghost" onClick={() => onAppeal(r.id)}>{t('records.appeal')}</Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {(pagination?.totalPages ?? 0) > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="size-4" />{t('common.prev')}
              </Button>
              <span className="text-sm text-muted-foreground">{page} / {pagination?.totalPages}</span>
              {/* 修复既有 bug：此处原为 common.confirm（「确认」），与「下一页」语义无关 */}
              <Button size="sm" variant="outline" disabled={page >= (pagination?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                {t('common.next')}<ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
