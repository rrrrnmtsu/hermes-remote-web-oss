import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';
import { QuickNavigation } from './QuickNavigation';

function demoController() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO navigation only'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', profile: 'default', principalId: 'DEMO-owner',
    liveId: 'DEMO-live', durableId: 'DEMO-stored', profiles: ['default', 'DEMO-other'], execution: 'idle' });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined); vi.spyOn(controller, 'recover').mockResolvedValue(undefined);
  vi.spyOn(controller, 'dispose').mockImplementation(() => undefined); vi.spyOn(controller, 'refreshProjects').mockResolvedValue(undefined);
  const writes = ['submit', 'stop', 'answer', 'openSession', 'selectProfile'] as const;
  const observed = writes.map(method => vi.spyOn(controller, method));
  return { controller, observed };
}
const dialog = () => screen.getByRole('dialog', { name: 'クイックナビゲーション' });
const shortcut = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
const dismiss = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'クイックナビゲーションを閉じる' }));
let originalOrigin: PropertyDescriptor | undefined;

beforeEach(() => {
  originalOrigin = Object.getOwnPropertyDescriptor(window.location, 'origin');
  Object.defineProperty(window.location, 'origin', { value: 'https://demo.invalid', configurable: true });
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-build');
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalOrigin) Object.defineProperty(window.location, 'origin', originalOrigin); else Reflect.deleteProperty(window.location, 'origin');
});

