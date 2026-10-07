import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from './remote';
import type { RemoteGateway, GatewayEvent, ServerRequest } from '../transport/remote-gateway';
import { HermesHttpError, type Http } from '../transport/http';

class DemoGateway implements RemoteGateway {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  tickets: string[] = [];
  events: ((event: GatewayEvent) => void)[] = [];
  handlers: ((request: ServerRequest) => boolean | void)[] = [];
  states: ((state: string) => void)[] = [];
  profile = 'default';
  running = false;
  failAck = false;
  failStop = false;
  failConnect = false;
  ready = true;
  truncated = false;
  epoch = 'DEMO-epoch-1';
  responseLost = false;
  responses: Record<string, unknown>[] = [];
  open: { id: string; method: string; params: Record<string, unknown> }[] = [];
  delayList: Promise<unknown> | null = null;
  delayProjects: Promise<unknown> | null = null;
  delayProjectSessions = new Map<string, Promise<unknown>>();
  projectsFailure = 0;
  activationHook: (() => void) | null = null;
  snapshot() {
    return { session_id: `DEMO-live-${this.profile}`, stored_session_id: `DEMO-durable-tip-${this.profile}`,
      messages: [{ role: 'assistant', text: 'DEMO 保存済み回答', row_id: 11 }], message_count: 1,
      info: { running: this.running, stored_session_id: `DEMO-durable-tip-${this.profile}` }, running: this.running, open_requests: [...this.open] };
  }
  setTicket(ticket: string): void { this.tickets.push(ticket); }
  async connect(): Promise<void> {
    if (this.failConnect) throw new Error('DEMO connection failure');
    this.states.forEach(handler => handler('open'));
    if (this.ready) this.emit('gateway.ready', { replay_epoch: this.epoch });
  }
  close(): void { this.states.forEach(handler => handler('closed')); }
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    let result: unknown = {};
    if (method === 'gateway.capabilities') result = { per_session_exclusive_submit: true, remote_web_version: 1 };
    if (method === 'remote.app.capabilities') result = { version: 1, principal_id: 'a'.repeat(64), methods: [], generation_allowed: true, generation_reason: '' };
    if (method === 'session.list') {
      if (this.delayList) return await this.delayList as T;
      result = { sessions: [{ id: 'DEMO-durable-root', resolved_id: 'DEMO-durable-tip', title: 'DEMO会話', source: 'tui' }] };
    }
    if (method === 'projects.tree') {
      if (this.projectsFailure) throw { code: this.projectsFailure, message: 'DEMO-secret-do-not-display' };
      if (this.delayProjects) return await this.delayProjects as T;
      result = { projects: [projectFixture('DEMO-plan'), projectFixture('DEMO-research')], active_id: 'DEMO-research' };
    }
    if (method === 'projects.project_sessions') {
      const id = String(params.project_id);
      if (this.delayProjectSessions.has(id)) return await this.delayProjectSessions.get(id) as T;
      result = { project: projectFixture(id) };
    }
    if (method === 'session.create' || method === 'session.resume') result = this.snapshot();
    if (method === 'session.activate') { const snapshot = this.snapshot(); this.activationHook?.(); result = snapshot; }
    if (method === 'session.events.since') result = { epoch: this.epoch, truncated: this.truncated, latest_seq: 10, events: [], open_requests: [...this.open] };
    if (method === 'prompt.submit') { this.running = true; if (this.failAck) throw new Error('DEMO ack lost'); result = { status: 'streaming', user_row_id: 12 }; }
    if (method === 'session.interrupt') { if (this.failStop) throw new Error('DEMO stop ack lost'); this.running = false; result = { status: 'interrupted' }; }
    if (['session.activate', 'session.events.since', 'session.resume'].includes(method)) this.open.forEach(entry => this.deliver(entry));
    return result as T;
  }
  deliver(entry: { id: string; method: string; params: Record<string, unknown> }): void {
    const request: ServerRequest = { ...entry, respond: response => {
      this.responses.push(response);
      if (!this.responseLost) { this.open = this.open.filter(item => item.id !== entry.id); this.emit('request.cancel', { id: entry.id, reason: 'resolved' }, `DEMO-live-${this.profile}`); }
    }, fail: () => { this.responses.push({ unsupported: true }); } };
    this.handlers.forEach(handler => handler(request));
  }
  emit(type: string, payload: Record<string, unknown>, sessionId?: string, seq?: number): void {
    this.events.forEach(handler => handler({ type, payload, ...(sessionId ? { session_id: sessionId } : {}), ...(seq !== undefined ? { seq } : {}) } as GatewayEvent));
  }
  onAny(handler: (event: GatewayEvent) => void): () => void { this.events.push(handler); return () => { this.events = this.events.filter(item => item !== handler); }; }
  onRequest(handler: (request: ServerRequest) => boolean | void): () => void { this.handlers.push(handler); return () => undefined; }
  onState(handler: (state: string) => void): () => void { this.states.push(handler); return () => undefined; }
  async awaitSessionReplay(): Promise<boolean> { return true; }
  getSeqWatermarks(): Record<string, number> { return {}; }
}

