import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Text } from '@fluentui/react-components';
import { SlideMultiple20Regular, Clock20Regular, ArrowTrending20Regular } from '@fluentui/react-icons';
import type { ClassRanking, RecordWithDetails } from '@class-duty/shared';

function getCurrentWeek(): string {
  const now = new Date(); const y = new Date(now.getFullYear(), 0, 1);
  return `${now.getFullYear()}-W${String(Math.ceil(((now.getTime() - y.getTime()) / 86400000 + y.getDay() + 1) / 7)).padStart(2, '0')}`;
}

const rankBadge = (r: number) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center' as const,
  width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 700,
  background: r === 1 ? '#DAA520' : r === 2 ? '#888' : r === 3 ? '#CD7F32' : 'rgba(255,255,255,0.08)',
  color: r <= 3 ? '#fff' : '#aaa',
});

export default function BigScreenPage() {
  const { t } = useTranslation();
  const [rankings, setRankings] = useState<ClassRanking[]>([]);
  const [records, setRecords] = useState<RecordWithDetails[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [time, setTime] = useState(new Date().toLocaleTimeString('zh-CN'));
  const week = getCurrentWeek();

  useEffect(() => {
    api.get<{data:ClassRanking[]}>(`/statistics/ranking?week=${week}`).then(r => setRankings(r.data));
    api.get<{data:RecordWithDetails[]}>('/records?pageSize=20').then(r => setRecords(r.data));
    api.get<{data:any}>('/statistics/dashboard').then(r => setStats(r.data));
    const clock = setInterval(() => setTime(new Date().toLocaleTimeString('zh-CN')), 1000);
    const refresh = setInterval(async () => {
      try { const [r, rec, st] = await Promise.all([api.get<{data:ClassRanking[]}>(`/statistics/ranking?week=${week}`), api.get<{data:RecordWithDetails[]}>('/records?pageSize=20'), api.get<{data:any}>('/statistics/dashboard')]); setRankings(r.data); setRecords(rec.data); setStats(st.data); } catch {}
    }, 30000);
    return () => { clearInterval(clock); clearInterval(refresh); };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0A0D1A', color: '#e0e0e0', padding: 32 }}>
      <div style={{ textAlign: 'center', padding: 32, borderRadius: 12, marginBottom: 32, background: 'linear-gradient(135deg, #002FA7, #1A4DE0)', color: '#fff' }}>
        <div style={{ fontSize: 16, opacity: 0.7, marginBottom: 8 }}><Clock20Regular style={{ verticalAlign: 'middle', marginRight: 4 }} /> {time}</div>
        <h1 style={{ fontSize: 36, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}><SlideMultiple20Regular /> {t('bigscreen.title')}</h1>
        <div style={{ fontSize: 18, marginTop: 8, opacity: 0.85 }}>{week} 周</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {[[stats?.today_records ?? '-', t('bigscreen.todayRecords'), '#fff'], [`+${stats?.today_positive ?? 0}`, t('bigscreen.todayPositive'), '#4CAF50'], [stats?.today_negative ?? 0, t('bigscreen.todayNegative'), '#F44336'], [stats?.week_top_class || '-', t('bigscreen.bestClass'), '#FFD700']].map(([val, label, color], i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: i === 3 ? 20 : 32, fontWeight: 700, color: String(color) }}>{String(val)}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {i === 1 ? <ArrowTrending20Regular /> : i === 2 ? <ArrowTrending20Regular style={{ transform: 'scaleY(-1)' }} /> : null} {String(label)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
          <Text weight="semibold" style={{ display: 'block', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#FFD700' }}>{t('bigscreen.weekRankingTop10')}</Text>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}><th style={{ padding: '8px 12px', textAlign: 'left', color: '#888' }}>#</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#888' }}>{t('records.class')}</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#888' }}>{t('records.score')}</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#888' }}>+/-</th></tr></thead>
            <tbody>{rankings.slice(0, 10).map(r => <tr key={r.class_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <td style={{ padding: '8px 12px' }}><span style={rankBadge(r.rank)}>{r.rank}</span></td>
              <td style={{ padding: '8px 12px' }}>{r.grade_name} {r.class_name}</td>
              <td style={{ padding: '8px 12px', color: r.total_score >= 0 ? '#4CAF50' : '#F44336', fontWeight: 600 }}>{r.total_score >= 0 ? '+' : ''}{r.total_score}</td>
              <td style={{ padding: '8px 12px' }}><span style={{ color: '#4CAF50' }}>+{r.positive_count}</span> / <span style={{ color: '#F44336' }}>-{r.negative_count}</span></td>
            </tr>)}</tbody>
          </table>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 24, border: '1px solid rgba(255,255,255,0.08)' }}>
          <Text weight="semibold" style={{ display: 'block', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#4FC3F7' }}>{t('bigscreen.liveFeed')}</Text>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {records.map(r => <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><Text style={{ fontWeight: 500 }}>{r.grade_name} {r.class_name}</Text> <Text size={100} style={{ marginLeft: 12, color: '#aaa' }}>{r.tag_name || '--'}</Text></div>
              <div><Text weight="semibold" style={{ color: r.score && r.score >= 0 ? '#4CAF50' : '#F44336', fontSize: 16 }}>{r.score && r.score >= 0 ? '+' : ''}{r.score ?? '--'}</Text>
                <Text size={100} style={{ marginLeft: 16, color: '#555' }}>{r.recorded_at?.slice(11, 16)}</Text></div>
            </div>)}
            {records.length === 0 && <Text size={200} style={{ color: '#555', display: 'block', textAlign: 'center', padding: 40 }}>{t('common.noData')}</Text>}
          </div>
        </div>
      </div>
    </div>
  );
}