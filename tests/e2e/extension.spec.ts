import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

// A stub Azure DevOps document. We fulfil navigations to dev.azure.com with this so the
// browser commits a page at a URL matching the content-script patterns — the extension
// then injects and detects context from the real URL (no ADO auth needed).
// Includes the toolbar anchors the ⬡ button attaches to: `#__bolt-edit` (file view) and a
// compare toolbar with the open file's path (PR / create-PR).
const STUB_HTML =
  '<!doctype html><html><head><title>Azure DevOps (stub)</title></head><body>' +
  '<button id="__bolt-edit">Edit</button>' +
  '<div class="repos-compare-toolbar"><span class="secondary-text">/src/Workflows/wf/workflow.json</span>' +
  '<div class="bolt-split-button">Inline</div></div>' +
  '<main id="ado">mocked Azure DevOps page</main></body></html>';

// The workflow the extension will "fetch" from the ADO items API in these tests.
const EXAMPLE_JSON = readFileSync('tests/data/nested.json', 'utf8');
const DIFF_BASE_JSON = readFileSync('tests/data/diff-base.json', 'utf8');
const DIFF_PR_JSON = readFileSync('tests/data/diff-pr.json', 'utf8');

const FILE_URL =
  'https://dev.azure.com/contoso/ProjectName/_git/integrations?path=/src/Workflows/wf/workflow.json&version=GBmain';

test.beforeEach(async ({ context }) => {
  // Serve the stub page for top-level navigations only.
  await context.route('https://dev.azure.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: STUB_HTML });
    } else {
      await route.fallback();
    }
  });

  // Serve the workflow content for the ADO "Get Item" REST call (added last → higher
  // priority than the document route for this URL).
  await context.route('**/_apis/git/repositories/**/items**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: EXAMPLE_JSON,
    });
  });
});

test('loads the background service worker', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

test('shows the toggle and renders the fetched workflow on a file view', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);

  // Toggle appears (in ADO's toolbar) only after the file is fetched and validated.
  const button = page.locator('.wf-ext-toolbar-btn');
  await expect(button).toBeVisible();
  await button.click();

  await expect(page.locator('.wf-ext-crumbs')).toContainText('contoso');
  await expect(page.locator('.wf-ext-surface')).toContainText('/src/Workflows/wf/workflow.json');
  await expect(page.locator('.wf-ext-ref')).toContainText('branch: main');

  // React Flow renders the fetched workflow inside the shadow root.
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  expect(await page.locator('.react-flow__node').count()).toBeGreaterThan(3);
  await expect(page.locator('.wf-node--trigger')).toContainText('Recurrence');
  await expect(page.locator('.react-flow__edge').first()).toBeAttached();
  expect(await page.locator('.react-flow__edge-status').count()).toBeGreaterThan(2);
});

test('fetches a file-view workflow pinned to the current branch', async ({ context }) => {
  // Record the versions the extension asks the items API for.
  const versions: (string | null)[] = [];
  await context.route('**/_apis/git/repositories/**/items**', (route) => {
    versions.push(new URL(route.request().url()).searchParams.get('versionDescriptor.version'));
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: EXAMPLE_JSON });
  });

  const page = await context.newPage();
  // A workflow that only exists on a feature branch (slashed name), taken from the page URL.
  await page.goto(
    'https://dev.azure.com/contoso/ProjectName/_git/integrations?path=/src/Workflows/wf/workflow.json&version=GBfeature/99999-x',
  );

  await expect(page.locator('.wf-ext-toolbar-btn')).toBeVisible();
  await page.locator('.wf-ext-toolbar-btn').click();

  // The fetch was pinned to the feature branch (not the default), and the panel labels it.
  expect(versions).toContain('feature/99999-x');
  await expect(page.locator('.wf-ext-ref')).toContainText('branch: feature/99999-x');
});

