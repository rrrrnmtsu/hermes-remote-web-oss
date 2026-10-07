import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('packages/web/remote-public/remote-worker.js', 'utf8');
const origin = 'https://demo.example'; const path = '/hermes-remote-web/';
const cachePrefix = 'hermes-remote-web.static.v1.';
class TestCache {
  readonly entries = new Map<string, Response>();
  async put(key: string, response: Response): Promise<void> { this.entries.set(key, response.clone()); }
  async match(key: string): Promise<Response | undefined> { return this.entries.get(key)?.clone(); }
}
function harness(buildId = 'DEMO-old', html = 'DEMO index old', shared = new Map<string, TestCache>()) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const files = new Map([[path + 'index.html', html], [path + 'assets/DEMO.js', 'DEMO static JS']]);
  const configuration = { buildId, assets: [...files].map(([filePath, value]) => ({ path: filePath, sha256: createHash('sha256').update(value).digest('hex') })) };
  const fetch = vi.fn(async (request: Request | { url: string }) => new Response(files.get(new URL(request.url).pathname) || 'DEMO network'));
  const clients: Array<{ url: string; focus: ReturnType<typeof vi.fn>; postMessage(message: { type: string }, ports?: MessagePort[]): void }> = [];
  const self = {
    location: { origin },
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: { matchAll: async () => clients, openWindow: vi.fn(async () => undefined), claim: vi.fn() },
  };
  class RelativeRequest extends Request { constructor(input: string, options?: RequestInit) { super(new URL(input, origin).href, options); } }
  vm.runInNewContext(source.replace("const CONFIG = { buildId: 'development', assets: [] };", `const CONFIG = ${JSON.stringify(configuration)};`), {
    self, URL, Request: RelativeRequest, Response, Uint8Array, Map, crypto: webcrypto, MessageChannel, setTimeout, clearTimeout,
    fetch,
    caches: { keys: async () => [...shared.keys()], delete: async (name: string) => shared.delete(name), open: async (name: string) => { if (!shared.has(name)) shared.set(name, new TestCache()); return shared.get(name)!; } },
  });
  async function dispatch(type: string, data: Record<string, unknown>): Promise<void> {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ ...data, waitUntil: (promise: Promise<unknown>) => { waits.push(promise); } });
    await Promise.all(waits);
  }
  async function message(type: string, clientUrl = origin + path) {
    const response = vi.fn(); await dispatch('message', { data: { type }, source: { url: clientUrl }, ports: [{ postMessage: response }] }); return response;
  }
  async function request(url: string, mode = 'cors'): Promise<Response | null> {
    let result: Promise<Response> | null = null;
    await dispatch('fetch', { request: { url, method: 'GET', mode }, respondWith: (promise: Promise<Response>) => { result = promise; } });
    return result ? await result : null;
  }
  return { dispatch, message, request, shared, fetch, self, clients, files };
}
describe('dedicated opt-in offline and notification worker', () => {
  it('does not persist responses, activate updates, claim clients or remove other caches by default', async () => {
    const worker = harness(); worker.shared.set('other-app-cache', new TestCache());
    await worker.dispatch('install', {}); await worker.dispatch('activate', {});
    expect(worker.fetch).not.toHaveBeenCalled(); expect([...worker.shared.keys()]).toEqual(['other-app-cache']);
    expect(worker.self.skipWaiting).not.toHaveBeenCalled(); expect(worker.self.clients.claim).not.toHaveBeenCalled();
  });
  it('requires the explicit CACHE_SHELL operation, verifies SHA256 and retains no auth/API/WS/unknown responses', async () => {
    const worker = harness(); const acknowledgment = await worker.message('CACHE_SHELL');
    expect(acknowledgment).toHaveBeenCalledWith({ ok: true, message: 'static_shell_cached' });
    expect(worker.shared.get(cachePrefix + 'DEMO-old')?.entries.size).toBe(2);
    for (const url of [`${origin}/api/auth/login`, `${origin}/api/sessions`, `${origin}/ws`, `${origin}${path}build.json`, `${origin}${path}assets/unregistered.js`, `${origin}${path}index.html?ticket=DEMO`, `https://other.example${path}assets/DEMO.js`]) expect(await worker.request(url)).toBeNull();
    expect(worker.fetch.mock.calls.every(([request]) => (request as Request).credentials === 'omit')).toBe(true);
    worker.fetch.mockRejectedValueOnce(new Error('DEMO offline'));
    expect(await (await worker.request(origin + path, 'navigate'))?.text()).toBe('DEMO index old');
  });
  it('refuses an HTML/login response with the wrong hash without declaring offline cache success', async () => {
    const worker = harness(); worker.fetch.mockResolvedValue(new Response('DEMO fake login secret'));
    expect(await worker.message('CACHE_SHELL')).toHaveBeenCalledWith({ ok: false, message: 'static_shell_not_cached' });
    expect(worker.shared.size).toBe(0);
  });
  it('does not let another origin or app clear the cache, and explicit clear affects owned caches only', async () => {
    const worker = harness(); worker.shared.set('other-app-cache', new TestCache()); await worker.message('CACHE_SHELL');
    expect(await worker.message('CLEAR_OFFLINE_SHELL', 'https://other.example/hermes-remote-web/')).not.toHaveBeenCalled();
    expect(await worker.message('CLEAR_OFFLINE_SHELL', origin + '/other-app/')).not.toHaveBeenCalled();
    expect(worker.shared.size).toBe(2);
    await worker.message('CLEAR_OFFLINE_SHELL'); expect([...worker.shared.keys()]).toEqual(['other-app-cache']);
  });
  it('waits for an in-flight shell write before acknowledging clear and leaves other app caches intact', async () => {
    const worker = harness(); worker.shared.set('other-app-cache', new TestCache());
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    worker.fetch.mockImplementationOnce(async () => { await pending; return new Response('DEMO index old'); });
    const writing = worker.message('CACHE_SHELL');
    let cleared = false;
    const clearing = worker.message('CLEAR_OFFLINE_SHELL').then(() => { cleared = true; });
    await Promise.resolve(); expect(cleared).toBe(false);
    expect(await worker.message('CACHE_SHELL')).toHaveBeenCalledWith({ ok: false, message: 'static_shell_not_cached' });
    release(); await clearing;
    expect(await writing).toHaveBeenCalledWith({ ok: false, message: 'static_shell_not_cached' });
    expect([...worker.shared.keys()]).toEqual(['other-app-cache']);
  });
  it('keeps the old index/assets across a new worker and rollback, without automatic updates', async () => {
    const old = harness(); await old.message('CACHE_SHELL');
    const newer = harness('DEMO-new', 'DEMO index new', old.shared); await newer.dispatch('install', {}); await newer.dispatch('activate', {}); await newer.message('CACHE_SHELL');
    expect([...old.shared.keys()]).toEqual([cachePrefix + 'DEMO-old', cachePrefix + 'DEMO-new']);
    old.fetch.mockRejectedValueOnce(new Error('offline')); newer.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await (await old.request(origin + path, 'navigate'))?.text()).toBe('DEMO index old');
    expect(await (await newer.request(origin + path, 'navigate'))?.text()).toBe('DEMO index new');
    expect(newer.self.skipWaiting).not.toHaveBeenCalled();
  });
  it('waits for every app tab to be safe before an explicit update, and refuses a draft/running/approval tab', async () => {
    const worker = harness(); let safe = false;
    worker.clients.push({ url: origin + path, focus: vi.fn(), postMessage: (_message, ports) => { ports?.[0]?.postMessage({ safe }); ports?.[0]?.close(); } });
    expect(await worker.message('ACTIVATE_REQUEST')).toHaveBeenCalledWith({ ok: false, message: 'work_in_progress' });
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    safe = true; expect(await worker.message('ACTIVATE_REQUEST')).toHaveBeenCalledWith({ ok: true, message: 'update_activated' });
    expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1); expect(worker.self.clients.claim).not.toHaveBeenCalled();
  });
  it('ignores untrusted notification content/URLs and opens only the fixed same-origin app', async () => {
    const worker = harness(); await worker.dispatch('push', { data: { json: () => ({ kind: 'waiting', title: 'DEMO-secret', body: 'DEMO-private', url: 'https://evil.example', sessionId: 'DEMO-id' }) } });
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith('Hermes Remote Web', expect.objectContaining({ body: '確認が必要です。アプリを開いて確認してください。', data: { kind: 'waiting' } }));
    expect(JSON.stringify(worker.self.registration.showNotification.mock.calls)).not.toMatch(/DEMO-private|DEMO-secret|DEMO-id|evil\.example/);
    await worker.dispatch('notificationclick', { notification: { close: vi.fn(), data: { url: 'https://evil.example' } } });
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith(path);
  });
});
