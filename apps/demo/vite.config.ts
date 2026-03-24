import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 演示站 SPA：widget 嵌入演示（模拟第三方宿主网站）。
// 通过 <script src="/widget/widget.js"> 消费已发布的组件产物，不依赖 widget 源码。
// dev 模式下 /widget 与 /workstation 由后端提供——需先构建一次；
// demo 模式（vite preview）消费 build 产物，同样把这些路径代理到后端。
// 后端地址通过 BACKEND_URL 注入，避免端口写死（默认 3001）。
const backend = process.env.BACKEND_URL || 'http://localhost:3001';
const proxy = {
  '/api': { target: backend, changeOrigin: true },
  '/widget': { target: backend, changeOrigin: true },
  '/workstation': { target: backend, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5175,
    proxy,
  },
  preview: {
    port: 5175,
    proxy,
  },
});