function projectFixture(id: string) {
  const row = { id: `${id}-root`, title: `DEMO ${id}`, source: 'tui', last_active: 1791030000, message_count: 2, _lineage_ids: [`${id}-root`, `${id}-tip`] };
  return { id, label: `DEMO ${id}`, sessionCount: 1, sessionIds: [row.id], previewSessions: [row],
    repos: [{ id: 'DEMO-repo', groups: [{ id: 'DEMO-main', sessions: [row, row] }] }] };
}

const controllers: RemoteController[] = [];
afterEach(() => { controllers.forEach(controller => controller.dispose()); controllers.length = 0; vi.useRealTimers(); });
function setup(options: { secure?: boolean; authFails?: boolean; authStatus?: number; statusError?: Error; noLock?: boolean; httpFailsLogout?: boolean } = {}) {
  const gateways: DemoGateway[] = [];
  let ticket = 0;
  const http = (async (path: string) => {
    if (path === '/api/auth/me' && options.authFails) throw new HermesHttpError(options.authStatus || 401, 'Unauthorized', 'DEMO-secret-that-must-not-render');
    if (path === '/api/status') { if (options.statusError) throw options.statusError; return { version: '0.21.5' }; }
    if (path === '/api/profiles') return { profiles: [{ name: 'default' }, { name: 'sakura' }] };
    if (path === '/api/auth/ws-ticket') return { ticket: `DEMO-ticket-${++ticket}` };
    if (path === '/auth/logout' && options.httpFailsLogout) throw new Error('DEMO logout transport failure');
    return {};
  }) as Http;
  http.setProfile = () => undefined;
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: options.secure ?? true,
    makeGateway: profile => { const gateway = new DemoGateway(); gateway.profile = profile; gateways.push(gateway); return gateway; },
    withOperationLock: async action => options.noLock ? undefined : action(),
  });
  controllers.push(controller);
  return { controller, gateways, http };
}
async function active() {
  const result = setup(); await result.controller.start(); await result.controller.openSession('DEMO-durable-root');
  const gateway = result.gateways[0]; if (!gateway) throw new Error('missing DEMO gateway');
  return { ...result, gateway };
}

