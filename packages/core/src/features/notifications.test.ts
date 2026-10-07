import { describe, expect, it, vi } from 'vitest';
import { NotificationController, type BrowserPushPort, type NotificationAccess, type NotificationScope, type NotificationStatus, type NotificationSubscription } from './notifications';

function fixture() {
  const scope: NotificationScope = { profile: 'smoke', durableSession: 'durable-1', generation: 'socket-1', connected: true };
  const entry: NotificationSubscription = { id: 'a'.repeat(32), session_id: 'durable-1', endpoint_fingerprint: 'f'.repeat(64), expires_at: 2_000_000_000, last_status: 'registered' };
  const status: NotificationStatus = { available: true, reason: 'ready', public_key: 'application-public-key', subscriptions: [], scope: 'authenticated_owner_profile_session', ttl_seconds: 2_592_000, max_subscriptions: 8 };
  const request = vi.fn(async (method: string, params: Record<string, unknown>, write?: boolean): Promise<unknown> => { void params; void write; return method.endsWith('.status') ? status : method.endsWith('.subscribe') ? { subscription: entry } : { removed: 1 }; });
  const access: NotificationAccess = { scope: () => ({ ...scope }), supports: vi.fn(() => true), request: <T>(method: string, params: Record<string, unknown>, write?: boolean) => request(method, params, write) as Promise<T> };
  const subscription = { endpoint: 'https://web.push.apple.com/synthetic-endpoint', expirationTime: null, keys: { p256dh: 'synthetic-public', auth: 'synthetic-auth' } };
  const browser: BrowserPushPort = { supported: true, permission: vi.fn(() => 'default' as const), requestPermission: vi.fn(async () => 'granted' as const), subscription: vi.fn(async () => null), subscribe: vi.fn(async () => subscription), unsubscribe: vi.fn(async () => true), fingerprint: vi.fn(async () => entry.endpoint_fingerprint) };
  return { controller: new NotificationController(access, browser), access, request, scope, status, entry, browser, subscription };
}
describe('explicit owner/profile/session notification subscriptions', () => {
  it('reads registration without permission, browser subscription write, or server write', async () => {
    const { controller, request, browser } = fixture(); await controller.refresh();
    expect(controller.snapshot().phase).toBe('ready'); expect(browser.requestPermission).not.toHaveBeenCalled(); expect(browser.subscribe).not.toHaveBeenCalled();
    expect(request.mock.calls).toEqual([['remote.notifications.status', { profile: 'smoke', session_id: 'durable-1' }, undefined]]);
  });
  it('keeps old servers unsupported without probing or registering a new method', async () => {
    const { controller, access, request } = fixture(); vi.mocked(access.supports).mockReturnValue(false); await controller.refresh();
    expect(controller.snapshot().phase).toBe('unsupported'); expect(request).not.toHaveBeenCalled(); expect(await controller.enable()).toBe(false);
  });
  it('requires a connected durable conversation', async () => {
    const { controller, scope, request } = fixture(); scope.durableSession = ''; await controller.refresh(); expect(request).not.toHaveBeenCalled();
    scope.durableSession = 'durable-1'; scope.connected = false; await controller.refresh(); expect(request).not.toHaveBeenCalled();
  });
  it('registers only after explicit permission and readback checks the same destination', async () => {
    const { controller, request, browser, subscription } = fixture(); await controller.refresh(); expect(await controller.enable()).toBe(true);
    expect(browser.requestPermission).toHaveBeenCalledTimes(1); expect(browser.subscribe).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[1]).toEqual(['remote.notifications.subscribe', { profile: 'smoke', session_id: 'durable-1', subscription }, true]);
    expect(controller.snapshot().phase).toBe('enabled');
  });
  it('does not create a subscription when device permission is denied', async () => {
    const { controller, browser, request } = fixture(); vi.mocked(browser.requestPermission).mockResolvedValue('denied'); await controller.refresh(); await controller.enable();
    expect(browser.subscribe).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1); expect(controller.snapshot().permission).toBe('denied');
  });
  it('retains an unknown registration ACK and never automatically re-registers', async () => {
    const { controller, request } = fixture(); await controller.refresh(); request.mockRejectedValueOnce(new Error('ACK lost'));
    await controller.enable(); await controller.enable(); expect(controller.snapshot().phase).toBe('unknown'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects a permission callback from a previous scope before any subscription write', async () => {
    const { controller, browser, scope, request } = fixture(); await controller.refresh();
    let resolve!: (permission: 'granted') => void;
    vi.mocked(browser.requestPermission).mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = controller.enable(); scope.profile = 'different'; controller.reset(); resolve('granted'); await pending;
    expect(browser.subscribe).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1); expect(controller.snapshot().phase).toBe('idle');
  });
  it('does not mistake another endpoint or conversation for this registration', async () => {
    const { controller, browser, status, entry } = fixture(); status.subscriptions = [{ ...entry, session_id: 'other' }];
    vi.mocked(browser.subscription).mockResolvedValue({ endpoint: 'synthetic', expirationTime: null, keys: { p256dh: 'x', auth: 'y' } });
    await controller.refresh(); expect(controller.snapshot().phase).toBe('ready');
  });
  it('requires readback after an unknown unsubscribe without automatically sending twice', async () => {
    const { controller, request } = fixture(); await controller.refresh(); await controller.enable(); request.mockRejectedValueOnce(new Error('ACK lost'));
    await controller.disable(); expect(controller.snapshot().phase).toBe('unknown');
    expect(request.mock.calls.filter(call => call[0] === 'remote.notifications.unsubscribe')).toHaveLength(1);
  });
  it('revokes browser and authenticated profile subscriptions before logout and reports uncertainty', async () => {
    const { controller, browser, request } = fixture(); expect(await controller.logout()).toEqual({ browser: 'revoked', server: 'revoked' });
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledWith('remote.notifications.unsubscribe_all', { profile: 'smoke' }, true);
    vi.mocked(browser.unsubscribe).mockRejectedValueOnce(new Error('device')); request.mockRejectedValueOnce(new Error('network'));
    expect(await controller.logout()).toEqual({ browser: 'unknown', server: 'unknown' });
  });
});
