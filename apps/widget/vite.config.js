import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    // widget 以 IIFE 嵌入第三方站点，打入生产版 React
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
  build: command === 'build' ? {
    lib: { entry: 'src/main.tsx', name: 'AssistFlowWidget', formats: ['iife'], fileName: () => 'widget.js' },
    outDir: 'dist',
    emptyOutDir: false,
  } : {},
}));
