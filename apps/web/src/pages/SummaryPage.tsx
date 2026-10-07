import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { tokens, Card, Text, Button, Input, Textarea } from '@fluentui/react-components';
import { Add20Regular, DocumentText20Regular } from '@fluentui/react-icons';
import type { DailySummary } from '@class-duty/shared';

function getCurrentWeek(): string {
  const now = new Date(); const y = new Date(now.getFullYear(), 0, 1);
  return `${now.getFullYear()}-W${String(Math.ceil(((now.getTime() - y.getTime()) / 86400000 + y.getDay() + 1) / 7)).padStart(2, '0')}`;
}

const rankBadge = (r: number) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center' as const,
  width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 700,
  background: r === 1 ? '#DAA520' : r === 2 ? '#888' : r === 3 ? '#CD7F32' : tokens.colorNeutralBackground4,
  color: r <= 3 ? '#fff' : tokens.colorNeutralForeground2,
});

const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: tokens.colorNeutralForeground2, marginBottom: 4, display: 'block' };
const rowFlex: React.CSSProperties = { display: 'flex', gap: 16, marginBottom: 16 };
const flex1: React.CSSProperties = { flex: 1 };

export default function SummaryPage() {
  const { t } = useTranslation();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [rankings, setRankings] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [week, setWeek] = useState(getCurrentWeek());
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const load = () => {
    api.get<{data:DailySummary[]}>(`/summaries?week=${week}`).then(r => setSummaries(r.data));
    api.get<{data:any[]}>(`/statistics/ranking?week=${week}`).then(r => setRankings(r.data));
  };

  useEffect(() => { load(); }, [week]);

  const autoSummary = () => {
    if (rankings.length === 0) return t('summary.autoContent');
    let txt = `## ${t('summary.weekRanking', { week })}\n\n`;
    for (const r of rankings.slice(0, 5)) txt += `- ${r.grade_name} ${r.class_name}: ${r.total_score >= 0 ? '+' : ''}${r.total_score} (扣分${r.negative_count}次, 加分${r.positive_count}次)\n`;
    return txt;
  };

  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true);
    try { await api.post('/summaries', { campus_id: 1, week, date, content: content || autoSummary() }); setShowForm(false); setContent(''); load(); } catch {} finally { setLoading(false); } };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text size={600} weight="semibold">{t('summary.title')}</Text>
        <div style={{ display: 'flex', gap: 8 }}><Input size="small" style={{ width: 130 }} value={week} onChange={e => setWeek(e.currentTarget.value)} />
          <Button appearance="primary" size="small" icon={<Add20Regular />} onClick={() => setShowForm(!showForm)}>{showForm ? t('common.close') : t('summary.newSummary')}</Button>
        </div>
      </div>

      {showForm && <Card style={{ marginBottom: 16 }}>
        <form onSubmit={handleSubmit}>
          <div style={rowFlex}><div style={flex1}><Text style={labelStyle}>周次</Text><Input value={week} onChange={e => setWeek(e.currentTarget.value)} /></div>
            <div style={flex1}><Text style={labelStyle}>{t('summary.date')}</Text><Input type="date" value={date} onChange={e => setDate(e.currentTarget.value)} /></div>
          </div>
          <div style={{ marginBottom: 16 }}><Text style={labelStyle}>{t('summary.content')}</Text><Textarea value={content} onChange={e => setContent(e.currentTarget.value)} placeholder={t('summary.autoHint')} rows={6} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Button appearance="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button><Button appearance="primary" type="submit" disabled={loading}>{t('common.submit')}</Button></div>
        </form>
      </Card>}

      {rankings.length > 0 && <Card style={{ marginBottom: 16 }}>
        <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: 12 }}>{t('summary.weekRanking', { week })}</Text>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}><th style={{ padding: 8 }}>#</th><th style={{ padding: 8 }}>{t('records.class')}</th><th style={{ padding: 8 }}>{t('records.score')}</th><th style={{ padding: 8 }}>+</th><th style={{ padding: 8 }}>-</th></tr></thead>
          <tbody>{rankings.map((r, i) => <tr key={r.class_id} style={{ borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
            <td style={{ padding: 8 }}><span style={rankBadge(i + 1)}>{i + 1}</span></td>
            <td style={{ padding: 8 }}>{r.grade_name} {r.class_name}</td>
            <td style={{ padding: 8, color: r.total_score >= 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontWeight: 600 }}>{r.total_score >= 0 ? '+' : ''}{r.total_score}</td>
            <td style={{ padding: 8, color: tokens.colorPaletteGreenForeground1 }}>{r.positive_count}</td>
            <td style={{ padding: 8, color: tokens.colorPaletteRedForeground1 }}>{r.negative_count}</td>
          </tr>)}</tbody>
        </table>
      </Card>}

      <Card>
        <Text size={400} weight="semibold" style={{ display: 'block', marginBottom: 12 }}><DocumentText20Regular style={{ verticalAlign: 'middle', marginRight: 4 }} />{t('summary.historySummaries')}</Text>
        {summaries.length === 0 ? <Text size={200}>{t('common.noData')}</Text> : summaries.map(s => (
          <div key={s.id} style={{ marginBottom: 12, background: tokens.colorNeutralBackground2, borderRadius: 8, padding: 16 }}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: 4, display: 'block' }}>{s.date} | {s.week}</Text>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{s.content}</Text>
          </div>
        ))}
      </Card>
    </div>
  );
}