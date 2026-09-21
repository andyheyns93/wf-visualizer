import { describe, expect, it } from 'vitest';
import { decodeVersion, detectAdoContext } from './adoContext';

describe('detectAdoContext — dev.azure.com', () => {
  it('parses a file view with path + version', () => {
    const ctx = detectAdoContext(
      'https://dev.azure.com/contoso/ProjectName/_git/integrations?path=/workflows/sync.json&version=GBmain',
    );
    expect(ctx).toMatchObject({
      host: 'dev.azure.com',
      org: 'contoso',
      project: 'ProjectName',
      repo: 'integrations',
      surface: 'file',
      path: '/workflows/sync.json',
      version: 'GBmain',
    });
    expect(ctx?.ref).toEqual({ type: 'branch', value: 'main' });
  });

  it('parses a pull request', () => {
    const ctx = detectAdoContext(
      'https://dev.azure.com/contoso/ProjectName/_git/integrations/pullrequest/1234?_a=files',
    );
    expect(ctx).toMatchObject({
      surface: 'pullrequest',
      org: 'contoso',
      project: 'ProjectName',
      repo: 'integrations',
      pullRequestId: '1234',
    });
  });

  it('parses a single-commit view (/commit/{sha})', () => {
    const ctx = detectAdoContext(
      'https://dev.azure.com/contoso/ProjectName/_git/integrations/commit/xxxxxxxxxxxxxxxxxxxxxxxxxxxx?refName=refs%2Fheads%2Ffeature%2F99999-x',
    );
    expect(ctx).toMatchObject({
      surface: 'commit',
      org: 'contoso',
      project: 'ProjectName',
      repo: 'integrations',
      commit: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
    expect(ctx?.ref).toEqual({ type: 'commit', value: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
  });

  it('parses a create-pull-request page with source/target refs', () => {
    const ctx = detectAdoContext(
      'https://dev.azure.com/contoso/ProjectName/_git/integrations/pullrequestcreate?sourceRef=feature/x&targetRef=master&sourceRepositoryId=g1&targetRepositoryId=g2',
    );
    expect(ctx).toMatchObject({
      surface: 'pullrequestcreate',
      repo: 'integrations',
      sourceRef: 'feature/x',
      targetRef: 'master',
    });
  });

  it('decodes encoded project/path segments', () => {
    const ctx = detectAdoContext(
      'https://dev.azure.com/contoso/My%20Project/_git/repo?path=%2Fsrc%2Fa.json',
    );
    expect(ctx?.project).toBe('My Project');
    expect(ctx?.path).toBe('/src/a.json');
  });

  it('returns null for a repo page with no file/PR surface', () => {
    expect(detectAdoContext('https://dev.azure.com/contoso/ProjectName/_git/integrations')).toBeNull();
  });

  it('returns null when there is no project segment before _git', () => {
    expect(detectAdoContext('https://dev.azure.com/contoso/_git/repo?path=/a.json')).toBeNull();
  });
});

describe('detectAdoContext — visualstudio.com (legacy)', () => {
  it('takes the org from the subdomain', () => {
    const ctx = detectAdoContext(
      'https://contoso.visualstudio.com/ProjectName/_git/integrations?path=/a.json&version=GBdev',
    );
    expect(ctx).toMatchObject({ org: 'contoso', project: 'ProjectName', repo: 'integrations', surface: 'file' });
    expect(ctx?.ref).toEqual({ type: 'branch', value: 'dev' });
  });

  it('handles a collection segment before the project', () => {
    const ctx = detectAdoContext(
      'https://contoso.visualstudio.com/DefaultCollection/ProjectName/_git/repo/pullrequest/9',
    );
    expect(ctx).toMatchObject({ org: 'contoso', project: 'ProjectName', repo: 'repo', pullRequestId: '9' });
  });
});

describe('detectAdoContext — non-ADO / invalid', () => {
  it('returns null for unrelated hosts', () => {
    expect(detectAdoContext('https://github.com/foo/bar')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(detectAdoContext('not a url')).toBeNull();
  });
});

describe('decodeVersion', () => {
  it('decodes branch/commit/tag prefixes', () => {
    expect(decodeVersion('GBmain')).toEqual({ type: 'branch', value: 'main' });
    expect(decodeVersion('GCabc123')).toEqual({ type: 'commit', value: 'abc123' });
    expect(decodeVersion('GTv1.0')).toEqual({ type: 'tag', value: 'v1.0' });
  });

  it('returns unknown for unrecognized descriptors and undefined for none', () => {
    expect(decodeVersion('weird')).toEqual({ type: 'unknown', value: 'weird' });
    expect(decodeVersion(undefined)).toBeUndefined();
  });
});
