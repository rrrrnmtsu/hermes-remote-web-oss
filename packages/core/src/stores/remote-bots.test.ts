import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from './remote';
import { HermesHttpError, type Http } from '../transport/http';

const controllers: RemoteController[] = [];
afterEach(() => { controllers.forEach(controller => controller.dispose()); controllers.length = 0; });
function setup() {
  const read = vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>().mockResolvedValue({ gateway_running: true });
  const http = Object.assign(read, { setProfile: vi.fn() }) as Http;
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO metadata only'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', authenticated: true, principalId: 'DEMO-owner', profile: 'DEMO 日本語', profiles: ['default', 'DEMO 日本語'] });
  controllers.push(controller); return { controller, read };
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('central bot read uses the existing authenticated same-origin contract', () => {
  it('pins the registered profile, verifies auth and performs exactly one GET with no gateway write or fallback', async () => {
    const { controller, read } = setup(); const signal = new AbortController().signal;
    await controller.readBotStatus('DEMO 日本語', signal);
    expect(read.mock.calls).toEqual([
      ['/api/auth/me', { skipProfile: true, signal }],
      ['/api/status?profile=DEMO%20%E6%97%A5%E6%9C%AC%E8%AA%9E', { method: 'GET', skipProfile: true, signal }],
    ]);
  });
  it.each(['reauth', 'logged_out', 'offline'] as const)('makes zero calls while %s', async connection => {
    const { controller, read } = setup(); controller.store.setState({ connection });
    await expect(controller.readBotStatus('DEMO 日本語', new AbortController().signal)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects unknown profiles, mismatched scope, missing principal and pre-aborted reads without network traffic', async () => {
    const { controller, read } = setup();
    await expect(controller.readBotStatus('not-registered', new AbortController().signal)).rejects.toThrow();
    await expect(controller.readBotStatus('default', new AbortController().signal)).rejects.toThrow();
    controller.store.setState({ principalId: '' });
    await expect(controller.readBotStatus('DEMO 日本語', new AbortController().signal)).rejects.toThrow();
    controller.store.setState({ principalId: 'DEMO-owner' }); const abort = new AbortController(); abort.abort();
    await expect(controller.readBotStatus('DEMO 日本語', abort.signal)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it('does not start the public status read if the profile changes during protected auth verification', async () => {
    const { controller, read } = setup(); const pending = deferred(); read.mockReturnValueOnce(pending.promise);
    const action = controller.readBotStatus('DEMO 日本語', new AbortController().signal);
    controller.store.setState({ profile: 'default' }); pending.resolve({ authenticated: true });
    await expect(action).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
  });
  it('rejects a status reply after logout and does not retry or transfer the result to a new scope', async () => {
    const { controller, read } = setup(); const pending = deferred(); read.mockResolvedValueOnce({}).mockReturnValueOnce(pending.promise);
    const action = controller.readBotStatus('DEMO 日本語', new AbortController().signal);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    controller.hideLocalSession(); pending.resolve({ gateway_running: true });
    await expect(action).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('handles expired auth through the existing reauthentication path rather than a successful public status probe', async () => {
    const { controller, read } = setup(); controller.store.setState({ draft: 'DEMO private draft', messages: [{ id: 'DEMO', role: 'user', text: 'DEMO private' }] });
    read.mockRejectedValueOnce(new HermesHttpError(401, 'Unauthorized', 'DEMO-secret'));
    await expect(controller.readBotStatus('DEMO 日本語', new AbortController().signal)).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1); expect(controller.store.getState().connection).toBe('reauth');
    expect(controller.store.getState().draft).toBe(''); expect(controller.store.getState().messages).toEqual([]);
    expect(controller.store.getState().diagnostic).not.toContain('DEMO-secret');
  });
  it('does not let an old profile auth failure log out or clear the new profile', async () => {
    const { controller, read } = setup(); let reject!: (error: unknown) => void;
    read.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
    const action = controller.readBotStatus('DEMO 日本語', new AbortController().signal);
    controller.store.setState({ profile: 'default', draft: 'DEMO new-profile draft' });
    reject(new HermesHttpError(401, 'Unauthorized', 'DEMO-old-secret'));
    await expect(action).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
    expect(controller.store.getState().connection).toBe('connected'); expect(controller.store.getState().draft).toBe('DEMO new-profile draft');
  });
});
