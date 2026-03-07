// DashboardShell — client component that renders the sidebar + topbar.
// Receives role, email, and store data from the Server Component layout.
// Hydrates the Zustand session store and initialises selectedStoreId on mount.
// Agency sidebar shows a global store selector dropdown; store sidebar shows the store name.
// Navigation supports flat items and grouped sub-menus (Security group).
// Settings link is part of the main nav (below Security) to prevent accidental clicks.
// Bottom section: user profile card (avatar/email/role badge) and a prominent Log Out button.
// Ample padding separates the scrollable nav from the fixed bottom section.
// Mobile: sidebar is a fixed drawer toggled by a hamburger button in the mobile top bar.
// Desktop: sidebar is a static flex column, exactly as before.
// (DashboardShell — 서버 컴포넌트 레이아웃에서 역할, 이메일, 매장 데이터를 받아
//  사이드바 + 상단바를 렌더링하는 클라이언트 컴포넌트.
//  모바일: 고정 드로어 사이드바, 햄버거 버튼으로 토글.
//  데스크탑: 기존과 동일한 정적 사이드바 컬럼)

'use client';

import { useEffect, useState }   from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link                       from 'next/link';
import {
  LayoutDashboard,
  Mic,
  History,      // Call History nav item icon (Call History 내비게이션 항목 아이콘)
  CalendarCheck,
  BarChart2,
  Settings,
  LogOut,
  Building2,
  ChevronDown,
  ShieldAlert,
  Monitor,
  Eye,
  Menu,   // hamburger icon for mobile top bar (모바일 상단 바 햄버거 아이콘)
  X,      // close icon for mobile sidebar drawer (모바일 사이드바 드로어 닫기 아이콘)
}                                 from 'lucide-react';
import { useSessionStore }        from '@/shared/stores/sessionStore';
import { getSupabaseClient }      from '@/shared/api/supabaseClient';
import { StoreProvider }          from '@/shared/contexts/StoreContext';

// Store entry used in the global sidebar selector (전역 사이드바 선택기에 사용되는 매장 항목)
interface StoreOption {
  id:   string;
  name: string;
}

// Sub-menu item shape for grouped navigation (그룹 내비게이션의 서브메뉴 항목 형태)
interface NavChild {
  href:  string;
  label: string;
  icon:  React.ComponentType<{ className?: string }>;
}

// Top-level nav item — optionally contains children forming a sub-group.
// (최상위 내비게이션 항목 — 선택적으로 서브그룹을 형성하는 하위 항목 포함)
interface NavItem {
  href:      string;
  label:     string;
  icon:      React.ComponentType<{ className?: string }>;
  children?: NavChild[];
}

// Props passed down from the Server Component layout (서버 컴포넌트 레이아웃에서 전달받는 props)
export interface DashboardShellProps {
  storeId:   string;
  agentId:   string;
  storeName: string;
  role:      'agency' | 'store';
  email:     string;
  // All stores for agency sidebar selector; empty for store-role users (에이전시 사이드바 선택기용 전체 매장 목록; 매장 역할 사용자에게는 빈 배열)
  allStores: StoreOption[];
  children:  React.ReactNode;
}

// Agency navigation — routes under /agency.
// Settings is placed between Analytics and Security so it stays in the core functional
// nav and is never confused with the logout area at the bottom of the sidebar.
// Security is the last nav group — infrequently accessed features separated from daily use.
// (에이전시 내비게이션 — /agency 하위 경로.
//  설정은 Analytics와 Security 사이에 배치 — 핵심 기능 내비에 포함, 하단 로그아웃과 혼동 방지.
//  Security는 마지막 내비 그룹 — 자주 사용하지 않는 기능을 일상 사용과 분리)
const AGENCY_NAV: NavItem[] = [
  { href: '/agency',              label: 'Overview',     icon: LayoutDashboard },
  { href: '/agency/ai-voice-bot',    label: 'AI Voice Bot',  icon: Mic         },
  // Call History — placed directly below AI Voice Bot as it is the primary output of voice calls
  // (Call History를 AI Voice Bot 바로 아래에 배치 — 음성 통화의 주요 출력 결과이기 때문)
  { href: '/agency/call-history',    label: 'Call History',  icon: History     },
  { href: '/agency/reservations',    label: 'Reservations',  icon: CalendarCheck },
  { href: '/agency/analytics',    label: 'Analytics',    icon: BarChart2       },
  // Settings above Security — part of main functional nav, not the logout footer area
  // (Settings를 Security 위에 배치 — 로그아웃 푸터 영역이 아닌 메인 기능 내비의 일부)
  { href: '/agency/settings', label: 'Settings', icon: Settings },
  {
    // Security group — infrequent, placed last to separate from daily-use items
    // (보안 그룹 — 빈번하지 않은 사용, 일상 사용 항목과 분리하기 위해 마지막에 배치)
    href:  '/agency/security',
    label: 'Security',
    icon:  ShieldAlert,
    children: [
      { href: '/agency/security/pos-overlay',   label: 'POS Overlay',      icon: Monitor },
      { href: '/agency/security/solink',         label: 'Solink Monitoring', icon: Monitor },
      { href: '/agency/security/prevent-theft', label: 'Prevent Theft',    icon: Eye     },
    ],
  },
];

