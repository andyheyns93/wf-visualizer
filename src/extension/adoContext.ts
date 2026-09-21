/**
 * Azure DevOps surface detection.
 *
 * Parses an ADO URL into the context needed to locate a workflow file or pull request.
 * Pure and side-effect free so it can be unit-tested without a browser.
 *
 * Supported shapes:
 *   dev.azure.com/{org}/{project}/_git/{repo}?path=/x.json&version=GBmain
 *   dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
 *   dev.azure.com/{org}/{project}/_git/{repo}/pullrequestcreate?sourceRef=…&targetRef=…
 *   dev.azure.com/{org}/{project}/_git/{repo}/commit/{sha}?refName=refs/heads/…
 *   {org}.visualstudio.com/[{collection}/]{project}/_git/{repo}?path=...
 */

export type AdoSurface = 'file' | 'pullrequest' | 'pullrequestcreate' | 'commit';

export interface AdoRef {
  type: 'branch' | 'commit' | 'tag' | 'unknown';
  value: string;
}

export interface AdoContext {
  host: string;
  org: string;
  project: string;
  repo: string;
  surface: AdoSurface;
  /** File surface: the repo-relative file path (decoded). */
  path?: string;
  /** File surface: the raw version descriptor (e.g. "GBmain"), if present. */
  version?: string;
  /** File surface: the decoded version descriptor. */
  ref?: AdoRef;
  /** Pull-request surface: the PR id. */
  pullRequestId?: string;
  /** Create-PR surface: the source/target branch refs being compared. */
  sourceRef?: string;
  targetRef?: string;
  /** Commit surface: the commit sha being viewed (diffed against its parent). */
  commit?: string;
}

/**
 * Decode an ADO version descriptor. ADO prefixes the ref kind: GB=branch, GC=commit,
 * GT=tag. Anything else is returned as-is with an unknown kind.
 */
export function decodeVersion(version: string | undefined): AdoRef | undefined {
  if (!version) return undefined;
  const kind = version.slice(0, 2);
  const value = version.slice(2);
  if (kind === 'GB') return { type: 'branch', value };
  if (kind === 'GC') return { type: 'commit', value };
  if (kind === 'GT') return { type: 'tag', value };
  return { type: 'unknown', value: version };
}

/** Parse an ADO URL into a workflow context, or null if it isn't a supported surface. */
export function detectAdoContext(rawUrl: string): AdoContext | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);

  const gitIdx = segments.indexOf('_git');
  if (gitIdx === -1 || gitIdx >= segments.length - 1 || gitIdx === 0) return null;

  const repo = segments[gitIdx + 1];
  const project = segments[gitIdx - 1];

  let org: string | undefined;
  if (host === 'dev.azure.com') {
    org = segments[0];
    // Guard against org == project (i.e. no project segment before _git).
    if (gitIdx < 2) return null;
  } else if (host.endsWith('.visualstudio.com')) {
    org = host.split('.')[0];
  } else {
    return null;
  }

  if (!org || !project || !repo) return null;

  const base = { host, org, project, repo } as const;

  // Pull request?
  const after = segments.slice(gitIdx + 2);
  if (after[0] === 'pullrequest' && after[1]) {
    return { ...base, surface: 'pullrequest', pullRequestId: after[1] };
  }

  // Creating a pull request (compares a source branch against a target)?
  if (after[0] === 'pullrequestcreate') {
    return {
      ...base,
      surface: 'pullrequestcreate',
      sourceRef: url.searchParams.get('sourceRef') ?? undefined,
      targetRef: url.searchParams.get('targetRef') ?? undefined,
    };
  }

  // A single commit's changes (diffed against its parent)?
  if (after[0] === 'commit' && after[1]) {
    const sha = after[1];
    return { ...base, surface: 'commit', commit: sha, ref: { type: 'commit', value: sha } };
  }

  // File view?
  const path = url.searchParams.get('path') ?? undefined;
  if (path) {
    const version = url.searchParams.get('version') ?? undefined;
    return { ...base, surface: 'file', path, version, ref: decodeVersion(version) };
  }

  return null;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
