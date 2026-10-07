import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { tokens, Card, Text, Button, Badge, Select } from '@fluentui/react-components';
import { CheckmarkCircle20Regular, DismissCircle20Regular, Alert20Regular, Filter20Regular } from '@fluentui/react-icons';

export default function AppealsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [appeals, setAppeals] = useState<any[]>([]);
  const [filter, setFilter] = useState('');

  const load = () => { let q = '/appeals?pageSize=50'; if (filter) q += `&status=${filter}`; api.get<{data:any[]}>(q).then(r => setAppeals(r.data)); };
  useEffect(() => { load(); }, [filter]);

  const handleApprove = async (id: number) => { await api.post(`/records/${id}/appeal/approve`, { review_comment: t('appeals.reviewComment') }); load(); };
  const handleReject = async (id: number) => { await api.post(`/records/${id}/appeal/reject`, { review_comment: t('appeals.rejectComment') }); load(); };

  const icon = (st: string) => {
    if (st === 'pending') return <Alert20Regular color={tokens.colorPaletteYellowForeground1} />;
    if (st === 'approved') return <CheckmarkCircle20Regular color={tokens.colorPaletteGreenForeground1} />;
    return <DismissCircle20Regular color={tokens.colorPaletteRedForeground1} />;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text size={600} weight="semibold">{t('appeals.title')}</Text>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Filter20Regular />
          <Select value={filter} onChange={(_, d) => setFilter(d.value)}><option value="">{t('appeals.allStatus')}</option><option value="pending">{t('appeals.pending')}</option><option value="approved">{t('appeals.approved')}</option><option value="rejected">{t('appeals.rejected')}</option></Select>
        </div>
      </div>

      {appeals.length === 0 ? <Text size={200}>{t('common.noData')}</Text> : appeals.map(a => (
        <Card key={a.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>{icon(a.status)}
                <Text weight="semibold">{a.record_info?.class_name} - {a.record_info?.tag_name || '--'}</Text>
                {a.status === 'pending' && <Badge color="warning">{t('appeals.pending')}</Badge>}
                {a.status === 'approved' && <Badge color="success">{t('appeals.approved')}</Badge>}
                {a.status === 'rejected' && <Badge color="danger">{t('appeals.rejected')}</Badge>}
              </div>
              <div style={{ fontSize: 13, color: tokens.colorNeutralForeground3, marginBottom: 4 }}>
                分数: <span style={{ fontWeight: 600, color: a.record_info?.score >= 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>{a.record_info?.score}</span>
                {a.record_info?.comment && ` | ${a.record_info.comment}`}
              </div>
              <div style={{ fontSize: 13, color: tokens.colorNeutralForeground3, marginBottom: 4 }}>{a.record_info?.week} | {a.record_info?.recorded_at?.slice(0, 16)}</div>
              <div style={{ padding: 12, borderRadius: 8, marginTop: 8, background: tokens.colorNeutralBackground2 }}>
                <Text size={200} weight="semibold" style={{ display: 'block', marginBottom: 4 }}>{t('appeals.teacher')}: {a.teacher_name}</Text>
                <Text>{a.reason}</Text>
              </div>
              {a.review_comment && <div style={{ padding: 12, borderRadius: 8, marginTop: 8, background: tokens.colorBrandBackground2 }}>
                <Text size={200} weight="semibold" style={{ display: 'block', marginBottom: 4 }}>{t('appeals.reviewer')}: {a.reviewer_name} {a.reviewed_at?.slice(0, 16)}</Text>
                <Text>{a.review_comment}</Text>
              </div>}
              <Text size={100} style={{ marginTop: 8, color: tokens.colorNeutralForeground3 }}>{t('common.submit')} {a.created_at?.slice(0, 16)}</Text>
            </div>
            {user?.role === 'admin' && a.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
                <Button size="small" appearance="primary" icon={<CheckmarkCircle20Regular />} onClick={() => handleApprove(a.record_id)}>{t('appeals.approve')}</Button>
                <Button size="small" appearance="secondary" icon={<DismissCircle20Regular />} onClick={() => handleReject(a.record_id)}>{t('appeals.reject')}</Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}