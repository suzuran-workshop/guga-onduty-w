import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { tokens, Card, Text, Button, Input, Select, Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell, Tab, TabList } from '@fluentui/react-components';
import { ArrowDownload20Regular, ArrowTrending20Regular } from '@fluentui/react-icons';
import type { Class } from '@class-duty/shared';

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

export default function StatisticsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'ranking'|'trend'|'detail'>('ranking');
  const [rankings, setRankings] = useState<any[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [detail, setDetail] = useState<any[]>([]);
  const [classes, setClasses] = useState<(Class & { grade_name: string })[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [week, setWeek] = useState(getCurrentWeek());
  const [selClass, setSelClass] = useState('');
  const [selGrade, setSelGrade] = useState('');

  useEffect(() => {
    api.get<{data:any[]}>('/classes').then(r => setClasses(r.data));
    api.get<{data:any[]}>('/grades').then(r => setGrades(r.data));
  }, []);

  useEffect(() => {
    if (tab === 'ranking') {
      let q = `/statistics/ranking?week=${week}`;
      if (selGrade) q += `&grade_id=${selGrade}`;
      api.get<{data:any[]}>(q).then(r => setRankings(r.data));
    }
  }, [tab, week, selGrade]);

  useEffect(() => {
    if (tab === 'trend' && selClass) api.get<{data:any[]}>(`/statistics/trend?class_id=${selClass}&weeks=8`).then(r => setTrend(r.data));
  }, [tab, selClass]);

  useEffect(() => {
    if (tab === 'detail') api.get<{data:any[]}>(`/records?week=${week}&pageSize=100`).then(r => setDetail(r.data));
  }, [tab, week]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text size={600} weight="semibold">{t('stats.title')}</Text>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input size="small" style={{ width: 130 }} value={week} onChange={e => setWeek(e.currentTarget.value)} />
          <Button size="small" appearance="subtle" icon={<ArrowDownload20Regular />} onClick={() => window.open(`/api/v1/statistics/export?start_week=${week}&end_week=${week}`, '_blank')}>{t('stats.exportCSV')}</Button>
        </div>
      </div>

      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as any)} style={{ marginBottom: 16 }}>
        <Tab value="ranking">{t('stats.ranking')}</Tab>
        <Tab value="trend">{t('stats.trend')}</Tab>
        <Tab value="detail">{t('stats.detail')}</Tab>
      </TabList>

      {tab === 'ranking' && <Card>
        <Select value={selGrade} onChange={(_, d) => setSelGrade(d.value)} style={{ marginBottom: 16 }}><option value="">{t('stats.selectGrade')}</option>{grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
        {rankings.length === 0 ? <Text size={200}>{t('common.noData')}</Text> : (
          <Table size="small"><TableHeader><TableRow>
            <TableHeaderCell>#</TableHeaderCell><TableHeaderCell>{t('records.class')}</TableHeaderCell><TableHeaderCell>{t('records.score')}</TableHeaderCell><TableHeaderCell>+</TableHeaderCell><TableHeaderCell>-</TableHeaderCell><TableHeaderCell>N</TableHeaderCell>
          </TableRow></TableHeader><TableBody>
            {rankings.map(r => <TableRow key={r.class_id}>
              <TableCell><span style={rankBadge(r.rank)}>{r.rank}</span></TableCell>
              <TableCell><strong>{r.grade_name} {r.class_name}</strong></TableCell>
              <TableCell style={{ color: r.total_score >= 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontWeight: 600 }}>{r.total_score >= 0 ? '+' : ''}{r.total_score}</TableCell>
              <TableCell style={{ color: tokens.colorPaletteGreenForeground1 }}>{r.positive_count}</TableCell>
              <TableCell style={{ color: tokens.colorPaletteRedForeground1 }}>{r.negative_count}</TableCell>
              <TableCell>{r.record_count}</TableCell>
            </TableRow>)}
          </TableBody></Table>)}
      </Card>}

      {tab === 'trend' && <Card>
        <Select value={selClass} onChange={(_, d) => setSelClass(d.value)} style={{ marginBottom: 16 }}><option value="">{t('stats.selectClass')}</option>{classes.map(c => <option key={c.id} value={c.id}>{c.grade_name} {c.name}</option>)}</Select>
        {trend.length > 0 && <div>
          <Text size={300} weight="semibold" style={{ display: 'block', marginBottom: 12 }}><ArrowTrending20Regular style={{ verticalAlign: 'middle' }} /> {classes.find(c => c.id === Number(selClass))?.grade_name} {classes.find(c => c.id === Number(selClass))?.name} {t('stats.recentTrend')}</Text>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 200, padding: '20px 0' }}>
            {trend.map((pt, i) => {
              const maxVal = Math.max(...trend.map(x => Math.abs(x.total_score)), 1);
              const h = Math.abs(pt.total_score) / maxVal * 150;
              return <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: `${h}px`, background: pt.total_score >= 0 ? tokens.colorPaletteGreenBackground3 : tokens.colorPaletteRedBackground3, borderRadius: '8px 8px 0 0', margin: '0 4px', minWidth: 30, transition: 'height 0.3s' }} />
                <Text size={100}>{pt.week.slice(6)}</Text>
                <Text size={100} style={{ color: pt.total_score >= 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>{pt.total_score >= 0 ? '+' : ''}{pt.total_score}</Text>
              </div>;
            })}
          </div>
        </div>}
        {trend.length === 0 && <Text size={200}>{t('stats.selectClass')}</Text>}
      </Card>}

      {tab === 'detail' && <Card>
        {detail.length === 0 ? <Text size={200}>{t('common.noData')}</Text> : (
          <Table size="small"><TableHeader><TableRow>
            <TableHeaderCell>{t('records.class')}</TableHeaderCell><TableHeaderCell>{t('records.tag')}</TableHeaderCell><TableHeaderCell>{t('records.score')}</TableHeaderCell><TableHeaderCell>{t('records.comment')}</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>记录人</TableHeaderCell>
          </TableRow></TableHeader><TableBody>
            {detail.map(r => <TableRow key={r.id}>
              <TableCell>{r.grade_name} {r.class_name}</TableCell>
              <TableCell>{r.tag_name || '--'}</TableCell>
              <TableCell style={{ color: r.score >= 0 ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1, fontWeight: 600 }}>{r.score >= 0 ? '+' : ''}{r.score}</TableCell>
              <TableCell style={{ fontSize: 13 }}>{r.comment || '--'}</TableCell>
              <TableCell style={{ fontSize: 13 }}>{r.recorded_at?.slice(0, 16)}</TableCell>
              <TableCell style={{ fontSize: 13 }}>{r.recorder_name}</TableCell>
            </TableRow>)}
          </TableBody></Table>
        )}
      </Card>}
    </div>
  );
}