describe('Hermes Remote Web contract adapter', () => {
  it('projects an in-flight persisted user row once by authoritative row ID, never by matching text', async () => {
    const { controller, gateway } = await active();
    gateway.snapshot = () => ({ session_id: 'DEMO-live-default', messages: [{ role: 'user', text: 'DEMO 本文', row_id: 12 }],
      stored_session_id: 'DEMO-durable-tip-default', message_count: 1, info: { running: true, stored_session_id: 'DEMO-durable-tip-default' },
      running: true, open_requests: [], inflight: { user: 'DEMO 本文', assistant: '', streaming: true, user_row_id: 12 } });
    await controller.synchronize(); expect(controller.store.getState().messages).toHaveLength(1);
    gateway.snapshot = () => ({ session_id: 'DEMO-live-default', messages: [{ role: 'user', text: 'DEMO 本文', row_id: 12 }],
      stored_session_id: 'DEMO-durable-tip-default', message_count: 1, info: { running: true, stored_session_id: 'DEMO-durable-tip-default' },
      running: true, open_requests: [], inflight: { user: 'DEMO 本文', assistant: '', streaming: true, user_row_id: 99 } });
    await controller.synchronize(); expect(controller.store.getState().messages).toHaveLength(2);
  });
  it('distinguishes 401, 403, timeout and a browser-opaque network/TLS failure without revealing response bodies', async () => {
    for (const status of [401, 403]) {
      const { controller } = setup({ authFails: true, authStatus: status }); await controller.start();
      expect(controller.store.getState()).toMatchObject({ connection: 'reauth', failureKind: status === 401 ? 'auth_401' : 'forbidden_403' });
      expect(controller.store.getState().diagnostic).not.toContain('DEMO-secret');
    }
    for (const [error, kind] of [[new Error('HTTP request timed out'), 'timeout'], [new TypeError('Failed to fetch'), 'network_or_tls'], [new HermesHttpError(404, 'Not Found', 'DEMO-private'), 'version_mismatch']] as const) {
      const { controller } = setup({ statusError: error }); await controller.start();
      expect(controller.store.getState().failureKind).toBe(kind);
      expect(controller.store.getState().diagnostic).not.toContain('DEMO-private');
    }
  });

  it('requires HTTPS, verified auth, ready and a successful read RPC separately', async () => {
    const insecure = setup({ secure: false }); await insecure.controller.start();
    expect(insecure.controller.store.getState().connection).toBe('unsupported');
    expect(insecure.gateways).toHaveLength(0);
    const auth = setup({ authFails: true }); await auth.controller.start();
    expect(auth.controller.store.getState().connection).toBe('reauth');
    expect(JSON.stringify(auth.controller.store.getState())).not.toContain('DEMO-secret');
    const { controller, gateways } = setup(); await controller.start();
    expect(controller.store.getState()).toMatchObject({ connection: 'connected', https: true, authenticated: true, wss: true, gatewayReady: true, readRpc: true });
    gateways[0]!.failConnect = true; await controller.recover();
    expect(controller.store.getState().connection).not.toBe('connected');
    expect(controller.store.getState().readRpc).toBe(false);
  });

  it('handles a missing ready handshake with a bounded visible failure', async () => {
    vi.useFakeTimers();
    const { controller, gateways } = setup(); await controller.start();
    gateways[0]!.ready = false;
    const pending = controller.recover();
    await vi.advanceTimersByTimeAsync(15001); await pending;
    expect(controller.store.getState().connection).toBe('error');
    expect(controller.store.getState().gatewayReady).toBe(false);
  });

  it('keeps durable, runtime and the selected lineage reference separate', async () => {
    const { controller, gateway } = await active();
    expect(controller.store.getState()).toMatchObject({ durableId: 'DEMO-durable-tip-default', liveId: 'DEMO-live-default', lineageId: 'DEMO-durable-root' });
    expect(gateway.calls.find(call => call.method === 'session.resume')?.params).toEqual({ session_id: 'DEMO-durable-root', profile: 'default', lazy: true, inline_images: false, close_on_disconnect: false });
    await controller.openSession();
    expect(gateway.calls.find(call => call.method === 'session.create')?.params).toEqual({ profile: 'default', close_on_disconnect: false });
  });

  it('protects an unsent draft from a new conversation or profile switch', async () => {
    const { controller, gateway } = await active();
    controller.setDraft('DEMO unsent draft');
    await controller.openSession(); await controller.selectProfile('sakura');
    expect(controller.store.getState()).toMatchObject({ profile: 'default', draft: 'DEMO unsent draft', liveId: 'DEMO-live-default' });
    expect(gateway.calls.filter(call => call.method === 'session.create')).toHaveLength(0);
  });

  it('quarantines a late list response from the previous profile', async () => {
    const { controller, gateway, gateways } = await active();
    let resolve: (value: unknown) => void = () => undefined;
    gateway.delayList = new Promise(done => { resolve = done; });
    const stale = controller.refreshSessions();
    await controller.selectProfile('sakura');
    resolve({ sessions: [{ id: 'DEMO-old', title: 'DEMO-old-profile', source: 'tui' }] });
    await stale;
    expect(controller.store.getState().profile).toBe('sakura');
    expect(controller.store.getState().sessions.map(session => session.title)).not.toContain('DEMO-old-profile');
    gateway.emit('message.delta', { text: 'DEMO-old-frame' }, 'DEMO-live-default', 99);
    expect(JSON.stringify(controller.store.getState())).not.toContain('DEMO-old-frame');
    expect(gateways).toHaveLength(2);
  });

  it('prevents rapid duplicate sends and retains unknown delivery through reconnect without retransmission', async () => {
    const { controller, gateway } = await active(); gateway.failAck = true;
    controller.setDraft('DEMO 日本語を送信');
    await Promise.all([controller.submit(), controller.submit(), controller.submit()]);
    expect(controller.store.getState().delivery).toBe('delivery_unknown');
    await controller.recover(); await controller.synchronize(); await controller.submit();
    expect(controller.store.getState().delivery).toBe('delivery_unknown');
    expect(gateway.calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1);
    expect(gateway.calls.find(call => call.method === 'prompt.submit')?.params).toEqual({ session_id: 'DEMO-live-default', profile: 'default', text: 'DEMO 日本語を送信' });
    expect(new Set(gateway.tickets).size).toBe(2);
  });

  it('does not send before connection and respects an occupied browser operation lock', async () => {
    const disconnected = setup(); disconnected.controller.setDraft('DEMO draft'); await disconnected.controller.submit();
    expect(disconnected.controller.store.getState().delivery).toBe('failed_before_send');
    const locked = setup({ noLock: true }); await locked.controller.start(); await locked.controller.openSession();
    expect(locked.gateways[0]?.calls.some(call => call.method === 'session.create')).toBe(false);
    expect(locked.controller.store.getState().liveId).toBe('');
  });

  it('does not mistake an accepted submission for unknown when later state synchronization fails', async () => {
    const { controller, gateway } = await active();
    const original = gateway.request.bind(gateway);
    let submitted = false;
    gateway.request = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      if (method === 'prompt.submit') submitted = true;
      if (submitted && method === 'session.activate') throw new Error('DEMO sync failed');
      return original<T>(method, params);
    };
    controller.setDraft('DEMO'); await controller.submit();
    expect(controller.store.getState().delivery).toBe('accepted');
  });

  it('answers only offered once/deny choices after authoritative revalidation', async () => {
    const { controller, gateway } = await active();
    gateway.open = [{ id: 'DEMO-approval', method: 'approval', params: { session_id: 'DEMO-live-default', command: 'echo DEMO', choices: ['once', 'session', 'always', 'deny'] } }];
    await controller.synchronize();
    await controller.answer('string:DEMO-approval', { choice: 'always' }); expect(gateway.responses).toHaveLength(0);
    await controller.answer('string:DEMO-approval', { choice: 'once' });
    expect(gateway.responses).toEqual([{ choice: 'once' }]);
    expect(controller.store.getState().requests[0]?.status).toBe('resolved');
  });

  it('requires another confirmation when approval contents change during revalidation', async () => {
    const { controller, gateway } = await active();
    gateway.open = [{ id: 'DEMO-change', method: 'approval', params: { session_id: 'DEMO-live-default', command: 'echo DEMO original', choices: ['once', 'deny'] } }];
    await controller.synchronize();
    gateway.activationHook = () => { gateway.open[0]!.params = { ...gateway.open[0]!.params, command: 'echo DEMO changed' }; };
    await controller.answer('string:DEMO-change', { choice: 'once' });
    expect(gateway.responses).toHaveLength(0);
    expect(controller.store.getState().diagnostic).toContain('承認対象が変わりました');
  });

  it('merges newly accepted clarify answers from revalidation and rejects missing answers', async () => {
    const { controller, gateway } = await active();
    gateway.open = [{ id: 'DEMO-questions', method: 'clarify', params: { session_id: 'DEMO-live-default', questions: [{ qid: 'q0', question: 'DEMO locked' }, { qid: 'q1', question: 'DEMO fresh' }], answers: { q0: 'accepted' } } }];
    await controller.synchronize();
    await controller.answer('string:DEMO-questions', { answers: { q0: 'tamper' } });
    expect(gateway.responses).toHaveLength(0);
    gateway.activationHook = () => { gateway.open[0]!.params = { ...gateway.open[0]!.params, answers: { q0: 'accepted', q1: 'accepted elsewhere' } }; };
    await controller.answer('string:DEMO-questions', { answers: { q0: 'tamper', q1: 'stale', unexpected: 'ignored' } });
    expect(gateway.responses).toEqual([{ answers: { q0: 'accepted', q1: 'accepted elsewhere' } }]);
  });

  it('does not approve a withdrawn or externally resolved request', async () => {
    const { controller, gateway } = await active();
    gateway.open = [{ id: 'DEMO-a', method: 'approval', params: { session_id: 'DEMO-live-default', choices: ['once', 'deny'] } }];
    await controller.synchronize();
    gateway.open = [];
    await controller.answer('string:DEMO-a', { choice: 'once' });
    expect(gateway.responses).toHaveLength(0);
    gateway.emit('request.cancel', { id: 'DEMO-a', reason: 'interrupted' }, 'DEMO-live-default');
    await controller.answer('string:DEMO-a', { choice: 'deny' });
    expect(gateway.responses).toHaveLength(0);
  });

  it('preserves an uncertain answer without automatically answering it again', async () => {
    const { controller, gateway } = await active(); gateway.responseLost = true;
    gateway.open = [{ id: 'DEMO-q', method: 'clarify', params: { session_id: 'DEMO-live-default', questions: [{ qid: 'q0', question: 'DEMO?' }], answers: {} } }];
    await controller.synchronize(); await controller.answer('string:DEMO-q', { answers: { q0: 'DEMO answer' } });
    await controller.recover(); await controller.answer('string:DEMO-q', { answers: { q0: 'DEMO answer' } });
    expect(controller.store.getState().requests[0]?.status).toBe('response_unknown');
    expect(gateway.responses).toHaveLength(1);
  });

  it('does not dismiss a new request racing an older snapshot', async () => {
    const { controller, gateway } = await active();
    gateway.activationHook = () => {
      const entry = { id: 'DEMO-new', method: 'approval', params: { session_id: 'DEMO-live-default', choices: ['deny'] } };
      gateway.deliver(entry);
    };
    await controller.synchronize();
    expect(controller.store.getState().requests[0]?.status).toBe('pending');
    expect(controller.store.getState().execution).toBe('waiting_input');
  });

  it('deduplicates seq and recovers truncated replay and epoch changes through authoritative history', async () => {
    const { controller, gateway } = await active();
    gateway.emit('message.start', {}, 'DEMO-live-default', 1);
    gateway.emit('message.delta', { text: 'DEMO-' }, 'DEMO-live-default', 2);
    gateway.emit('message.delta', { text: 'DEMO-' }, 'DEMO-live-default', 2);
    gateway.emit('message.delta', { text: 'stream' }, 'DEMO-live-default', 3);
    expect(controller.store.getState().messages.at(-1)?.text).toBe('DEMO-stream');
    gateway.truncated = true; gateway.epoch = 'DEMO-epoch-2'; await controller.recover();
    expect(controller.store.getState().messages.at(-1)?.text).toBe('DEMO 保存済み回答');
    expect(controller.store.getState().syncWarning).not.toBe('');
  });

  it('projects the fixed accepted caption by canonical ACK row when history races streaming', async () => {
    const { controller, gateway } = await active();
    gateway.activationHook = () => gateway.emit('message.delta', { text: 'DEMO newer stream' }, 'DEMO-live-default');
    controller.setDraft('DEMO 日本語の固定本文'); await controller.submit();
    expect(controller.store.getState().delivery).toBe('accepted');
    expect(controller.store.getState().messages.filter(message => message.id === '12')).toEqual([{ id: '12', role: 'user', text: 'DEMO 日本語の固定本文' }]);
    expect(gateway.calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1);
  });
  it('does not invalidate a completed history snapshot for an unprojected informational event', async () => {
    const { controller, gateway } = await active();
    gateway.snapshot = () => ({ session_id: 'DEMO-live-default', stored_session_id: 'DEMO-durable-tip-default', messages: [
      { role: 'user', text: 'DEMO fixed caption', row_id: 12 }, { role: 'assistant', text: 'DEMO complete', row_id: 13 }],
      message_count: 2, info: { running: false, stored_session_id: 'DEMO-durable-tip-default' }, running: false, open_requests: [] });
    gateway.activationHook = () => gateway.emit('session.usage', { input_tokens: 1 }, 'DEMO-live-default');
    await controller.synchronize(); expect(controller.store.getState().messages.map(message => message.id)).toEqual(['12', '13']);
  });
  it('preserves streamed text newer than an in-flight history snapshot', async () => {
    const { controller, gateway } = await active();
    gateway.emit('message.start', {}, 'DEMO-live-default', 1);
    gateway.activationHook = () => gateway.emit('message.delta', { text: 'DEMO-racing' }, 'DEMO-live-default', 2);
    await controller.synchronize();
    expect(controller.store.getState().messages.at(-1)?.text).toBe('DEMO-racing');
  });

  it('keeps stop requested/unknown distinct from authoritative stopped state', async () => {
    const { controller, gateway } = await active(); gateway.running = true;
    await controller.synchronize(); gateway.failStop = true; await controller.stop();
    expect(controller.store.getState()).toMatchObject({ execution: 'unknown', stopUnknown: true });
    gateway.failStop = false; gateway.running = false; await controller.synchronize();
    expect(controller.store.getState()).toMatchObject({ execution: 'stopped', stopUnknown: false });
    await controller.synchronize();
    expect(controller.store.getState().execution).toBe('stopped');
  });

  it('rejects unsupported requests without executing a terminal bridge or notification', async () => {
    const { controller, gateway } = await active();
    gateway.running = true;
    await controller.synchronize();
    gateway.deliver({ id: 'DEMO-sudo', method: 'sudo', params: { session_id: 'DEMO-live-default' } });
    expect(gateway.responses).toEqual([{ unsupported: true }]);
    expect(controller.store.getState().requests[0]?.status).toBe('unsupported');
    gateway.running = false;
    gateway.emit('request.cancel', { id: 'DEMO-sudo', reason: 'resolved' }, 'DEMO-live-default');
    await vi.waitFor(() => expect(controller.store.getState().execution).toBe('idle'));
    expect(gateway.calls.every(call => !/cron|kanban|push|config|pty/.test(call.method))).toBe(true);
  });

  it('hides all local sensitive state on failed logout and prevents automatic reconnect', async () => {
    const { controller, gateways } = setup({ httpFailsLogout: true }); await controller.start(); await controller.openSession();
    controller.setDraft('DEMO-sensitive-draft'); await controller.logout(); await controller.recover();
    expect(controller.store.getState()).toMatchObject({ connection: 'logged_out', draft: '', liveId: '', durableId: '', messages: [], requests: [], sessions: [], profiles: [] });
    expect(gateways[0]?.tickets).toHaveLength(1);
    expect(JSON.stringify(controller.store.getState())).not.toContain('DEMO-sensitive');
  });
});

