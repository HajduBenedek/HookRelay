import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild drops decorator metadata, which NestJS needs for dependency injection; SWC keeps it.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        // Real Postgres and Redis in containers: needs Docker.
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
