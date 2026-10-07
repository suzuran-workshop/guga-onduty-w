import { NavLink, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { tokens, Button } from '@fluentui/react-components';
import {
  Board20Regular, CheckmarkCircle20Regular, DataUsage20Regular, DocumentText20Regular,
  Scales20Regular, Flag20Regular, Settings20Regular, Options20Regular,
  SignOut20Regular, SlideMultiple20Regular, Building20Regular,
} from '@fluentui/react-icons';
import DashboardPage from '../pages/DashboardPage';
import RecordPage from '../pages/RecordPage';
import StatisticsPage from '../pages/StatisticsPage';
import SummaryPage from '../pages/SummaryPage';
import AppealsPage from '../pages/AppealsPage';
import AwardsPage from '../pages/AwardsPage';
import ConfigPage from '../pages/ConfigPage';
import SettingsPage from '../pages/SettingsPage';

const navItems = [
  { path: '/', i18n: 'nav.dashboard', icon: Board20Regular },
  { path: '/records', i18n: 'nav.records', icon: CheckmarkCircle20Regular },
  { path: '/statistics', i18n: 'nav.stats', icon: DataUsage20Regular },
  { path: '/summary', i18n: 'nav.summary', icon: DocumentText20Regular },
  { path: '/appeals', i18n: 'nav.appeals', icon: Scales20Regular, roles: ['admin', 'teacher'] },
  { path: '/awards', i18n: 'nav.awards', icon: Flag20Regular },
  { path: '/config', i18n: 'nav.config', icon: Settings20Regular, roles: ['admin'] },
  { path: '/settings', i18n: 'nav.settings', icon: Options20Regular, roles: ['admin'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const roleLabel = user?.role === 'admin' ? t('roles.admin') : user?.role === 'teacher' ? t('roles.teacher') : t('roles.student');
  const visibleNav = navItems.filter(item => !item.roles || item.roles.includes(user?.role || ''));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: tokens.colorNeutralBackground2 }}>
      <div style={{ width: 240, flexShrink: 0, background: tokens.colorNeutralBackground1, borderRight: `1px solid ${tokens.colorNeutralStroke2}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
          <Building20Regular color={tokens.colorBrandForeground1} />
          <span style={{ fontSize: 16, fontWeight: 600, color: tokens.colorNeutralForeground1 }}>{t('app.title')}</span>
        </div>
        <div style={{ flex: 1, padding: 8 }}>
          {visibleNav.map(item => {
            const active = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
            return (
              <NavLink key={item.path} to={item.path} end={item.path === '/'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 6, textDecoration: 'none', marginBottom: 2, transition: 'background 0.1s',
                  color: active ? tokens.colorBrandForeground2 : tokens.colorNeutralForeground2,
                  background: active ? tokens.colorBrandBackground2 : 'transparent',
                  fontWeight: active ? 600 : 400, fontSize: 14,
                }}>
                <item.icon /> <span>{t(item.i18n)}</span>
              </NavLink>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', background: tokens.colorNeutralBackground1, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t(visibleNav.find(n => location.pathname === n.path || (n.path !== '/' && location.pathname.startsWith(n.path)))?.i18n || 'nav.dashboard')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: tokens.colorNeutralForeground2 }}>{user?.display_name} / {roleLabel}</span>
            <Button size="small" appearance="subtle" icon={<SlideMultiple20Regular />} onClick={() => navigate('/bigscreen')}>{t('nav.bigscreen')}</Button>
            <Button size="small" appearance="subtle" icon={<SignOut20Regular />} onClick={logout}>{t('auth.logout')}</Button>
          </div>
        </header>
        <main style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/records" element={<RecordPage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/summary" element={<SummaryPage />} />
            <Route path="/appeals" element={<AppealsPage />} />
            <Route path="/awards" element={<AwardsPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}