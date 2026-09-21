/**
 * Background service worker (MV3).
 *
 * Auth strategy: the Azure DevOps web app authenticates its own `_apis` calls with a
 * short-lived `Authorization: Bearer …` token. We observe those requests (read-only
 * webRequest) and reuse the most recent token to fetch the workflow file ourselves — so
 * no Personal Access Token setup is needed while the user is signed in.
 *
 * Tokens are cached per host in memory and in `chrome.storage.session` (kept in RAM,
 * cleared when the browser closes, never written to disk), so they survive the service
 * worker being evicted.
 */
import {
  buildCommitUrl,
  buildItemsUrl,
  buildPullRequestUrl,
  buildVersionItemsUrl,
  isWorkflowItemsRequest,
  parseVersionDescriptor,
  unwrapItemsResponse,
} from './adoApi';
import type { AdoContext, AdoRef } from './adoContext';
import type { ExtMessage, FetchPrDiffResponse, FetchWorkflowResponse } from './messaging';

const API_URL_PATTERNS = ['https://dev.azure.com/*/_apis/*', 'https://*.visualstudio.com/*/_apis/*'];
const tokenKey = (host: string) => `token:${host}`;
const wfUrlKey = (tabId: number) => `wfurl:${tabId}`;
const wfRefKey = (tabId: number) => `wfref:${tabId}`;

// In-memory caches; storage.session is the durable-across-worker-restart backing store.
const tokenCache = new Map<string, string>();

// The ADO app's own "Get Item" URL for the workflow last opened in each tab. Re-issuing
// this exact URL is authoritative (correct repo id, version, encoding) and updates on SPA
// navigation without a page reload.
const tabWorkflowUrl = new Map<number, string>();

// The version descriptor (branch/commit/tag) from that same request — the authoritative
// branch for the tab. Used to pin a reconstructed fetch to the right branch when the page
// URL didn't carry `&version=` (a branch-only workflow would otherwise 404 on the default
// branch), and to report which ref the content actually came from.
const tabWorkflowRef = new Map<number, AdoRef>();

chrome.runtime.onInstalled.addListener(() => {
  console.info('[wf-visualizer] extension installed');
});

// Capture the Bearer token from Azure DevOps' own API traffic.
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'authorization');
    if (auth?.value?.startsWith('Bearer ')) {
      try {
        const host = new URL(details.url).host;
        tokenCache.set(host, auth.value);
        void chrome.storage.session.set({ [tokenKey(host)]: auth.value });
      } catch {
        // ignore malformed URLs
      }
    }

    // A workflow file was opened (initial load or SPA navigation). Remember the app's own
    // request URL — and the branch/commit it targeted — for this tab, then nudge the content
    // script to (re)load.
    if (details.tabId >= 0 && isWorkflowItemsRequest(details.url)) {
      tabWorkflowUrl.set(details.tabId, details.url);
      const set: Record<string, unknown> = { [wfUrlKey(details.tabId)]: details.url };
      const ref = parseVersionDescriptor(details.url);
      if (ref) {
        tabWorkflowRef.set(details.tabId, ref);
        set[wfRefKey(details.tabId)] = ref;
      }
      void chrome.storage.session.set(set);
      chrome.tabs.sendMessage(details.tabId, { type: 'wf/workflowChanged' }).catch(() => {
        // no content script in this tab yet — ignore
      });
    }
    return undefined;
  },
  { urls: API_URL_PATTERNS },
  ['requestHeaders', 'extraHeaders'],
);

async function getToken(host: string): Promise<string | undefined> {
  const cached = tokenCache.get(host);
  if (cached) return cached;
  const key = tokenKey(host);
  const stored = await chrome.storage.session.get(key);
  const value = stored[key] as string | undefined;
  if (value) tokenCache.set(host, value);
  return value;
}

async function getWorkflowUrl(tabId: number | undefined): Promise<string | undefined> {
  if (tabId == null) return undefined;
  const cached = tabWorkflowUrl.get(tabId);
  if (cached) return cached;
  const key = wfUrlKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const value = stored[key] as string | undefined;
  if (value) tabWorkflowUrl.set(tabId, value);
  return value;
}

/** The branch/commit the ADO app last requested for this tab (from its items call). */
async function getWorkflowRef(tabId: number | undefined): Promise<AdoRef | undefined> {
  if (tabId == null) return undefined;
  const cached = tabWorkflowRef.get(tabId);
  if (cached) return cached;
  const key = wfRefKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const value = stored[key] as AdoRef | undefined;
  if (value) tabWorkflowRef.set(tabId, value);
  return value;
}

