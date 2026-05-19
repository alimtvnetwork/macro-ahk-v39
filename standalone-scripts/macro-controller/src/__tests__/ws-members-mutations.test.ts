/**
 * ws-members-mutations — verifies invite/remove/updateRole dispatch correctly
 * and that each successful call invalidates the per-workspace members cache.
 * Failures (non-2xx) throw with a body preview and leave the cache untouched.
 *
 * Mock strategy:
 *   - Stub the marco SDK on `window.marco.api.memberships`.
 *   - Spy on `clearMembersCache` from ws-members-fetch.
 *   - Stub logging/error-utils so no console noise during tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logging', () => ({ log: vi.fn() }));
vi.mock('../error-utils', () => ({ logError: vi.fn() }));
vi.mock('../shared-state', () => ({ CREDIT_API_BASE: 'https://api.test.com' }));

vi.mock('../ws-members-fetch', () => ({ clearMembersCache: vi.fn() }));

import { inviteMember, removeMember, updateMemberRole } from '../ws-members-mutations';
import { clearMembersCache } from '../ws-members-fetch';
const clearMembersCacheSpy = clearMembersCache as unknown as ReturnType<typeof vi.fn>;

interface MembershipsApi {
  invite: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  updateRole: ReturnType<typeof vi.fn>;
}

function installSdk(api: MembershipsApi): void {
  (window as unknown as { marco?: { api?: { memberships?: MembershipsApi } } }).marco = {
    api: { memberships: api },
  };
}

function uninstallSdk(): void {
  delete (window as unknown as { marco?: unknown }).marco;
}

const WS = 'ws_abc';
const USER = 'usr_xyz';

beforeEach(() => {
  clearMembersCacheSpy.mockReset();
  uninstallSdk();
});

describe('inviteMember', () => {
  it('calls SDK invite with (wsId, email, role, baseUrl) and clears cache on success', async () => {
    const api: MembershipsApi = {
      invite: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
      remove: vi.fn(),
      updateRole: vi.fn(),
    };
    installSdk(api);

    await inviteMember(WS, 'a@b.com', 'member');

    expect(api.invite).toHaveBeenCalledWith(WS, 'a@b.com', 'member', { baseUrl: 'https://api.test.com' });
    expect(clearMembersCacheSpy).toHaveBeenCalledWith(WS);
  });

  it('throws on non-2xx and does NOT invalidate cache', async () => {
    const api: MembershipsApi = {
      invite: vi.fn().mockResolvedValue({ ok: false, status: 403, data: { error: 'forbidden' } }),
      remove: vi.fn(),
      updateRole: vi.fn(),
    };
    installSdk(api);

    await expect(inviteMember(WS, 'a@b.com', 'owner')).rejects.toThrow(/HTTP 403/);
    expect(clearMembersCacheSpy).not.toHaveBeenCalled();
  });

  it('rejects missing wsId / email without calling SDK', async () => {
    const api: MembershipsApi = { invite: vi.fn(), remove: vi.fn(), updateRole: vi.fn() };
    installSdk(api);
    await expect(inviteMember('', 'a@b.com', 'member')).rejects.toThrow(/wsId/);
    await expect(inviteMember(WS, '', 'member')).rejects.toThrow(/email/);
    expect(api.invite).not.toHaveBeenCalled();
  });

  it('throws when SDK is not loaded', async () => {
    uninstallSdk();
    await expect(inviteMember(WS, 'a@b.com', 'member')).rejects.toThrow(/SDK not loaded/);
  });
});

describe('removeMember', () => {
  it('calls SDK remove and clears cache on success', async () => {
    const api: MembershipsApi = {
      invite: vi.fn(),
      remove: vi.fn().mockResolvedValue({ ok: true, status: 204, data: null }),
      updateRole: vi.fn(),
    };
    installSdk(api);

    await removeMember(WS, USER);

    expect(api.remove).toHaveBeenCalledWith(WS, USER, { baseUrl: 'https://api.test.com' });
    expect(clearMembersCacheSpy).toHaveBeenCalledWith(WS);
  });

  it('throws on non-2xx and does NOT invalidate cache', async () => {
    const api: MembershipsApi = {
      invite: vi.fn(),
      remove: vi.fn().mockResolvedValue({ ok: false, status: 404, data: { error: 'not found' } }),
      updateRole: vi.fn(),
    };
    installSdk(api);

    await expect(removeMember(WS, USER)).rejects.toThrow(/HTTP 404/);
    expect(clearMembersCacheSpy).not.toHaveBeenCalled();
  });
});

describe('updateMemberRole', () => {
  it('promotes to owner and clears cache', async () => {
    const api: MembershipsApi = {
      invite: vi.fn(),
      remove: vi.fn(),
      updateRole: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
    };
    installSdk(api);

    await updateMemberRole(WS, USER, 'owner');

    expect(api.updateRole).toHaveBeenCalledWith(WS, USER, 'owner', { baseUrl: 'https://api.test.com' });
    expect(clearMembersCacheSpy).toHaveBeenCalledWith(WS);
  });

  it('demotes to member and clears cache', async () => {
    const api: MembershipsApi = {
      invite: vi.fn(),
      remove: vi.fn(),
      updateRole: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
    };
    installSdk(api);

    await updateMemberRole(WS, USER, 'member');

    expect(api.updateRole).toHaveBeenCalledWith(WS, USER, 'member', { baseUrl: 'https://api.test.com' });
    expect(clearMembersCacheSpy).toHaveBeenCalledWith(WS);
  });

  it('throws on non-2xx and does NOT invalidate cache', async () => {
    const api: MembershipsApi = {
      invite: vi.fn(),
      remove: vi.fn(),
      updateRole: vi.fn().mockResolvedValue({ ok: false, status: 500, data: 'oops' }),
    };
    installSdk(api);

    await expect(updateMemberRole(WS, USER, 'owner')).rejects.toThrow(/HTTP 500/);
    expect(clearMembersCacheSpy).not.toHaveBeenCalled();
  });
});
