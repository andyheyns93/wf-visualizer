import { ADO_API_VERSION } from '../config';
import type { AdoContext, AdoRef } from './adoContext';

const enc = encodeURIComponent;

/**
 * Build the Azure DevOps REST "Get Item" URL for a file-surface context.
 * `includeContent=true` returns the file text inside the item metadata JSON
 * (`{ ..., "content": "<file text>" }`), matching what the ADO web app itself requests.
 *
 * dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items?path=...
 * {org}.visualstudio.com/{project}/_apis/git/repositories/{repo}/items?path=...
 */
export function buildItemsUrl(ctx: AdoContext): string {
  if (ctx.surface !== 'file' || !ctx.path) {
    throw new Error('buildItemsUrl requires a file-surface context with a path.');
  }

  const origin =
    ctx.host === 'dev.azure.com'
      ? `https://dev.azure.com/${enc(ctx.org)}`
      : `https://${enc(ctx.org)}.visualstudio.com`;

  const params = new URLSearchParams({
    path: ctx.path,
    'api-version': ADO_API_VERSION,
    includeContent: 'true',
    resolveLfs: 'true',
  });
  if (ctx.ref && ctx.ref.type !== 'unknown') {
    params.set('versionDescriptor.versionType', ctx.ref.type);
    params.set('versionDescriptor.version', ctx.ref.value);
  }

  return `${origin}/${enc(ctx.project)}/_apis/git/repositories/${enc(ctx.repo)}/items?${params.toString()}`;
}

/**
 * True if a URL is the Azure DevOps app's own "Get Item" call for a workflow file
 * (a `.json` fetched with `includeContent=true`). The app issues this on every navigation
 * to a file — including SPA navigations with no page reload — so it doubles as a reliable
 * "a workflow was opened" signal. Case-insensitive on `/items` (the app uses `/Items`).
 */
export function isWorkflowItemsRequest(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/\/_apis\/git\/repositories\/[^/]+\/items$/i.test(u.pathname)) return false;
    if (u.searchParams.get('includeContent') !== 'true') return false;
    return /\.json$/i.test(u.searchParams.get('path') ?? '');
  } catch {
    return false;
  }
}

/**
 * Extract the version descriptor (branch/commit/tag) from an ADO "Get Item" URL — e.g. the
 * app's own request captured via `webRequest`. This is the authoritative branch for a file
 * view: ADO includes it even when the page URL omits `&version=`, and a branch-only workflow
 * would 404 against the default branch without it. ADO's web app uses a numeric versionType
 * (0=branch, 1=tag, 2=commit); the public REST API also accepts the string forms, so we accept
 * both. Returns undefined when the URL carries no version descriptor.
 */
export function parseVersionDescriptor(url: string): AdoRef | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const value = u.searchParams.get('versionDescriptor.version');
  if (!value) return undefined;
  const raw = (u.searchParams.get('versionDescriptor.versionType') ?? '').toLowerCase();
  const type: AdoRef['type'] =
    raw === '1' || raw === 'tag'
      ? 'tag'
      : raw === '2' || raw === 'commit'
        ? 'commit'
        : 'branch'; // 0 / "branch" / anything else → branch (ADO's default)
  return { type, value };
}

/** Base URL for an org/project/repo, on either ADO host form. */
function repoBase(ctx: Pick<AdoContext, 'host' | 'org' | 'project' | 'repo'>): string {
  const origin =
    ctx.host === 'dev.azure.com'
      ? `https://dev.azure.com/${enc(ctx.org)}`
      : `https://${enc(ctx.org)}.visualstudio.com`;
  return `${origin}/${enc(ctx.project)}/_apis/git/repositories/${enc(ctx.repo)}`;
}

/** REST URL for a pull request's details (source/target merge commits). */
export function buildPullRequestUrl(ctx: AdoContext): string {
  if (ctx.surface !== 'pullrequest' || !ctx.pullRequestId) {
    throw new Error('buildPullRequestUrl requires a pull-request context.');
  }
  return `${repoBase(ctx)}/pullRequests/${enc(ctx.pullRequestId)}?api-version=${ADO_API_VERSION}`;
}

/** REST URL for a single commit's metadata (used to find its parent for a commit-view diff). */
export function buildCommitUrl(
  ctx: Pick<AdoContext, 'host' | 'org' | 'project' | 'repo'>,
  commitId: string,
): string {
  return `${repoBase(ctx)}/commits/${enc(commitId)}?api-version=${ADO_API_VERSION}`;
}

/** REST "Get Item" URL for a file at a specific version (branch/commit/tag). */
export function buildVersionItemsUrl(
  ctx: Pick<AdoContext, 'host' | 'org' | 'project' | 'repo'>,
  path: string,
  version: string,
  versionType: 'branch' | 'commit' | 'tag',
): string {
  const params = new URLSearchParams({
    path,
    'api-version': ADO_API_VERSION,
    includeContent: 'true',
    resolveLfs: 'true',
    'versionDescriptor.version': version,
    'versionDescriptor.versionType': versionType,
  });
  return `${repoBase(ctx)}/items?${params.toString()}`;
}

/** REST "Get Item" URL for a file at a specific commit (used for PR before/after). */
export function buildCommitItemsUrl(
  ctx: Pick<AdoContext, 'host' | 'org' | 'project' | 'repo'>,
  path: string,
  commitId: string,
): string {
  return buildVersionItemsUrl(ctx, path, commitId, 'commit');
}

/**
 * Normalize an items response to the raw file text. Accepts both the metadata wrapper
 * (`{ content: "..." }`, from `includeContent=true`) and an already-raw body.
 */
export function unwrapItemsResponse(text: string): string {
  try {
    const parsed = JSON.parse(text) as { content?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
      return parsed.content;
    }
  } catch {
    // Not a JSON wrapper — treat as raw file text.
  }
  return text;
}

/**
 * Cookie fallback used from the content script (first-party request, so the ADO session
 * cookie is sent). `X-TFS-FedAuthRedirect: Suppress` turns auth failures into a 401 rather
 * than an HTML sign-in redirect.
 */
export async function fetchWorkflowViaCookie(ctx: AdoContext): Promise<string> {
  const res = await fetch(buildItemsUrl(ctx), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-TFS-FedAuthRedirect': 'Suppress',
    },
  });
  if (!res.ok) throw new Error(`Azure DevOps returned ${res.status}`);
  return unwrapItemsResponse(await res.text());
}
