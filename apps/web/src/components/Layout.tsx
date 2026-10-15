/**
 * 布局 —— 侧边栏 + 顶栏（shadcn/ui + lucide，替换旧 Fluent 内联样式）。
 *
 * 迁移要点（对照旧 components/Layout.tsx）：
 *  - 全内联 style + Fluent tokens → Tailwind 原子类 + shadcn CSS 变量。
 *  - 图标 @fluentui/react-icons → lucide-react。
 *  - 菜单角色过滤保留（visibleNav），但**路由级 RBAC 已在 App.tsx 的 RequireRole 兜底**
 *    （旧代码只藏菜单、可直接输 URL 越权，本次修复）。
 *  - 顶栏用户区：displayName + 角色 + 下拉（大屏 / 退出）。
 */
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, ClipboardCheck, BarChart3, FileText, Scale, Flag, Settings, SlidersHorizontal,
  Building2, Presentation, LogOut, ChevronsUpDown,
} from 'lucide-react';
import type { UserRole } from '@guga-onduty-w/shared';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  to: string;
  i18nKey: string;
  icon: ReactNode;
  roles?: UserRole[]; // 缺省 = 所有角色可见
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', i18nKey: 'nav.dashboard', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { to: '/records', i18nKey: 'nav.records', icon: <ClipboardCheck className="h-4 w-4" /> },
  { to: '/statistics', i18nKey: 'nav.stats', icon: <BarChart3 className="h-4 w-4" /> },
  { to: '/summary', i18nKey: 'nav.summary', icon: <FileText className="h-4 w-4" /> },
  { to: '/appeals', i18nKey: 'nav.appeals', icon: <Scale className="h-4 w-4" />, roles: ['admin', 'teacher'] },
  { to: '/awards', i18nKey: 'nav.awards', icon: <Flag className="h-4 w-4" /> },
  { to: '/config', i18nKey: 'nav.config', icon: <Settings className="h-4 w-4" />, roles: ['admin'] },
  { to: '/settings', i18nKey: 'nav.settings', icon: <SlidersHorizontal className="h-4 w-4" />, roles: ['admin'] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { profile, campusName, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const role = profile?.role;
  const visibleNav = NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));

  // 当前页标题（反查 nav）
  const current =
    NAV_ITEMS.find((n) => (n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to) && n.to !== '/')) ??
    NAV_ITEMS[0];
  const pageTitle = t(current.i18nKey);
  const displayName = profile?.displayName ?? '';

  return (
    <div className="flex min-h-screen bg-background">
      {/* 侧边栏 */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="font-semibold">{t('app.title')}</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              {item.icon}
              {t(item.i18nKey)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-2">
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={() => navigate('/bigscreen')}>
            <Presentation className="h-4 w-4" />
            {t('nav.bigscreen')}
          </Button>
        </div>
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-6">
          <h1 className="text-base font-semibold">{pageTitle}</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">{displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="hidden text-left sm:block">
                  <div className="text-sm font-medium leading-tight">{displayName}</div>
                  <div className="text-xs text-muted-foreground leading-tight">
                    {role ? t(`roles.${role}`) : ''}
                    {campusName ? ` · ${campusName}` : ''}
                  </div>
                </div>
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {campusName || t('app.title')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/bigscreen')}>
                <Presentation className="mr-2 h-4 w-4" />
                {t('nav.bigscreen')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {t('auth.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <Separator className="hidden" />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
