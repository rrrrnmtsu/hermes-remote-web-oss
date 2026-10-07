import { afterEach, describe, expect, it } from 'vitest';
import { RemoteController } from './remote';
import type { RemoteGateway, GatewayEvent, ServerRequest } from '../transport/remote-gateway';
import type { Http } from '../transport/http';
import { DOCUMENT_RAW_LIMIT, type DocumentCapabilities } from '../features/documents';

const methods = ['remote.app.capabilities', 'remote.sessions.list', 'remote.documents.capabilities', 'remote.session.model_set'];
const documentCaps: DocumentCapabilities = { version: 1, enabled: true, reason: '', formats: ['TXT', 'PDF'], max_raw_bytes: DOCUMENT_RAW_LIMIT,
  max_frame_bytes: 8388608, max_text_bytes: 65536, max_extracted_bytes: 131072, max_pages: 20, model_input_max_bytes: 262144, extraction: 'text_only', generation_verified: false };
class Gateway implements RemoteGateway {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  events = new Set<(event: GatewayEvent) => void>(); states = new Set<(state: string) => void>();
  principal = 'a'.repeat(64); authorized = true; modern = true; lost = false; rejected = false;
  setTicket(): void { /* Synthetic ticket is deliberately not recorded. */ }
  async connect(): Promise<void> { this.events.forEach(fn => fn({ type: 'gateway.ready', payload: {} })); }
  close(): void { this.states.forEach(fn => fn('closed')); }
  onAny(fn: (event: GatewayEvent) => void): () => void { this.events.add(fn); return () => { this.events.delete(fn); }; }
  onState(fn: (state: string) => void): () => void { this.states.add(fn); return () => { this.states.delete(fn); }; }
  onRequest(fn: (request: ServerRequest) => boolean | void): () => void { void fn; return () => undefined; }
  async awaitSessionReplay(): Promise<boolean> { return true; }
  getSeqWatermarks(): Record<string, number> { return {}; }
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params }); let value: unknown = {};
    if (method === 'gateway.capabilities') value = { per_session_exclusive_submit: true, ...(this.modern ? { remote_web_version: 1 } : {}) };
    if (method === 'remote.app.capabilities') value = { version: 1, principal_id: this.principal, methods, generation_allowed: this.authorized, generation_reason: 'DEMO policy' };
    if (['remote.sessions.list', 'session.list'].includes(method)) value = { sessions: [] };
    if (method === 'projects.tree') value = { projects: [] };
    if (method === 'session.events.since') value = { epoch: 'DEMO-epoch', events: [], open_requests: [], truncated: false };
    if (['session.create', 'session.resume', 'session.activate'].includes(method)) value = { session_id: 'DEMO-live', stored_session_id: 'DEMO-durable', running: false, messages: [{ role: 'assistant', text: 'DEMO response', row_id: 1 }], open_requests: [] };
    if (method === 'remote.documents.capabilities') value = documentCaps;
    if (method === 'prompt.submit') {
      if (this.rejected) throw { code: 4131 };
      if (this.lost) throw new Error('DEMO ACK lost');
      value = { status: 'streaming', user_row_id: 2, document_turn: { receipt_id: 'DEMO-receipt', format: 'TXT', bytes: 4, text_bytes: 4, pages: null, extraction: 'utf8', truncated: false } };
    }
    return value as T;
  }
}
const active: RemoteController[] = [];
async function setup(modern = true, authorized = true) {
  const gateway = new Gateway(); gateway.modern = modern; gateway.authorized = authorized;
  const http = (async (path: string) => path === '/api/profiles' ? { profiles: [{ name: 'default' }] }
    : path === '/api/auth/ws-ticket' ? { ticket: 'DEMO' } : {}) as Http; http.setProfile = () => undefined;
  let locks = 0;
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true, makeGateway: () => gateway,
    withOperationLock: async fn => { locks++; return fn(); } }); active.push(controller);
  await controller.start(); await controller.openSession(); return { controller, gateway, locks: () => locks };
}
function select(controller: RemoteController): void {
  const s = controller.store.getState(); expect(controller.selectDocument({ name: 'demo.txt', format: 'TXT', bytes: new TextEncoder().encode('DEMO'),
    preview: 'DEMO', previewTruncated: false, extraction: 'utf8' }, s.profile, s.liveId)).toBe(true);
}
afterEach(() => { active.splice(0).forEach(c => c.dispose()); });
describe('product scoped operations', () => {
  it('selection/cancel writes nothing; a document and immutable caption share one prompt and lock', async () => {
    const { controller, gateway, locks } = await setup(); const before = gateway.calls.length; select(controller); controller.cancelDocument();
    expect(gateway.calls).toHaveLength(before); select(controller); controller.setDraft('日本語本文'); const lockCount = locks(); await controller.submit();
    const submit = gateway.calls.filter(c => c.method === 'prompt.submit'); expect(submit).toHaveLength(1);
    expect(submit[0]?.params).toMatchObject({ text: '日本語本文', document: { filename: 'demo.txt', content_base64: 'REVNTw==' } });
    expect(locks() - lockCount).toBe(1); expect(controller.store.getState().delivery).toBe('accepted');
  });
  it('ACK unknown retains selection/draft, and recovery or repeat clicks never retransmit', async () => {
    const { controller, gateway } = await setup(); select(controller); controller.setDraft('固定本文'); gateway.lost = true; await controller.submit();
    expect(controller.store.getState()).toMatchObject({ delivery: 'delivery_unknown', draft: '固定本文', document: { status: 'delivery_unknown' } });
    await controller.synchronize(); await controller.submit(); expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
  });
  it('document rejection keeps the draft and never falls back to a text-only request', async () => {
    const { controller, gateway } = await setup(); select(controller); controller.setDraft('本文'); gateway.rejected = true; await controller.submit();
    expect(controller.store.getState()).toMatchObject({ delivery: 'failed_before_send', draft: '本文', document: { status: 'selected' } });
    expect(gateway.calls.filter(c => c.method === 'prompt.submit')).toHaveLength(1);
  });
  it('authorization remains off without disabling metadata or calling generation', async () => {
    const { controller, gateway } = await setup(true, false); controller.setDraft('未許可'); await controller.submit();
    expect(controller.store.getState().delivery).toBe('failed_before_send'); expect(gateway.calls.some(c => c.method === 'prompt.submit')).toBe(false);
    await controller.featureRequest('remote.sessions.list'); expect(gateway.calls.at(-1)?.method).toBe('remote.sessions.list');
  });
  it('a new authenticated principal cannot retain the old transcript, draft or attachment', async () => {
    const { controller, gateway } = await setup(); select(controller); controller.setDraft('DEMO private draft');
    gateway.principal = 'b'.repeat(64); gateway.close(); await controller.recover(true);
    expect(controller.store.getState()).toMatchObject({ principalId: gateway.principal, draft: '', liveId: '', messages: [], document: null, attachment: null });
  });
  it('old servers receive neither the new lazy create nor document parameters', async () => {
    const { controller, gateway } = await setup(false); expect(gateway.calls.find(c => c.method === 'session.create')?.params).not.toHaveProperty('lazy');
    select(controller); controller.setDraft('DEMO'); await controller.submit(); expect(gateway.calls.some(c => c.method === 'prompt.submit')).toBe(false);
    controller.cancelDocument(); await controller.submit(); expect(gateway.calls.some(c => c.method === 'prompt.submit')).toBe(false);
  });
});
