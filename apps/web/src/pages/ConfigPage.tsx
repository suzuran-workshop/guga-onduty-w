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
import type { Campus, Grade, Class, UserView, DingtalkContact } from '@guga-onduty-w/shared';

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
  refSource?: 'campuses' | 'grades' | 'classes' | 'users' | 'dingtalkContacts'; // 关联下拉数据源
  required?: boolean;
  createOnly?: boolean;     // 仅新建时可编辑（如 username）
  /**
   * 可置空字段（如班主任绑定）：留空时**显式提交 null** 而不是跳过。
   * handleSave 默认跳过空串（避免把未填字段写成空），但这让「解绑」无法表达——
   * 教师离职后若不置空，扣分推送会持续发给错的人。故可空字段走 null 分支。
   */
  nullable?: boolean;
  /** 字段下方的提示文案（i18n key） */
  hintKey?: string;
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
    /**
     * 班主任的**钉钉 userid**（权威绑定，2026-10-23 需求 4）。
     * 与 class_teacher 的分工：class_teacher 是自由文本展示名，此字段才决定
     * 「扣分推送发给谁」「谁能对这个班申诉」。故必须从通讯录下拉选（钉钉 userid
     * 形如 `5314054424-444663015`，手填必错；且后端 assertTeacherBinding 会校验
     * 该 userid 存在于本地通讯录表）。
     * nullable：教师离职后必须能解绑，否则推送会持续发给错的人。
     */
    { key: 'teacher_dingtalk_id', labelKey: 'config.teacherDingtalk', type: 'select', refSource: 'dingtalkContacts', nullable: true, hintKey: 'config.teacherDingtalkHint' },
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
  classes: [{ key: 'name', labelKey: 'common.name' }, { key: 'gradeName', labelKey: 'common.grade' }, { key: 'classTeacher', labelKey: 'config.classTeacher' }, { key: 'teacherDingtalkId', labelKey: 'config.teacherDingtalk' }],
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

  // 关联下拉数据源（campuses/grades/contacts 供其他实体的 select 用）
  const [refData, setRefData] = useState<{
    campuses: Campus[]; grades: Grade[]; classes: Class[]; users: UserView[]; contacts: DingtalkContact[];
  }>({ campuses: [], grades: [], classes: [], users: [], contacts: [] });

  const loadRefs = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([api.get<Campus[]>('/campuses'), api.get<Grade[]>('/grades')]);
      setRefData((p) => ({ ...p, campuses: c.data, grades: g.data }));
    } catch { /* 忽略 */ }
    // 通讯录单独取：它是钉钉管理面端点（/dingtalk/contacts），未同步时为空数组，
    // 不能因为它的失败连带让校区/年级下拉也空掉（班主任绑定是可选增强，不是前置依赖）
    try {
      const ct = await api.get<DingtalkContact[]>('/dingtalk/contacts', { limit: 500 });
      setRefData((p) => ({ ...p, contacts: ct.data }));
    } catch { /* 未同步通讯录/无权限：下拉为空，字段旁给提示 */ }
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
      // 班主任钉钉绑定必须回填：不填的话编辑弹窗里显示「未绑定」，
      // 管理员改个班名保存就会把绑定静默清掉（推送随即失效且无人察觉）
      teacher_dingtalk_id: it.teacherDingtalkId ?? '',
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
        const v = form[f.key];
        if (v === undefined) continue;
        // 默认跳过空串（未填的字段不该写成空值）；但 nullable 字段必须显式提交 null，
        // 否则「解绑班主任」永远表达不出来——教师离职后推送会继续发给错的人。
        if (v === '') {
          if (f.nullable) payload[f.key] = null;
          continue;
        }
        payload[f.key] = v;
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
    if (source === 'dingtalkContacts') {
      // value 必须是**钉钉 userid**（后端 assertTeacherBinding 校验它存在于通讯录表）。
      // label 带部门名消歧：组织里重名很常见（两个「李老师」），而 userid 形如
      // `5314054424-444663015` 对人不可读，只显示姓名的话管理员无法判断该选谁——
      // 选错人的后果是扣分推送发给别的班主任，且本人无从察觉。
      return refData.contacts.map((ct) => {
        const dept = ct.deptNames?.filter(Boolean).join(' / ');
        const title = ct.title ? ` · ${ct.title}` : '';
        return { value: ct.userId, label: dept ? `${ct.name}（${dept}${title}）` : `${ct.name}${title}` };
      });
    }
    return [];
  }

  function renderField(f: FieldSpec) {
    const disabled = !!editing && f.createOnly;
    const val = form[f.key] ?? '';
    if (f.type === 'select') {
      const opts = f.refSource ? refOptions(f.refSource) : (f.options ?? []).map((o) => ({ value: o.value, label: o.labelKey ? t(o.labelKey) : o.label! }));
      // Radix Select 不接受空字符串 value，可空字段用哨兵表达「未绑定」
      const NONE = '__none__';
      const select = (
        <Select
          value={f.nullable && !val ? NONE : String(val)}
          onValueChange={(v) => setField(f.key, f.nullable && v === NONE ? '' : v)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={f.nullable && !val ? t('config.unbound') : t(f.labelKey)} />
          </SelectTrigger>
          <SelectContent>
            {f.nullable && <SelectItem value={NONE}>{t('config.unbound')}</SelectItem>}
            {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            {/* 通讯录为空时给可操作的指引，否则管理员只看到一个空下拉，不知该去哪配 */}
            {f.refSource === 'dingtalkContacts' && opts.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('config.noContacts')}</div>
            )}
          </SelectContent>
        </Select>
      );
      return f.hintKey ? (
        <div className="space-y-1">
          {select}
          <p className="text-xs text-muted-foreground">{t(f.hintKey)}</p>
        </div>
      ) : select;
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
                      ) : c.key === 'teacherDingtalkId' ? (
                        // 存的是钉钉 userid（形如 5314054424-444663015），直接显示无意义；
                        // 用通讯录反查姓名，未绑定则明确标出（未绑定 = 该班扣分推送发不出去）
                        it.teacherDingtalkId ? (
                          <Badge variant="success">
                            {refData.contacts.find((x) => x.userId === it.teacherDingtalkId)?.name ?? it.teacherDingtalkId}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t('config.unbound')}</Badge>
                        )
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
