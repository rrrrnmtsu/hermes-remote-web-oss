import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';

function setup() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO only'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, liveId: 'DEMO-live', durableId: 'DEMO-durable',
    profile: 'default', profiles: ['default', 'other'], draft: 'DEMO\n下書き', messages: [
      { id: 'DEMO-q', role: 'user', text: '日本語の質問' },
      { id: 'DEMO-a', role: 'assistant', text: '# 結論\n\n本文\n\n## 確認方法\n\n```text\n# code\n```' },
    ] });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined); vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  const writes = ['submit', 'answer', 'stop', 'openSession', 'selectProfile'].map(name => vi.spyOn(controller, name as 'submit'));
  const rendered = render(<RemoteApp controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: '開いている会話へ' }));
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '会話メニュー' })).getByRole('button', { name: 'この会話の目次' }));
  };
  return { controller, writes, open, ...rendered };
}
beforeEach(() => {
  localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-outline');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('outline navigation without operations or persistence', () => {
  it('freezes the list during streaming, jumps explicitly, preserves draft and offers return', async () => {
    const { open, controller, writes, container } = setup();
    const storage = vi.spyOn(Storage.prototype, 'setItem'); open();
    const dialog = screen.getByRole('dialog', { name: 'この会話の目次' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
    const scroll = vi.spyOn(container.querySelector('.remote-transcript') as HTMLElement, 'scrollTo'); scroll.mockClear();
    act(() => controller.store.setState({ messages: [...controller.store.getState().messages, { id: 'DEMO-new', role: 'assistant', text: '# 新着' }] }));
    expect(within(dialog).queryByText('新着')).toBeNull(); expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hermes · 見出し2 確認方法' }));
    await waitFor(() => expect(container.querySelector('.remote-outline-target')).toHaveTextContent('確認方法'));
    expect(document.activeElement).toBe(container.querySelector('.remote-outline-target'));
    expect(screen.getByLabelText('Hermesへのメッセージ')).toHaveValue('DEMO\n下書き');
    open(); expect(within(screen.getByRole('dialog', { name: 'この会話の目次' })).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: '移動前の位置へ戻る' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '会話メニュー' })).toHaveFocus());
    expect(container.querySelector('.remote-outline-target')).toBeNull();
    writes.forEach(write => expect(write).not.toHaveBeenCalled()); expect(storage).not.toHaveBeenCalled();
  });
  it('refuses a removed target and discards snapshot on scope or auth loss', () => {
    const { open, controller, writes } = setup(); open();
    act(() => controller.store.setState({ messages: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Hermes · 見出し1 結論' }));
    expect(screen.getByRole('alert')).toHaveTextContent('現在の表示範囲にありません');
    act(() => controller.store.setState({ profile: 'other', liveId: 'DEMO-other', draft: '次の下書き' }));
    expect(screen.queryByRole('dialog', { name: 'この会話の目次' })).toBeNull();
    open(); expect(screen.getByText('この範囲には質問や回答見出しがありません。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移動前の位置へ戻る' })).toBeNull();
    act(() => controller.store.setState({ connection: 'reauth', liveId: '', draft: '' }));
    expect(screen.queryByRole('dialog', { name: 'この会話の目次' })).toBeNull();
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
  });
  it('preserves active search when the outline is dismissed', async () => {
    const { open, writes } = setup();
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
    fireEvent.click(screen.getByRole('button', { name: 'この会話を検索' }));
    fireEvent.change(screen.getByLabelText('会話内の検索語'), { target: { value: '確認方法' } });
    await waitFor(() => expect(document.querySelector('mark')).toHaveTextContent('確認方法'));
    open(); fireEvent.click(within(screen.getByRole('dialog', { name: 'この会話の目次' })).getByRole('button', { name: '閉じる' }));
    expect(screen.getByLabelText('会話内の検索語')).toHaveValue('確認方法');
    expect(document.querySelector('mark')).toHaveTextContent('確認方法');
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
  });
});
