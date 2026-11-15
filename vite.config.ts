import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative paths so the app works at https://<user>.github.io/<repo>/
  base: './',
  plugins: [react()],
  build: { target: 'safari16', sourcemap: true, chunkSizeWarningLimit: 1500 },
  optimizeDeps: { exclude: ['@mediabunny/aac-encoder'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
