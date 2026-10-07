import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';

function controller() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const value = new RemoteController({ http, origin: 'https://DEMO.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO unit only'); }, withOperationLock: async action => action() });
  value.store.setState({ connection: 'connected', profile: 'default', profiles: ['default', 'DEMO-other'],
    liveId: 'DEMO-live', durableId: 'DEMO-durable', execution: 'idle' });
  vi.spyOn(value, 'start').mockResolvedValue(undefined); vi.spyOn(value, 'recover').mockResolvedValue(undefined); vi.spyOn(value, 'dispose').mockImplementation(() => undefined);
  return value;
}
beforeEach(() => {
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-build');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('navigation and search interaction ownership', () => {
  it('restores each page position and resets it at a different profile', () => {
    const value = controller(); render(<RemoteApp controller={value} />);
    fireEvent.click(screen.getByRole('button', { name: '設定' })); const main = screen.getByRole('main');
    main.scrollTop = 180; fireEvent.scroll(main);
    fireEvent.click(screen.getByRole('button', { name: '確認待ち' })); expect(main.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '設定' })); expect(main.scrollTop).toBe(180);
    act(() => value.store.setState({ profile: 'DEMO-other' })); expect(main.scrollTop).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('does not open an existing conversation when a new-session operation was refused', async () => {
    const value = controller(); const open = vi.spyOn(value, 'openSession').mockResolvedValue(undefined);
    render(<RemoteApp controller={value} />); fireEvent.click(screen.getByRole('button', { name: '新規会話' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('region', { name: '会話一覧' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Hermesへのメッセージ')).toBeNull();
  });
  it('shows a positively confirmed new session without taking over later navigation', async () => {
    const value = controller(); let finish!: () => void;
    vi.spyOn(value, 'openSession').mockImplementation(() => new Promise<void>(resolve => { finish = () => {
      value.store.setState({ liveId: 'DEMO-new', durableId: 'DEMO-new-stored' }); resolve();
    }; }));
    render(<RemoteApp controller={value} />); fireEvent.click(screen.getByRole('button', { name: '新規会話' }));
    fireEvent.click(screen.getByRole('button', { name: '設定' })); await act(async () => { finish(); });
    expect(screen.getByRole('heading', { name: '設定・診断' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Hermesへのメッセージ')).toBeNull();
  });
  it('opens the chat after the selected operation confirms a new live session', async () => {
    const value = controller(); vi.spyOn(value, 'openSession').mockImplementation(async () => {
      value.store.setState({ liveId: 'DEMO-new', durableId: 'DEMO-new-stored' });
    });
    render(<RemoteApp controller={value} />); fireEvent.click(screen.getByRole('button', { name: '新規会話' }));
    await waitFor(() => expect(screen.getByLabelText('Hermesへのメッセージ')).toBeInTheDocument());
    expect(value.store.getState().liveId).toBe('DEMO-new');
  });
  it('coalesces rapid new-session taps at the shared UI entry without sending a prompt', async () => {
    const value = controller(); let finish!: () => void;
    const open = vi.spyOn(value, 'openSession').mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const submit = vi.spyOn(value, 'submit'); render(<RemoteApp controller={value} />);
    const newSession = screen.getByRole('button', { name: '新規会話' }); fireEvent.click(newSession); fireEvent.click(newSession);
    expect(open).toHaveBeenCalledTimes(1); await act(async () => finish()); expect(submit).not.toHaveBeenCalled();
  });
  it('clears and closes search with focus restoration while preserving draft and IME', () => {
    const value = controller(); value.setDraft('DEMO 日本語\n元の下書き'); const submit = vi.spyOn(value, 'submit');
    render(<RemoteApp controller={value} />); fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
    const menu = screen.getByRole('button', { name: '会話メニュー' }); menu.focus(); fireEvent.click(menu);
    fireEvent.click(within(screen.getByRole('dialog', { name: '会話メニュー' })).getByRole('button', { name: 'この会話を検索' }));
    const input = screen.getByLabelText('会話内の検索語'); fireEvent.change(input, { target: { value: '日本語' } });
    fireEvent.click(screen.getByRole('button', { name: '本文検索をクリア' })); expect(input).toHaveValue(''); expect(input).toHaveFocus();
    fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Escape', isComposing: true }); expect(input).toBeInTheDocument();
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Escape' }); expect(screen.queryByLabelText('会話内の検索語')).toBeNull();
    expect(menu).toHaveFocus(); expect(value.store.getState().draft).toBe('DEMO 日本語\n元の下書き'); expect(submit).not.toHaveBeenCalled();
  });
});