test('scrambles names and paths in the panel when the developer setting is on', async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { sync: { set: (o: object) => Promise<void> } } } }).chrome.storage.sync.set(
      { settings: { scramble: true } },
    ),
  );

  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.locator('.wf-ext-toolbar-btn').click();
  await expect(page.locator('.wf-node__name').first()).toBeVisible();

  // Header identifiers, the file path, and node names are all masked...
  await expect(page.locator('.wf-ext-crumbs')).not.toContainText('contoso');
  await expect(page.locator('.wf-ext-surface')).not.toContainText('Workflows');
  // Real action names (from nested.json) no longer appear as node labels.
  await expect(page.locator('.wf-node__name', { hasText: 'List_orders' })).toHaveCount(0);
  await expect(page.locator('.wf-node__name', { hasText: 'For_each_order' })).toHaveCount(0);
  // ...while path structure (separators) is preserved so it still reads as a path.
  await expect(page.locator('.wf-ext-surface')).toContainText('/');
});

test('exports the workflow to a file from the panel (scrambled by default)', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);
  await page.locator('.wf-ext-toolbar-btn').click();
  await expect(page.locator('.wf-node__name').first()).toBeVisible();

  await page.locator('.wf-ext-close[aria-label="More actions"]').click();
  await page.locator('.wf-ext-menu__item', { hasText: 'Export' }).click();
  const dialog = page.locator('.wf-ext-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="checkbox"]')).toBeChecked(); // scramble default on

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.locator('.wf-ext-btn--primary').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^wf-visualizer-single-scrambled-.*\.json$/);
});

test('imports & visualizes a workflow from the options page (wizard)', async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const optionsUrl = (await worker.evaluate(() => {
    const c = (
      globalThis as unknown as {
        chrome: {
          runtime: {
            getManifest: () => { options_ui?: { page: string }; options_page?: string };
            getURL: (p: string) => string;
          };
        };
      }
    ).chrome;
    const m = c.runtime.getManifest();
    return c.runtime.getURL(m.options_ui?.page ?? m.options_page ?? '');
  })) as string;

  const page = await context.newPage();
  await page.goto(optionsUrl);

  // Step through the wizard: Single → Paste JSON → paste a workflow → Import.
  await page.locator('.opt__import').click();
  await page.locator('.imp-choice', { hasText: 'Single workflow' }).click();
  await page.locator('.imp-choice', { hasText: 'Paste JSON' }).click();
  await page.locator('.imp-area').fill(EXAMPLE_JSON);
  await page.locator('.imp-btn--primary', { hasText: 'Import' }).click();

  await expect(page.locator('.opt-viewer')).toBeVisible();
  await expect(page.locator('.opt-viewer .react-flow__node').first()).toBeVisible();

  // Close the result and re-enter the step-by-step import flow.
  await page.locator('.opt-viewer__close').click();
  await expect(page.locator('.opt-viewer')).toHaveCount(0);
  await page.locator('.opt__import').click();
  await expect(page.locator('.imp-form')).toBeVisible();
});

test('rejects a single export when the PR (before/after) flow is chosen', async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const optionsUrl = (await worker.evaluate(() => {
    const c = (
      globalThis as unknown as {
        chrome: {
          runtime: {
            getManifest: () => { options_ui?: { page: string }; options_page?: string };
            getURL: (p: string) => string;
          };
        };
      }
    ).chrome;
    const m = c.runtime.getManifest();
    return c.runtime.getURL(m.options_ui?.page ?? m.options_page ?? '');
  })) as string;

  const singleExport = {
    format: 'wf-visualizer-export',
    formatVersion: 1,
    type: 'single',
    scrambled: false,
    exportedAt: '2026-08-07T00:00:00.000Z',
    workflow: JSON.parse(EXAMPLE_JSON),
  };

  const page = await context.newPage();
  await page.goto(optionsUrl);
  await page.locator('.opt__import').click();
  await page.locator('.imp-choice', { hasText: 'Before & after' }).click(); // PR flow
  await page.locator('.imp-choice', { hasText: 'Upload export' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(singleExport)),
  });

  // Mismatch is flagged; no viewer opens.
  await expect(page.locator('.imp-error')).toContainText('single-workflow export');
  await expect(page.locator('.opt-viewer')).toHaveCount(0);
});

