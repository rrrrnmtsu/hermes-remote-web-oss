import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserEncryptedStore } from './encrypted-store';
import { IndexedDbPersistence, MemoryEncryptedPersistence } from './persistence';
import { StoragePanel } from './StoragePanel';
import { ProductControls } from '../ProductControls';
import { RemoteController, type RemoteOptions } from '../../../../core/src/stores/remote';
import * as worker from './worker';
import type { StoreContents, StorageScope } from './types';

const crypto = webcrypto as unknown as Crypto;
const scope: StorageScope = { origin: 'https://demo.example', principal: 'DEMO-user', profile: 'DEMO-profile', durableSession: 'DEMO-session' };
const passphrase = 'DEMO-local-passphrase';
let initial: StoreContents;
const originalOrigin = window.location.origin;
beforeAll(async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  const persistence = new MemoryEncryptedPersistence();
  await new BrowserEncryptedStore(scope.origin, persistence, crypto).initialize(passphrase); initial = await persistence.read();
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalOrigin === undefined) Reflect.deleteProperty(window.location, 'origin');
  else Object.assign(window.location, { origin: originalOrigin });
});
async function store() {
  const persistence = new MemoryEncryptedPersistence(); persistence.contents = structuredClone(initial);
  const instance = new BrowserEncryptedStore(scope.origin, persistence, crypto); await instance.unlock(passphrase); instance.setScope(scope);
  return { instance, persistence };
}
describe('explicit local encrypted storage controls', () => {
  it('uses authenticated Hermes read connectivity rather than the OS internet hint for an explicit encrypted save', async () => {
    const persistence = new MemoryEncryptedPersistence();
    vi.stubGlobal('crypto', crypto);
    vi.spyOn(IndexedDbPersistence.prototype, 'read').mockImplementation(() => persistence.read());
    vi.spyOn(IndexedDbPersistence.prototype, 'change').mockImplementation(update => persistence.change(update));
    vi.spyOn(worker, 'cacheOfflineShell').mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    Object.assign(window.location, { origin: scope.origin });
    const http = vi.fn(); const rpc = vi.fn();
    const controller = new RemoteController({ origin: window.location.origin, secure: true, http,
      makeGateway: () => ({ request: rpc }) } as unknown as RemoteOptions);
    controller.store.setState({ authenticated: true, connection: 'connected', readRpc: true, principalId: 'a'.repeat(64),
      profile: 'DEMO-profile', liveId: 'DEMO-live', durableId: 'DEMO-durable', lineageId: 'DEMO-durable', lastSync: 1000,
      messages: [{ id: 'DEMO-message', role: 'assistant', text: 'DEMO known private memory text' }] });
    const props = { controller, state: controller.store.getState(), settings: true, selection: null,
      onSelection: vi.fn(), onOpen: vi.fn(), safeNavigate: true, safeUpdate: true,
      onInsert: vi.fn(), onSafetyChange: vi.fn(), onLogoutPreparation: vi.fn() };
    const view = render(<ProductControls {...props} />);
    fireEvent.change(screen.getByLabelText('端末保存のパスフレーズ'), { target: { value: passphrase } });
    fireEvent.click(screen.getByRole('button', { name: '暗号化保存を準備' }));
    await screen.findByText('解錠しました。保存は個別に有効化してください。');
    const save = screen.getByRole('button', { name: '現在取得済みの履歴を端末へ保存' });
    expect(save).toBeDisabled(); expect(persistence.contents.entries).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox', { name: '選んだ履歴をオフラインで閲覧' }));
    await waitFor(() => expect(save).toBeEnabled());
    expect(navigator.onLine).toBe(false); expect(persistence.contents.entries).toHaveLength(0);
    fireEvent.click(save);
    await waitFor(() => expect(persistence.contents.entries).toHaveLength(1));
    expect(JSON.stringify(persistence.contents)).not.toContain('DEMO known private memory text');
    expect(http).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
    Object.assign(navigator, { onLine: true });
    view.rerender(<ProductControls {...props} state={{ ...props.state, connection: 'offline', readRpc: false }} />);
    await waitFor(() => expect(save).toBeDisabled());
    view.rerender(<ProductControls {...props} state={{ ...props.state, readRpc: false }} />);
    await waitFor(() => expect(save).toBeDisabled());
    view.rerender(<ProductControls {...props} state={{ ...props.state, authenticated: false }} />);
    await waitFor(() => expect(save).toBeDisabled());
    expect(http).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); controller.dispose();
  });
  it('does not save previously displayed messages or restore a draft just by opening the panel or opting in', async () => {
    const { instance, persistence } = await store(); const restored = vi.fn(); const shell = vi.fn(async () => undefined);
    render(<StoragePanel store={instance} scope={scope} online history={{ messages: [{ role: 'assistant', text: 'DEMO private text' }], syncedAt: 1, limited: false, partial: false }} onRestoreDraft={restored} onCacheShell={shell} />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '未送信下書きを暗号化して保持' })).not.toBeChecked());
    expect(screen.getByRole('button', { name: '現在取得済みの履歴を端末へ保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '選んだ履歴をオフラインで閲覧' }));
    await waitFor(() => expect(instance.enabled.history).toBe(true));
    expect(shell).toHaveBeenCalledTimes(1); expect(persistence.contents.entries).toHaveLength(0); expect(restored).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '現在取得済みの履歴を端末へ保存' }));
    await waitFor(() => expect(persistence.contents.entries).toHaveLength(1)); expect(restored).not.toHaveBeenCalled();
    expect(JSON.stringify(persistence.contents)).not.toContain('DEMO private text');
  });
  it('requires restoration confirmation and leaves the previous scope untouched after a scope switch', async () => {
    const { instance } = await store(); await instance.setEnabled('draft', true); await instance.saveDraft(scope, 'DEMO 日本語\n未送信');
    const restored = vi.fn(); const component = render(<StoragePanel store={instance} scope={scope} online history={null} onRestoreDraft={restored} />);
    await screen.findByRole('button', { name: '下書きの復元を確認' }); fireEvent.click(screen.getByRole('button', { name: '下書きの復元を確認' }));
    await screen.findByRole('dialog', { name: '保存下書きを復元' }); expect(restored).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(restored).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '下書きの復元を確認' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '下書きの復元を確認' })); await screen.findByRole('dialog', { name: '保存下書きを復元' });
    fireEvent.click(screen.getByRole('button', { name: '入力欄へ復元' })); expect(restored).toHaveBeenCalledWith('DEMO 日本語\n未送信', scope);
    component.rerender(<StoragePanel store={instance} scope={{ ...scope, durableSession: 'DEMO-other' }} online history={null} onRestoreDraft={restored} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: '下書きの復元を確認' })).not.toBeInTheDocument()); expect(restored).toHaveBeenCalledTimes(1);
  });
  it('renders untrusted saved text through the existing safe Markdown viewer without a send/approval action', async () => {
    const { instance } = await store(); await instance.setEnabled('history', true);
    await instance.saveHistory(scope, { messages: [{ role: 'assistant', text: '<script>DEMO attack</script>\n\n[DEMO unsafe](javascript:alert(1))\n\n```text\nDEMO code\n```' }], syncedAt: 1, limited: true, partial: true });
    const restored = vi.fn(); render(<StoragePanel store={instance} scope={null} online={false} history={null} onRestoreDraft={restored} />);
    fireEvent.click(await screen.findByRole('button', { name: '保存履歴を閲覧' }));
    const dialog = await screen.findByRole('dialog', { name: '端末に保存した履歴' });
    expect(dialog.querySelector('script')).toBeNull(); expect(dialog.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText('DEMO code')).toBeInTheDocument(); expect(screen.getByText(/生成途中のスナップショット/)).toBeInTheDocument();
    expect(restored).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '送信' })).not.toBeInTheDocument();
  });
});
