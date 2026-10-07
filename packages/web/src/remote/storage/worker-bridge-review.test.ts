import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineShell } from './worker';

// This unit checks the real bridge's ownership/ACK rules. The separate browser
// scenario uses the actual installed workers, network boundary and Cache Storage.
class ReviewChannel {
  port1 = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() };
  port2 = { postMessage: (data: unknown): void => { queueMicrotask(() => this.port1.onmessage?.({ data } as MessageEvent)); } };
}
class ReviewWorker {
  calls: unknown[] = [];
  constructor(private readonly accepted = true) {}
  postMessage(message: unknown, ports: MessagePort[]): void {
    this.calls.push(message); ports[0]?.postMessage({ ok: this.accepted });
  }
}
function registration(scope: string, active: ReviewWorker | null, waiting: ReviewWorker | null = null, installing: ReviewWorker | null = null): ServiceWorkerRegistration {
  return { scope, active, waiting, installing, unregister: vi.fn() } as unknown as ServiceWorkerRegistration;
}
function setup(registrations: ServiceWorkerRegistration[]) {
  vi.stubGlobal('MessageChannel', ReviewChannel);
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => registrations } });
  const remove = vi.fn(async () => true);
  vi.stubGlobal('caches', { keys: async () => ['hermes-remote-web.static.v1.DEMO', 'DEMO.foreign-app'], delete: remove });
  return { remove };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent worker clear bridge review', () => {
  it('clears all three owned generations and never messages/unregisters a foreign scope', async () => {
    const active = new ReviewWorker(), waiting = new ReviewWorker(), installing = new ReviewWorker(), foreign = new ReviewWorker();
    const foreignRegistration = registration(window.location.origin + '/other-app/', foreign);
    setup([foreignRegistration, registration(window.location.origin + '/hermes-remote-web/', active, waiting, installing)]);
    await clearOfflineShell();
    for (const owned of [active, waiting, installing]) expect(owned.calls).toEqual([{ type: 'CLEAR_OFFLINE_SHELL' }]);
    expect(foreign.calls).toEqual([]); expect(foreignRegistration.unregister).not.toHaveBeenCalled();
  });
  it('deduplicates the same worker object instead of clearing it multiple times', async () => {
    const worker = new ReviewWorker();
    setup([registration(window.location.origin + '/hermes-remote-web/', worker, worker, worker)]);
    await clearOfflineShell(); expect(worker.calls).toEqual([{ type: 'CLEAR_OFFLINE_SHELL' }]);
  });
  it('does not report a complete clear when one generation fails its acknowledgement', async () => {
    const active = new ReviewWorker(), waiting = new ReviewWorker(false), installing = new ReviewWorker();
    const { remove } = setup([registration(window.location.origin + '/hermes-remote-web/', active, waiting, installing)]);
    await expect(clearOfflineShell()).rejects.toThrow('端末の保存消去を確認できません');
    for (const owned of [active, waiting, installing]) expect(owned.calls).toEqual([{ type: 'CLEAR_OFFLINE_SHELL' }]);
    expect(remove).not.toHaveBeenCalled();
  });
  it('without an owned registration deletes only the exact owned cache namespace', async () => {
    const foreign = new ReviewWorker();
    const { remove } = setup([registration(window.location.origin + '/other-app/', foreign)]);
    await clearOfflineShell();
    expect(remove.mock.calls).toEqual([['hermes-remote-web.static.v1.DEMO']]); expect(foreign.calls).toEqual([]);
  });
});
