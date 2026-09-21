import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

const EXTENSION_PATH = path.resolve('dist/extension');

/**
 * A fixture that launches a persistent Chromium context with the built extension loaded.
 *
 * Chrome extensions require a headed context; we use the new headless mode
 * (`--headless=new`), which supports extensions and needs no display. Set HEADED=1 to
 * watch it run in a real window.
 */
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...(process.env.HEADED ? [] : ['--headless=new']),
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // The background service worker's URL carries the extension id.
    let worker: Worker | undefined = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await use(id);
  },
});

export const expect = test.expect;
