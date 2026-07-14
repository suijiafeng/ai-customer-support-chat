import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 与 server/config.ts 保持一致：先 .env.local（高优先级），再 .env（兜底）
for (const file of ['.env.local', '.env']) {
  loadEnv({ path: join(repoRoot, file) });
}

// 默认构建产物由 NestJS 托管在 /workstation/ 路径；开发时根路径 + 代理到后端。
// 独立静态部署（不再由 server 托管）时设 VITE_BASE_PATH=/，构建产物挂在自己域名的根路径。
// 后端地址解析优先级：BACKEND_URL > PORT（根目录 .env.local/.env）> 3001
const backend = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '3001'}`;
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH || (command === 'build' ? '/workstation/' : '/'),
  plugins: [react()],
  build: { outDir: 'dist' },
  // 生产包剔除调试输出（含依赖里的），保留 warn/error 便于线上排障；dev 不受影响
  esbuild: command === 'build'
    ? { pure: ['console.log', 'console.debug', 'console.info'], drop: ['debugger'] }
    : undefined,
  server: {
    port: 5174,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
}));
