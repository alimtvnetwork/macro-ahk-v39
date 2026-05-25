import { describe, it, expect } from 'vitest';
import { pickRepoUrl } from '../gitsync-api';

describe('pickRepoUrl — Lovable gitsync response shapes', () => {
  it('prefers config.repo_url when present', () => {
    expect(
      pickRepoUrl({ synced: true, config: { repo_url: 'https://github.com/acme/app' } }),
    ).toBe('https://github.com/acme/app');
  });

  it('constructs URL from config.owner_name + repo_name when repo_url missing', () => {
    expect(
      pickRepoUrl({ synced: true, config: { owner_name: 'acme', repo_name: 'app' } }),
    ).toBe('https://github.com/acme/app');
  });

  it('falls back to legacy github_repo_url', () => {
    expect(pickRepoUrl({ github_repo_url: 'https://github.com/acme/legacy' }))
      .toBe('https://github.com/acme/legacy');
  });

  it('falls back to legacy github_owner + github_repo pair', () => {
    expect(pickRepoUrl({ github_owner: 'acme', github_repo: 'legacy' }))
      .toBe('https://github.com/acme/legacy');
  });

  it('accepts owner/repo composite in github_repo', () => {
    expect(pickRepoUrl({ github_repo: 'acme/legacy' }))
      .toBe('https://github.com/acme/legacy');
  });

  it('returns null when no recognizable fields exist', () => {
    expect(pickRepoUrl({})).toBeNull();
    expect(pickRepoUrl({ synced: true, config: null })).toBeNull();
    expect(pickRepoUrl({ config: { repo_url: null, repo_name: null, owner_name: null } })).toBeNull();
  });
});
