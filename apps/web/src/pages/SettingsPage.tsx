import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { tokens, Card, Text, Button, Switch } from '@fluentui/react-components';
import { ArrowUpload20Regular, ArrowDownload20Regular } from '@fluentui/react-icons';

export default function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => { api.get<{data:Record<string,string>}>('/settings?campus_id=1').then(r => setSettings(r.data)); }, []);

  const toggle = async (key: string, val: string) => {
    const nv = val === 'true' ? 'false' : 'true';
    await api.put('/settings', { campus_id: 1, settings: [{ key, value: nv }] });
    setSettings(prev => ({ ...prev, [key]: nv }));
  };

  const handleExport = async () => {
    const r = await api.get<{data:any}>('/templates/export?campus_id=1');
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'templates.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  const handleImport = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = async (e: any) => { const f = e.target.files?.[0]; if (!f) return; await api.post('/templates/import', { campus_id: 1, data: JSON.parse(await f.text()) }); };
    input.click();
  };

  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` };

  return (
    <div>
      <div style={{ marginBottom: 16 }}><Text size={600} weight="semibold">{t('settings.title')}</Text></div>
      <Card style={{ maxWidth: 600 }}>
        <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: 16 }}>{t('settings.campusSettings')}</Text>
        <div style={row}>
          <div><div style={{ fontWeight: 500 }}>{t('settings.appealToggle')}</div><div style={{ fontSize: 13, color: tokens.colorNeutralForeground3 }}>{t('settings.appealDesc')}</div></div>
          <Switch checked={settings.appeal_enabled === 'true'} onChange={() => toggle('appeal_enabled', settings.appeal_enabled || 'false')}
            label={settings.appeal_enabled === 'true' ? t('settings.enabled') : t('settings.disabled')} />
        </div>
        <div style={row}>
          <div><div style={{ fontWeight: 500 }}>{t('settings.notifyToggle')}</div><div style={{ fontSize: 13, color: tokens.colorNeutralForeground3 }}>{t('settings.notifyDesc')}</div></div>
          <Switch checked={settings.auto_notify_teachers === 'true'} onChange={() => toggle('auto_notify_teachers', settings.auto_notify_teachers || 'false')}
            label={settings.auto_notify_teachers === 'true' ? t('settings.enabled') : t('settings.disabled')} />
        </div>
        <div style={{ marginTop: 24 }}>
          <Text weight="semibold" style={{ display: 'block', marginBottom: 12 }}>Template Import/Export</Text>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" appearance="outline" icon={<ArrowDownload20Regular />} onClick={handleExport}>{t('settings.exportTemplates')}</Button>
            <Button size="small" appearance="outline" icon={<ArrowUpload20Regular />} onClick={handleImport}>{t('settings.importTemplates')}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}