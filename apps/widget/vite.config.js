import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ command }) => ({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
  build: command === 'build' ? {
    lib: { entry: 'src/main.js', name: 'AssistFlowWidget', formats: ['iife'], fileName: () => 'widget.js' },
    outDir: 'dist',
    emptyOutDir: false,
  } : {},
}));
