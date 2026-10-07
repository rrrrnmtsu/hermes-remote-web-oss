import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  base: '/hermes-remote-web/',
  publicDir: 'remote-public',
  define: { __REMOTE_BUILD_ID__: JSON.stringify(process.env.HERMES_REMOTE_BUILD_ID || 'development') },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    outDir: process.env.HERMES_REMOTE_OUTPUT || '../../releases/development',
    emptyOutDir: false,
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@hermes-pwa/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
