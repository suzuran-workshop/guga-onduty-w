/**
 * 系统设置页 —— 申诉/自动通知开关 + 模板导入导出。
 *
 * 迁移要点（对照旧 Fluent 版）：
 *  - Fluent Switch/Card/Button → shadcn Switch（checked + onCheckedChange）。
 *  - GET /settings 返回 key-value map（Record<string,string>），非数组。
 *  - PUT /settings 去掉硬编码 campus_id（后端从 profile 取），body {settings:[{key,value}]}，value 是 'true'/'false'。
 *  - 模板导出：api.get('/templates/export') → JSON Blob 下载；导入：input[type=file] 读 JSON → POST /templates/import。
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { api } from '@/api/client';

type SettingsMap = Record<string, string>;

export default function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsMap>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<SettingsMap>('/settings').then((r) => setSettings(r.data));
  }, []);

  async function toggle(key: string) {
    const nv = settings[key] === 'true' ? 'false' : 'true';
    try {
      await api.put('/settings', { settings: [{ key, value: nv }] });
      setSettings((prev) => ({ ...prev, [key]: nv }));
      toast.success(t('settings.savedOk'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function handleExport() {
    try {
      const r = await api.get<{ name: string; tagIds: string[] }[]>('/templates/export');
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'templates.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  async function handleImport(file: File) {
    try {
      const data = JSON.parse(await file.text());
      const r = await api.post<{ imported: number }>('/templates/import', { data });
      toast.success(`${t('common.import')}: ${r.data.imported}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.failed'));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>

      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <div className="mb-4 font-semibold">{t('settings.campusSettings')}</div>

          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <Label className="text-base">{t('settings.appealToggle')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings.appealDesc')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {settings.appeal_enabled === 'true' ? t('settings.enabled') : t('settings.disabled')}
              </span>
              <Switch checked={settings.appeal_enabled === 'true'} onCheckedChange={() => toggle('appeal_enabled')} />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <Label className="text-base">{t('settings.notifyToggle')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings.notifyDesc')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {settings.auto_notify_teachers === 'true' ? t('settings.enabled') : t('settings.disabled')}
              </span>
              <Switch checked={settings.auto_notify_teachers === 'true'} onCheckedChange={() => toggle('auto_notify_teachers')} />
            </div>
          </div>

          <Separator />

          <div className="pt-5">
            <div className="mb-3 font-semibold">{t('config.tabs.templates')}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="size-4" />{t('settings.exportTemplates')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />{t('settings.importTemplates')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImport(f);
                  e.target.value = ''; // 允许重复选同一文件
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
