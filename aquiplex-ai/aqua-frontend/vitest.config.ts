import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Unit + rendered-DOM regression suite.
 *
 * Deliberately separate from vite.config.ts: the app config carries the PWA
 * plugin, the build stamp and manual chunking, none of which a test run should
 * pay for or be affected by.
 *
 * jsdom has no layout engine, so nothing here can assert geometry. It asserts
 * the DECISIONS and the STRUCTURE — which is where the reported bug lived.
 * Geometry is e2e/ (see playwright.config.ts).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
  },
});
