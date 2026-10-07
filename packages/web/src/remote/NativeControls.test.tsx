import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController, type RemoteOptions } from '../../../core/src/stores/remote';
import { NATIVE_SHARE_FILE_LIMIT, NATIVE_STORAGE_LIMIT, type NativeEnvelope } from '../../../core/src/features/native-shell';
import { NativeControls } from './NativeControls';
import { prepareDocument } from './file-content';
import { prepareImage } from './image-content';

vi.mock('./file-content', () => ({ prepareDocument: vi.fn() }));
vi.mock('./image-content', () => ({ prepareImage: vi.fn() }));
const origin = 'https://example.com';
const sharedID = '12345678-1234-1234-1234-123456789abc';
const shared = { id: sharedID, kind: 'text', name: '共有テキスト', bytes: 18, expiresAt: Date.now() + 3600_000,
  text: '日本語の共有', mime: 'text/plain', contentBase64: '' };
const originalOrigin = window.location.origin;
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
let replies: Record<string, unknown | (() => Promise<unknown>)>;
function makeChannel() {
  return vi.fn(async (packet: NativeEnvelope) => {
    const item = replies[packet.method]; const value = typeof item === 'function' ? await item() : item;
    return { version: 1, id: packet.id, ok: true, value };
  });
}
let channel: ReturnType<typeof makeChannel>;
beforeEach(() => {
  Object.assign(window.location, { origin });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  replies = { 'device.capabilities': { version: 1, origin, scopeInvalidationVersion: 1, keychain: true, sharing: true,
    maxFileBytes: NATIVE_SHARE_FILE_LIMIT, maxStorageBytes: NATIVE_STORAGE_LIMIT }, 'device.authenticate': true, 'device.invalidate': true,
  'storage.save': true, 'storage.read': null, 'storage.remove': true,
  'share.pending': shared, 'share.accept': shared, 'share.finish': true, 'share.cancel': true };
  channel = makeChannel();
  Object.assign(window, { webkit: { messageHandlers: { hermesRemote: { postMessage: channel } } } });
  vi.mocked(prepareDocument).mockResolvedValue({ name: 'DEMO.txt', format: 'TXT', bytes: new TextEncoder().encode('abc'), preview: 'abc', previewTruncated: false, extraction: 'utf8' });
});
afterEach(() => {
  cleanup(); vi.clearAllMocks(); vi.restoreAllMocks();
  Object.assign(window.location, { origin: originalOrigin }); delete (window as Window & { webkit?: unknown }).webkit;
  if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor); else Reflect.deleteProperty(document, 'hidden');
  if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModalDescriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'close', closeDescriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
function methods(): string[] { return channel.mock.calls.map(([packet]) => (packet as NativeEnvelope).method); }
function fixture() {
  const http = vi.fn(); const rpc = vi.fn();
  const controller = new RemoteController({ origin, secure: true, http,
    makeGateway: () => ({ request: rpc }), withOperationLock: async <T,>(action: () => Promise<T>) => action() } as unknown as RemoteOptions);
  controller.store.setState({ authenticated: true, connection: 'connected', principalId: 'a'.repeat(64), profile: 'DEMO-profile',
    durableId: 'DEMO-durable', liveId: 'DEMO-live', lineageId: 'DEMO-durable', draft: '元の下書き', imageQueue: 'empty',
    messages: [{ id: 'DEMO-user', role: 'user', text: '合成本文' }, { id: 'DEMO-system', role: 'system', text: 'DEMO-system-excluded' }], lastSync: 1000 });
  const onInsert = vi.fn((text: string) => controller.setDraft(controller.store.getState().draft + text));
  const safety = vi.fn(); let prepareLogout: (() => Promise<void>) | null = null;
  const register = vi.fn((prepare: (() => Promise<void>) | null) => { prepareLogout = prepare; });
  function Harness({ visible = true }: { visible?: boolean }) {
    const state = useSyncExternalStore(controller.store.subscribe, controller.store.getState, controller.store.getState);
    return <NativeControls controller={controller} state={state} onInsert={onInsert} onSafetyChange={safety} onLogoutPreparation={register} visible={visible} />;
  }
  return { controller, http, rpc, onInsert, safety, register, Harness, logout: () => prepareLogout?.() };
}
async function ready(): Promise<void> { await waitFor(() => expect(screen.getByRole('button', { name: '端末保存を確認' })).toBeEnabled()); }
async function confirmShare(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '共有待ちを確認' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '確認して下書きへ取り込む' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '確認して下書きへ取り込む' }));
}