describe('authoritative project/session sidebar projection', () => {
  it('does not treat a malformed session list as a successful read RPC', async () => {
    const { controller, gateways } = setup(); await controller.start();
    gateways[0]!.delayList = Promise.resolve({});
    await expect(controller.refreshSessions()).rejects.toThrow('session_list_contract_mismatch');
    expect(controller.store.getState().listLoading).toBe(false);
    expect(controller.store.getState().diagnostic).toContain('会話一覧を取得できません');
  });

  it('loads bounded profile-scoped reads without adopting the server active project', async () => {
    const { controller, gateways } = setup(); await controller.start(); await controller.refreshProjects();
    const gateway = gateways[0]!;
    expect(gateway.calls.find(call => call.method === 'projects.tree')?.params).toEqual({ profile: 'default', preview_limit: 3, session_limit: 100 });
    expect(controller.store.getState()).toMatchObject({ projectsStatus: 'ready', selectedProjectId: '', liveId: '' });
    await controller.selectProject('DEMO-plan');
    expect(gateway.calls.find(call => call.method === 'projects.project_sessions')?.params).toEqual({ profile: 'default', project_id: 'DEMO-plan', session_limit: 100 });
    expect(controller.store.getState().projectSessions).toHaveLength(1);
    expect(controller.store.getState().projectSessions[0]?.durableId).toBe('DEMO-plan-root');
    expect(gateway.calls.every(call => !/projects\.(set_active|create|update|delete|record|discover)|prompt|resume|config/.test(call.method))).toBe(true);
  });

  it('keeps draft, live scope and execution intact while filtering projects', async () => {
    const { controller, gateways } = setup(); await controller.start(); await controller.openSession(); await controller.refreshProjects();
    controller.setDraft('DEMO 保持する下書き');
    const before = controller.store.getState();
    controller.store.setState({ execution: 'running' });
    await controller.selectProject('DEMO-plan');
    expect(controller.store.getState()).toMatchObject({ draft: before.draft, liveId: before.liveId, durableId: before.durableId, execution: 'running' });
    await controller.selectProfile('sakura'); await controller.openSession('DEMO-plan-root');
    expect(controller.store.getState().profile).toBe('default');
    expect(gateways[0]!.calls.filter(call => call.method === 'session.resume')).toHaveLength(0);
  });

  it('resumes project durable IDs through the existing canonical session contract', async () => {
    const { controller, gateways } = setup(); await controller.start(); await controller.refreshProjects(); await controller.selectProject('DEMO-plan');
    await controller.openSession(controller.store.getState().projectSessions[0]!.durableId);
    expect(gateways[0]!.calls.find(call => call.method === 'session.resume')?.params).toEqual({ session_id: 'DEMO-plan-root', profile: 'default', lazy: true, inline_images: false, close_on_disconnect: false });
    expect(controller.store.getState()).toMatchObject({ durableId: 'DEMO-durable-tip-default', lineageId: 'DEMO-plan-root', liveId: 'DEMO-live-default' });
  });

  it('quarantines a late project tree from the old profile', async () => {
    const { controller, gateways } = setup(); await controller.start();
    let finish!: (result: unknown) => void;
    gateways[0]!.delayProjects = new Promise(resolve => { finish = resolve; });
    const loading = controller.refreshProjects();
    await controller.selectProfile('sakura');
    finish({ projects: [projectFixture('DEMO-old-profile')] }); await loading;
    expect(controller.store.getState()).toMatchObject({ profile: 'sakura', projects: [], projectsStatus: 'idle', projectSessions: [] });
    await controller.refreshProjects();
    expect(gateways[1]!.calls.find(call => call.method === 'projects.tree')?.params.profile).toBe('sakura');
  });

  it('quarantines a late drill-in when another project is selected', async () => {
    const { controller, gateways } = setup(); await controller.start(); await controller.refreshProjects();
    let finish!: (result: unknown) => void;
    gateways[0]!.delayProjectSessions.set('DEMO-plan', new Promise(resolve => { finish = resolve; }));
    const loading = controller.selectProject('DEMO-plan');
    await controller.selectProject('DEMO-research');
    finish({ project: projectFixture('DEMO-plan') }); await loading;
    expect(controller.store.getState()).toMatchObject({ selectedProjectId: 'DEMO-research', projectLoading: false });
    expect(controller.store.getState().projectSessions[0]?.durableId).toBe('DEMO-research-root');
  });

  it('keeps a clear-filter operation authoritative over a pending drill-in', async () => {
    const { controller, gateways } = setup(); await controller.start(); await controller.refreshProjects();
    let finish!: (result: unknown) => void;
    gateways[0]!.delayProjectSessions.set('DEMO-plan', new Promise(resolve => { finish = resolve; }));
    const loading = controller.selectProject('DEMO-plan'); await controller.selectProject('');
    finish({ project: projectFixture('DEMO-plan') }); await loading;
    expect(controller.store.getState()).toMatchObject({ selectedProjectId: '', projectSessions: [], projectLoading: false });
  });

  it('preserves chat on unsupported/error project reads and never exposes server errors', async () => {
    const { controller, gateways } = setup(); await controller.start();
    gateways[0]!.projectsFailure = -32601; await controller.refreshProjects();
    expect(controller.store.getState()).toMatchObject({ connection: 'connected', projectsStatus: 'unsupported', readRpc: true });
    expect(controller.store.getState().projectsError).not.toContain('DEMO-secret');
    gateways[0]!.projectsFailure = 5062; await controller.refreshProjects();
    expect(controller.store.getState()).toMatchObject({ connection: 'connected', projectsStatus: 'error' });
    await controller.openSession(); expect(controller.store.getState().liveId).toBe('DEMO-live-default');
  });

  it('treats a disappeared project as unconfirmed rather than an empty successful list', async () => {
    const { controller, gateways } = setup(); await controller.start(); await controller.refreshProjects();
    gateways[0]!.delayProjectSessions.set('DEMO-plan', Promise.resolve({ project: null }));
    await controller.selectProject('DEMO-plan');
    expect(controller.store.getState()).toMatchObject({ selectedProjectId: 'DEMO-plan', projectSessions: [], projectLoading: false });
    expect(controller.store.getState().projectError).not.toBe('');
  });

  it('erases project titles and IDs on logout before late read completion', async () => {
    const { controller, gateways } = setup(); await controller.start(); await controller.refreshProjects();
    let finish!: (result: unknown) => void;
    gateways[0]!.delayProjectSessions.set('DEMO-plan', new Promise(resolve => { finish = resolve; }));
    const loading = controller.selectProject('DEMO-plan'); await controller.logout();
    finish({ project: projectFixture('DEMO-plan') }); await loading;
    expect(controller.store.getState()).toMatchObject({ projects: [], selectedProjectId: '', projectSessions: [], projectsStatus: 'idle', connection: 'logged_out' });
    expect(JSON.stringify(controller.store.getState())).not.toContain('DEMO-plan');
  });
});
