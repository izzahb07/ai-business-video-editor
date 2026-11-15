import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The app is served at https://izzahb07.github.io/ai-business-video-editor/
  base: '/ai-business-video-editor/',
  plugins: [react()],
  build: { target: 'safari16', sourcemap: true, chunkSizeWarningLimit: 1500 },
  optimizeDeps: { exclude: ['@mediabunny/aac-encoder'] },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
