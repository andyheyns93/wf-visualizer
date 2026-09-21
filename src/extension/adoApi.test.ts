import { describe, expect, it } from 'vitest';
import {
  buildCommitItemsUrl,
  buildItemsUrl,
  buildPullRequestUrl,
  isWorkflowItemsRequest,
  parseVersionDescriptor,
  unwrapItemsResponse,
} from './adoApi';
import { detectAdoContext } from './adoContext';

function fileContext(url: string) {
  const ctx = detectAdoContext(url);
  if (!ctx) throw new Error('expected a context');
  return ctx;
}

describe('buildItemsUrl', () => {
  it('builds a dev.azure.com items URL with a branch version descriptor', () => {
    const ctx = fileContext(
      'https://dev.azure.com/contoso/ProjectName/_git/integrations?path=/src/Workflows/workflow.json&version=GBmain',
    );
    const url = new URL(buildItemsUrl(ctx));

    expect(url.origin).toBe('https://dev.azure.com');
    expect(url.pathname).toBe('/contoso/ProjectName/_apis/git/repositories/integrations/items');
    expect(url.searchParams.get('path')).toBe('/src/Workflows/workflow.json');
    expect(url.searchParams.get('includeContent')).toBe('true');
    expect(url.searchParams.get('versionDescriptor.versionType')).toBe('branch');
    expect(url.searchParams.get('versionDescriptor.version')).toBe('main');
  });

  it('builds a legacy visualstudio.com items URL', () => {
    const ctx = fileContext(
      'https://contoso.visualstudio.com/ProjectName/_git/integrations?path=/a.json',
    );
    const url = new URL(buildItemsUrl(ctx));
    expect(url.origin).toBe('https://contoso.visualstudio.com');
    expect(url.pathname).toBe('/ProjectName/_apis/git/repositories/integrations/items');
  });

  it('omits the version descriptor when there is no ref', () => {
    const ctx = fileContext('https://dev.azure.com/contoso/ProjectName/_git/integrations?path=/a.json');
    const url = new URL(buildItemsUrl(ctx));
    expect(url.searchParams.has('versionDescriptor.versionType')).toBe(false);
  });

  it('throws for a non-file (pull request) context', () => {
    const pr = detectAdoContext('https://dev.azure.com/contoso/ProjectName/_git/integrations/pullrequest/1');
    expect(pr?.surface).toBe('pullrequest');
    expect(() => buildItemsUrl(pr!)).toThrow(/file-surface/i);
  });
});

describe('isWorkflowItemsRequest', () => {
  // The shape of request the ADO web app issues (repo/project GUIDs, capital /Items).
  const appUrl =
    'https://dev.azure.com/contoso/853e4c25-7119-43f2-9262-ee536e0749f5/_apis/git/repositories/c1ad1f68-0103-4293-9a41-fc35811dd329/Items?path=/src/Workflows/sync-customers/workflow.json&recursionLevel=0&includeContentMetadata=true&versionDescriptor.version=master&versionDescriptor.versionType=0&includeContent=true&resolveLfs=true';

  it('matches the ADO app workflow content request (capital /Items, GUIDs)', () => {
    expect(isWorkflowItemsRequest(appUrl)).toBe(true);
  });

  it('rejects an items request without includeContent', () => {
    expect(
      isWorkflowItemsRequest(
        'https://dev.azure.com/o/p/_apis/git/repositories/r/items?path=/a/workflow.json',
      ),
    ).toBe(false);
  });

  it('rejects a non-json path', () => {
    expect(
      isWorkflowItemsRequest(
        'https://dev.azure.com/o/p/_apis/git/repositories/r/items?path=/a/readme.md&includeContent=true',
      ),
    ).toBe(false);
  });

  it('rejects unrelated ADO api requests', () => {
    expect(isWorkflowItemsRequest('https://dev.azure.com/o/_apis/git/pullRequests/1')).toBe(false);
    expect(isWorkflowItemsRequest('not a url')).toBe(false);
  });
});

