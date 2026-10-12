import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from './remote';
import type { BotConversationScope } from '../features/bot-conversations';
import type { RemoteGateway, GatewayEvent } from '../transport/remote-gateway';
import { HermesHttpError, type Http } from '../transport/http';

const page = () => ({ sessions: [{ session_id: 'DEMO-owned', title: 'DEMO-owned-title', pinned: false, archived: false, version: '0.DEMO', started_at: 10, parent_session_id: null }],
  next_cursor: null, order: 'created_desc', scope: 'owned_profile_sessions', limit: 50, snapshot_time: 30 });
class DemoGateway implements RemoteGateway {
  events: ((event: GatewayEvent) => void)[] = [];
  requests = vi.fn<(method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>(async method => {
    if (method === 'gateway.capabilities') return { per_session_exclusive_submit: true, remote_web_version: 1 };
    if (method === 'remote.app.capabilities') return { version: 1, principal_id: 'a'.repeat(64), methods: ['remote.sessions.list'], generation_allowed: false, generation_reason: 'DEMO' };
    if (method === 'remote.sessions.list') return page();
    if (method === 'session.list') return { sessions: [{ id: 'DEMO-owned', source: 'discord', title: 'DEMO-RAW-SECRET' }] };
    throw new Error('DEMO unexpected method');
  });
  setTicket(): void {}
  async connect(): Promise<void> { this.events.forEach(handler => handler({ type: 'gateway.ready', payload: { replay_epoch: 'DEMO' } } as GatewayEvent)); }
  close(): void {}
  async request<T>(method: string, params: Record<string, unknown> = {}, _timeout?: number, signal?: AbortSignal): Promise<T> { return await this.requests(method, params, signal) as T; }
  onAny(handler: (event: GatewayEvent) => void): () => void { this.events.push(handler); return () => {}; }
  onRequest(): () => void { return () => {}; }
  onState(): () => void { return () => {}; }
  async awaitSessionReplay(): Promise<boolean> { return true; }
  getSeqWatermarks(): Record<string, number> { return {}; }
}
const controllers: RemoteController[] = [];
afterEach(() => { controllers.forEach(controller => controller.dispose()); controllers.length = 0; });
async function fixture() {
  const gateway = new DemoGateway();
  const read = vi.fn<(path: string) => Promise<unknown>>(async path => path === '/api/status' ? { auth_required: true, version: 'DEMO' }
    : path === '/api/profiles' ? { profiles: [{ name: 'default' }, { name: 'other' }] }
      : path === '/api/auth/ws-ticket' ? { ticket: 'DEMO-ticket' } : {});
  const http = Object.assign(read, { setProfile: vi.fn() }) as Http;
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true, makeGateway: () => gateway, withOperationLock: async action => action() });
  controllers.push(controller); await controller.start(); expect(controller.store.getState().connection).toBe('connected'); read.mockClear(); gateway.requests.mockClear();
  const scope = (): BotConversationScope => ({ origin: 'https://demo.invalid', profile: controller.store.getState().profile,
    principal: controller.store.getState().principalId, generation: controller.imageSelectionGeneration, projectId: controller.store.getState().selectedProjectId });
  return { controller, gateway, read, scope };
}

