/**
 * 路由 + 守卫 —— react-router 7（docs §3.1）。
 *
 * 路由表（对照旧 App.tsx，路径契约不变）：
 *   /login      登录（已登录则重定向 /）
 *   /bigscreen  数字大屏（公开，无守卫，全屏）
 *   /*          ProtectedRoute（需登录）→ Layout → 8 个业务子路由
 *
 * 迁移修复：
 *  - 旧代码仅隐藏菜单、无路由级 RBAC（student 手输 /config 可进）→ 新增 RequireRole 守卫。
 *  - config/settings 仅 admin；appeals 仅 admin+teacher（与后端 RBAC 矩阵对齐）。
 *  - loading 时渲染骨架屏（旧代码整体白屏直到 /me 完成）。
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { UserRole } from '@class-duty/shared';
import { useAuth } from '@/hooks/useAuth';
import { Layout } from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import RecordPage from '@/pages/RecordPage';
import StatisticsPage from '@/pages/StatisticsPage';
import SummaryPage from '@/pages/SummaryPage';
import AppealsPage from '@/pages/AppealsPage';
import AwardsPage from '@/pages/AwardsPage';
import ConfigPage from '@/pages/ConfigPage';
import SettingsPage from '@/pages/SettingsPage';
import BigScreenPage from '@/pages/BigScreenPage';
// 值班域（融合方案）
import DutySchedulePage from '@/pages/DutySchedulePage';
import DutyCheckinPage from '@/pages/DutyCheckinPage';
import DutyInspectionPage from '@/pages/DutyInspectionPage';
import DutySwapPage from '@/pages/DutySwapPage';
import DutyReportPage from '@/pages/DutyReportPage';
import DutyConfigPage from '@/pages/DutyConfigPage';

/** 全屏加载占位（首屏 /me 探测中） */
function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">加载中…</div>
    </div>
  );
}

/** 需登录守卫：未登录跳 /login（记住来源） */
function ProtectedRoute({ children }: { children: ReactElement }) {
  const { profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

/** 路由级 RBAC：角色不符 → 回首页（不渲染越权页面） */
function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactElement }) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/bigscreen" element={<BigScreenPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/records" element={<RecordPage />} />
                <Route path="/statistics" element={<StatisticsPage />} />
                <Route path="/summary" element={<SummaryPage />} />
                <Route
                  path="/appeals"
                  element={
                    <RequireRole roles={['admin', 'teacher']}>
                      <AppealsPage />
                    </RequireRole>
                  }
                />
                <Route path="/awards" element={<AwardsPage />} />
                <Route
                  path="/config"
                  element={
                    <RequireRole roles={['admin']}>
                      <ConfigPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RequireRole roles={['admin']}>
                      <SettingsPage />
                    </RequireRole>
                  }
                />
                {/* 值班域（融合方案 DUTY-FUSION.md）：巡查权限页用 RequireRole 兜底，config 仅 admin */}
                <Route path="/duty/schedule" element={<DutySchedulePage />} />
                <Route path="/duty/checkin" element={<DutyCheckinPage />} />
                <Route
                  path="/duty/inspection"
                  element={
                    <RequireRole roles={['admin', 'teacher']}>
                      <DutyInspectionPage />
                    </RequireRole>
                  }
                />
                <Route path="/duty/swap" element={<DutySwapPage />} />
                <Route path="/duty/report" element={<DutyReportPage />} />
                <Route
                  path="/duty/config"
                  element={
                    <RequireRole roles={['admin']}>
                      <DutyConfigPage />
                    </RequireRole>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
