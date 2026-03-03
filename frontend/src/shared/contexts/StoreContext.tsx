// StoreContext — React Context that carries the server-resolved store identity
// down to every client component without prop-drilling or Zustand hydration races.
// The DashboardShell (parent) receives storeId as a prop from the Server Component
// layout and immediately provides it via this context — synchronously, on first render.
// (StoreContext — prop 드릴링이나 Zustand 수화 경쟁 없이 서버에서 확인된 매장 정보를
//  모든 클라이언트 컴포넌트에 전달하는 React Context.
//  DashboardShell(부모)이 서버 컴포넌트 레이아웃에서 storeId를 prop으로 받아
//  이 컨텍스트를 통해 즉시 동기적으로 제공함)

'use client';

import { createContext, useContext } from 'react';

// Values exposed through the store context (스토어 컨텍스트를 통해 노출되는 값)
export interface StoreContextValue {
  storeId:   string;              // Empty string when no store is linked (연결된 매장 없을 때 빈 문자열)
  agentId:   string;
  storeName: string;
  role:      'agency' | 'store';
}

// Default context value — replaced immediately by StoreProvider on mount.
// (기본 컨텍스트 값 — 마운트 시 StoreProvider에 의해 즉시 교체됨)
const StoreContext = createContext<StoreContextValue>({
  storeId:   '',
  agentId:   '',
  storeName: '',
  role:      'store',
});

// StoreProvider — wraps dashboard children to make store context available.
// Receives the server-resolved store data as its value prop.
// (StoreProvider — 스토어 컨텍스트를 사용 가능하게 대시보드 하위 컴포넌트를 감싸는 컴포넌트.
//  서버에서 확인된 매장 데이터를 value prop으로 받음)
export function StoreProvider({
  value,
  children,
}: {
  value:    StoreContextValue;
  children: React.ReactNode;
}) {
  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
}

// useStoreContext — hook for consuming the store context in any client component.
// storeId is available synchronously on the very first render — no mounted guard needed.
// (useStoreContext — 모든 클라이언트 컴포넌트에서 스토어 컨텍스트를 사용하는 훅.
//  storeId는 첫 번째 렌더에서 동기적으로 사용 가능 — mounted 가드 불필요)
export function useStoreContext(): StoreContextValue {
  return useContext(StoreContext);
}
