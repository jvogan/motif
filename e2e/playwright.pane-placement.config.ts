import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.MOTIF_PANE_E2E_PORT ?? 5227);

export default defineConfig({
  testDir: resolve(root, 'e2e'),
  testMatch: 'claude-science-pane-placement.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  outputDir: resolve(root, 'test-results/pane-placement'),
  timeout: 60_000,
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${port}`,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'on-first-retry',
  },
  webServer: {
    command: `node_modules/.bin/vite --config vite.claude-science.config.ts --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/motif.html`,
    cwd: root,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
