import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(configDir, '..', '..');

// 与 server/config.ts 保持一致：先 .env.local（高优先级），再 .env（兜底）
// dotenv 默认不覆盖已存在的环境变量，顺序即优先级
for (const file of ['.env.local', '.env']) {
  loadEnv({ path: join(repoRoot, file) });
}

// 后端地址解析优先级：BACKEND_URL > PORT（根目录 .env.local/.env）> 3001
const backend = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '3001'}`;

function stripBundleComments() {
  return {
    name: 'strip-bundle-comments-post-build',
    closeBundle() {
      const bundlePath = resolve(configDir, 'dist/widget.js');
      if (!existsSync(bundlePath)) return;
      const code = readFileSync(bundlePath, 'utf8');
      writeFileSync(bundlePath, code.replace(/\/\*[\s\S]*?\*\//g, ''), 'utf8');
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), command === 'build' ? stripBundleComments() : null].filter(Boolean),
  build: command === 'build'
    ? {
        lib: { entry: 'src/main.tsx', name: 'AssistFlowWidget', formats: ['iife'], fileName: () => 'widget.js' },
        outDir: 'dist',
        sourcemap: false,
        minify: 'esbuild',
      }
    : {
        sourcemap: true,
      },
  esbuild: command === 'build' ? { legalComments: 'none' } : undefined,
  // widget 以 IIFE 嵌入第三方站点，构建时打入生产版 React；dev 预览不替换
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  server: {
    port: 5173,
    proxy: { '/api': { target: backend, changeOrigin: true } },
  },
}));
