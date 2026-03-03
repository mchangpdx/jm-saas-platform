import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 👇 여기부터 새로 추가된 부분입니다! (자동 리다이렉트 기능)
  async redirects() {
    return [
      {
        source: '/',          // 사용자가 메인 주소(루트)로 접속하면
        destination: '/login',// 무조건 /login 경로로 보냅니다
        permanent: true,      // 영구적인 이동임을 검색엔진에 알립니다
      },
    ];
  },
};

export default nextConfig;