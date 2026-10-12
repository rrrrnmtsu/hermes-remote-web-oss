import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserPushPort } from './browser-push';
import { ensureRemoteWorker } from '../storage/worker';

vi.mock('../storage/worker', () => ({ ensureRemoteWorker: vi.fn() }));
let secure: PropertyDescriptor | undefined, workers: PropertyDescriptor | undefined;
const permission = { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') };
const registrations = vi.fn().mockResolvedValue([]);
const ownScope = () => `${window.location.origin}/hermes-remote-web/`;
const subscription = () => ({ toJSON: vi.fn(() => ({ endpoint: 'https://DEMO.invalid/push', keys: { p256dh: 'DEMO-public', auth: 'DEMO-auth' } })), unsubscribe: vi.fn().mockResolvedValue(true) });
beforeEach(() => {
  secure = Object.getOwnPropertyDescriptor(window, 'isSecureContext'); workers = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistrations: registrations }, configurable: true });
  vi.stubGlobal('Notification', permission); vi.stubGlobal('PushManager', class {}); vi.stubGlobal('crypto', webcrypto);
  permission.permission = 'default'; permission.requestPermission.mockClear(); registrations.mockReset().mockResolvedValue([]); vi.mocked(ensureRemoteWorker).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (secure) Object.defineProperty(window, 'isSecureContext', secure); else Reflect.deleteProperty(window, 'isSecureContext');
  if (workers) Object.defineProperty(navigator, 'serviceWorker', workers); else Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('browser push boundary uses explicit consent and only the own registration', () => {
  it('constructing or checking support/permission never enables anything or opens a permission dialog', () => {
    const port = browserPushPort(); expect(port.supported).toBe(true); expect(port.permission()).toBe('default');
    expect(permission.requestPermission).not.toHaveBeenCalled(); expect(registrations).not.toHaveBeenCalled(); expect(ensureRemoteWorker).not.toHaveBeenCalled();
  });
  it.each(['Notification', 'PushManager'] as const)('unsupported %s makes read/unsubscribe inert without touching another app', async missing => {
    vi.stubGlobal(missing, undefined); const port = browserPushPort(); expect(port.supported).toBe(false);
    expect(port.permission()).toBe('unsupported'); expect(await port.requestPermission()).toBe('unsupported');
    expect(await port.subscription()).toBeNull(); expect(await port.unsubscribe()).toBe(true); expect(registrations).not.toHaveBeenCalled();
  });
  it('rejects insecure or absent-worker support without requesting OS consent', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }); expect(browserPushPort().supported).toBe(false);
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    expect(await browserPushPort().requestPermission()).toBe('unsupported'); expect(permission.requestPermission).not.toHaveBeenCalled();
  });
  it.each(['granted', 'denied'])('terminal permission %s is returned without another prompt', async terminal => {
    permission.permission = terminal; expect(await browserPushPort().requestPermission()).toBe(terminal); expect(permission.requestPermission).not.toHaveBeenCalled();
  });
  it('asks once only for the explicit default-permission operation', async () => {
    expect(await browserPushPort().requestPermission()).toBe('granted'); expect(permission.requestPermission).toHaveBeenCalledTimes(1);
    expect(ensureRemoteWorker).not.toHaveBeenCalled();
  });
  it('does not inspect, unsubscribe or unregister a different app registration', async () => {
    const other = { scope: `${window.location.origin}/other-app/`, pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription()) }, unregister: vi.fn() };
    registrations.mockResolvedValue([other]); const port = browserPushPort();
    expect(await port.subscription()).toBeNull(); expect(await port.unsubscribe()).toBe(true);
    expect(other.pushManager.getSubscription).not.toHaveBeenCalled(); expect(other.unregister).not.toHaveBeenCalled();
  });
  it('reads and cancels only its exact-scope subscription without keeping a copy in app storage', async () => {
    const own = subscription(), other = { scope: `${window.location.origin}/other-app/`, pushManager: { getSubscription: vi.fn() } };
    registrations.mockResolvedValue([other, { scope: ownScope(), pushManager: { getSubscription: vi.fn().mockResolvedValue(own) } }]);
    const before = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]; const port = browserPushPort();
    expect(await port.subscription()).toEqual({ endpoint: 'https://DEMO.invalid/push', expirationTime: null, keys: { p256dh: 'DEMO-public', auth: 'DEMO-auth' } });
    expect(await port.unsubscribe()).toBe(true); expect(own.unsubscribe).toHaveBeenCalledTimes(1); expect(other.pushManager.getSubscription).not.toHaveBeenCalled();
    expect([JSON.stringify(localStorage), JSON.stringify(sessionStorage)]).toEqual(before);
  });
  it.each([{ endpoint: 'DEMO' }, { endpoint: 'DEMO', keys: { p256dh: 'DEMO' } }, { keys: { p256dh: 'DEMO', auth: 'DEMO' } }])('rejects an incomplete browser subscription before a server write', async raw => {
    registrations.mockResolvedValue([{ scope: ownScope(), pushManager: { getSubscription: vi.fn().mockResolvedValue({ toJSON: () => raw }) } }]);
    await expect(browserPushPort().subscription()).rejects.toThrow('invalid browser subscription'); expect(ensureRemoteWorker).not.toHaveBeenCalled();
  });
  it('uses the current browser subscription as the source of expiry and explicit unsubscribe failure', async () => {
    const own = { toJSON: () => ({ endpoint: 'DEMO', expirationTime: 100, keys: { p256dh: 'DEMO', auth: 'DEMO' } }), unsubscribe: vi.fn().mockResolvedValue(false) };
    registrations.mockResolvedValue([{ scope: ownScope(), pushManager: { getSubscription: vi.fn().mockResolvedValue(own) } }]);
    const port = browserPushPort(); expect((await port.subscription())?.expirationTime).toBe(100); expect(await port.unsubscribe()).toBe(false);
  });
  it('passes a validated P-256 public key only to the explicit own-worker subscribe operation', async () => {
    const bytes = new Uint8Array(65); bytes[0] = 4;
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const subscribe = vi.fn().mockResolvedValue(subscription()); vi.mocked(ensureRemoteWorker).mockResolvedValue({ pushManager: { subscribe } } as unknown as ServiceWorkerRegistration);
    expect(await browserPushPort().subscribe(encoded)).toMatchObject({ endpoint: 'https://DEMO.invalid/push' });
    expect(subscribe).toHaveBeenCalledTimes(1); expect(subscribe.mock.calls[0]?.[0].userVisibleOnly).toBe(true);
    expect([...new Uint8Array(subscribe.mock.calls[0]?.[0].applicationServerKey)]).toEqual([...bytes]);
  });
  it.each([new Uint8Array(64), new Uint8Array(65)])('refuses malformed public-key length/header without subscribing', async bytes => {
    const subscribe = vi.fn(); vi.mocked(ensureRemoteWorker).mockResolvedValue({ pushManager: { subscribe } } as unknown as ServiceWorkerRegistration);
    await expect(browserPushPort().subscribe(btoa(String.fromCharCode(...bytes)))).rejects.toThrow(); expect(subscribe).not.toHaveBeenCalled();
  });
  it('hashes endpoint fingerprints without registration, permission prompts or exposing the endpoint as a fingerprint', async () => {
    const port = browserPushPort(), fingerprint = await port.fingerprint('https://DEMO.invalid/push');
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(await port.fingerprint('https://DEMO.invalid/push')).toBe(fingerprint);
    expect(await port.fingerprint('https://DEMO.invalid/other')).not.toBe(fingerprint); expect(registrations).not.toHaveBeenCalled(); expect(permission.requestPermission).not.toHaveBeenCalled();
  });
});