async function fetchWorkflow(
  context: AdoContext,
  tabId?: number,
): Promise<FetchWorkflowResponse> {
  const token = await getToken(context.host);
  if (!token) return { ok: false, reason: 'no-token' };

  // Prefer the ADO app's own request URL for this tab (authoritative: correct repo id,
  // version, and encoding). Fall back to building one — only possible for a file surface (a
  // pull request has no single file path).
  let url = await getWorkflowUrl(tabId);
  if (!url) {
    if (context.surface !== 'file' || !context.path) return { ok: false, reason: 'not-found' };
    // Pin to a branch/commit: prefer the page URL's ref, else the one the ADO app used for
    // this tab. Without it, a branch-only workflow would 404 against the default branch.
    const ref =
      context.ref && context.ref.type !== 'unknown' ? context.ref : await getWorkflowRef(tabId);
    url =
      ref && ref.type !== 'unknown'
        ? buildVersionItemsUrl(context, context.path, ref.value, ref.type)
        : buildItemsUrl(context);
  }
  // The path of the file actually being fetched (from the URL we use).
  let path = context.path ?? '';
  try {
    path = new URL(url).searchParams.get('path') ?? path;
  } catch {
    // keep context.path
  }
  // The branch/commit the fetched URL resolved to — reported so the panel labels it correctly.
  const ref = parseVersionDescriptor(url) ?? context.ref;

  try {
    const res = await fetch(url, {
      headers: { Authorization: token, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      // Token likely expired — drop it so the next captured one is used.
      tokenCache.delete(context.host);
      void chrome.storage.session.remove(tokenKey(context.host));
      return { ok: false, reason: 'unauthorized', status: res.status };
    }
    if (res.status === 404) return { ok: false, reason: 'not-found', status: 404 };
    if (!res.ok) return { ok: false, reason: 'error', status: res.status };
    return { ok: true, text: unwrapItemsResponse(await res.text()), path, ref };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Fetch a file's raw text at a version (branch/commit); null on 404 (added/removed side). */
async function fetchFileAtVersion(
  ctx: AdoContext,
  path: string,
  version: string,
  versionType: 'branch' | 'commit',
  token: string,
): Promise<string | null> {
  const res = await fetch(buildVersionItemsUrl(ctx, path, version, versionType), {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`items ${res.status}`);
  return unwrapItemsResponse(await res.text());
}

/** Resolve the before/after versions to compare for a PR, a create-PR page, or a commit. */
async function resolveDiffVersions(
  context: AdoContext,
  token: string,
): Promise<{ before: string; after: string; type: 'branch' | 'commit' } | null> {
  if (context.surface === 'pullrequestcreate') {
    if (!context.sourceRef || !context.targetRef) return null;
    return { before: context.targetRef, after: context.sourceRef, type: 'branch' };
  }
  // Commit view: diff the commit against its first parent (its state before this commit).
  if (context.surface === 'commit') {
    if (!context.commit) return null;
    const res = await fetch(buildCommitUrl(context, context.commit), {
      headers: { Authorization: token, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const commit = (await res.json()) as { parents?: string[] };
    const parent = commit.parents?.[0];
    // No parent (root commit) → compare against itself (everything reads as unchanged).
    return { before: parent ?? context.commit, after: context.commit, type: 'commit' };
  }
  const prRes = await fetch(buildPullRequestUrl(context), {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  if (!prRes.ok) return null;
  const pr = (await prRes.json()) as {
    lastMergeTargetCommit?: { commitId?: string };
    lastMergeSourceCommit?: { commitId?: string };
  };
  const before = pr.lastMergeTargetCommit?.commitId;
  const after = pr.lastMergeSourceCommit?.commitId;
  return before && after ? { before, after, type: 'commit' } : null;
}

/** Fetch the before/after versions of the workflow file open in a PR (or create-PR). */
async function fetchPrDiff(
  context: AdoContext,
  requestedPath: string | undefined,
  tabId?: number,
): Promise<FetchPrDiffResponse> {
  const token = await getToken(context.host);
  if (!token) return { ok: false, reason: 'no-token' };

  // Prefer the explicit path (the file open in the compare toolbar); otherwise fall back to
  // the path from the ADO app's own captured items request.
  let path: string | null = requestedPath ?? null;
  if (!path) {
    const capturedUrl = await getWorkflowUrl(tabId);
    try {
      path = capturedUrl ? new URL(capturedUrl).searchParams.get('path') : null;
    } catch {
      path = null;
    }
  }
  if (!path) return { ok: false, reason: 'not-found' };

  try {
    const versions = await resolveDiffVersions(context, token);
    if (!versions) return { ok: false, reason: 'error' };
    const [before, after] = await Promise.all([
      fetchFileAtVersion(context, path, versions.before, versions.type, token),
      fetchFileAtVersion(context, path, versions.after, versions.type, token),
    ]);
    return { ok: true, path, before, after };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

chrome.runtime.onMessage.addListener((message: ExtMessage, sender, sendResponse) => {
  if (message?.type === 'wf/fetchWorkflow') {
    fetchWorkflow(message.context, sender.tab?.id).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message?.type === 'wf/fetchPrDiff') {
    fetchPrDiff(message.context, message.path, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (message?.type === 'wf/openOptions') {
    void chrome.runtime.openOptionsPage();
    return undefined;
  }
  return undefined;
});

// Forget a tab's captured URL/ref when it closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  tabWorkflowUrl.delete(tabId);
  tabWorkflowRef.delete(tabId);
  void chrome.storage.session.remove([wfUrlKey(tabId), wfRefKey(tabId)]);
});

export {};
