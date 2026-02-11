import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 演示站 SPA：落地页 + widget 嵌入演示（/embed/ 路由）。
// 嵌入演示像真实第三方网站一样通过 <script src="/widget/widget.js">
// 消费组件产物，不依赖 widget 源码。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5175,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
