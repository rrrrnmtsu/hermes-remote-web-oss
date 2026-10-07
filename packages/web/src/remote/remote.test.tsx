import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';
import { safeMarkdownUrl } from './safe-markdown';
import { NotificationController } from '../../../core/src/features/notifications';

function demoController() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('UI-only DEMO; never connects'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, liveId: 'DEMO-live', durableId: 'DEMO-durable', profile: 'default',
    profiles: ['default'], execution: 'idle', https: true, authenticated: true, wss: true, gatewayReady: true, readRpc: true });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined);
  vi.spyOn(controller, 'recover').mockResolvedValue(undefined);
  vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  return controller;
}

beforeEach(() => {
  window.localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-build');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('mobile user flows', () => {
  it('hides conversation and controls immediately while authenticated notification revocation is pending', async () => {
    const controller = demoController(); controller.setDraft('DEMO private pending draft');
    controller.store.setState({ messages: [{ id: 'DEMO-private', role: 'assistant', text: 'DEMO private answer' }] });
    let finish!: (value: { browser: 'revoked'; server: 'revoked' }) => void;
    const revocation = new Promise<{ browser: 'revoked'; server: 'revoked' }>(resolve => { finish = resolve; });
    const revoke = vi.spyOn(NotificationController.prototype, 'logout').mockReturnValue(revocation);
    const logout = vi.spyOn(controller, 'logout').mockResolvedValue(undefined);
    const { container } = render(<RemoteApp controller={controller} />);
    fireEvent.click(screen.getByRole('button', { name: '設定' })); fireEvent.click(screen.getByText('ログアウト'));
    fireEvent.click(screen.getByText('ログアウトを実行'));
    expect(screen.getByRole('status')).toHaveTextContent('会話と入力内容を隠しています');
    expect(container.querySelector('.remote-workspace')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: '設定' })).toBeNull(); expect(logout).not.toHaveBeenCalled();
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    finish({ browser: 'revoked', server: 'revoked' }); await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    revoke.mockRestore();
  });
  it('separates Japanese IME confirmation and newline from explicit send', () => {
    const controller = demoController(); const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByText('開いている会話へ'));
    const input = screen.getByLabelText('Hermesへのメッセージ');
    fireEvent.change(input, { target: { value: 'DEMO 日本語\n確認' } });
    fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(controller.store.getState().draft).toBe('DEMO 日本語\n確認');
  });

  it('renders unknown delivery distinctly and prevents user resubmission', () => {
    const controller = demoController(); controller.store.setState({ draft: 'DEMO draft', delivery: 'delivery_unknown' });
    const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByText('開いている会話へ'));
    expect(screen.getByRole('alert')).toHaveTextContent('送信結果不明');
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('renders safe Markdown without raw HTML, executable URLs or remote image fetches', () => {
    const controller = demoController(); controller.store.setState({ messages: [{ id: 'DEMO', role: 'assistant',
      text: 'DEMO <script>window.pwned=true</script> [bad](javascript:alert(1)) ![image](https://external.invalid/track) [good](https://example.com/info)' }] });
    const { container } = render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByText('開いている会話へ'));
    expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByRole('link').every(link => !link.getAttribute('href')?.includes('javascript'))).toBe(true);
    expect(screen.getByRole('link', { name: /good/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(safeMarkdownUrl('data:text/html,pwned')).toBe('');
  });

  it('shows only once/deny and confirms the real request scope before answering', () => {
    const controller = demoController(); const answer = vi.spyOn(controller, 'answer').mockResolvedValue(undefined);
    controller.store.setState({ requests: [{ id: 'DEMO-a', key: 'string:DEMO-a', profile: 'default', sessionId: 'DEMO-live', method: 'approval',
      status: 'pending', params: { choices: ['once', 'always', 'session', 'deny'], command: 'echo DEMO', description: 'DEMO approval' } }] });
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: '確認待ち (1)' }));
    expect(screen.queryByRole('button', { name: /always|session/ })).toBeNull();
    fireEvent.click(screen.getByText('今回だけ許可')); expect(answer).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '承認対象の確認' })).toHaveTextContent('default / DEMO-live');
    fireEvent.click(screen.getByText('確認して回答')); expect(answer).toHaveBeenCalledWith('string:DEMO-a', { choice: 'once' });
  });

  it('restores accepted clarify answers and encodes multiple choices as the official JSON-array string', () => {
    const controller = demoController(); const answer = vi.spyOn(controller, 'answer').mockResolvedValue(undefined);
    controller.store.setState({ requests: [{ id: 'DEMO-q', key: 'string:DEMO-q', profile: 'default', sessionId: 'DEMO-live', method: 'clarify', status: 'pending',
      params: { questions: [{ qid: 'q0', question: 'DEMO locked' }, { qid: 'q1', question: 'DEMO choose', choices: ['A', 'B'], multi_select: true }, { qid: 'q2', question: 'DEMO text' }], answers: { q0: 'accepted' } } }] });
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: '確認待ち (1)' }));
    expect(screen.getByText('受理済み: accepted')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' })); fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    fireEvent.change(screen.getByLabelText('DEMO text 自由入力'), { target: { value: 'DEMO 自由回答' } });
    fireEvent.click(screen.getByText('回答を送信'));
    expect(answer).toHaveBeenCalledWith('string:DEMO-q', { answers: { q0: 'accepted', q1: '["A","B"]', q2: 'DEMO 自由回答' } });
  });

  it('preserves another app storage and caches while local logout hides content', async () => {
    const controller = demoController();
    window.localStorage.setItem('other-app.example', 'DEMO-other-app');
    const logout = vi.spyOn(controller, 'logout').mockResolvedValue(undefined);
    render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: '設定' }));
    fireEvent.click(screen.getByText('ログアウト')); expect(logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('ログアウトを実行')); await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem('other-app.example')).toBe('DEMO-other-app');
    expect(screen.getByText(/保存は既定OFFです/)).toBeInTheDocument();
  });
});
