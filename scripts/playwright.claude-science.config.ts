import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: resolve(root, 'e2e'),
  testMatch: 'claude-science-*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  outputDir: resolve(root, 'test-results/motif-artifact'),
  use: {
    browserName: 'chromium',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    trace: 'on-first-retry',
    launchOptions: {
      args: [
        '--disable-gpu',
        '--force-color-profile=srgb',
        '--force-raster-color-profile=srgb',
      ],
    },
  },
});
