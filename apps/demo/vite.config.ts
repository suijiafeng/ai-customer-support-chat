import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 演示站 SPA：widget 嵌入演示（模拟第三方宿主网站）。
// 通过 <script src="/widget/widget.js"> 消费已发布的组件产物，不依赖 widget 源码。
// dev 模式下 /widget 与 /workstation 由后端（3001）提供——需先构建一次
// （根目录 predev:all 已自动处理 widget；工作台跳转链接同理走 3001）。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/widget': { target: 'http://localhost:3001', changeOrigin: true },
      '/workstation': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
