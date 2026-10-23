/**
 * 值周记录页 —— 新增记录（图片上传）+ 模板快选 + 筛选 + 分页列表 + 撤回/申诉。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Card/Table/Select/Toast → shadcn + sonner。
 *  - 数据字段 snake_case → camelCase 领域类型（RecordWithDetails）；recordedAt 是 epoch。
 *  - 图片上传：FormData → api.upload；缩略图/回显走 fileUrl(objectKey)（修复旧代码图片死数据）。
 *  - RBAC：user.role → profile.role。
 *  - 修复旧分页「下一页」按钮 label 缺失（`--`）bug。
 */
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Upload, ChevronLeft, ChevronRight, X } from 'lucide-react';
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

export default function RecordPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [records, setRecords] = useState<RecordWithDetails[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selClass, setSelClass] = useState('');
  const [selTag, setSelTag] = useState('');
  const [score, setScore] = useState(0);
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

  const selTagObj = tags.find((tg) => tg.id === selTag);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selClass) {
      toast.error(t('records.selectClassAndTag'));
      return;
    }
    setSubmitting(true);
    try {
      // 图片走分块上传（chunk-client → /api/v1/files/{init,chunk,complete}）：
      // 历史为绕开 qw-pages 网关单请求体 ~1MB 上限，该形态已移除（ADR-7）；分块逻辑保留、照常工作。
      // 每张图切成 ≤384KB 的块逐块 PUT，服务端 base64 分块落库（DB 后端，持久）。
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
      fd.set('class_id', selClass);
      if (selTag) fd.set('tag_id', selTag);
      fd.set('score', String(score));
      fd.set('week', week);
      if (comment) fd.set('comment', comment);
      objectKeys.forEach((k) => fd.append('image_keys', k));
      await api.upload('/records', fd);
      toast.success(t('records.created'));
      setShowForm(false);
      setSelTag('');
      setScore(0);
      setComment('');
      setImages([]);
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
      toast.error(err instanceof Error ? err.message : t('common.failed'));
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

      {/* 模板快选 */}
      {templates.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t('records.quickTemplate')}</Label>
          <div className="flex flex-wrap gap-2">
            {templates.map((tp) => (
              <Button
                key={tp.id}
                variant="outline"
                size="sm"
                onClick={() => {
                  const first = tp.tags?.[0];
                  if (first) {
                    setSelTag(first.id);
                    setScore(first.score);
                    setShowForm(true);
                  }
                }}
              >
                {tp.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* 新增表单 */}
      {showForm && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('records.class')}</Label>
                  <Select value={selClass} onValueChange={setSelClass}>
                    <SelectTrigger><SelectValue placeholder={t('records.class')} /></SelectTrigger>
                    <SelectContent>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.gradeName} {c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('records.week')}</Label>
                  <Input value={week} disabled />
                </div>
              </div>

              {/* 标签 chip */}
              <div className="space-y-2">
                <Label>{t('records.tag')}</Label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tg) => (
                    <button
                      key={tg.id}
                      type="button"
                      onClick={() => { setSelTag(tg.id); setScore(tg.score); }}
                      className={cn(
                        'rounded-md border px-3 py-1 text-sm transition-colors',
                        selTag === tg.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent',
                      )}
                      style={selTag === tg.id ? { borderColor: tg.color } : { color: tg.color }}
                    >
                      {tg.name} ({tg.score >= 0 ? '+' : ''}{tg.score})
                    </button>
                  ))}
                </div>
              </div>

              {selTagObj && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t('records.score')}</Label>
                    <Input type="number" value={String(score)} onChange={(e) => setScore(Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('records.tagDefaultScore')}</Label>
                    <Input value={`${selTagObj.name}: ${selTagObj.score >= 0 ? '+' : ''}${selTagObj.score}`} disabled />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('records.comment')}</Label>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('records.commentPlaceholder')} />
              </div>

              {/* 图片上传 */}
              <div className="space-y-2">
                <Label>{t('records.uploadImage')} · {t('records.maxImages')}</Label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-sm text-muted-foreground hover:bg-accent">
                  <Upload className="mb-2 size-5" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => setImages((prev) => [...prev, ...Array.from(e.target.files || [])].slice(0, 9))}
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

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
                <Button type="submit" disabled={submitting}>{submitting ? t('common.loading') : t('common.submit')}</Button>
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
                <ChevronLeft className="size-4" />{t('common.back')}
              </Button>
              <span className="text-sm text-muted-foreground">{page} / {pagination?.totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= (pagination?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
                {t('common.confirm')}<ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