// Store-owner navigation — routes under /store.
// Settings is placed between Analytics and Security so it stays in the core functional
// nav and is never confused with the logout area at the bottom of the sidebar.
// Security is the last nav group — infrequently accessed features separated from daily use.
// (매장 소유자 내비게이션 — /store 하위 경로.
//  설정은 Analytics와 Security 사이에 배치 — 핵심 기능 내비에 포함, 하단 로그아웃과 혼동 방지.
//  Security는 마지막 내비 그룹 — 자주 사용하지 않는 기능을 일상 사용과 분리)
const STORE_NAV: NavItem[] = [
  { href: '/store',              label: 'Overview',     icon: LayoutDashboard },
  { href: '/store/ai-voice-bot',    label: 'AI Voice Bot',  icon: Mic         },
  // Call History — placed directly below AI Voice Bot as it is the primary output of voice calls
  // (Call History를 AI Voice Bot 바로 아래에 배치 — 음성 통화의 주요 출력 결과이기 때문)
  { href: '/store/call-history',    label: 'Call History',  icon: History     },
  { href: '/store/reservations',    label: 'Reservations',  icon: CalendarCheck },
  { href: '/store/analytics',    label: 'Analytics',    icon: BarChart2       },
  // Settings above Security — part of main functional nav, not the logout footer area
  // (Settings를 Security 위에 배치 — 로그아웃 푸터 영역이 아닌 메인 기능 내비의 일부)
  { href: '/store/settings', label: 'Settings', icon: Settings },
  {
    // Security group — infrequent, placed last to separate from daily-use items
    // (보안 그룹 — 빈번하지 않은 사용, 일상 사용 항목과 분리하기 위해 마지막에 배치)
    href:  '/store/security',
    label: 'Security',
    icon:  ShieldAlert,
    children: [
      { href: '/store/security/pos-overlay',   label: 'POS Overlay',      icon: Monitor },
      { href: '/store/security/solink',         label: 'Solink Monitoring', icon: Monitor },
      { href: '/store/security/prevent-theft', label: 'Prevent Theft',    icon: Eye     },
    ],
  },
];

