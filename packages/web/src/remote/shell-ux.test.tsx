import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';
import { ConnectionPanel } from './ConnectionPanel';

function demoController() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('Shell-only DEMO; never connects'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, liveId: 'DEMO-live', durableId: 'DEMO-1', profile: 'default',
    profiles: ['default', 'DEMO-secondary'], execution: 'idle', https: true, authenticated: true, wss: true, gatewayReady: true, readRpc: true,
    sessions: [{ durableId: 'DEMO-1', lineageId: 'DEMO-1', title: 'DEMO 日本語 ABC', source: 'cli' }] });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined);
  vi.spyOn(controller, 'recover').mockResolvedValue(undefined);
  vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  return controller;
}
beforeEach(() => {
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-shell');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('mobile shell navigation and recovery guidance', () => {
  it('keeps the selected profile before search and scopes a trimmed case-insensitive search to the fetched list', () => {
    const controller = demoController();
    const refresh = vi.spyOn(controller, 'refreshSessions').mockResolvedValue(undefined);
    const { container } = render(<RemoteApp controller={controller} />);
    const profile = screen.getByLabelText('登録profile');
    const search = screen.getByLabelText('会話を検索');
    expect(profile.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(search, { target: { value: ' abc ' } });
    expect(screen.getByRole('button', { name: 'DEMO 日本語 ABC' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'DEMO missing' } });
    expect(screen.getByRole('heading', { name: '一致する会話がありません' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DEMO 日本語 ABC' })).toBeNull();
    fireEvent.click(within(container.querySelector<HTMLElement>('.remote-search')!).getByRole('button', { name: '検索をクリア' }));
    expect(search).toHaveValue('');
    expect(refresh).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLDetailsElement>('.remote-profile-switch details')?.open).toBe(false);
  });

  it('explains a protected draft and allows only returning to the current conversation', () => {
    const controller = demoController();
    controller.store.setState({ draft: 'DEMO private draft' });
    const open = vi.spyOn(controller, 'openSession').mockResolvedValue(undefined);
    const select = vi.spyOn(controller, 'selectProfile').mockResolvedValue(undefined);
    render(<RemoteApp controller={controller} />);
    expect(screen.getByText(/開いている会話に下書きがあります/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新規会話' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DEMO 日本語 ABC' })).toBeDisabled();
    expect(screen.getByLabelText('登録profile')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO private draft');
    expect(open).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });

  it('does not show an empty result while a list is loading', () => {
    const controller = demoController();
    controller.store.setState({ sessions: [], listLoading: true });
    const { container } = render(<RemoteApp controller={controller} />);
    expect(screen.getByText('会話一覧を取得中…')).toBeInTheDocument();
    expect(container.querySelector('.remote-session-list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('このprofileには会話がありません')).toBeNull();
    act(() => controller.store.setState({ listLoading: false }));
    expect(screen.getByRole('heading', { name: 'このprofileには会話がありません' })).toBeInTheDocument();
  });

  it('opens grouped connection checks and hides build details until requested', () => {
    const { container } = render(<RemoteApp controller={demoController()} />);
    fireEvent.click(screen.getByRole('button', { name: '接続状態と診断' }));
    const checks = screen.getByRole('list', { name: '接続確認の段階' });
    expect(within(checks).getAllByText('確認済み')).toHaveLength(5);
    const details = container.querySelector<HTMLDetailsElement>('.remote-diagnostic-details');
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText('アプリと接続の詳細'));
    expect(details?.open).toBe(true);
    expect(screen.getByText('DEMO-shell')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
  });

  it('shows the current connection stage after five seconds without retrying automatically', () => {
    vi.useFakeTimers();
    const controller = demoController();
    const connect = vi.fn();
    const { rerender } = render(<ConnectionPanel state={{ ...controller.store.getState(), connection: 'wss' }} onConnect={connect} onDiagnostics={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Hermesのログイン画面を開く' })).toBeNull();
    expect(screen.queryByRole('button', { name: '認証後に接続・再接続' })).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    rerender(<ConnectionPanel state={{ ...controller.store.getState(), connection: 'gateway' }} onConnect={connect} onDiagnostics={vi.fn()} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('gateway.readyを確認')).toBeInTheDocument();
    expect(screen.getByText(/接続に時間がかかっています/)).toBeInTheDocument();
    expect(connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '認証後に接続・再接続' }));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('offers reauthentication only for an authentication state, with network-specific recovery otherwise', () => {
    const controller = demoController();
    const { rerender } = render(<ConnectionPanel state={{ ...controller.store.getState(), connection: 'offline' }} onConnect={vi.fn()} onDiagnostics={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Hermesのログイン画面を開く' })).toBeNull();
    expect(screen.getByText(/Tailscaleと通信状態/)).toBeInTheDocument();
    rerender(<ConnectionPanel state={{ ...controller.store.getState(), connection: 'reauth' }} onConnect={vi.fn()} onDiagnostics={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Hermesのログイン画面を開く' })).toHaveAttribute('href', '/login?next=%2Fhermes-remote-web%2F');
  });
});
