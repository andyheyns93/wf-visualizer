import { defineConfig } from '@playwright/test';

// E2E tests load the built extension (dist/extension/) into a real Chromium and drive it.
// Build the extension first: `npm run build:ext` (the `test:e2e` script does this for you).
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/test-results',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
