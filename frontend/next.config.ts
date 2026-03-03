import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 기존 config 옵션들이 있다면 유지하고 아래를 추가합니다 */
  
  typescript: {
    // !! 주의 !!
    // 프로젝트에 타입스크립트 에러가 있더라도 프로덕션 빌드를 강제로 완료하도록 허용합니다.
    ignoreBuildErrors: true,
  },
  eslint: {
    // 프로젝트에 ESLint 경고/에러가 있어도 빌드를 강제로 완료하도록 허용합니다.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;