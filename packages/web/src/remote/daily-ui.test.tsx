import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';
import { readChatFontSize, saveChatFontSize } from './runtime';
import { MarkdownSaveDialog } from './MarkdownSaveDialog';
import { createMarkdownSnapshot } from './chat-content';
import { ChatMessage } from './ChatMessage';
import { prepareSearchIndex, findSearchHits } from './chat-content';
import { ConfirmDialog } from './ConfirmDialog';

function demoController() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO UI only'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, liveId: 'DEMO-live', durableId: 'DEMO-durable', profile: 'default', profiles: ['default', 'other'],
    messages: [{ id: 'DEMO-a', role: 'assistant', text: '**日本語** 日本語\n\n```text\n日本語\n```\n[危険](javascript:alert(1))\n<script>window.__DEMO_xss=1</script>' }] });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined); vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  return controller;
}
function open(controller: RemoteController) {
  const result = render(<RemoteApp controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' })); return result;
}
function menuAction(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '会話メニュー' })).getByRole('button', { name }));
}
beforeEach(() => {
  localStorage.removeItem('hermes-remote-web.settings.chat-font-size');
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-daily-ui');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('daily UI privacy and operations', () => {
  it('cycles dialog endpoints while preserving native summary keyboard navigation', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 44)] as unknown as DOMRectList);
    render(<ConfirmDialog label="DEMO focus" onDismiss={() => undefined}><button>DEMO first</button><details><summary tabIndex={0}>DEMO details</summary></details><button>DEMO last</button></ConfirmDialog>);
    const summary = screen.getByText('DEMO details'); act(() => summary.focus());
    expect(document.activeElement).toBe(summary);
    const middle = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); fireEvent(summary, middle);
    expect(middle.defaultPrevented).toBe(false);
    const last = screen.getByRole('button', { name: 'DEMO last' }); act(() => last.focus());
    const end = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); fireEvent(last, end);
    expect(end.defaultPrevented).toBe(true); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'DEMO first' }));
  });
  it('searches the visible image label without loading its URL or altering displayed text', () => {
    const message = { id: 'DEMO-image-label', role: 'assistant', text: '![日本語の代替ラベル](https://untrusted.invalid/DEMO.png)' };
    const hits = findSearchHits(prepareSearchIndex([message]), '日本語').hits;
    const { container } = render(<ChatMessage message={message} searchHits={hits} activeHit={0} />);
    expect(container.querySelector('img')).toBeNull(); expect(container.querySelector('mark')).toHaveTextContent('日本語');
    expect(container).toHaveTextContent('画像: 日本語の代替ラベル');
  });
  it('defaults to 16, persists only allowed sizes, previews/resets and rejects invalid/storage failures', () => {
    expect(readChatFontSize()).toBe(16);
    for (const value of [15, 16, 17] as const) { expect(saveChatFontSize(value)).toBe(value); expect(readChatFontSize()).toBe(value); }
    for (const invalid of ['15px', '15', 18, null, 'url(DEMO)']) expect(saveChatFontSize(invalid)).toBe(16);
    localStorage.setItem('hermes-remote-web.settings.chat-font-size', '1e2'); expect(readChatFontSize()).toBe(16);
    const controller = demoController();
    const writes = [vi.spyOn(controller, 'submit'), vi.spyOn(controller, 'answer'), vi.spyOn(controller, 'stop'), vi.spyOn(controller, 'openSession'), vi.spyOn(controller, 'selectProfile')];
    const first = render(<RemoteApp controller={controller} />);
    fireEvent.click(screen.getByRole('button', { name: '設定' }));
    const select = screen.getByLabelText('会話の文字サイズ'); expect(select).toHaveValue('16');
    fireEvent.change(select, { target: { value: '15' } }); expect(localStorage.getItem('hermes-remote-web.settings.chat-font-size')).toBe('15');
    expect(screen.getByLabelText('会話の文字サイズのプレビュー')).toHaveStyle({ '--chat-body-font-size': '0.9375rem' });
    first.unmount(); render(<RemoteApp controller={controller} />); fireEvent.click(screen.getByRole('button', { name: '設定' }));
    expect(screen.getByLabelText('会話の文字サイズ')).toHaveValue('15');
    fireEvent.click(screen.getByRole('button', { name: '文字サイズを標準に戻す' })); expect(readChatFontSize()).toBe(16);
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('DEMO blocked'); }); expect(readChatFontSize()).toBe(16);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('DEMO blocked'); }); expect(saveChatFontSize(17)).toBe(16);
  });
  it('searches safely, preserves code copy, avoids new-arrival scroll and discards query on scope changes', async () => {
    const controller = demoController(); const { container } = open(controller);
    const scroll = vi.spyOn(container.querySelector<HTMLElement>('.remote-transcript')!, 'scrollTo');
    menuAction('この会話を検索'); fireEvent.change(screen.getByLabelText('会話内の検索語'), { target: { value: '日本語' } });
    await waitFor(() => expect(container.querySelectorAll('mark')).toHaveLength(3));
    const code = container.querySelector('pre')!.textContent;
    expect(code).toBe('日本語\n'); expect(container.querySelectorAll('script')).toHaveLength(0);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    scroll.mockClear();
    act(() => controller.store.setState({ messages: [...controller.store.getState().messages, { id: 'DEMO-new', role: 'assistant', text: '日本語 新着' }] }));
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '次の一致' })); expect(scroll).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('会話内の検索語'), { target: { value: 'DEMO nonexistent' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '次の一致' })).toBeDisabled());
    act(() => controller.store.setState({ profile: 'other', liveId: 'DEMO-other-live', messages: [] }));
    expect(screen.queryByLabelText('会話内の検索語')).toBeNull(); expect(container.textContent).not.toContain('DEMO nonexistent');
  });
  it('shares expanded drafts, selection/newlines/IME and closes on authentication loss', () => {
    const controller = demoController(); const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    open(controller);
    const input = screen.getByLabelText('Hermesへのメッセージ') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'DEMO\n編集' } }); input.setSelectionRange(5, 5); fireEvent.select(input);
    fireEvent.compositionStart(input); expect(screen.getByRole('button', { name: '入力の補助' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.compositionEnd(input);
    fireEvent.click(screen.getByRole('button', { name: '入力の補助' })); fireEvent.click(screen.getByRole('button', { name: '入力欄を広げる' }));
    const editor = screen.getByLabelText('拡大したメッセージ入力');
    expect(screen.queryByLabelText('Hermesへのメッセージ')).toBeNull();
    expect(editor).toHaveValue('DEMO\n編集');
    fireEvent.change(editor, { target: { value: 'DEMO\n編集\n日本語' } }); fireEvent.compositionStart(editor);
    expect(screen.getByRole('button', { name: '通常表示へ戻る' })).toBeDisabled();
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true }); fireEvent.compositionEnd(editor);
    fireEvent.click(screen.getByRole('button', { name: '通常表示へ戻る' }));
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO\n編集\n日本語'); expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '入力の補助' })); fireEvent.click(screen.getByRole('button', { name: '入力欄を広げる' }));
    const setDraft = vi.spyOn(controller, 'setDraft');
    act(() => controller.store.setState({ profile: 'other', liveId: 'DEMO-other-live', draft: 'DEMO next scope', messages: [] }));
    expect(screen.queryByRole('dialog', { name: '拡大入力' })).toBeNull();
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO next scope');
    expect(setDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '入力の補助' })); fireEvent.click(screen.getByRole('button', { name: '入力欄を広げる' }));
    act(() => controller.store.setState({ connection: 'reauth', liveId: '', draft: '' }));
    expect(screen.queryByRole('dialog', { name: '拡大入力' })).toBeNull();
  });
  it('new local actions call no create/send/approval/stop/profile write and never store sensitive content', async () => {
    const controller = demoController();
    const writes = [vi.spyOn(controller, 'submit'), vi.spyOn(controller, 'answer'), vi.spyOn(controller, 'stop'),
      vi.spyOn(controller, 'openSession'), vi.spyOn(controller, 'selectProfile')];
    localStorage.setItem('other-app-DEMO', 'preserve');
    open(controller);
    const input = screen.getByLabelText('Hermesへのメッセージ') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'DEMO before\nDEMO after' } }); input.setSelectionRange(12, 12); fireEvent.select(input);
    fireEvent.click(screen.getByRole('button', { name: '入力の補助' })); fireEvent.click(screen.getByRole('button', { name: /^要約/ }));
    expect(controller.store.getState().draft).toBe('DEMO before\n要点を3つにまとめてください。DEMO after');
    menuAction('この会話を検索'); fireEvent.change(screen.getByLabelText('会話内の検索語'), { target: { value: '日本語' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '次の一致' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '本文検索を閉じる' }));
    menuAction('会話をMarkdownで保存'); expect(screen.getByRole('dialog', { name: '会話のMarkdown保存' })).toHaveTextContent('端末のファイル');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
    const allowed = ['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.signed-out', 'hermes-remote-web.settings.chat-font-size', 'other-app-DEMO'];
    const keys = Object.keys(localStorage); expect(keys.every(key => allowed.includes(key))).toBe(true);
    for (const key of keys) expect(localStorage.getItem(key)).not.toMatch(/日本語|DEMO before|DEMO-live|DEMO-durable/);
    expect(localStorage.getItem('other-app-DEMO')).toBe('preserve'); expect(Object.keys(sessionStorage)).toEqual([]);
  });
  it('disables export while running, delivery is unknown or stop is unconfirmed', () => {
    const controller = demoController(); open(controller);
    for (const execution of ['running', 'waiting_input', 'stop_requested', 'unknown'] as const) {
      act(() => controller.store.setState({ execution })); fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
      expect(screen.getByRole('button', { name: '会話をMarkdownで保存' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    }
    act(() => controller.store.setState({ execution: 'idle', delivery: 'delivery_unknown' }));
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' })); expect(screen.getByRole('button', { name: '会話をMarkdownで保存' })).toBeDisabled();
  });
  it('creates a Blob only after explicit confirmation and revokes it on dismissal', () => {
    const create = vi.fn(() => 'blob:DEMO'); const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const result = render(<MarkdownSaveDialog snapshot={createMarkdownSnapshot([{ id: 'DEMO', role: 'user', text: 'DEMO 日本語' }], new Date())} onDismiss={() => undefined} />);
    expect(create).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '確認してファイルを保存' }));
    expect(create).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: '確認してファイルを保存' })).toBeDisabled();
    expect(screen.getByText(/端末側の保存完了は確認できません/)).toBeInTheDocument(); result.unmount(); expect(revoke).toHaveBeenCalledWith('blob:DEMO');
  });
});