describe('buildPullRequestUrl', () => {
  it('builds the PR details URL', () => {
    const pr = detectAdoContext('https://dev.azure.com/contoso/ProjectName/_git/integrations/pullrequest/42');
    const url = new URL(buildPullRequestUrl(pr!));
    expect(url.pathname).toBe('/contoso/ProjectName/_apis/git/repositories/integrations/pullRequests/42');
  });

  it('throws for a non-PR context', () => {
    const file = detectAdoContext('https://dev.azure.com/contoso/ProjectName/_git/integrations?path=/a.json');
    expect(() => buildPullRequestUrl(file!)).toThrow(/pull-request/i);
  });
});

describe('buildCommitItemsUrl', () => {
  it('builds an items URL pinned to a commit', () => {
    const ctx = { host: 'dev.azure.com', org: 'contoso', project: 'ProjectName', repo: 'integrations' };
    const url = new URL(buildCommitItemsUrl(ctx, '/a/workflow.json', 'abc123'));
    expect(url.pathname).toBe('/contoso/ProjectName/_apis/git/repositories/integrations/items');
    expect(url.searchParams.get('path')).toBe('/a/workflow.json');
    expect(url.searchParams.get('includeContent')).toBe('true');
    expect(url.searchParams.get('versionDescriptor.versionType')).toBe('commit');
    expect(url.searchParams.get('versionDescriptor.version')).toBe('abc123');
  });
});

describe('parseVersionDescriptor', () => {
  it('reads the ADO app numeric versionType (0=branch) with a slashed branch name', () => {
    // The real request the ADO web app issues for a file on a feature branch.
    const url =
      'https://dev.azure.com/contoso/p/_apis/git/repositories/r/Items?path=/a/workflow.json&versionDescriptor.version=feature/99999-x&versionDescriptor.versionType=0&includeContent=true';
    expect(parseVersionDescriptor(url)).toEqual({
      type: 'branch',
      value: 'feature/99999-x',
    });
  });

  it('maps numeric commit/tag version types', () => {
    const commit =
      'https://dev.azure.com/o/p/_apis/git/repositories/r/items?path=/a.json&versionDescriptor.version=abc123&versionDescriptor.versionType=2';
    const tag =
      'https://dev.azure.com/o/p/_apis/git/repositories/r/items?path=/a.json&versionDescriptor.version=v1.0&versionDescriptor.versionType=1';
    expect(parseVersionDescriptor(commit)).toEqual({ type: 'commit', value: 'abc123' });
    expect(parseVersionDescriptor(tag)).toEqual({ type: 'tag', value: 'v1.0' });
  });

  it('accepts the string versionType forms too', () => {
    const url =
      'https://dev.azure.com/o/p/_apis/git/repositories/r/items?path=/a.json&versionDescriptor.version=main&versionDescriptor.versionType=branch';
    expect(parseVersionDescriptor(url)).toEqual({ type: 'branch', value: 'main' });
  });

  it('returns undefined when there is no version descriptor or the URL is invalid', () => {
    expect(
      parseVersionDescriptor('https://dev.azure.com/o/p/_apis/git/repositories/r/items?path=/a.json'),
    ).toBeUndefined();
    expect(parseVersionDescriptor('not a url')).toBeUndefined();
  });
});

describe('unwrapItemsResponse', () => {
  it('unwraps the includeContent metadata wrapper', () => {
    const wrapper = JSON.stringify({ objectId: 'x', content: '{"definition":{}}' });
    expect(unwrapItemsResponse(wrapper)).toBe('{"definition":{}}');
  });

  it('returns raw workflow JSON unchanged (no top-level content field)', () => {
    const raw = '{"definition":{"triggers":{},"actions":{}}}';
    expect(unwrapItemsResponse(raw)).toBe(raw);
  });

  it('returns non-JSON text unchanged', () => {
    expect(unwrapItemsResponse('not json at all')).toBe('not json at all');
  });
});
