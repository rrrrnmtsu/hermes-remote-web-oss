import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAuthClient, type HermesStatus, type HermesUser } from './auth';
import { HermesHttpError, type Http } from './http';

function makeHttpMock() {
  return vi.fn(async (...args: Parameters<Http>): Promise<unknown> => { void args; return undefined; });
}

describe('makeAuthClient', () => {
  let httpMock: ReturnType<typeof makeHttpMock>;
  let client: ReturnType<typeof makeAuthClient>;

  beforeEach(() => {
    httpMock = makeHttpMock();
    client = makeAuthClient(httpMock as unknown as Http);
  });

  describe('status', () => {
    it('maps raw status with auth_required=true', async () => {
      httpMock.mockResolvedValue({ auth_required: true, auth_providers: ['basic'], gateway_state: 'running' });
      const status: HermesStatus = await client.status();
      expect(status.authRequired).toBe(true);
      expect(status.authProviders).toEqual(['basic']);
      expect(status.gatewayState).toBe('running');
    });

    it('maps raw status with auth_required=false', async () => {
      httpMock.mockResolvedValue({ auth_required: false, auth_providers: [], gateway_state: 'idle' });
      const status = await client.status();
      expect(status.authRequired).toBe(false);
      expect(status.authProviders).toEqual([]);
      expect(status.gatewayState).toBe('idle');
    });

    it('defaults auth_providers to empty array when missing', async () => {
      httpMock.mockResolvedValue({ auth_required: true });
      const status = await client.status();
      expect(status.authProviders).toEqual([]);
    });

    it('defaults auth_required to false when missing', async () => {
      httpMock.mockResolvedValue({});
      const status = await client.status();
      expect(status.authRequired).toBe(false);
    });

    it('does not set gatewayState when undefined', async () => {
      httpMock.mockResolvedValue({ auth_required: false });
      const status = await client.status();
      expect(status.gatewayState).toBeUndefined();
    });
  });

  describe('me', () => {
    it('maps raw user fully', async () => {
      httpMock.mockResolvedValue({
        user_id: 'u-1',
        email: 'a@b.com',
        display_name: 'Alice',
        org_id: 'o-1',
        provider: 'basic',
        expires_at: 1234567890,
      });
      const user: HermesUser = await client.me();
      expect(user.userId).toBe('u-1');
      expect(user.email).toBe('a@b.com');
      expect(user.displayName).toBe('Alice');
      expect(user.orgId).toBe('o-1');
      expect(user.provider).toBe('basic');
      expect(user.expiresAt).toBe(1234567890);
    });

    it('provides defaults for missing fields', async () => {
      httpMock.mockResolvedValue({});
      const user = await client.me();
      expect(user.userId).toBe('unknown');
      expect(user.displayName).toBe('Hermes user');
      expect(user.provider).toBe('unknown');
      expect(user.expiresAt).toBe(0);
      expect(user.email).toBeUndefined();
      expect(user.orgId).toBeUndefined();
    });

    it('falls back displayName to email', async () => {
      httpMock.mockResolvedValue({ email: 'bob@example.com' });
      const user = await client.me();
      expect(user.displayName).toBe('bob@example.com');
    });
  });

  describe('check', () => {
    it('returns authenticated when auth not required', async () => {
      httpMock.mockResolvedValueOnce({ auth_required: false });
      const state = await client.check();
      expect(state.kind).toBe('authenticated');
      if (state.kind === 'authenticated') {
        expect(state.status.authRequired).toBe(false);
      }
    });

    it('returns authenticated with user when auth required and me succeeds', async () => {
      httpMock
        .mockResolvedValueOnce({ auth_required: true, auth_providers: ['basic'] })
        .mockResolvedValueOnce({ user_id: 'u-1', display_name: 'Alice' });
      const state = await client.check();
      expect(state.kind).toBe('authenticated');
      if (state.kind === 'authenticated') {
        expect(state.user?.displayName).toBe('Alice');
      }
    });

    it('returns unauthenticated when me throws 401', async () => {
      httpMock
        .mockResolvedValueOnce({ auth_required: true, auth_providers: ['basic'] })
        .mockRejectedValueOnce(new HermesHttpError(401, 'Unauthorized', ''));
      const state = await client.check();
      expect(state.kind).toBe('unauthenticated');
      if (state.kind === 'unauthenticated') {
        expect(state.reason).toContain('Dashboard login is required');
      }
    });

    it('returns offline on network error', async () => {
      httpMock.mockRejectedValueOnce(new Error('Network error'));
      const state = await client.check();
      expect(state.kind).toBe('offline');
      if (state.kind === 'offline') {
        expect(state.reason).toBe('Network error');
      }
    });

    it('returns offline with error message from generic error', async () => {
      httpMock.mockRejectedValueOnce(new Error('Something broke'));
      const state = await client.check();
      expect(state.kind).toBe('offline');
      if (state.kind === 'offline') {
        expect(state.reason).toBe('Something broke');
      }
    });

    it('returns offline with fallback message for non-Error thrown value', async () => {
      httpMock.mockRejectedValueOnce('plain string error');
      const state = await client.check();
      expect(state.kind).toBe('offline');
      if (state.kind === 'offline') {
        expect(state.reason).toBe('Hermes API is unreachable.');
      }
    });

    it('returns offline for non-401 HermesHttpError from me', async () => {
      httpMock
        .mockResolvedValueOnce({ auth_required: true })
        .mockRejectedValueOnce(new HermesHttpError(500, 'Server Error', 'boom'));
      const state = await client.check();
      expect(state.kind).toBe('offline');
      if (state.kind === 'offline') {
        expect(state.reason).toBe('boom');
      }
    });
  });
});
