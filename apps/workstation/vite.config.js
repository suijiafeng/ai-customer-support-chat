import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 默认构建产物由 NestJS 托管在 /workstation/ 路径；开发时根路径 + 代理到后端。
// 独立静态部署（不再由 server 托管）时设 VITE_BASE_PATH=/，构建产物挂在自己域名的根路径。
// 后端地址通过 BACKEND_URL 注入，避免端口写死（默认 3001）
const backend = process.env.BACKEND_URL || 'http://localhost:3001';

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH || (command === 'build' ? '/workstation/' : '/'),
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
}));
