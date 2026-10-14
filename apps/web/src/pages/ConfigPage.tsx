/**
 * 配置中心 —— 7 实体配置驱动 CRUD 引擎（校区/年级/班级/用户/小组/标签/模板）。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Tabs/Table/Dialog → shadcn；内联样式 → Tailwind。
 *  - 字段规格化：每实体声明 FieldSpec[]（label i18n key + type + 关联下拉数据源），
 *    替代旧代码手写 switch fields() 和裸列名表头。
 *  - 引用字段用下拉（年级选校区、班级选年级、用户选校区/角色），不再手填 ID。
 *  - campusId 不再硬编码 1（旧 bug）：新建时默认当前 profile 校区，admin 可切。
 *  - 字段 snake_case 请求体（后端契约）+ camelCase 展示。
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { Campus, Grade, Class, UserView } from '@class-duty/shared';

type TabKey = 'campuses' | 'grades' | 'classes' | 'users' | 'groups' | 'tags' | 'templates';

const TAB_KEYS: TabKey[] = ['campuses', 'grades', 'classes', 'users', 'groups', 'tags', 'templates'];
const ENDPOINTS: Record<TabKey, string> = {
  campuses: '/campuses', grades: '/grades', classes: '/classes', users: '/users',
  groups: '/groups', tags: '/tags', templates: '/templates',
};

/** 字段规格：驱动表单渲染与请求体构造 */
interface FieldSpec {
  key: string;              // 请求体字段名（snake_case，对齐后端契约）
  labelKey: string;         // i18n key
  type: 'text' | 'number' | 'textarea' | 'select';
  options?: { value: string; labelKey?: string; label?: string }[];
  refSource?: 'campuses' | 'grades' | 'classes' | 'users'; // 关联下拉数据源
  required?: boolean;
  createOnly?: boolean;     // 仅新建时可编辑（如 username）
}

const FIELDS: Record<TabKey, FieldSpec[]> = {
  campuses: [
    { key: 'name', labelKey: 'common.name', type: 'text', required: true },
    { key: 'code', labelKey: 'config.code', type: 'text', required: true },
  ],
  grades: [
    { key: 'campus_id', labelKey: 'common.campus', type: 'select', refSource: 'campuses', required: true },
    { key: 'name', labelKey: 'common.name', type: 'text', required: true },
    { key: 'sort_order', labelKey: 'config.sortOrder', type: 'number' },
  ],
  classes: [
    { key: 'campus_id', labelKey: 'common.campus', type: 'select', refSource: 'campuses', required: true },
    { key: 'grade_id', labelKey: 'common.grade', type: 'select', refSource: 'grades', required: true },
    { key: 'name', labelKey: 'common.name', type: 'text', required: true },
    { key: 'class_teacher', labelKey: 'config.classTeacher', type: 'text' },
  ],
  users: [
    { key: 'campus_id', labelKey: 'common.campus', type: 'select', refSource: 'campuses', required: true },
    { key: 'username', labelKey: 'auth.username', type: 'text', required: true, createOnly: true },
    { key: 'password', labelKey: 'auth.password', type: 'text', createOnly: true },
    { key: 'display_name', labelKey: 'config.displayName', type: 'text', required: true },
    { key: 'role', labelKey: 'config.role', type: 'select', required: true, options: [
      { value: 'admin', labelKey: 'roles.admin' }, { value: 'teacher', labelKey: 'roles.teacher' }, { value: 'student', labelKey: 'roles.student' },
    ] },
  ],
  groups: [
    { key: 'campus_id', labelKey: 'common.campus', type: 'select', refSource: 'campuses', required: true },
    { key: 'name', labelKey: 'common.name', type: 'text', required: true },
  ],
  tags: [
    { key: 'campus_id', labelKey: 'common.campus', type: 'select', refSource: 'campuses', required: true },
    { key: 'name', labelKey: 'common.name', type: 'text', required: true },
    { key: 'score', labelKey: 'config.score', type: 'number', required: true },
    { key: 'color', labelKey: 'config.color', type: 'text' },
    { key: 'category', labelKey: 'config.category', type: 'select', options: [
      { value: 'positive', label: '加分' }, { value: 'negative', label: '扣分' }, { value: 'neutral', label: '中性' },
    ] },
  ],
  templates: [
    { key: 'campus_id', labelKey: 'common.campus', type: 'select', refSource: 'campuses', required: true },
    { key: 'name', labelKey: 'common.name', type: 'text', required: true },
  ],
};

/** 表格展示列（camelCase 领域字段 → 表头 i18n） */
const COLUMNS: Record<TabKey, { key: string; labelKey: string }[]> = {
  campuses: [{ key: 'name', labelKey: 'common.name' }, { key: 'code', labelKey: 'config.code' }],
  grades: [{ key: 'name', labelKey: 'common.name' }, { key: 'sortOrder', labelKey: 'config.sortOrder' }, { key: 'campusName', labelKey: 'common.campus' }],
  classes: [{ key: 'name', labelKey: 'common.name' }, { key: 'gradeName', labelKey: 'common.grade' }, { key: 'classTeacher', labelKey: 'config.classTeacher' }],
  users: [{ key: 'username', labelKey: 'auth.username' }, { key: 'displayName', labelKey: 'config.displayName' }, { key: 'role', labelKey: 'config.role' }, { key: 'campusName', labelKey: 'common.campus' }],
  groups: [{ key: 'name', labelKey: 'common.name' }],
  tags: [{ key: 'name', labelKey: 'common.name' }, { key: 'score', labelKey: 'config.score' }, { key: 'category', labelKey: 'config.category' }],
  templates: [{ key: 'name', labelKey: 'common.name' }],
};

