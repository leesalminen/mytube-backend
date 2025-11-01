import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['test/**', 'dist/**', 'prisma/**']
    }
  }
});