test('follows the page background in auto theme mode (light page → light)', async ({ context }) => {
  await context.route('https://dev.azure.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body style="background:#ffffff">ado</body></html>',
      });
    } else {
      await route.fallback();
    }
  });

  const page = await context.newPage();
  await page.goto(FILE_URL);
  await expect(page.locator('.wf-ext-root')).toHaveAttribute('data-theme', 'light');
});

test('honors an explicit theme setting over the page theme', async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { sync: { set: (o: object) => Promise<void> } } } }).chrome.storage.sync.set(
      { settings: { theme: 'dark' } },
    ),
  );

  // A light page, but the explicit "dark" setting must win.
  await context.route('https://dev.azure.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body style="background:#ffffff">ado</body></html>',
      });
    } else {
      await route.fallback();
    }
  });

  const page = await context.newPage();
  await page.goto(FILE_URL);
  await expect(page.locator('.wf-ext-root')).toHaveAttribute('data-theme', 'dark');
});

test('hides the toggle when the file is not a workflow', async ({ context }) => {
  // Override the items response with non-workflow JSON.
  await context.route('**/_apis/git/repositories/**/items**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: '{"hello":"world"}' }),
  );

  const page = await context.newPage();
  await page.goto('https://dev.azure.com/contoso/ProjectName/_git/integrations?path=/notes.json');

  await page.waitForTimeout(1500);
  await expect(page.locator('.wf-ext-toolbar-btn')).toHaveCount(0);
});

test('hides the toggle when the file fetch fails (e.g. not signed in)', async ({ context }) => {
  await context.route('**/_apis/git/repositories/**/items**', (route) =>
    route.fulfill({ status: 401, contentType: 'text/plain', body: 'unauthorized' }),
  );

  const page = await context.newPage();
  await page.goto(FILE_URL);

  await page.waitForTimeout(1500);
  await expect(page.locator('.wf-ext-toolbar-btn')).toHaveCount(0);
});

test('shows no toggle on a PR until a workflow file has been opened', async ({ context }) => {
  // No workflow items request has been captured for this tab, so nothing to render yet.
  const page = await context.newPage();
  await page.goto('https://dev.azure.com/contoso/ProjectName/_git/integrations/pullrequest/42');

  await page.waitForTimeout(1500);
  await expect(page.locator('.wf-ext-toolbar-btn')).toHaveCount(0);
});

test('fetches with the captured ADO Bearer token (no PAT)', async ({ context }) => {
  const authOnContentFetch: (string | undefined)[] = [];

  // Record the Authorization header on the real (includeContent) workflow fetch, and
  // return the includeContent metadata wrapper the ADO app itself returns.
  await context.route('**/_apis/git/repositories/**/items**', async (route) => {
    if (route.request().url().includes('includeContent=true')) {
      authOnContentFetch.push(route.request().headers()['authorization']);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ objectId: 'x', content: EXAMPLE_JSON }),
    });
  });

  // Seed a captured token in the background worker's session store. (In production the
  // webRequest listener captures this from the ADO app's own API traffic; Playwright's
  // request interception bypasses webRequest, so we seed it directly here.)
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { session: { set: (o: object) => Promise<void> } } } }).chrome.storage.session.set(
      { 'token:dev.azure.com': 'Bearer TESTTOKEN' },
    ),
  );

  const page = await context.newPage();
  await page.goto(FILE_URL);

  await expect(page.locator('.wf-ext-toolbar-btn')).toBeVisible();
  await page.locator('.wf-ext-toolbar-btn').click();
  await expect(page.locator('.wf-node--trigger')).toContainText('Recurrence');

  // The authenticated workflow fetch used the Bearer token (not the cookie fallback).
  expect(authOnContentFetch).toContain('Bearer TESTTOKEN');
});

test('updates the panel on SPA navigation to another workflow (no reload)', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);

  await page.locator('.wf-ext-toolbar-btn').click();
  await expect(page.locator('.wf-ext-surface')).toContainText('/src/Workflows/wf/workflow.json');

  // Simulate ADO's soft navigation to a different workflow file (History API, no reload).
  await page.evaluate(() => {
    history.pushState(
      {},
      '',
      '/contoso/ProjectName/_git/integrations?path=/other/area/workflow.json&version=GBmain',
    );
  });

  await expect(page.locator('.wf-ext-surface')).toContainText('/other/area/workflow.json');
  await expect(page.locator('.wf-node--trigger')).toContainText('Recurrence');
});