export function DashboardShell({
  storeId,
  agentId,
  storeName,
  role,
  email,
  allStores,
  children,
}: DashboardShellProps) {
  const router             = useRouter();
  const pathname           = usePathname();
  const setStore           = useSessionStore((s) => s.setStore);
  const clearSession       = useSessionStore((s) => s.clearSession);
  const selectedStoreId    = useSessionStore((s) => s.selectedStoreId);
  const setSelectedStoreId = useSessionStore((s) => s.setSelectedStoreId);

  // Mobile sidebar open/closed state — false by default (모바일 사이드바 열림/닫힘 상태 — 기본값 닫힘)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Hydrate Zustand session store with server-resolved store data on mount.
  // (마운트 시 서버에서 확인된 매장 데이터로 Zustand 세션 스토어 초기화)
  useEffect(() => {
    setStore({ storeId, agentId, storeName, role });
  }, [storeId, agentId, storeName, role, setStore]);

  // Initialise selectedStoreId once on mount:
  //   agency  → first store from allStores (if not already set)
  //   store   → their own storeId (always override to keep it in sync)
  // (마운트 시 한 번만 selectedStoreId 초기화:
  //  에이전시 → allStores의 첫 번째 매장 (미설정 시),  매장 → 자신의 storeId (항상 동기화))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (role === 'agency') {
      if (!selectedStoreId && allStores.length > 0) {
        setSelectedStoreId(allStores[0].id);
      }
    } else if (role === 'store' && storeId) {
      setSelectedStoreId(storeId);
    }
  }, []); // Mount-only — intentional empty deps (마운트 시 한 번만 — 의도적 빈 의존성)

  // Close the mobile sidebar whenever the route changes (경로 변경 시 모바일 사이드바 자동 닫기)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Sign out from Supabase, clear local session, and navigate to login.
  // (Supabase 로그아웃, 로컬 세션 초기화 후 로그인 페이지로 이동)
  async function handleLogout() {
    await getSupabaseClient().auth.signOut();
    clearSession();
    router.push('/login');
  }

  // Settings is now in navItems — no separate settingsHref needed (설정이 navItems에 포함 — 별도 settingsHref 불필요)
  const navItems = role === 'agency' ? AGENCY_NAV : STORE_NAV;

  // Derive avatar initials from the first character of the email address.
  // (이메일 주소의 첫 번째 문자로 아바타 이니셜 생성)
  const avatarInitial = email.charAt(0).toUpperCase();

  // Shared sidebar content rendered in both the mobile drawer and the desktop column.
  // Extracted to avoid JSX duplication — both surfaces are identical in content.
  // (모바일 드로어와 데스크탑 컬럼 양쪽에 동일하게 렌더링되는 사이드바 콘텐츠.
  //  JSX 중복 방지를 위해 추출 — 두 곳의 내용이 동일)
  const sidebarContent = (
    <>
      {/* Brand / platform wordmark (브랜드 / 플랫폼 워드마크) */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-gray-200 px-5 dark:border-gray-800">
        <Building2 className="h-6 w-6 shrink-0 text-indigo-600 dark:text-indigo-400" />
        <span className="truncate text-sm font-semibold">JM AI Voice</span>
      </div>

      {/* Global store selector — agency users only (에이전시 사용자 전용 전역 매장 선택기) */}
      {role === 'agency' && allStores.length > 0 && (
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Store
          </p>
          <div className="relative">
            <select
              value={selectedStoreId ?? ''}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="h-9 w-full appearance-none rounded-lg border border-gray-300 bg-white py-0 pl-3 pr-8 text-sm font-medium text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {allStores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
          </div>
        </div>
      )}

      {/* Store name pill — store-role users only (매장 역할 사용자 전용 매장명 pill) */}
      {role === 'store' && storeName && (
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Store
          </p>
          <p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
            {storeName}
          </p>
        </div>
      )}

      {/* ── Navigation links (내비게이션 링크) ──────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navItems.map(({ href, label, icon: Icon, children: subItems }) => {

            // ── Grouped nav item with sub-menu (서브메뉴가 있는 그룹 내비게이션 항목) ──
            if (subItems && subItems.length > 0) {
              // Check if any child route is currently active (자식 경로 중 현재 활성 여부 확인)
              const groupActive = subItems.some(
                (c) => pathname === c.href || pathname.startsWith(`${c.href}/`)
              );

              return (
                <li key={href}>
                  {/* Section label — non-navigable group header (내비게이션 불가 섹션 헤더) */}
                  <div
                    className={`flex items-center gap-2.5 px-3 py-2 text-[11px] font-bold uppercase tracking-widest
                      ${groupActive
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-gray-400 dark:text-gray-500'}`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {label}
                  </div>

                  {/* Sub-menu items indented under the group header (그룹 헤더 아래 들여쓰기된 서브메뉴 항목) */}
                  <ul className="mt-0.5 space-y-0.5 pl-5">
                    {subItems.map(({ href: cHref, label: cLabel, icon: CIcon }) => {
                      const childActive = pathname === cHref || pathname.startsWith(`${cHref}/`);
                      return (
                        <li key={cHref}>
                          <Link
                            href={cHref}
                            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                              ${childActive
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                          >
                            <CIcon className="h-3.5 w-3.5 shrink-0" />
                            {cLabel}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            }

            // ── Regular flat nav item (일반 플랫 내비게이션 항목) ──
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors
                    ${active
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Bottom section — profile card + Log Out button only ──────────────── */}
      {/* Settings has been moved into the main nav above to prevent accidental clicks.
          Ample pb-8 padding creates a clear visual gap between the scrollable nav and
          this fixed footer, reducing mis-click risk on the logout button.
          (설정은 실수 클릭 방지를 위해 메인 내비게이션으로 이동됨.
           충분한 pb-8 여백으로 스크롤 가능한 내비와 이 고정 푸터 사이의 명확한 시각적 간격 확보) */}
      <div className="flex shrink-0 flex-col gap-4 border-t border-gray-200 p-4 pb-8 dark:border-gray-800">

        {/* User profile card — avatar + email + role badge
            (아바타 + 이메일 + 역할 배지로 구성된 사용자 프로필 카드) */}
        <div className="flex items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60">

          {/* Avatar circle — filled with email initial (이메일 이니셜로 채워진 아바타 원) */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold uppercase text-white shadow-sm ring-2 ring-indigo-100 dark:ring-indigo-900/40">
            {avatarInitial}
          </div>

          {/* Email + role badge (이메일 + 역할 배지) */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">
              {email}
            </p>
            <span className="mt-0.5 inline-block rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
              {role}
            </span>
          </div>
        </div>

        {/* Log Out button — prominent red accent, full width, clearly separated from profile card.
            gap-4 on the parent ensures consistent spacing above and below this button.
            (두드러진 빨간 강조, 전체 너비, 프로필 카드와 명확히 구분된 로그아웃 버튼.
             부모의 gap-4로 이 버튼 위아래에 일관된 간격 확보) */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-200 transition-colors hover:bg-red-100 dark:bg-red-950/20 dark:text-red-400 dark:ring-red-900/40 dark:hover:bg-red-950/30"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Log Out
        </button>
      </div>
    </>
  );

  // Wrap the entire shell in StoreProvider so every child page receives
  // storeId synchronously from props — eliminating the Zustand hydration race
  // that caused "No store linked" flashes on client-side navigation.
  // (Zustand 수화 경쟁으로 발생하던 "연결된 매장 없음" 깜박임 제거를 위해
  //  전체 셸을 StoreProvider로 감싸 모든 하위 페이지가 props에서
  //  동기적으로 storeId를 받도록 함)
  return (
    <StoreProvider value={{ storeId, agentId, storeName, role }}>
      <div className="flex h-full">

        {/* ── Mobile backdrop — darkens page content when drawer is open ──────── */}
        {/* Tap anywhere outside the drawer to close it (드로어 외부 탭으로 닫기) */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
        {/*
          Mobile:  fixed overlay drawer (z-50), slides in from left.
                   Hidden by default (-translate-x-full), visible when sidebarOpen (translate-x-0).
          Desktop: static flex column (md:static resets position to normal flow).
          Transition applies on both axes but md:translate-x-0 ensures desktop is always visible.
          (모바일: 왼쪽에서 슬라이드인되는 고정 오버레이 드로어(z-50).
                  기본값 숨김(-translate-x-full), sidebarOpen 시 표시(translate-x-0).
           데스크탑: md:static으로 일반 플로우에 복귀하는 정적 플렉스 컬럼.
                   md:translate-x-0으로 항상 표시 보장)
        */}
        <aside
          className={`
            fixed inset-y-0 left-0 z-50
            md:static md:inset-auto md:z-auto
            flex w-64 shrink-0 flex-col
            border-r border-gray-200 bg-white
            dark:border-gray-800 dark:bg-gray-900
            transition-transform duration-300 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            md:translate-x-0
          `}
        >
          {/* Close button — visible only inside the mobile drawer (모바일 드로어 전용 닫기 버튼) */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute right-3 top-3.5 flex md:hidden items-center justify-center rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>

          {sidebarContent}
        </aside>

        {/* ── Main content area ────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Mobile top bar — hamburger + wordmark, visible only on mobile (모바일 상단 바 — 햄버거 + 워드마크, 모바일 전용) */}
          <div className="flex md:hidden h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">

            {/* Hamburger button — opens the sidebar drawer (사이드바 드로어 여는 햄버거 버튼) */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Platform wordmark centred on mobile (모바일에서 가운데 정렬된 플랫폼 워드마크) */}
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">JM AI Voice</span>
            </div>

            {/* Live status badge — matches desktop topbar (데스크탑 상단바와 동일한 라이브 상태 배지) */}
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-[10px] font-semibold text-green-700 ring-1 ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-800">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              Live
            </span>
          </div>

          {/* Desktop topbar — hidden on mobile, shown on md and above (데스크탑 상단바 — 모바일 숨김, md 이상에서 표시) */}
          <header className="hidden md:flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-gray-800 dark:bg-gray-900">
            <h1 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              JM AI Voice Platform
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 ring-1 ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-800">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              Live
            </span>
          </header>

          {/* Page content — scrollable (스크롤 가능한 페이지 콘텐츠) */}
          <main className="flex-1 overflow-y-auto bg-gray-50 p-6 dark:bg-gray-950">
            {children}
          </main>
        </div>

      </div>
    </StoreProvider>
  );
}
