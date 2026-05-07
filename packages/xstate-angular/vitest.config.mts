import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    name: '@zurab/xstate-angular',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts']
  },
  resolve: {
    alias: {
      xstate: path.resolve(__dirname, '../core/src/index.ts')
    }
  }
});