const DETAIL_HTML =
  '<!doctype html><html><head><title>ADO detail</title></head><body>' +
  '<div class="repos-files-hub-page" style="position:absolute;top:80px;left:48px;width:880px;height:560px;">' +
  '<div class="repos-files-header-commandbar">' +
  '<button id="__bolt-edit" class="bolt-header-command-item-button bolt-button">Edit</button>' +
  '</div><div>file body</div></div></body></html>';

async function routeDetailPage(context: import('@playwright/test').BrowserContext) {
  await context.route('https://dev.azure.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: DETAIL_HTML });
    } else {
      await route.fallback();
    }
  });
}

test('places the toggle next to Edit and fills the page when content-area sizing is off (detail)', async ({
  context,
}) => {
  // Disable file-view content-area sizing (default is on) to test the full-page overlay.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { sync: { set: (o: object) => Promise<void> } } } }).chrome.storage.sync.set(
      { settings: { matchContentAreaFile: false } },
    ),
  );

  await routeDetailPage(context);

  const page = await context.newPage();
  await page.goto(FILE_URL);

  // Toolbar button appears (once the workflow loads); there is no floating fallback.
  const toolbarBtn = page.locator('.wf-ext-toolbar-btn');
  await expect(toolbarBtn).toBeVisible();

  // It is inserted immediately before the Edit button.
  const prevClass = await page.evaluate(
    () => document.getElementById('__bolt-edit')?.previousElementSibling?.className ?? '',
  );
  expect(prevClass).toContain('wf-ext-toolbar-mount');

  // With content-area sizing off, the panel fills the whole page viewport.
  await toolbarBtn.click();
  await expect(page.locator('.wf-ext-panel')).toBeVisible();
  const innerWidth = await page.evaluate(() => window.innerWidth);
  const panel = await page.locator('.wf-ext-panel').boundingBox();
  expect(panel).not.toBeNull();
  expect(Math.abs(panel!.width - innerWidth)).toBeLessThan(4);
  await expect(page.locator('.wf-node--trigger')).toContainText('Recurrence');
});

test('sizes the panel to the content area by default on a file view (detail)', async ({
  context,
}) => {
  // File-view content-area sizing is on by default — no setting needed.
  await routeDetailPage(context);
  const page = await context.newPage();
  await page.goto(FILE_URL);

  await page.locator('.wf-ext-toolbar-btn').click();
  await expect(page.locator('.wf-ext-panel')).toBeVisible();

  const container = await page.locator('.repos-files-hub-page').boundingBox();
  const panel = await page.locator('.wf-ext-panel').boundingBox();
  expect(container).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(Math.abs(panel!.width - container!.width)).toBeLessThan(3);
});

test('closes the panel on Escape', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);

  await page.locator('.wf-ext-toolbar-btn').click();
  await expect(page.locator('.wf-ext-panel')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.wf-ext-panel')).toHaveCount(0);
});