describe('native controls preserve the normal controller boundary', () => {
  it('Safari has no native UI, hook, storage or request side effect', () => {
    delete (window as Window & { webkit?: unknown }).webkit;
    const f = fixture(); const view = render(<f.Harness />);
    expect(view.container).toBeEmptyDOMElement(); expect(channel).not.toHaveBeenCalled(); expect(f.register).not.toHaveBeenCalled();
    expect(f.http).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('blocks an older shell and explains the missing scope cancellation contract without storage fallback', async () => {
    const value = replies['device.capabilities'] as Record<string, unknown>; delete value.scopeInvalidationVersion;
    const storage = vi.spyOn(Storage.prototype, 'setItem'); const f = fixture(); render(<f.Harness />);
    await screen.findByText(/取消契約に未対応/);
    expect(screen.getByRole('button', { name: '端末保存を確認' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '共有待ちを確認' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(methods()).toEqual(['device.invalidate', 'device.capabilities']);
    expect(storage).not.toHaveBeenCalled(); expect(f.http).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('saves only after opt-in and explicit action; freezes scope/body and excludes system/tool data', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem'); const f = fixture(); render(<f.Harness />); await ready();
    expect(methods()).toEqual(['device.invalidate', 'device.capabilities']); expect(screen.getByRole('button', { name: '現在時点を端末へ保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '現在時点を端末へ保存' }));
    await waitFor(() => expect(methods()).toContain('storage.save'));
    const packet = channel.mock.calls.find(([value]) => (value as NativeEnvelope).method === 'storage.save')![0] as NativeEnvelope;
    expect(packet.scope).toEqual({ origin, principal: 'a'.repeat(64), profile: 'DEMO-profile', durableSession: 'DEMO-durable' });
    expect(JSON.parse(String(packet.params.value))).toMatchObject({ version: 1, draft: '元の下書き', limited: true, messages: [{ role: 'user', text: '合成本文' }] });
    expect(String(packet.params.value)).not.toContain('DEMO-system-excluded');
    act(() => f.controller.setDraft('後から編集')); expect(JSON.parse(String(packet.params.value)).draft).toBe('元の下書き');
    expect(storage).not.toHaveBeenCalled(); expect(f.http).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('rejects oversized snapshot without writing and does not silently truncate it', async () => {
    const f = fixture(); f.controller.setDraft('あ'.repeat(NATIVE_STORAGE_LIMIT)); render(<f.Harness />); await ready();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: '現在時点を端末へ保存' }));
    await screen.findByText(/端末保存上限1MiB/); expect(methods()).not.toContain('storage.save');
  });
  it('reads a snapshot as historical local data, confirms insertion, and preserves the existing draft', async () => {
    replies['storage.read'] = JSON.stringify({ version: 1, savedAt: 1000, syncedAt: 900, limited: true, partial: false,
      draft: '保存した日本語\n下書き', messages: [{ role: 'assistant', text: '<img src=x onerror=alert(1)>' }] });
    const f = fixture(); const view = render(<f.Harness />); await ready();
    fireEvent.click(screen.getByRole('button', { name: '端末保存を確認' })); await screen.findByRole('button', { name: '保存した下書きを挿入' });
    expect(f.onInsert).not.toHaveBeenCalled(); expect(view.container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存した下書きを挿入' })); expect(f.safety).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '確認して挿入' }));
    expect(f.controller.store.getState().draft).toBe('元の下書き保存した日本語\n下書き'); expect(methods()).not.toContain('storage.save');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('metadata inspection and cancellation do not fetch shared contents or send anything', async () => {
    const f = fixture(); render(<f.Harness />); await ready(); await confirmShare();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(methods()).not.toContain('share.accept'); expect(f.safety).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(f.onInsert).not.toHaveBeenCalled();
    expect(methods()).not.toContain('share.finish');
    fireEvent.click(screen.getByRole('button', { name: '共有待ちを取消' }));
    await waitFor(() => expect(methods()).toContain('share.cancel'));
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.http).not.toHaveBeenCalled();
  });
  it('explicit text import inserts into the draft then finishes the matching handoff once', async () => {
    const f = fixture(); render(<f.Harness />); await ready(); await confirmShare();
    fireEvent.click(screen.getByRole('button', { name: '確認して挿入' }));
    await screen.findByText('下書きへ取り込みました。まだ転送・送信していません。');
    expect(f.controller.store.getState().draft).toBe('元の下書き日本語の共有');
    expect(methods().filter(name => name.startsWith('share.'))).toEqual(['share.pending', 'share.accept', 'share.finish']);
    expect(f.http).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('imports a file through the existing validator and local controller selection, with no upload', async () => {
    const file = { ...shared, kind: 'file', name: 'DEMO.txt', bytes: 3, contentBase64: 'YWJj', mime: 'text/plain', text: '説明' };
    replies['share.pending'] = file; replies['share.accept'] = file;
    const f = fixture(); const select = vi.spyOn(f.controller, 'selectDocument'); render(<f.Harness />); await ready(); await confirmShare();
    fireEvent.click(screen.getByRole('button', { name: '確認して挿入' }));
    await waitFor(() => expect(methods()).toContain('share.finish'));
    expect(prepareDocument).toHaveBeenCalledTimes(1); expect(prepareImage).not.toHaveBeenCalled(); expect(select).toHaveBeenCalledTimes(1);
    expect(f.controller.store.getState().document?.status).toBe('selected'); expect(f.controller.store.getState().draft).toBe('元の下書き説明');
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.http).not.toHaveBeenCalled();
  });
  it('rejects a late file preparation after session/profile changes without selection, insertion or finish', async () => {
    const file = { ...shared, kind: 'file', name: 'DEMO.txt', bytes: 3, contentBase64: 'YWJj', mime: 'text/plain', text: '説明' };
    replies['share.pending'] = file; replies['share.accept'] = file;
    let release!: (value: Awaited<ReturnType<typeof prepareDocument>>) => void;
    vi.mocked(prepareDocument).mockImplementation(() => new Promise(done => { release = done; }));
    const f = fixture(); const select = vi.spyOn(f.controller, 'selectDocument'); render(<f.Harness />); await ready(); await confirmShare();
    fireEvent.click(screen.getByRole('button', { name: '確認して挿入' })); await waitFor(() => expect(prepareDocument).toHaveBeenCalledTimes(1));
    act(() => f.controller.store.setState({ profile: 'DEMO-other', liveId: 'DEMO-other-live', durableId: 'DEMO-other-durable', draft: '別会話の下書き' }));
    await act(async () => { release({ name: 'DEMO.txt', format: 'TXT', bytes: new TextEncoder().encode('abc'), preview: 'abc', previewTruncated: false, extraction: 'utf8' }); });
    expect(select).not.toHaveBeenCalled(); expect(f.onInsert).not.toHaveBeenCalled(); expect(methods()).not.toContain('share.finish');
    expect(f.controller.store.getState().draft).toBe('別会話の下書き');
  });
  it('validation failure leaves the original draft/attachment and pending handoff untouched', async () => {
    const file = { ...shared, kind: 'file', name: 'DEMO.txt', bytes: 3, contentBase64: 'YWJj', mime: 'text/plain', text: '説明' };
    replies['share.pending'] = file; replies['share.accept'] = file;
    vi.mocked(prepareDocument).mockRejectedValue(new Error('DEMO-invalid-document'));
    const f = fixture(); const original = { name: 'old.txt', format: 'TXT' as const, bytes: new TextEncoder().encode('old'), preview: 'old', previewTruncated: false, extraction: 'utf8' as const, status: 'selected' as const };
    f.controller.store.setState({ document: original }); const cancel = vi.spyOn(f.controller, 'cancelDocument');
    render(<f.Harness />); await ready(); await confirmShare(); fireEvent.click(screen.getByRole('button', { name: '確認して挿入' }));
    await screen.findByText(/結果を確認できません/);
    expect(f.controller.store.getState().document).toBe(original); expect(f.controller.store.getState().draft).toBe('元の下書き');
    expect(f.controller.store.getState().imageSelecting).toBe(false); expect(cancel).not.toHaveBeenCalled();
    expect(f.onInsert).not.toHaveBeenCalled(); expect(methods()).not.toContain('share.finish'); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('replaces only a confirmed local selected attachment after validation and preserves the draft', async () => {
    const file = { ...shared, kind: 'file', name: 'DEMO.txt', bytes: 3, contentBase64: 'YWJj', mime: 'text/plain', text: '説明' };
    replies['share.pending'] = file; replies['share.accept'] = file;
    const f = fixture(); f.controller.store.setState({ document: { name: 'old.txt', format: 'TXT', bytes: new TextEncoder().encode('old'), preview: 'old', previewTruncated: false, extraction: 'utf8', status: 'selected' } });
    const cancel = vi.spyOn(f.controller, 'cancelDocument'); render(<f.Harness />); await ready(); await confirmShare();
    expect(cancel).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '確認して挿入' }));
    await waitFor(() => expect(methods()).toContain('share.finish'));
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.controller.store.getState().document?.name).toBe('DEMO.txt');
    expect(f.controller.store.getState().draft).toBe('元の下書き説明'); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('rejects a native accept without a valid payload; does not select, insert or finish', async () => {
    replies['share.accept'] = false; const f = fixture(); render(<f.Harness />); await ready(); await confirmShare();
    fireEvent.click(screen.getByRole('button', { name: '確認して挿入' })); await screen.findByText(/結果を確認できません/);
    expect(f.onInsert).not.toHaveBeenCalled(); expect(methods()).not.toContain('share.finish'); expect(prepareDocument).not.toHaveBeenCalled();
    expect(f.controller.store.getState().imageSelecting).toBe(false); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('discards late snapshot contents after authentication expires', async () => {
    let release!: (value: unknown) => void; replies['storage.read'] = () => new Promise(done => { release = done; });
    const f = fixture(); render(<f.Harness />); await ready(); fireEvent.click(screen.getByRole('button', { name: '端末保存を確認' }));
    await waitFor(() => expect(methods()).toContain('storage.read'));
    act(() => f.controller.store.setState({ authenticated: false, connection: 'reauth', draft: '' }));
    await act(async () => { release(JSON.stringify({ version: 1, savedAt: 1000, syncedAt: 900, limited: true, partial: false, draft: 'DEMO-old-private-draft', messages: [] })); });
    expect(screen.queryByText('DEMO-old-private-draft')).toBeNull(); expect(screen.queryByRole('button', { name: '保存した下書きを挿入' })).toBeNull();
    expect(f.onInsert).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('keeps imported text but reports unknown handoff removal without retry or repeat insertion', async () => {
    replies['share.finish'] = false; const f = fixture(); render(<f.Harness />); await ready(); await confirmShare();
    fireEvent.click(screen.getByRole('button', { name: '確認して挿入' })); await screen.findByText(/共有待ちの解除結果は不明/);
    expect(f.onInsert).toHaveBeenCalledTimes(1); expect(methods().filter(name => name === 'share.finish')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '確認して下書きへ取り込む' })).toBeDisabled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('locks on background, recovers read-only on native resume, and cleans up while UI is hidden', async () => {
    const f = fixture(); const recover = vi.spyOn(f.controller, 'recover').mockResolvedValue(); const view = render(<f.Harness />); await ready();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByRole('button', { name: '端末保存を確認' })).toBeDisabled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); fireEvent(window, new Event('hermes-native-resume'));
    await waitFor(() => expect(recover).toHaveBeenCalledTimes(1)); expect(methods()).not.toContain('storage.save');
    view.rerender(<f.Harness visible={false} />); expect(screen.queryByRole('region', { name: 'iOS端末連携' })).toBeNull();
    fireEvent(window, new Event('hermes-native-resume')); await waitFor(() => expect(recover).toHaveBeenCalledTimes(2));
    view.unmount(); fireEvent(window, new Event('hermes-native-resume')); expect(recover).toHaveBeenCalledTimes(2); expect(f.register).toHaveBeenLastCalledWith(null);
  });
  it('logout prepares scoped removal and always invalidates even when native removal is unknown', async () => {
    replies['storage.remove'] = false; const f = fixture(); render(<f.Harness />); await ready();
    await act(async () => { await expect(f.logout()).rejects.toThrow('端末保存の消去を確認できません'); });
    expect(methods().filter(name => name === 'storage.remove')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '端末保存を確認' })).toBeDisabled(); expect(f.rpc).not.toHaveBeenCalled();
  });
});
