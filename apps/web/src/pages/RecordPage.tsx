import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { tokens, Card, Text, Button, Input, Select, Textarea, Badge, Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell, Spinner, Toast, useToastController } from '@fluentui/react-components';
import { Add20Regular, ArrowUpload20Regular, ChevronLeft20Regular, ChevronRight20Regular } from '@fluentui/react-icons';
import type { Tag, Class } from '@class-duty/shared';

function getCurrentWeek(): string {
  const now = new Date(); const y = new Date(now.getFullYear(), 0, 1);
  return `${now.getFullYear()}-W${String(Math.ceil(((now.getTime() - y.getTime()) / 86400000 + y.getDay() + 1) / 7)).padStart(2, '0')}`;
}

export default function RecordPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { dispatchToast } = useToastController();

  const [records, setRecords] = useState<any[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [classes, setClasses] = useState<(Class & { grade_name: string })[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selClass, setSelClass] = useState(0);
  const [selTag, setSelTag] = useState(0);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [week] = useState(getCurrentWeek());
  const [images, setImages] = useState<File[]>([]);
  const [fWeek, setFWeek] = useState(getCurrentWeek());
  const [fClass, setFClass] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);

  const toast = (msg: string) => dispatchToast(<Toast><Text>{msg}</Text></Toast>, { position: 'bottom-end', intent: 'success' });

  const loadRecords = async () => {
    let q = `/records?page=${page}&pageSize=20&week=${fWeek}`;
    if (fClass) q += `&class_id=${fClass}`;
    try { const r = await api.get<any>(q); setRecords(r.data); setPagination(r.pagination); } catch {}
  };

  useEffect(() => {
    api.get<{ data: Tag[] }>('/tags').then(r => setTags(r.data));
    api.get<{ data: any[] }>('/classes').then(r => setClasses(r.data));
    api.get<{ data: any[] }>('/templates').then(r => setTemplates(r.data));
  }, []);

  useEffect(() => { loadRecords(); }, [page, fWeek, fClass]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selClass || !selTag) { toast('请选择班级和标签'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set('class_id', String(selClass)); fd.set('tag_id', String(selTag));
      fd.set('score', String(score)); fd.set('week', week);
      if (comment) fd.set('comment', comment);
      images.forEach(i => fd.append('images', i));
      await api.post('/records', fd);
      toast(t('common.submit') + ' OK');
      setShowForm(false); setSelTag(0); setScore(0); setComment(''); setImages([]);
      loadRecords();
    } catch (err: any) { toast(err.message); } finally { setLoading(false); }
  };

  const selTagObj = tags.find(tg => tg.id === selTag);

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: tokens.colorNeutralForeground2, marginBottom: 4, display: 'block' };
  const chipBase: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none', border: `1px solid ${tokens.colorNeutralStroke2}`, background: 'transparent', transition: 'all 0.1s' };
  const chipActive: React.CSSProperties = { ...chipBase, borderColor: tokens.colorBrandForeground1, background: tokens.colorBrandBackground2, color: tokens.colorBrandForeground2 };
  const rowFlex: React.CSSProperties = { display: 'flex', gap: 16, marginBottom: 16 };
  const flex1: React.CSSProperties = { flex: 1 };
  const pos: React.CSSProperties = { color: tokens.colorPaletteGreenForeground1, fontWeight: 600 };
  const neg: React.CSSProperties = { color: tokens.colorPaletteRedForeground1, fontWeight: 600 };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Text size={600} weight="semibold">{t('records.title')}</Text>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => setShowForm(!showForm)}>{showForm ? t('common.close') : t('records.newRecord')}</Button>
      </div>

      {templates.length > 0 && <div style={{ marginBottom: 16 }}>
        <Text style={labelStyle}>{t('records.quickTemplate')}</Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {templates.map((tp: any) => (
            <button key={tp.id} style={{ ...chipBase, background: 'none' }} onClick={() => { if (tp.tags?.[0]) { setSelTag(tp.tags[0].id); setScore(tp.tags[0].score); setShowForm(true); } }}>{tp.name}</button>
          ))}
        </div>
      </div>}

      {showForm && <Card style={{ marginBottom: 16 }}>
        <form onSubmit={handleSubmit}>
          <div style={rowFlex}>
            <div style={flex1}><Text style={labelStyle}>{t('records.class')}</Text>
              <Select value={selClass} onChange={(_, d) => setSelClass(Number(d.value))}><option value={0}>{t('records.class')}</option>{classes.map(c => <option key={c.id} value={c.id}>{c.grade_name} {c.name}</option>)}</Select>
            </div>
            <div style={flex1}><Text style={labelStyle}>{t('records.week')}</Text><Input value={week} disabled /></div>
          </div>

          <div style={{ marginBottom: 16 }}><Text style={labelStyle}>{t('records.tag')}</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tags.map(tg => <span key={tg.id} style={selTag === tg.id ? chipActive : chipBase} onClick={() => { setSelTag(tg.id); setScore(tg.score); }}>{tg.name} ({tg.score >= 0 ? '+' : ''}{tg.score})</span>)}
            </div>
          </div>

          {selTagObj && <div style={rowFlex}>
            <div style={flex1}><Text style={labelStyle}>{t('records.score')}</Text><Input type="number" value={String(score)} onChange={e => setScore(Number(e.currentTarget.value))} /></div>
            <div style={flex1}><Text style={labelStyle}>{t('records.tagDefaultScore')}</Text><Input value={`${selTagObj.name}: ${selTagObj.score >= 0 ? '+' : ''}${selTagObj.score}`} disabled /></div>
          </div>}

          <div style={{ marginBottom: 16 }}><Text style={labelStyle}>{t('records.comment')}</Text>
            <Textarea value={comment} onChange={e => setComment(e.currentTarget.value)} placeholder={t('records.commentPlaceholder')} />
          </div>

          <div style={{ marginBottom: 16 }}><Text style={labelStyle}>{t('records.uploadImage')}</Text>
            <label style={{ border: `2px dashed ${tokens.colorNeutralStroke2}`, borderRadius: 8, padding: 20, textAlign: 'center', cursor: 'pointer', display: 'block', fontSize: 13, color: tokens.colorNeutralForeground3 }}>
              <input type="file" accept="image/*" multiple hidden onChange={e => setImages(prev => [...prev, ...Array.from(e.target.files || [])].slice(0, 9))} />
              <ArrowUpload20Regular /><div>{t('records.uploadImage')}</div>
            </label>
            {images.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{images.map((img, i) => <img key={i} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: `1px solid ${tokens.colorNeutralStroke2}` }} src={URL.createObjectURL(img)} alt="" />)}</div>}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button appearance="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button appearance="primary" type="submit" disabled={loading}>{loading ? t('common.loading') : t('common.submit')}</Button>
          </div>
        </form>
      </Card>}

      <Card style={{ marginBottom: 16 }}>
        <div style={rowFlex}>
          <div style={flex1}><Text style={labelStyle}>{t('records.filterByWeek')}</Text><Input value={fWeek} onChange={e => setFWeek(e.currentTarget.value)} /></div>
          <div style={flex1}><Text style={labelStyle}>{t('records.filterByClass')}</Text>
            <Select value={fClass} onChange={(_, d) => setFClass(d.value)}><option value="">{t('common.all')}</option>{classes.map(c => <option key={c.id} value={c.id}>{c.grade_name} {c.name}</option>)}</Select>
          </div>
        </div>
      </Card>

      <Card>
        <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: 12 }}>{t('records.recordList')} ({pagination?.total || 0})</Text>
        {records.length === 0 ? <Text size={200}>{t('common.noData')}</Text> : (
          <Table size="small">
            <TableHeader><TableRow>
              <TableHeaderCell>{t('records.class')}</TableHeaderCell><TableHeaderCell>{t('records.tag')}</TableHeaderCell><TableHeaderCell>{t('records.score')}</TableHeaderCell>
              <TableHeaderCell>{t('records.comment')}</TableHeaderCell><TableHeaderCell>{t('records.week')}</TableHeaderCell><TableHeaderCell>记录人</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell></TableHeaderCell>
            </TableRow></TableHeader>
            <TableBody>{records.map(r => (
              <TableRow key={r.id}>
                <TableCell>{r.grade_name} {r.class_name}</TableCell>
                <TableCell><span style={chipBase}>{r.tag_name || '--'}</span></TableCell>
                <TableCell style={r.score && r.score >= 0 ? pos : neg}>{r.score && r.score >= 0 ? '+' : ''}{r.score ?? '--'}</TableCell>
                <TableCell style={{ fontSize: 13 }}>{r.comment || '--'}</TableCell>
                <TableCell>{r.week}</TableCell>
                <TableCell style={{ fontSize: 13 }}>{r.recorder_name}</TableCell>
                <TableCell style={{ fontSize: 13 }}>{r.recorded_at?.slice(0, 16)}</TableCell>
                <TableCell>
                  {r.status === 'active' && <Badge size="extra-small" color="success" appearance="filled">{t('records.status.normal')}</Badge>}
                  {r.status === 'revoked' && <Badge size="extra-small" color="danger" appearance="filled">{t('records.status.revoked')}</Badge>}
                  {r.status === 'appealing' && <Badge size="extra-small" color="warning">{t('records.status.appealing')}</Badge>}
                  {r.status === 'appeal_approved' && <Badge size="extra-small" color="informative">{t('records.status.approved')}</Badge>}
                </TableCell>
                <TableCell>{r.status === 'active' && <>
                  {user?.role === 'admin' && <Button size="small" appearance="subtle" onClick={async () => { if (confirm(t('records.confirmRevoke'))) { await api.delete(`/records/${r.id}`); loadRecords(); } }}>{t('records.revoke')}</Button>}
                  {user?.role === 'teacher' && <Button size="small" appearance="subtle" onClick={async () => { const re = prompt(t('records.appealReason')); if (!re) return; await api.post(`/records/${r.id}/appeal`, { reason: re }); loadRecords(); }}>{t('records.appeal')}</Button>}
                </>}</TableCell>
              </TableRow>))}
            </TableBody>
          </Table>
        )}
        {pagination?.totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 16 }}>
            <Button size="small" appearance="subtle" icon={<ChevronLeft20Regular />} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('common.back')}</Button>
            <Text size={200}>{page} / {pagination.totalPages}</Text>
            <Button size="small" appearance="subtle" icon={<ChevronRight20Regular />} iconPosition="after" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>--</Button>
          </div>
        )}
      </Card>
    </div>
  );
}