test('renders a before/after diff on a pull request', async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

  // Seed a token, and the captured workflow items URL (which the webRequest listener would
  // normally capture) so the background can derive the file path for this tab.
  const page = await context.newPage();
  await page.bringToFront();
  const tabId = (await worker.evaluate(async () => {
    const [tab] = await (
      globalThis as unknown as { chrome: { tabs: { query: (q: object) => Promise<{ id?: number }[]> } } }
    ).chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  })) as number | null;

  await worker.evaluate(
    (v: { tabId: number | null; url: string }) =>
      (globalThis as unknown as { chrome: { storage: { session: { set: (o: object) => Promise<void> } } } }).chrome.storage.session.set(
        {
          'token:dev.azure.com': 'Bearer T',
          [`wfurl:${v.tabId}`]: v.url,
        },
      ),
    {
      tabId,
      url: 'https://dev.azure.com/contoso/ProjectName/_apis/git/repositories/integrations/items?path=/src/Workflows/wf/workflow.json&includeContent=true',
    },
  );

  // PR details → the two merge commits.
  await context.route('**/_apis/git/repositories/**/pullRequests/**', (route) =>
    route.fulfill({
      json: { lastMergeTargetCommit: { commitId: 'base1' }, lastMergeSourceCommit: { commitId: 'head1' } },
    }),
  );
  // The file at each commit → base vs PR workflow.
  await context.route('**/_apis/git/repositories/**/items**', (route) => {
    const version = new URL(route.request().url()).searchParams.get('versionDescriptor.version');
    const body = version === 'base1' ? DIFF_BASE_JSON : DIFF_PR_JSON;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: body }) });
  });

  await page.goto('https://dev.azure.com/contoso/ProjectName/_git/integrations/pullrequest/42');
  await page.locator('.wf-ext-toolbar-btn').click();

  // Two panes (before / after) and the change highlighting.
  await expect(page.locator('.wf-diff__pane')).toHaveCount(2);
  await expect(page.locator('.wf-diff--added').first()).toBeVisible(); // Notify (added)
  await expect(page.locator('.wf-diff--removed').first()).toBeVisible(); // Cleanup (removed)
  await expect(page.locator('.wf-diff--renamed').first()).toBeVisible(); // Old_name ↔ New_name

  // Change navigator: window present, next focuses a change and opens its diff.
  await expect(page.locator('.wf-diff-nav')).toBeVisible();
  await page.locator('button[aria-label="Next change"]').click();
  await expect(page.locator('.wf-focused').first()).toBeVisible();
  await expect(page.locator('.inspector')).toBeVisible();
  // Fields view is the default; toggling to Raw shows the line diff.
  await expect(page.locator('.inspector .jf')).toBeVisible();
  await page.locator('.inspector__viewtoggle button', { hasText: 'Raw' }).click();
  await expect(page.locator('.inspector .diff-lines')).toBeVisible();

  // The change list has all four changes (changed, renamed, added, removed).
  await page.locator('button[aria-label="Toggle change list"]').click();
  await expect(page.locator('.wf-diff-nav__item')).toHaveCount(4);
});

test('renders a before/after diff on a single commit (parent → commit)', async ({ context }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // Seed a token (the webRequest capture is bypassed by Playwright's request interception).
  await worker.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { session: { set: (o: object) => Promise<void> } } } }).chrome.storage.session.set(
      { 'token:dev.azure.com': 'Bearer T' },
    ),
  );

  // Commit details → its first parent (the "before" version).
  await context.route('**/_apis/git/repositories/**/commits/**', (route) =>
    route.fulfill({ json: { parents: ['base1'] } }),
  );
  // The file at each version → parent (base) vs commit (after).
  await context.route('**/_apis/git/repositories/**/items**', (route) => {
    const version = new URL(route.request().url()).searchParams.get('versionDescriptor.version');
    const body = version === 'base1' ? DIFF_BASE_JSON : DIFF_PR_JSON;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: body }) });
  });

  const page = await context.newPage();
  // The commit view reads the open file path from the compare toolbar (in STUB_HTML).
  await page.goto(
    'https://dev.azure.com/contoso/ProjectName/_git/integrations/commit/46e53d68abf1?refName=refs%2Fheads%2Ffeature%2Fx',
  );
  await page.locator('.wf-ext-toolbar-btn').click();

  // Two panes with the before/after change highlighting, same as a PR.
  await expect(page.locator('.wf-diff__pane')).toHaveCount(2);
  await expect(page.locator('.wf-diff--added').first()).toBeVisible();
  await expect(page.locator('.wf-diff--removed').first()).toBeVisible();
  await expect(page.locator('.wf-diff-nav')).toBeVisible();
});

test('collapses a scope container, hiding nested nodes', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FILE_URL);

  await page.locator('.wf-ext-toolbar-btn').click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();

  const before = await page.locator('.react-flow__node').count();
  await page.locator('.wf-scope__toggle').first().click();

  await expect
    .poll(async () => page.locator('.react-flow__node').count())
    .toBeLessThan(before);
});
