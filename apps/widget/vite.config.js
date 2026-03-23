import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 后端地址通过 BACKEND_URL 注入，避免端口写死（默认 3001）
const backend = process.env.BACKEND_URL || 'http://localhost:3001';
const configDir = dirname(fileURLToPath(import.meta.url));

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