export default function ConfigPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [tab, setTab] = useState<TabKey>('classes');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  // 关联下拉数据源（campuses/grades/classes/users 供其他实体的 select 用）
  const [refData, setRefData] = useState<{ campuses: Campus[]; grades: Grade[]; classes: Class[]; users: UserView[] }>({
    campuses: [], grades: [], classes: [], users: [],
  });

  const loadRefs = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([api.get<Campus[]>('/campuses'), api.get<Grade[]>('/grades')]);
      setRefData((p) => ({ ...p, campuses: c.data, grades: g.data }));
    } catch { /* 忽略 */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get<any[]>(ENDPOINTS[tab]);
      setRows(r.data);
    } catch { /* 忽略 */ }
  }, [tab]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    // 默认当前用户校区（修复旧代码硬编码 campus_id:1）
    setForm({ campus_id: profile?.campusId ?? '', role: 'student', category: 'negative', sort_order: 0, score: 0 });
    setOpen(true);
  }
  function openEdit(it: any) {
    setEditing(it);
    // camelCase 领域对象 → snake_case 表单（请求体契约）
    setForm({
      name: it.name, code: it.code, sort_order: it.sortOrder, campus_id: it.campusId,
      grade_id: it.gradeId, class_teacher: it.classTeacher, username: it.username,
      display_name: it.displayName, role: it.role, score: it.score, color: it.color,
      category: it.category,
    });
    setOpen(true);
  }
  const setField = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  async function handleSave() {
    try {
      // 只提交当前实体声明的字段（去掉无关键）
      const payload: Record<string, any> = {};
      for (const f of FIELDS[tab]) {
        if (editing && f.createOnly) continue; // 编辑不改 username/password
        if (form[f.key] !== undefined && form[f.key] !== '') payload[f.key] = form[f.key];
      }
      if (editing) {
        await api.put(`${ENDPOINTS[tab]}/${editing.id}`, payload);
        toast.success(t('config.updatedOk'));
      } else {
        await api.post(ENDPOINTS[tab], payload);
        toast.success(t('config.createdOk'));
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('config.deleteConfirm'))) return;
    try {
      await api.delete(`${ENDPOINTS[tab]}/${id}`);
      toast.success(t('config.deletedOk'));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  // 关联下拉选项渲染
  function refOptions(source: FieldSpec['refSource']) {
    if (source === 'campuses') return refData.campuses.map((c) => ({ value: c.id, label: c.name }));
    if (source === 'grades') return refData.grades.map((g) => ({ value: g.id, label: g.name }));
    return [];
  }

  function renderField(f: FieldSpec) {
    const disabled = !!editing && f.createOnly;
    const val = form[f.key] ?? '';
    if (f.type === 'select') {
      const opts = f.refSource ? refOptions(f.refSource) : (f.options ?? []).map((o) => ({ value: o.value, label: o.labelKey ? t(o.labelKey) : o.label! }));
      return (
        <Select value={String(val)} onValueChange={(v) => setField(f.key, f.refSource ? v : v)} disabled={disabled}>
          <SelectTrigger><SelectValue placeholder={t(f.labelKey)} /></SelectTrigger>
          <SelectContent>
            {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (f.type === 'number') {
      return <Input type="number" value={String(val)} disabled={disabled} onChange={(e) => setField(f.key, Number(e.target.value))} />;
    }
    if (f.type === 'textarea') {
      return <Textarea value={String(val)} disabled={disabled} onChange={(e) => setField(f.key, e.target.value)} />;
    }
    return <Input type={f.key === 'password' ? 'password' : 'text'} value={String(val)} disabled={disabled} onChange={(e) => setField(f.key, e.target.value)} />;
  }

  const columns = COLUMNS[tab];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('config.title')}</h1>

      <div className="flex items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            {TAB_KEYS.map((k) => (
              <TabsTrigger key={k} value={k}>{t(`config.tabs.${k}`)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={openNew}><Plus className="size-4" />{t('config.newItem')}</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c.key}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((it) => (
                <TableRow key={it.id}>
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      {c.key === 'score' ? (
                        <span className={cn('font-semibold', (it.score ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
                          {it.score >= 0 ? '+' : ''}{it.score}
                        </span>
                      ) : c.key === 'role' ? (
                        <Badge variant="secondary">{t(`roles.${it.role}`)}</Badge>
                      ) : c.key === 'category' ? (
                        <Badge variant={it.category === 'positive' ? 'success' : it.category === 'negative' ? 'destructive' : 'secondary'}>
                          {it.category === 'positive' ? '加分' : it.category === 'negative' ? '扣分' : '中性'}
                        </Badge>
                      ) : (
                        String(it[c.key] ?? '--')
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(it)}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(it.id)}><Trash2 className="size-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={columns.length + 1} className="py-8 text-center text-muted-foreground">{t('common.noData')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t('config.editItem') : t('config.newItem')} · {t(`config.tabs.${tab}`)}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('config.title')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {FIELDS[tab].map((f) => (
              <div key={f.key} className="space-y-2">
                <Label>{t(f.labelKey)}{f.required && <span className="text-destructive"> *</span>}</Label>
                {renderField(f)}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
