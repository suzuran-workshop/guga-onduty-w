import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import {
  tokens, Card, Text, Button, Input, Select, Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell,
  Tab, TabList, Dialog, DialogTrigger, DialogSurface, DialogTitle, DialogBody, DialogActions,
} from '@fluentui/react-components';
import { Add20Regular, Edit20Regular, Delete20Regular } from '@fluentui/react-icons';

type CTab = 'campuses'|'grades'|'classes'|'users'|'groups'|'tags'|'templates';

const TABS: { key: CTab; i18n: string }[] = [
  { key: 'campuses', i18n: 'config.tabs.campuses' }, { key: 'grades', i18n: 'config.tabs.grades' },
  { key: 'classes', i18n: 'config.tabs.classes' }, { key: 'users', i18n: 'config.tabs.users' },
  { key: 'groups', i18n: 'config.tabs.groups' }, { key: 'tags', i18n: 'config.tabs.tags' },
  { key: 'templates', i18n: 'config.tabs.templates' },
];

const COLUMNS: Record<CTab, string[]> = {
  campuses: ['id','name','code'], grades: ['id','name','sort_order'],
  classes: ['id','name','grade_id','class_teacher'], users: ['id','username','display_name','role','campus_name'],
  groups: ['id','name','campus_id'], tags: ['id','name','score','category'], templates: ['id','name','campus_id'],
};

const endpoints: Record<CTab,string> = {
  campuses:'/campuses',grades:'/grades',classes:'/classes',users:'/users',groups:'/groups',tags:'/tags',templates:'/templates',
};

const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: tokens.colorNeutralForeground2, marginBottom: 4, display: 'block' };

export default function ConfigPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CTab>('classes');
  const [data, setData] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string,any>>({});

  const load = () => api.get<{data:any[]}>(endpoints[tab]).then(r => setData(r.data));
  useEffect(() => { load(); }, [tab]);

  const openNew = () => { setEditing(null); setForm({ campus_id: 1 }); setOpen(true); };
  const openEdit = (it: any) => { setEditing(it); setForm({...it}); setOpen(true); };
  const handleDelete = async (id: number) => { if (!confirm(t('config.deleteConfirm'))) return; await api.delete(`${endpoints[tab]}/${id}`); load(); };
  const handleSave = async () => {
    if (editing) await api.put(`${endpoints[tab]}/${editing.id}`, form);
    else await api.post(endpoints[tab], form);
    setOpen(false); load();
  };

  const fields = () => {
    const f = { set: (k: string, v: any) => setForm((p: any) => ({...p, [k]: v})) };
    switch (tab) {
      case 'campuses': return <><div style={{ marginBottom: 14 }}><Text style={labelStyle}>名称</Text><Input value={form.name||''} onChange={e => f.set('name', e.currentTarget.value)} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>代号</Text><Input value={form.code||''} onChange={e => f.set('code', e.currentTarget.value)} /></div></>;
      case 'grades': return <><div style={{ marginBottom: 14 }}><Text style={labelStyle}>名称</Text><Input value={form.name||''} onChange={e => f.set('name', e.currentTarget.value)} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>排序</Text><Input type="number" value={form.sort_order||0} onChange={e => f.set('sort_order', Number(e.currentTarget.value))} /></div></>;
      case 'classes': return <><div style={{ marginBottom: 14 }}><Text style={labelStyle}>名称</Text><Input value={form.name||''} onChange={e => f.set('name', e.currentTarget.value)} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>年级ID</Text><Input type="number" value={form.grade_id||''} onChange={e => f.set('grade_id', Number(e.currentTarget.value))} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>班主任</Text><Input value={form.class_teacher||''} onChange={e => f.set('class_teacher', e.currentTarget.value)} /></div></>;
      case 'users': return <><div style={{ marginBottom: 14 }}><Text style={labelStyle}>用户名</Text><Input value={form.username||''} onChange={e => f.set('username', e.currentTarget.value)} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>显示名</Text><Input value={form.display_name||''} onChange={e => f.set('display_name', e.currentTarget.value)} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>角色</Text><Select value={form.role||'student'} onChange={(_,d) => f.set('role', d.value)}><option value="admin">{t('roles.admin')}</option><option value="teacher">{t('roles.teacher')}</option><option value="student">{t('roles.student')}</option></Select></div></>;
      case 'groups': return <div style={{ marginBottom: 14 }}><Text style={labelStyle}>名称</Text><Input value={form.name||''} onChange={e => f.set('name', e.currentTarget.value)} /></div>;
      case 'tags': return <><div style={{ marginBottom: 14 }}><Text style={labelStyle}>名称</Text><Input value={form.name||''} onChange={e => f.set('name', e.currentTarget.value)} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>分值</Text><Input type="number" value={form.score||0} onChange={e => f.set('score', Number(e.currentTarget.value))} /></div><div style={{ marginBottom: 14 }}><Text style={labelStyle}>分类</Text><Select value={form.category||'negative'} onChange={(_,d) => f.set('category', d.value)}><option value="positive">加分</option><option value="negative">扣分</option><option value="neutral">中性</option></Select></div></>;
      case 'templates': return <div style={{ marginBottom: 14 }}><Text style={labelStyle}>名称</Text><Input value={form.name||''} onChange={e => f.set('name', e.currentTarget.value)} /></div>;
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}><Text size={600} weight="semibold">{t('config.title')}</Text></div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as CTab)} style={{ flex: 1 }}>
          {TABS.map(tb => <Tab key={tb.key} value={tb.key}>{t(tb.i18n)}</Tab>)}
        </TabList>
        <Button size="small" appearance="primary" icon={<Add20Regular />} onClick={openNew}>{t('config.newItem')}</Button>
      </div>

      <Card>
        <Table size="small"><TableHeader><TableRow>
          {COLUMNS[tab].map(c => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}<TableHeaderCell></TableHeaderCell>
        </TableRow></TableHeader><TableBody>
          {data.map(it => <TableRow key={it.id}>
            {COLUMNS[tab].map(c => <TableCell key={c}>{c==='score' ? <span style={{color:it[c]>=0?tokens.colorPaletteGreenForeground1:tokens.colorPaletteRedForeground1,fontWeight:600}}>{it[c]>=0?'+':''}{it[c]}</span> : String(it[c]??'--')}</TableCell>)}
            <TableCell><Button size="small" appearance="subtle" icon={<Edit20Regular />} onClick={() => openEdit(it)}>{t('config.editItem')}</Button>
              <Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={() => handleDelete(it.id)}>{t('common.delete')}</Button></TableCell>
          </TableRow>)}
        </TableBody></Table>
      </Card>

      <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
        <DialogSurface>
          <DialogTitle>{editing ? t('config.editItem') : t('config.newItem')} {t(TABS.find(tb => tb.key === tab)?.i18n || '')}</DialogTitle>
          <DialogBody>{fields()}</DialogBody>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button appearance="primary" onClick={handleSave}>{t('common.save')}</Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>
    </div>
  );
}