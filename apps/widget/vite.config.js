import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后端地址通过 BACKEND_URL 注入，避免端口写死（默认 3001）
const backend = process.env.BACKEND_URL || 'http://localhost:3001';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // widget 以 IIFE 嵌入第三方站点，构建时打入生产版 React；dev 预览不替换
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  server: {
    port: 5173,
    proxy: { '/api': { target: backend, changeOrigin: true } },
  },
  build: command === 'build' ? {
    lib: { entry: 'src/main.tsx', name: 'AssistFlowWidget', formats: ['iife'], fileName: () => 'widget.js' },
    outDir: 'dist',
  } : {},
}));
