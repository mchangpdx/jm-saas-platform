// Root layout — sets up fonts, dark-mode class strategy, and global meta.
// All route groups inherit this shell without re-mounting on navigation.
// (루트 레이아웃 — 폰트, 다크 모드 클래스 전략, 전역 메타 설정.
//  모든 라우트 그룹이 탐색 시 재마운트 없이 이 셸을 상속)

import type { Metadata }      from 'next';
import { Inter }              from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title:       'JM AI Voice Platform',
  description: 'B2B SaaS AI Voice Platform for Restaurant & Retail POS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      {/*
        The `dark` class is toggled on <html> to enable Tailwind dark-mode variants.
        (`dark` 클래스는 Tailwind 다크 모드 변형 활성화를 위해 <html>에 토글됨)
      */}
      <body className={`${inter.className} h-full bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100`}>
        {children}
      </body>
    </html>
  );
}
