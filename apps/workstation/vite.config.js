import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 构建时部署在 Express 的 /workstation 路径；开发时根路径 + 代理到后端
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/workstation/' : '/',
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: false },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
}));
