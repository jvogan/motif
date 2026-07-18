import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated Playwright config for the MSA interaction spec. It spins up its own
// Vite dev server on a dedicated port so it never collides with the shared
// artifact e2e run or a live dev server. The opt-in flag is set here rather
// than through shell syntax so `npm run test:e2e:msa` stays cross-platform.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.MOTIF_MSA_E2E_PORT ?? 5223);
process.env.MOTIF_MSA_E2E = '1';

export default defineConfig({
  testDir: resolve(root, 'e2e'),
  testMatch: 'claude-science-msa-interactions.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  outputDir: resolve(root, 'test-results/msa-interactions'),
  timeout: 60_000,
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${port}`,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'on-first-retry',
    launchOptions: {
      args: ['--disable-gpu', '--force-color-profile=srgb', '--force-raster-color-profile=srgb'],
    },
  },
  webServer: {
    command: `node_modules/.bin/vite --config vite.claude-science.config.ts --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/motif.html`,
    cwd: root,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
