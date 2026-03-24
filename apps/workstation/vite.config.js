import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 构建产物由 NestJS 托管在 /workstation/ 路径；开发时根路径 + 代理到后端
// 后端地址通过 BACKEND_URL 注入，避免端口写死（默认 3001）
const backend = process.env.BACKEND_URL || 'http://localhost:3001';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/workstation/' : '/',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
}));
