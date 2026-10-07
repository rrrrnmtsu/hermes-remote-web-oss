import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  define: {
    // Dashboard plugins are loaded as classic browser scripts. React's CJS
    // build must not leave Node-only process.env references in the IIFE bundle.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      formats: ['iife'],
      name: 'HermesMobileTab',
      fileName: () => 'index.js',
    },
    outDir: '../../dashboard/dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      external: [],
      output: {
        exports: 'named',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'style.css';
          return assetInfo.name ?? 'assets/[name][extname]';
        },
      },
    },
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@hermes-pwa/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
