import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['packages/**/*.{ts,tsx,js,jsx}'],
      // Preserve measured package-source floors, including the JavaScript workers.
      // Generated release copies must not change the denominator after a build.
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 75,
        statements: 80,
      },
      exclude: [
        '**/.agent-scratch/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/test/**',
        '**/*.config.*',
        '**/scripts/**',
        '**/dashboard/**',
        '**/*.d.ts',
        '**/.eslintrc.cjs',
        'packages/web/src/main.tsx',
      ],
    },
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: {
      '@hermes-pwa/core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
});
