import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'scripts/**/__tests__/**/*.test.mjs',
    ],
    pool: 'forks',
    execArgv: ['--max-old-space-size=4096'],
    testTimeout: 15_000,
    environment: 'node',
  },
});
