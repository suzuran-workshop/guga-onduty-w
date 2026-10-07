import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { tokens, Card, Text, Button, Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell, Spinner } from '@fluentui/react-components';
import { ArrowClockwise20Regular, ArrowTrending20Regular, DocumentOnePage20Regular, Clock20Regular } from '@fluentui/react-icons';
import type { DashboardStats, RecordWithDetails } from '@class-duty/shared';

const rankBadge = (r: number) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center' as const,
  width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 700,
  background: r === 1 ? '#DAA520' : r === 2 ? '#888' : r === 3 ? '#CD7F32' : tokens.colorNeutralBackground4,
  color: r <= 3 ? '#fff' : tokens.colorNeutralForeground2,
});

export default function DashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [records, setRecords] = useState<RecordWithDetails[]>([]);
  const [rankings, setRankings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      api.get<{ data: DashboardStats }>('/statistics/dashboard'),
      api.get<{ data: RecordWithDetails[] }>('/records?pageSize=10'),
      api.get<{ data: any[] }>('/statistics/ranking'),
    ]).then(([s, r, rk]) => { setStats(s.data); setRecords(r.data); setRankings(rk.data.slice(0, 5)); }).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  if (loading && !stats) return <Spinner />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Text size={600} weight="semibold">{t('nav.dashboard')}</Text>
        <Button size="small" appearance="subtle" icon={<ArrowClockwise20Regular />} onClick={refresh}>{t('common.refresh')}</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <Card style={{ textAlign: 'center', padding: '20px 16px' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.today_records ?? '-'}</div>
          <div style={{ fontSize: 13, color: tokens.colorNeutralForeground3, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><DocumentOnePage20Regular /> {t('dashboard.todayRecords')}</div>
        </Card>
        <Card style={{ textAlign: 'center', padding: '20px 16px' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: tokens.colorPaletteGreenForeground1 }}>{(stats?.today_positive ?? 0) > 0 ? '+' + stats?.today_positive : '0'}</div>
          <div style={{ fontSize: 13, color: tokens.colorNeutralForeground3, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><ArrowTrending20Regular /> {t('dashboard.todayPositive')}</div>
        </Card>
        <Card style={{ textAlign: 'center', padding: '20px 16px' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: tokens.colorPaletteRedForeground1 }}>{stats?.today_negative ?? 0}</div>
          <div style={{ fontSize: 13, color: tokens.colorNeutralForeground3, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><ArrowTrending20Regular style={{ transform: 'scaleY(-1)' }} /> {t('dashboard.todayNegative')}</div>
        </Card>
        <Card style={{ textAlign: 'center', padding: '20px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{stats?.week_top_class || '-'}</div>
          <div style={{ fontSize: 13, color: tokens.colorNeutralForeground3, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Clock20Regular /> {t('dashboard.weekBest')}</div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: 12 }}>{t('dashboard.weekTop5')}</Text>
          {rankings.length === 0 ? <Text size={200}>{t('common.noData')}</Text> : (
            <Table size="small">
              <TableHeader><TableRow><TableHeaderCell>#</TableHeaderCell><TableHeaderCell>{t('records.class')}</TableHeaderCell><TableHeaderCell>{t('records.score')}</TableHeaderCell></TableRow></TableHeader>
              <TableBody>
                {rankings.map(r => (
                  <TableRow key={r.class_id}><TableCell><span style={rankBadge(r.rank)}>{r.rank}</span></TableCell>
                    <TableCell>{r.grade_name} {r.class_name}</TableCell>
                    <TableCell style={{ color: r.total_score >= 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontWeight: 600 }}>{r.total_score >= 0 ? '+' : ''}{r.total_score}</TableCell>
                  </TableRow>))}
              </TableBody>
            </Table>)}
        </Card>

        <Card>
          <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: 12 }}>{t('dashboard.recentRecords')}</Text>
          {records.length === 0 ? <Text size={200}>{t('common.noData')}</Text> : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {records.map(r => (
                <div key={r.id} style={{ padding: '10px 0', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span><strong>{r.grade_name} {r.class_name}</strong><span style={{ marginLeft: 8 }}>{r.tag_name || '--'}</span></span>
                    <span style={{ color: r.score && r.score >= 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontWeight: 600 }}>{r.score && r.score >= 0 ? '+' : ''}{r.score ?? '--'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3, marginTop: 2 }}>{r.recorder_name} &middot; {r.recorded_at?.slice(0, 16)}</div>
                </div>))}
            </div>)}
        </Card>
      </div>
    </div>
  );
}