import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 演示站：落地页（React）+ widget 嵌入演示页（纯 HTML，像真实第三方网站一样
// 通过 <script src="/widget/widget.js"> 消费组件产物，不依赖 widget 源码）。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed/index.html'),
      },
    },
  },
  server: {
    port: 5175,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
