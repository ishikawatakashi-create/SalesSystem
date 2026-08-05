import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 日本時間表示はアプリ層で行う。サーバー・DBはUTCで一貫させる。
  reactStrictMode: true,
};

export default nextConfig;
