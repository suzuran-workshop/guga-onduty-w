/**
 * 路由 + 守卫 —— react-router 7（docs §3.1）。
 *
 * 路由表（对照旧 App.tsx，路径契约不变）：
 *   /login          登录（已登录则重定向 /）
 *   /bigscreen      数字大屏（公开，无守卫，全屏）
 *   /appeal/:token  免登录申诉（公开，无守卫；教师从钉钉推送点链接直达）
 *   /*              ProtectedRoute（需登录）→ Layout → 8 个业务子路由
 *
 * ⚠ /appeal/:token 必须与 /bigscreen 一样挂在 ProtectedRoute **之外**：需求 4 的前提是
 *   「教师不需要专门进入系统」，若这条路要求登录，等于自己推翻该前提。
 *   令牌即凭证（绑定 recordId + 教师钉钉身份 + 过期 + 一次性），不需要会话。
 *
 * 迁移修复：
 *  - 旧代码仅隐藏菜单、无路由级 RBAC（student 手输 /config 可进）→ 新增 RequireRole 守卫。
 *  - config/settings 仅 admin；appeals 仅 admin+teacher（与后端 RBAC 矩阵对齐）。
 *  - loading 时渲染骨架屏（旧代码整体白屏直到 /me 完成）。
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { UserRole } from '@guga-onduty-w/shared';
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
import PublicAppealPage from '@/pages/PublicAppealPage';

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

/**
 * 首页按角色分流（2026-10-23，需求 2）。
 *
 * ⚠ 不能直接渲染 DashboardPage：看板调 /statistics/dashboard，而统计域已收紧为
 * admin/teacher only，student 落地即 403 白屏。student 的唯一模块是「评价」，
 * 故其首页直接就是评价页——落地即可打分，也避免侧边栏出现一堆点进去就报错的入口。
 */
function HomeRoute() {
  const { profile } = useAuth();
  if (profile?.role === 'student') return <Navigate to="/records" replace />;
  return <DashboardPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/bigscreen" element={<BigScreenPage />} />
      {/* 免登录申诉（公开）：与 /bigscreen 平级，刻意在 ProtectedRoute 之外 */}
      <Route path="/appeal/:token" element={<PublicAppealPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<HomeRoute />} />
                <Route path="/records" element={<RecordPage />} />
                <Route
                  path="/statistics"
                  element={
                    <RequireRole roles={['admin', 'teacher']}>
                      <StatisticsPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/summary"
                  element={
                    <RequireRole roles={['admin', 'teacher']}>
                      <SummaryPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/appeals"
                  element={
                    <RequireRole roles={['admin', 'teacher']}>
                      <AppealsPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/awards"
                  element={
                    <RequireRole roles={['admin', 'teacher']}>
                      <AwardsPage />
                    </RequireRole>
                  }
                />
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
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
