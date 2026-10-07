import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { tokens, Card, Text, Button, Input } from '@fluentui/react-components';
import { Reward20Regular, Flag20Regular } from '@fluentui/react-icons';
import type { Award } from '@class-duty/shared';

function getCurrentWeek(): string {
  const now = new Date(); const y = new Date(now.getFullYear(), 0, 1);
  return `${now.getFullYear()}-W${String(Math.ceil(((now.getTime() - y.getTime()) / 86400000 + y.getDay() + 1) / 7)).padStart(2, '0')}`;
}

export default function AwardsPage() {
  const { t } = useTranslation();
  const [awards, setAwards] = useState<Award[]>([]);
  const [week, setWeek] = useState(getCurrentWeek());
  const [loading, setLoading] = useState(false);

  const load = () => api.get<{data:Award[]}>(`/awards?week=${week}`).then(r => setAwards(r.data));
  useEffect(() => { load(); }, [week]);

  const handleAward = async () => { if (!confirm(t('awards.confirmAward', { week }))) return; setLoading(true);
    try { await api.post('/awards', { campus_id: 1, week }); load(); } catch {} finally { setLoading(false); } };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text size={600} weight="semibold">{t('awards.title')}</Text>
        <div style={{ display: 'flex', gap: 8 }}><Input size="small" style={{ width: 130 }} value={week} onChange={e => setWeek(e.currentTarget.value)} />
          <Button appearance="primary" icon={<Reward20Regular />} onClick={handleAward} disabled={loading}>{loading ? t('awards.awarding') : t('awards.awardButton')}</Button>
        </div>
      </div>

      {awards.length === 0 ? <Text size={200}>{t('awards.noRecords')}</Text> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {awards.map(a => (
            <Card key={a.id} style={{ textAlign: 'center', padding: '24px 16px', borderTop: `4px solid ${tokens.colorBrandForeground1}` }}>
              <Flag20Regular fontSize={32} color={tokens.colorBrandForeground1} style={{ marginBottom: 8 }} />
              <Text size={500} weight="bold" style={{ marginBottom: 4, display: 'block' }}>{a.grade_name} {a.class_name}</Text>
              <Text size={200}>{a.week} {t('awards.title')}</Text>
              {a.note && <Text size={200}>{a.note}</Text>}
              <Text size={100} style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}>{t('awards.awardedAt')}: {a.awarded_at?.slice(0, 16)}</Text>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}