describe('central bot discovery preserves real contracts and native scope', () => {
  it('performs protected auth first, then exactly two bounded reads; no made-up filters, title lookup, fallback or operations', async () => {
    const { controller, read, gateway, scope } = await fixture(); const signal = new AbortController().signal;
    const result = await controller.readBotConversationPage(scope(), null, signal);
    expect(read.mock.calls.map(call => call[0])).toEqual(['/api/auth/me']);
    expect(gateway.requests.mock.calls).toEqual([
      ['remote.sessions.list', { profile: 'default', limit: 50 }, signal],
      ['session.list', { profile: 'default', limit: 200 }, signal],
    ]);
    expect(result.rows[0]?.source).toBe('discord'); expect(JSON.stringify(result)).not.toContain('DEMO-RAW-SECRET');
    expect(controller.store.getState().sessions[0]?.source).toBe('');
  });
  it('pins a registered project and opaque cursor without changing the main list or draft', async () => {
    const { controller, gateway, scope } = await fixture();
    controller.store.setState({ selectedProjectId: 'DEMO-project', projects: [{ id: 'DEMO-project', label: 'DEMO', kind: 'registered', sessionCount: 0, sessionIds: [], previews: [], lastActive: null }], draft: 'DEMO 元の下書き' });
    const previous = controller.store.getState().sessions;
    await controller.readBotConversationPage(scope(), 'DEMO-cursor', new AbortController().signal);
    expect(gateway.requests.mock.calls[0]?.[1]).toEqual({ profile: 'default', project_id: 'DEMO-project', cursor: 'DEMO-cursor', limit: 50 });
    expect(controller.store.getState().sessions).toBe(previous); expect(controller.store.getState().draft).toBe('DEMO 元の下書き');
  });
  it('rejects unknown/mismatched scope, unregistered project, absent capability or pre-aborted reads before traffic', async () => {
    const { controller, gateway, read, scope } = await fixture();
    for (const change of [{ origin: 'https://other.invalid' }, { profile: 'other' }, { principal: 'other' }, { generation: 'old' }, { projectId: 'unknown' }]) {
      await expect(controller.readBotConversationPage({ ...scope(), ...change }, null, new AbortController().signal)).rejects.toThrow();
    }
    controller.store.setState({ selectedProjectId: 'unknown' });
    await expect(controller.readBotConversationPage(scope(), null, new AbortController().signal)).rejects.toThrow();
    controller.store.setState({ selectedProjectId: '', featureMethods: [] });
    await expect(controller.readBotConversationPage(scope(), null, new AbortController().signal)).rejects.toThrow();
    controller.store.setState({ featureMethods: ['remote.sessions.list'] }); const abort = new AbortController(); abort.abort();
    await expect(controller.readBotConversationPage(scope(), null, abort.signal)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled(); expect(gateway.requests).not.toHaveBeenCalled();
  });
  it('does not start RPCs after scope changes during auth, and handles expired auth through the existing clear/reauth flow', async () => {
    const { controller, read, gateway, scope } = await fixture(); let resolve!: (value: unknown) => void;
    read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const action = controller.readBotConversationPage(scope(), null, new AbortController().signal);
    controller.store.setState({ selectedProjectId: 'changed' }); resolve({}); await expect(action).rejects.toThrow(); expect(gateway.requests).not.toHaveBeenCalled();
    controller.store.setState({ selectedProjectId: '', draft: 'DEMO 秘密の下書き' });
    read.mockRejectedValueOnce(new HermesHttpError(401, 'Unauthorized', 'DEMO-secret'));
    await expect(controller.readBotConversationPage(scope(), null, new AbortController().signal)).rejects.toThrow();
    expect(controller.store.getState().connection).toBe('reauth'); expect(controller.store.getState().draft).toBe(''); expect(gateway.requests).not.toHaveBeenCalled();
  });
  it('observes both parallel RPC failures without a retry and never returns a source-only result', async () => {
    const { controller, gateway, scope } = await fixture();
    gateway.requests.mockRejectedValueOnce(new Error('DEMO owned unavailable')).mockRejectedValueOnce(new Error('DEMO source unavailable'));
    await expect(controller.readBotConversationPage(scope(), null, new AbortController().signal)).rejects.toThrow();
    expect(gateway.requests).toHaveBeenCalledTimes(2);
  });
  it.each(['project', 'profile', 'principal', 'live', 'auth', 'capability', 'abort'])('drops a page/index arriving after %s scope loss', async change => {
    const { controller, gateway, scope } = await fixture(); let resolve!: (value: unknown) => void;
    gateway.requests.mockReturnValueOnce(new Promise(done => { resolve = done; })); const abort = new AbortController();
    const action = controller.readBotConversationPage(scope(), null, abort.signal);
    await vi.waitFor(() => expect(gateway.requests).toHaveBeenCalledTimes(2));
    if (change === 'abort') abort.abort();
    else if (change === 'project') controller.store.setState({ selectedProjectId: 'DEMO-new-project' });
    else if (change === 'profile') controller.store.setState({ profile: 'other' });
    else if (change === 'principal') controller.store.setState({ principalId: 'b'.repeat(64) });
    else if (change === 'live') controller.store.setState({ liveId: 'DEMO-new-live' });
    else if (change === 'auth') controller.store.setState({ authenticated: false });
    else controller.store.setState({ featureMethods: [] });
    resolve(page());
    await expect(action).rejects.toThrow(); expect(gateway.requests).toHaveBeenCalledTimes(2);
  });
});
