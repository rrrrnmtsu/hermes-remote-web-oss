import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';

beforeEach(() => {
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-quote');
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function open() {
  const httpCalls = vi.fn();
  const http: Http = Object.assign(async <T,>() => { httpCalls(); return {} as T; }, { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO only'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, liveId: 'DEMO-live', profile: 'default', profiles: ['default'], draft: '前半後半',
    messages: [{ id: 'DEMO-a', role: 'assistant', text: '日本語 **引用**\n\n```text\ncode\n```' }, { id: 'DEMO-tool', role: 'tool', text: 'DEMO tool excluded' }] });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined); vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  const submit = vi.spyOn(controller, 'submit'); const stop = vi.spyOn(controller, 'stop'); const newSession = vi.spyOn(controller, 'openSession'); const respond = vi.spyOn(controller, 'answer');
  render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
  return { controller, http: httpCalls, submit, stop, newSession, respond };
}
describe('quote UI scoped frozen draft insertion', () => {
  it('cancels local image preparation on leaving the conversation without retaining an update/scope guard', () => {
    const { controller, http, submit } = open();
    act(() => { controller.setDraft(''); controller.setImageSelecting(true, 'default', 'DEMO-live'); });
    expect(controller.store.getState().imageSelecting).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '← 会話一覧' }));
    expect(controller.store.getState().imageSelecting).toBe(false);
    expect(http).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });
  it('captures before selection disappears, inserts without replacing a draft, sends zero writes and restores question caret', async () => {
    const { controller, http, submit, stop, newSession, respond } = open();
    const input = screen.getByLabelText('Hermesへのメッセージ') as HTMLTextAreaElement;
    input.setSelectionRange(2, 4); fireEvent.select(input);
    const mark = document.querySelector('.remote-message-content strong')!;
    const range = document.createRange(); range.selectNodeContents(mark); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const menu = screen.getByRole('button', { name: 'Hermesのメッセージ操作' });
    fireEvent.pointerDown(menu); window.getSelection()!.removeAllRanges(); fireEvent.click(menu);
    act(() => controller.store.setState({ messages: [{ id: 'DEMO-a', role: 'assistant', text: '後から到着した本文' }] }));
    fireEvent.click(screen.getByRole('button', { name: '引用して質問' }));
    const dialog = screen.getByRole('dialog', { name: '引用して質問' });
    expect(within(dialog).getByText('引用', { exact: true })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '下書きへ挿入' }));
    await waitFor(() => { expect(document.activeElement).toBe(input); expect(input.value.slice(0, input.selectionStart)).toMatch(/この部分について：$/); });
    expect(controller.store.getState().draft).toBe('前半\n\n以下は会話からの引用です。\n> 引用\n\nこの部分について：\n\n後半');
    expect(input.value.slice(0, input.selectionStart)).toMatch(/この部分について：$/);
    for (const method of [http, submit, stop, newSession, respond]) expect(method).not.toHaveBeenCalled();
  });
  it('offers displayed body only, confirms 8000-char omission, excludes tool and discards modal after auth scope changes', () => {
    const { controller } = open();
    fireEvent.click(screen.getByRole('button', { name: 'ツールのメッセージ操作' }));
    expect(screen.queryByRole('button', { name: '引用して質問' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    act(() => controller.store.setState({ messages: [{ id: 'DEMO-a', role: 'assistant', text: 'あ'.repeat(9000) }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Hermesのメッセージ操作' })); fireEvent.click(screen.getByRole('button', { name: '引用して質問' }));
    expect(screen.getByRole('alert').textContent).toContain('先頭8,000文字');
    act(() => controller.store.setState({ connection: 'reauth', liveId: '', draft: '' }));
    expect(screen.queryByRole('dialog', { name: '引用して質問' })).toBeNull();
  });
});