describe('quick navigation preserves existing operations and local editing', () => {
  it('opens from mobile sidebar and settings without writes and returns to the original trigger', async () => {
    const { controller, observed } = demoController(); render(<RemoteApp controller={controller} />);
    const trigger = screen.getByRole('button', { name: 'セッションのサイドバーを開く' }); trigger.focus(); fireEvent.click(trigger);
    const launch = within(screen.getByRole('dialog', { name: 'セッション管理' })).getByRole('button', { name: 'クイックナビゲーション' });
    launch.focus(); fireEvent.click(launch);
    expect(screen.queryByRole('dialog', { name: 'セッション管理' })).toBeNull();
    expect(within(dialog()).getByRole('searchbox', { name: '移動先を検索' })).toHaveFocus();
    dismiss(); expect(trigger).toHaveFocus();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '設定' })));
    const settingsLaunch = screen.getByRole('button', { name: 'クイックナビゲーション' }); settingsLaunch.focus(); fireEvent.click(settingsLaunch);
    dismiss(); expect(settingsLaunch).toHaveFocus(); observed.forEach(write => expect(write).not.toHaveBeenCalled());
  });
  it('cancels back into the unchanged textarea, selection and reading position; queries never persist', () => {
    const { controller, observed } = demoController(); controller.setDraft('DEMO 日本語\n下書きを保持');
    const { container } = render(<RemoteApp controller={controller} />);
    fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
    const input = screen.getByLabelText('Hermesへのメッセージ') as HTMLTextAreaElement; act(() => { input.focus(); input.setSelectionRange(5, 8); });
    const transcript = container.querySelector<HTMLElement>('.remote-transcript')!; transcript.scrollTop = 120;
    shortcut(); const query = within(dialog()).getByRole('searchbox', { name: '移動先を検索' });
    fireEvent.change(query, { target: { value: 'DEMO-sensitive-query' } });
    expect(within(dialog()).getByText('一致する移動先はありません。会話・設定などの名前で検索してください。')).toBeInTheDocument();
    dismiss(); expect(input).toHaveFocus(); expect(input.selectionStart).toBe(5); expect(input.selectionEnd).toBe(8);
    expect(transcript.scrollTop).toBe(120); expect(input).toHaveValue('DEMO 日本語\n下書きを保持');
    shortcut(); expect(within(dialog()).getByRole('searchbox')).toHaveValue('');
    expect(Object.entries(localStorage).some(([key, value]) => /navigation|query|DEMO/.test(key + value))).toBe(false);
    expect(sessionStorage.length).toBe(0); observed.forEach(write => expect(write).not.toHaveBeenCalled());
  });
  it('navigates through existing pages while preserving the draft and unknown-send guard', async () => {
    const { controller, observed } = demoController(); controller.store.setState({ draft: 'DEMO unknown', delivery: 'delivery_unknown' });
    render(<RemoteApp controller={controller} />); shortcut();
    fireEvent.change(within(dialog()).getByRole('searchbox'), { target: { value: 'settings' } });
    await act(async () => fireEvent.keyDown(within(dialog()).getByRole('searchbox'), { key: 'Enter' }));
    expect(screen.getByRole('heading', { name: '設定・診断' })).toBeInTheDocument();
    shortcut(); fireEvent.click(within(dialog()).getByRole('button', { name: '確認待ち' }));
    expect(screen.getByRole('heading', { name: '確認待ち' })).toBeInTheDocument();
    shortcut(); fireEvent.click(within(dialog()).getByRole('button', { name: '開いている会話へ' }));
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO unknown');
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
    expect(controller.store.getState().delivery).toBe('delivery_unknown'); observed.forEach(write => expect(write).not.toHaveBeenCalled());
  });
  it('ignores IME and other open dialogs, but permits deliberate arrow/Enter navigation', () => {
    const { controller, observed } = demoController(); render(<RemoteApp controller={controller} />);
    fireEvent.compositionStart(window); shortcut(); expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.compositionEnd(window); shortcut(); const query = within(dialog()).getByRole('searchbox');
    fireEvent.change(query, { target: { value: '設定' } }); fireEvent.compositionStart(query);
    fireEvent.keyDown(query, { key: 'Enter' }); expect(dialog()).toBeInTheDocument();
    fireEvent.compositionEnd(query); fireEvent.keyDown(query, { key: 'ArrowDown' });
    expect(within(dialog()).getByRole('button', { name: '設定・診断' })).toHaveFocus(); dismiss();
    fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' })); shortcut();
    expect(screen.getByRole('dialog', { name: '会話メニュー' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'クイックナビゲーション' })).toBeNull(); observed.forEach(write => expect(write).not.toHaveBeenCalled());
  });
  it.each(['profile', 'liveId', 'principalId', 'connection'] as const)('discards the query and modal when %s changes', async field => {
    const { controller, observed } = demoController(); render(<RemoteApp controller={controller} />); shortcut();
    fireEvent.change(within(dialog()).getByRole('searchbox'), { target: { value: 'DEMO-private-query' } });
    await act(async () => controller.store.setState({ [field]: field === 'connection' ? 'reauth' : 'DEMO-changed' }));
    expect(screen.queryByRole('dialog', { name: 'クイックナビゲーション' })).toBeNull();
    expect(Object.values(localStorage).join(' ')).not.toContain('DEMO-private-query'); observed.forEach(write => expect(write).not.toHaveBeenCalled());
  });
  it('shows unsupported destinations as disabled and coalesces repeated explicit selection', () => {
    const select = vi.fn();
    render(<QuickNavigation commands={[
      { id: 'files', label: 'ファイル', description: 'DEMO', keywords: '', disabledReason: '未対応' },
      { id: 'settings', label: '設定', description: 'DEMO', keywords: '' },
    ]} onSelect={select} onDismiss={vi.fn()} />);
    expect(within(dialog()).getByRole('button', { name: 'ファイル' })).toBeDisabled();
    const settings = within(dialog()).getByRole('button', { name: '設定' }); fireEvent.click(settings); fireEvent.click(settings);
    expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith('settings');
  });
  it('clears abandoned IME state after auth loss and removes global listeners on unmount', async () => {
    const { controller, observed } = demoController(); const view = render(<RemoteApp controller={controller} />); shortcut();
    fireEvent.compositionStart(within(dialog()).getByRole('searchbox'));
    await act(async () => controller.store.setState({ connection: 'reauth' }));
    await act(async () => controller.store.setState({ connection: 'connected' }));
    shortcut(); expect(dialog()).toBeInTheDocument(); view.unmount();
    const key = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(key); expect(key.defaultPrevented).toBe(false); observed.forEach(write => expect(write).not.toHaveBeenCalled());
  });
});
