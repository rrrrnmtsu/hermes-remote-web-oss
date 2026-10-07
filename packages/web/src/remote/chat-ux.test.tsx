import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController, type RemoteRequest } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';

function demoController() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('UI-only DEMO'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, liveId: 'DEMO-live', durableId: 'DEMO-stored', profile: 'default', profiles: ['default'] });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined);
  vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  return controller;
}
function open(controller: RemoteController) {
  const result = render(<RemoteApp controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
  return result;
}
const approval: RemoteRequest = { key: 'number:42', id: 42, method: 'approval', profile: 'default', sessionId: 'DEMO-live',
  status: 'pending', params: { command: 'echo DEMO', choices: ['once', 'deny', 'always'] } };

beforeEach(() => {
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-ui');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('daily mobile chat UX', () => {
  it('distinguishes message authors semantically and opens copy only on demand', async () => {
    const controller = demoController();
    controller.store.setState({ messages: [
      { id: 'DEMO-u', role: 'user', text: 'DEMO 質問' }, { id: 'DEMO-a', role: 'assistant', text: 'DEMO 回答' },
      { id: 'DEMO-s', role: 'system', text: 'DEMO お知らせ' }, { id: 'DEMO-empty', role: 'assistant', text: '' },
    ] });
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: copy } });
    open(controller);
    expect(screen.getByRole('article', { name: 'あなたのメッセージ' })).toHaveClass('remote-message-user');
    expect(screen.getByRole('article', { name: 'Hermesのメッセージ' })).toHaveClass('remote-message-assistant');
    expect(screen.getByRole('article', { name: 'システムのメッセージ' })).toHaveClass('remote-message-system');
    expect(screen.queryByRole('button', { name: 'メッセージをコピー' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hermesのメッセージ操作' }));
    fireEvent.click(screen.getByRole('button', { name: 'メッセージをコピー' }));
    expect(copy).toHaveBeenCalledWith('DEMO 回答');
    expect(await screen.findByText('コピーしました')).toBeInTheDocument();
  });

  it('copies just the code, and keeps tool details collapsed by default', async () => {
    const controller = demoController();
    controller.store.setState({ messages: [{ id: 'DEMO-code', role: 'assistant', text: 'DEMO説明\n\n```text\necho DEMO\n```' }],
      tools: [{ id: 'DEMO-tool', name: 'DEMO-read', status: '完了', detail: 'DEMO tool details' }] });
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: copy } });
    const { container } = open(controller);
    expect(container.querySelector<HTMLDetailsElement>('.remote-tool-activity')?.open).toBe(false);
    expect(screen.getByText('1件のツールを実行')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'コードをコピー' }));
    expect(copy).toHaveBeenCalledWith('echo DEMO\n');
    expect(await screen.findByText('コピーしました')).toBeInTheDocument();
  });

  it('projects only real pending requests in this conversation, and removes cancelled CTA', () => {
    const controller = demoController();
    controller.store.setState({ requests: [approval, { ...approval, key: 'string:other', profile: 'DEMO-other' }] });
    open(controller);
    const inline = screen.getByRole('article', { name: 'この会話の確認要求' });
    expect(inline).toHaveTextContent('コマンド実行の承認');
    fireEvent.click(within(inline).getByRole('button', { name: '確認する' }));
    expect(screen.getByLabelText('要求されたコマンド')).toHaveTextContent('echo DEMO');
    fireEvent.click(screen.getByRole('button', { name: '会話へ戻る' }));
    act(() => controller.store.setState({ requests: [{ ...approval, status: 'cancelled' }] }));
    expect(screen.queryByRole('article', { name: 'この会話の確認要求' })).toBeNull();
  });

  it('keeps stop confirmation and authoritative stop state distinct', () => {
    const controller = demoController();
    controller.store.setState({ execution: 'running' });
    const stop = vi.spyOn(controller, 'stop').mockResolvedValue(undefined);
    const { container } = open(controller);
    fireEvent.click(screen.getByRole('button', { name: /^停止$/ }));
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '停止確認' })).toHaveTextContent('実施済みの変更は巻き戻しません');
    fireEvent.click(screen.getByRole('button', { name: '停止を要求' }));
    expect(stop).toHaveBeenCalledTimes(1);
    act(() => controller.store.setState({ execution: 'stop_requested' }));
    expect(container.querySelector('.remote-activity-strip')).toHaveTextContent('停止を要求しています');
    expect(container.querySelector('.remote-chat-state')).not.toHaveTextContent('停止を確認');
    act(() => controller.store.setState({ execution: 'stopped' }));
    expect(container.querySelector('.remote-activity-strip')).toBeEmptyDOMElement();
  });

  it('separates sending, execution, reconnection and unknown delivery without resending', () => {
    const controller = demoController();
    const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    const recover = vi.spyOn(controller, 'recover').mockResolvedValue(undefined);
    const { container } = open(controller);
    const strip = container.querySelector('.remote-activity-strip')!;
    expect(strip).toBeEmptyDOMElement();
    act(() => controller.store.setState({ delivery: 'sending' }));
    expect(strip).toHaveTextContent('メッセージを送信中');
    expect(strip).not.toHaveTextContent('Hermesが処理');
    act(() => controller.store.setState({ delivery: 'accepted', execution: 'running' }));
    expect(strip).toHaveTextContent('Hermesが処理');
    act(() => controller.store.setState({ connection: 'offline', execution: 'unknown' }));
    expect(strip).toHaveTextContent('オフライン');
    act(() => controller.store.setState({ connection: 'reconnecting' }));
    expect(strip).toHaveTextContent('再接続中');
    act(() => controller.store.setState({ connection: 'connected', generationAllowed: true, delivery: 'delivery_unknown', draft: 'DEMO lost ACK' }));
    expect(screen.getByRole('alert')).toHaveTextContent('送信結果不明');
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
    window.dispatchEvent(new Event('pageshow'));
    expect(recover).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows new content as a floating action and preserves a history reader', () => {
    const controller = demoController();
    const { container } = open(controller);
    const transcript = container.querySelector<HTMLElement>('.remote-transcript')!;
    Object.defineProperty(transcript, 'scrollHeight', { value: 1500, configurable: true });
    Object.defineProperty(transcript, 'clientHeight', { value: 400, configurable: true });
    transcript.scrollTop = 100;
    fireEvent.scroll(transcript);
    const scroll = vi.spyOn(transcript, 'scrollTo'); scroll.mockClear();
    act(() => controller.store.setState({ messages: [{ id: 'DEMO-new', role: 'assistant', text: 'DEMO 新着' }] }));
    expect(scroll).not.toHaveBeenCalled();
    expect(transcript.scrollTop).toBe(100);
    const action = screen.getByRole('button', { name: '新着を表示' });
    expect(action.closest('.remote-composer-dock')).not.toBeNull();
    fireEvent.click(action);
    expect(scroll).toHaveBeenCalledWith({ top: 1500 });
    expect(screen.queryByRole('button', { name: '新着を表示' })).toBeNull();
  });
});
