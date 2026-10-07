import { afterEach, describe, expect, it } from 'vitest';
import { RemoteController } from './remote';
import { imageBase64, imageRawLimit, IMAGE_RAW_LIMIT } from './image-transfer';
import { imageHeader } from './image-header';
import type { Http } from '../transport/http';
import type { RemoteGateway, GatewayEvent, ServerRequest } from '../transport/remote-gateway';
import { demoImage, demoPng } from './image-fixtures.test-data';

class ImageDemoGateway implements RemoteGateway {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  events: ((event: GatewayEvent) => void)[] = []; states: ((phase: string) => void)[] = [];
  running = false; native = true; enabled = true; missingReceipt = false; legacyPending = false;
  promptError: unknown = null; promptDelay: Promise<void> | null = null; afterSubmit: (() => void) | null = null;
  setTicket(): void {}
  async connect(): Promise<void> { this.events.forEach(fn => fn({ type: 'gateway.ready', payload: { replay_epoch: 'DEMO' } } as GatewayEvent)); }
  close(): void {}
  async awaitSessionReplay(): Promise<boolean> { return true; }
  getSeqWatermarks(): Record<string, number> { return {}; }
  onAny(fn: (event: GatewayEvent) => void): () => void { this.events.push(fn); return () => undefined; }
  onRequest(fn: (request: ServerRequest) => boolean | void): () => void { void fn; return () => undefined; }
  onState(fn: (phase: string) => void): () => void { this.states.push(fn); return () => undefined; }
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params }); let result: unknown = {};
    if (method === 'gateway.capabilities') result = { per_session_exclusive_submit: true, remote_web_version: 1, ...(this.native ? { image_turn_version: 1 } : {}) };
    if (method === 'image.turn_capabilities') result = { version: 1, enabled: this.enabled, model_vision: this.enabled ? true : null, reason: '',
      max_raw_bytes: IMAGE_RAW_LIMIT, max_frame_bytes: 8 * 1048576, max_text_bytes: 65536, max_edge: 8192, max_pixels: 16000000 };
    if (method === 'remote.app.capabilities') result = { version: 1, principal_id: 'a'.repeat(64), methods: [], generation_allowed: true, generation_reason: '' };
    if (method === 'session.list') result = { sessions: [] };
    if (['session.create', 'session.resume', 'session.activate'].includes(method)) result = {
      session_id: 'DEMO-live', messages: [], message_count: 0, info: { running: this.running }, running: this.running };
    if (method === 'session.events.since') result = { epoch: 'DEMO', events: [], open_requests: [], latest_seq: 0 };
    if (method === 'prompt.submit') {
      if (this.promptDelay) await this.promptDelay;
      this.afterSubmit?.();
      if (this.promptError) throw this.promptError;
      if (params.image && this.legacyPending) throw { code: 4132 };
      this.running = true; result = { status: 'streaming', ...(params.image && !this.missingReceipt ? {
        image_turn: { receipt_id: 'DEMO-receipt', format: 'PNG', width: 1, height: 1, bytes: demoPng().byteLength } } : {}) };
    }
    return result as T;
  }
}
const controllers: RemoteController[] = [];
afterEach(() => { controllers.forEach(controller => controller.dispose()); controllers.length = 0; });
async function setup(native = true) {
  const gateway = new ImageDemoGateway(); gateway.native = native;
  let lockCount = 0, activeLock = 0, denyLock = false;
  const http: Http = Object.assign(async <T,>(path: string) => ({ ...path.endsWith('/status') ? { version: '0.21.5' } : {},
    ...path === '/api/profiles' ? { profiles: [{ name: 'default' }, { name: 'other' }] } : {}, ticket: 'DEMO' } as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://DEMO.invalid', secure: true, makeGateway: () => gateway,
    withOperationLock: async action => { expect(activeLock).toBe(0); if (denyLock) return undefined;
      activeLock++; lockCount++; try { return await action(); } finally { activeLock--; } } });
  controllers.push(controller); await controller.start(); await controller.openSession();
  return { controller, gateway, locks: () => lockCount, denyLock: () => { denyLock = true; } };
}
const writes = (gateway: ImageDemoGateway) => gateway.calls.filter(call => ['image.attach_bytes', 'image.detach', 'prompt.submit'].includes(call.method));
describe('one image and text use a single capability-gated prompt turn', () => {
  it('only a known accepted image is cleared on completion; the next image can be selected', async () => {
    const { controller, gateway } = await setup();
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 本文'); await controller.submit();
    gateway.running = false; gateway.events.forEach(fn => fn({ type: 'message.complete', session_id: 'DEMO-live', payload: { status: 'complete', text: 'DEMO 応答' } } as GatewayEvent));
    expect(controller.store.getState().attachment).toBeNull();
    expect(controller.selectImage(demoImage(), 'default', 'DEMO-live')).toBe(true);
    expect(writes(gateway)).toHaveLength(1);
  });
  it('completion is not proof of a lost upload ACK and never clears its unknown state', async () => {
    const { controller, gateway } = await setup(); gateway.promptError = new Error('DEMO ack lost');
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 本文'); await controller.submit();
    gateway.running = false; gateway.events.forEach(fn => fn({ type: 'message.complete', session_id: 'DEMO-live', payload: { status: 'complete', text: 'DEMO 応答' } } as GatewayEvent));
    expect(controller.store.getState().attachment?.status).toBe('delivery_unknown');
    expect(controller.store.getState().delivery).toBe('delivery_unknown'); expect(writes(gateway)).toHaveLength(1);
  });
  it('local selection/cancel writes zero; old servers never receive new image parameters', async () => {
    const { controller, gateway } = await setup(false);
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 説明'); await controller.submit();
    expect(writes(gateway)).toEqual([]); expect(gateway.calls.some(call => call.method === 'image.turn_capabilities')).toBe(false);
    expect(controller.store.getState().imageDiagnostic).toContain('プレビュー');
    await controller.cancelImage(); expect(writes(gateway)).toEqual([]); expect(controller.store.getState().draft).toBe('DEMO 説明');
    await controller.submit(); expect(writes(gateway)[0]!.params).toEqual({ profile: 'default', session_id: 'DEMO-live', text: 'DEMO 説明' });
  });
  it('explicit send takes one lock and freezes one image and Japanese text; no image-only send', async () => {
    const { controller, gateway, locks } = await setup(); controller.selectImage(demoImage(), 'default', 'DEMO-live');
    await controller.submit(); expect(writes(gateway)).toEqual([]); controller.setDraft('DEMO 日本語\n説明');
    gateway.afterSubmit = () => controller.setDraft('次の下書き'); const before = locks();
    await Promise.all([controller.submit(), controller.submit()]); expect(locks() - before).toBe(1);
    expect(writes(gateway)).toHaveLength(1); expect(writes(gateway)[0]!.params).toEqual({ session_id: 'DEMO-live', profile: 'default', text: 'DEMO 日本語\n説明',
      image: { filename: 'remote-image.png', content_base64: imageBase64(demoPng()) } });
    expect(controller.store.getState().draft).toBe('次の下書き'); expect(controller.store.getState().delivery).toBe('accepted');
    expect(controller.store.getState().attachment?.status).toBe('accepted');
  });
  it.each([4130, 4131, 4132, 4133, 4009, 5070])('formal refusal %s preserves local image/draft and never auto retries', async code => {
    const { controller, gateway } = await setup(); gateway.promptError = { code };
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 説明'); await controller.submit();
    expect(controller.store.getState().attachment?.status).toBe('selected'); expect(controller.store.getState().delivery).toBe('failed_before_send');
    await controller.synchronize(); expect(writes(gateway)).toHaveLength(1); await controller.cancelImage();
    expect(controller.store.getState().draft).toBe('DEMO 説明'); expect(writes(gateway)).toHaveLength(1);
  });
  it.each(['lost_ack', 'missing_receipt'])('%s retains unknown through reconnect and prevents automatic image/text/detach retries', async mode => {
    const { controller, gateway } = await setup(); if (mode === 'lost_ack') gateway.promptError = new Error('DEMO timeout'); else gateway.missingReceipt = true;
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 説明'); await controller.submit();
    expect(controller.store.getState().delivery).toBe('delivery_unknown'); expect(controller.store.getState().attachment?.status).toBe('delivery_unknown');
    await controller.recover(); await controller.submit(); await controller.cancelImage(); expect(writes(gateway)).toHaveLength(1);
  });
  it('model capability is distinct from contract availability; no silent text-only fallback', async () => {
    const { controller, gateway } = await setup(); gateway.enabled = false; await controller.synchronize();
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 説明'); await controller.submit(); expect(writes(gateway)).toEqual([]);
    await controller.cancelImage(); await controller.submit(); expect(writes(gateway)[0]!.params.image).toBeNull();
  });
  it('pending images belonging to legacy clients are refused and are never detached by Web', async () => {
    const { controller, gateway } = await setup(); gateway.legacyPending = true;
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 説明'); await controller.submit();
    expect(controller.store.getState().delivery).toBe('failed_before_send'); await controller.cancelImage(); expect(writes(gateway)).toHaveLength(1);
  });
  it('stale scope, tab competition, cancellation and update cannot replace an in-flight snapshot', async () => {
    const { controller, gateway, denyLock } = await setup(); const generation = controller.imageSelectionGeneration; await controller.recover();
    expect(controller.selectImage(demoImage(), 'other', 'DEMO-live')).toBe(false);
    expect(controller.selectImage(demoImage(), 'default', 'DEMO-live', generation)).toBe(false);
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 説明'); denyLock(); await controller.submit(); expect(writes(gateway)).toEqual([]);
    expect(controller.store.getState().attachment).not.toBeNull(); await controller.selectProfile('other'); expect(controller.store.getState().profile).toBe('default');
  });
  it('logout during send clears bytes and rejects delayed acceptance', async () => {
    const { controller, gateway } = await setup(); let finish!: () => void; gateway.promptDelay = new Promise(resolve => { finish = resolve; });
    controller.selectImage(demoImage(), 'default', 'DEMO-live'); controller.setDraft('DEMO 説明'); const sending = controller.submit();
    while (!writes(gateway).length) await Promise.resolve(); await controller.cancelImage(); expect(controller.store.getState().attachment).not.toBeNull();
    await controller.logout(); finish(); await sending; expect(controller.store.getState().attachment).toBeNull(); expect(writes(gateway)).toHaveLength(1);
  });
  it('the transmitted image is isolated from caller byte mutation', async () => {
    const { controller, gateway } = await setup(); const image = demoImage(); controller.selectImage(image, 'default', 'DEMO-live'); image.bytes.fill(0);
    controller.setDraft('DEMO 説明'); await controller.submit(); expect(writes(gateway)).toHaveLength(1);
  });
});
describe('image transfer bounded pure validation', () => {
  it('bounds raw/base64/JSON limits and encodes without including a device path', () => {
    expect(imageRawLimit()).toBe(IMAGE_RAW_LIMIT); expect(imageRawLimit({ backendBytes: 1048576, websocketBytes: 5000, proxyBytes: 6000 })).toBe(678);
    expect(imageRawLimit({ backendBytes: 1, websocketBytes: 0, proxyBytes: Infinity })).toBe(0);
    expect(imageBase64(Uint8Array.of(1, 2, 3, 4))).toBe('AQIDBA==');
  });
  it('rejects forged headers, broken images, animated/unsupported bytes and huge dimensions before decode', () => {
    expect(imageHeader(demoPng())).toEqual({ mime: 'image/png', width: 1, height: 1 });
    for (const bytes of [Uint8Array.of(1, 2, 3), demoPng().slice(0, 20), Uint8Array.from(new TextEncoder().encode('<svg/>'))]) expect(() => imageHeader(bytes)).toThrow();
    const huge = demoPng(); new DataView(huge.buffer).setUint32(16, 9000); expect(() => imageHeader(huge)).toThrow(/寸法/);
    const pixels = demoPng(); new DataView(pixels.buffer).setUint32(16, 5000); new DataView(pixels.buffer).setUint32(20, 5000); expect(() => imageHeader(pixels)).toThrow(/画素/);
  });
});
