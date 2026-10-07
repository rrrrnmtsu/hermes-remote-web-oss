import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';

function demoController() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('UI-only DEMO'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, profiles: ['default', 'DEMO-secondary'], profile: 'default',
    sessions: [{ durableId: 'DEMO-current', lineageId: 'DEMO-current', title: 'DEMO 開いている会話', source: 'tui' }],
    projectsStatus: 'ready', projects: [{ id: 'DEMO-plan', label: 'DEMO 計画', kind: 'registered', sessionCount: 2,
      sessionIds: ['DEMO-current', 'DEMO-plan-old'], previews: [], lastActive: 1791040000 }],
    liveId: 'DEMO-live', durableId: 'DEMO-current', lineageId: 'DEMO-current', execution: 'idle' });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined);
  vi.spyOn(controller, 'recover').mockResolvedValue(undefined);
  vi.spyOn(controller, 'refreshProjects').mockResolvedValue(undefined);
  vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  return controller;
}
beforeEach(() => {
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-sidebar-build');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('profile and project session navigation', () => {
  it('opens an accessible mobile drawer and refreshes the server projection', () => {
    const controller = demoController(); render(<RemoteApp controller={controller} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'セッションのサイドバーを開く' }));
    const drawer = screen.getByRole('dialog', { name: 'セッション管理' });
    expect(within(drawer).getByLabelText('サイドバーのprofile')).toHaveValue('default');
    expect(within(drawer).getByLabelText('サーバー集計 2会話')).toHaveTextContent('2');
    expect(controller.refreshProjects).toHaveBeenCalledTimes(1);
    fireEvent.click(within(drawer).getByRole('button', { name: 'サイドバーを閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('allows project filtering with a draft while guarding profile and session changes', () => {
    const controller = demoController(); controller.setDraft('DEMO 保存しない下書き');
    const select = vi.spyOn(controller, 'selectProject').mockResolvedValue(undefined);
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: 'セッションのサイドバーを開く' }));
    const drawer = screen.getByRole('dialog', { name: 'セッション管理' });
    expect(within(drawer).getByLabelText('サイドバーのprofile')).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: 'サイドバーから新規会話' })).toBeDisabled();
    fireEvent.click(within(drawer).getByRole('button', { name: 'プロジェクトを選択: DEMO 計画' }));
    expect(select).toHaveBeenCalledWith('DEMO-plan');
    expect(controller.store.getState().draft).toBe('DEMO 保存しない下書き');
    fireEvent.click(within(drawer).getByRole('button', { name: '開いている会話を表示' }));
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO 保存しない下書き');
  });

  it('opens session navigation from the compact conversation menu without sending', () => {
    const controller = demoController(); const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
    fireEvent.click(screen.getByRole('button', { name: 'セッションを選ぶ' }));
    expect(screen.getByRole('dialog', { name: 'セッション管理' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '会話メニュー' })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows only loaded project sessions, search scope and the unchanged new-chat workspace', () => {
    const controller = demoController();
    controller.store.setState({ selectedProjectId: 'DEMO-plan', projectSessions: [{ durableId: 'DEMO-plan-old', lineageId: 'DEMO-plan-old', title: 'DEMO 日本語の計画', source: 'tui', lastActive: 1791030000 }] });
    render(<RemoteApp controller={controller} />);
    expect(screen.getByLabelText('選択中のプロジェクト')).toHaveTextContent('新規会話はprofileの既定の作業先で始まります');
    expect(screen.getByRole('button', { name: 'DEMO 日本語の計画' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DEMO 開いている会話' })).toBeNull();
    fireEvent.change(screen.getByLabelText('会話を検索'), { target: { value: 'not matched' } });
    expect(screen.getByText('一致する会話がありません')).toBeInTheDocument();
    expect(controller.store.getState().selectedProjectId).toBe('DEMO-plan');
  });

  it('keeps current execution and real pending requests visible instead of inventing project statuses', () => {
    const controller = demoController(); controller.store.setState({ execution: 'waiting_input', requests: [{ id: 7, key: 'number:7', method: 'approval', profile: 'default', sessionId: 'DEMO-live', status: 'pending', params: { choices: ['deny'] } }] });
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: 'セッションのサイドバーを開く' }));
    const drawer = screen.getByRole('dialog', { name: 'セッション管理' });
    expect(within(drawer).getByRole('button', { name: '開いている会話を表示' })).toHaveTextContent('確認待ち · 確認 1件');
    expect(within(drawer).getByRole('button', { name: 'プロジェクトを選択: DEMO 計画' })).not.toHaveTextContent('実行中');
    expect(within(drawer).getByLabelText('サイドバーのprofile')).toBeDisabled();
  });

  it('does not replace unavailable project data with fabricated rows or break normal conversation access', () => {
    const controller = demoController(); controller.store.setState({ projects: [], projectsStatus: 'unsupported', projectsError: 'DEMO project未対応' });
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: 'セッションのサイドバーを開く' }));
    const drawer = screen.getByRole('dialog', { name: 'セッション管理' });
    expect(within(drawer).getByText('DEMO project未対応')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /プロジェクトを選択/ })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'セッションを開く: DEMO 開いている会話' })).toBeEnabled();
  });

  it('renders a persistent desktop sidebar and refreshes only once on connection', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    const controller = demoController(); const { rerender } = render(<RemoteApp controller={controller} />);
    expect(screen.getByRole('complementary', { name: 'セッション管理' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'セッションのサイドバーを開く' })).toBeNull();
    rerender(<RemoteApp controller={controller} />);
    expect(controller.refreshProjects).toHaveBeenCalledTimes(1);
  });

  it('keeps navigation data memory-only and closes the drawer during logout', async () => {
    const controller = demoController(); localStorage.setItem('other-app.sidebar-fixture', 'DEMO-unrelated');
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: 'セッションのサイドバーを開く' }));
    const persisted = JSON.stringify(Object.entries(localStorage));
    expect(persisted).not.toContain('DEMO-plan'); expect(persisted).not.toContain('DEMO-current');
    await act(async () => { await controller.logout(); });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('DEMO 計画')).toBeNull();
    expect(localStorage.getItem('other-app.sidebar-fixture')).toBe('DEMO-unrelated');
  });
});
