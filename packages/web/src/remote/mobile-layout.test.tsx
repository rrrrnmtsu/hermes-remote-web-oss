import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { RemoteApp } from './RemoteApp';

function demoController() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('Layout-only DEMO; never connects'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: true, liveId: 'DEMO-live', durableId: 'DEMO-durable', profile: 'default',
    profiles: ['default'], execution: 'idle', https: true, authenticated: true, wss: true, gatewayReady: true, readRpc: true });
  vi.spyOn(controller, 'start').mockResolvedValue(undefined);
  vi.spyOn(controller, 'recover').mockResolvedValue(undefined);
  vi.spyOn(controller, 'dispose').mockImplementation(() => undefined);
  return controller;
}

function openConversation(controller: RemoteController) {
  const result = render(<RemoteApp controller={controller} />);
  fireEvent.click(screen.getByText('開いている会話へ'));
  return result;
}

beforeEach(() => {
  window.localStorage.setItem('hermes-remote-web.settings.signed-out', 'yes');
  Object.defineProperty(navigator, 'locks', { value: {}, configurable: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: function(this: HTMLDialogElement) { this.open = true; }, configurable: true });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: function(this: HTMLDialogElement) { this.open = false; }, configurable: true });
  vi.stubGlobal('__REMOTE_BUILD_ID__', 'DEMO-layout');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('compact mobile chat layout', () => {
  it('keeps only back, title, status and the menu in the chat header', () => {
    const { container } = openConversation(demoController());
    expect(container.querySelectorAll('header')).toHaveLength(1);
    const header = screen.getByLabelText('会話ヘッダー');
    expect(within(header).getByRole('button', { name: '← 会話一覧' })).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: '再同期' })).toBeNull();
    expect(within(header).queryByRole('button', { name: '停止' })).toBeNull();
    expect(header).not.toHaveTextContent('接続・同期済み');
    expect(header).not.toHaveTextContent('default');
    expect(screen.queryByRole('navigation')).toBeNull();
    fireEvent.click(within(header).getByRole('button', { name: '会話メニュー' }));
    const menu = screen.getByRole('dialog', { name: '会話メニュー' });
    expect(within(menu).getByRole('button', { name: '再同期' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: '停止' })).toBeNull();
    const details = container.querySelector<HTMLDetailsElement>('.remote-session-details');
    expect(details?.open).toBe(false);
    fireEvent.click(within(menu).getByRole('button', { name: '閉じる' }));
    fireEvent.click(within(header).getByRole('button', { name: '← 会話一覧' }));
    expect(screen.getByRole('region', { name: '会話一覧' })).toBeInTheDocument();
  });

  it('preserves composer focus on send pointerdown and dismisses the keyboard without sending or discarding a draft', () => {
    const controller = demoController();
    const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    const { container } = openConversation(controller);
    const input = screen.getByLabelText('Hermesへのメッセージ');
    fireEvent.change(input, { target: { value: 'DEMO 日本語の下書き' } });
    act(() => input.focus());
    expect(container.querySelector('.remote-app')).toHaveAttribute('data-editing', 'true');
    expect(screen.getByRole('button', { name: 'キーボードを閉じる' })).toBeInTheDocument();
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('button', { name: '送信' }), event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(controller.store.getState().draft).toBe('DEMO 日本語の下書き');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'キーボードを閉じる' }));
    expect(document.activeElement).not.toBe(input);
    expect(container.querySelector('.remote-app')).toHaveAttribute('data-editing', 'false');
    expect(controller.store.getState().draft).toBe('DEMO 日本語の下書き');
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'キーボードを閉じる' })).toBeNull();
  });

  it('starts at one row, caps long drafts, and shrinks again', () => {
    openConversation(demoController());
    const input = screen.getByLabelText('Hermesへのメッセージ') as HTMLTextAreaElement;
    expect(input.rows).toBe(1);
    Object.defineProperty(input, 'scrollHeight', { value: 1000, configurable: true });
    fireEvent.change(input, { target: { value: 'DEMO\n'.repeat(80) } });
    expect(Number.parseFloat(input.style.height)).toBeLessThanOrEqual(160);
    expect(Number.parseFloat(input.style.height)).toBeGreaterThan(100);
    Object.defineProperty(input, 'scrollHeight', { value: 28, configurable: true });
    fireEvent.change(input, { target: { value: '' } });
    expect(Number.parseFloat(input.style.height)).toBe(44);
  });

  it('keeps keyboard-dismiss reachable when focus moves from input to the control', () => {
    const controller = demoController();
    const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    openConversation(controller);
    const input = screen.getByLabelText('Hermesへのメッセージ');
    fireEvent.change(input, { target: { value: 'DEMO keyboard navigation' } });
    act(() => input.focus());
    const dismiss = screen.getByRole('button', { name: 'キーボードを閉じる' });
    act(() => dismiss.focus());
    expect(document.activeElement).toBe(dismiss);
    expect(dismiss).toBeInTheDocument();
    fireEvent.click(dismiss);
    expect(screen.queryByRole('button', { name: 'キーボードを閉じる' })).toBeNull();
    expect(controller.store.getState().draft).toBe('DEMO keyboard navigation');
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not mistake focus or pinch zoom for a software keyboard', async () => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: window.innerHeight, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    openConversation(demoController());
    act(() => screen.getByLabelText('Hermesへのメッセージ').focus());
    expect(document.documentElement.dataset.remoteKeyboard).toBe('false');
    Object.assign(viewport, { height: window.innerHeight - 300 });
    await act(async () => { viewport.dispatchEvent(new Event('resize')); await new Promise(resolve => window.requestAnimationFrame(resolve)); });
    expect(document.documentElement.dataset.remoteKeyboard).toBe('true');
    Object.assign(viewport, { scale: 2 });
    await act(async () => { viewport.dispatchEvent(new Event('resize')); await new Promise(resolve => window.requestAnimationFrame(resolve)); });
    expect(document.documentElement.dataset.remoteKeyboard).toBe('false');
    cleanup();
    expect(document.documentElement.dataset.remoteKeyboard).toBeUndefined();
  });

  it('reserves a real body line and measured controls before growing a six-line draft', () => {
    const controller = demoController();
    controller.store.setState({ generationAllowed: false, generationReason: 'DEMO 生成は未許可。理由はスクロールして確認できます。',
      requests: [{ id: 'DEMO-budget', key: 'string:DEMO-budget', profile: 'default', sessionId: 'DEMO-live', method: 'approval',
        status: 'pending', params: { command: 'DEMO harmless', choices: ['once', 'deny'] } }] });
    const { container } = openConversation(controller);
    const section = container.querySelector<HTMLElement>('.remote-conversation')!;
    const heading = container.querySelector<HTMLElement>('.remote-chat-heading')!;
    const dock = container.querySelector<HTMLElement>('.remote-composer-dock')!;
    const form = container.querySelector<HTMLElement>('.remote-composer')!;
    const actions = container.querySelector<HTMLElement>('.remote-composer-actions')!;
    const context = container.querySelector<HTMLElement>('.remote-composer-context')!;
    const transcript = container.querySelector<HTMLElement>('.remote-transcript')!;
    const input = screen.getByLabelText('Hermesへのメッセージ') as HTMLTextAreaElement;
    document.documentElement.style.fontSize = '16px';
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 280));
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 56));
    vi.spyOn(actions, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 340, 48));
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 340, 32));
    const request = context.querySelector<HTMLElement>('.remote-action-required')!;
    vi.spyOn(request, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 340, 46));
    dock.style.padding = '4px 12px 8px'; form.style.padding = '8px 12px'; form.style.border = '1px solid black';
    actions.style.marginTop = '4px'; context.style.minHeight = '46px'; transcript.style.padding = '8px 16px 16px';
    input.style.lineHeight = '24px'; input.style.padding = '4px 0';
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(context, 'scrollHeight', { configurable: true, value: 140 });
    fireEvent.change(input, { target: { value: 'DEMO 日本語\n'.repeat(6) } });
    expect(Number.parseFloat(input.style.height)).toBe(45);
    expect(context.style.getPropertyValue('--remote-context-max-height')).toBe('46px');
    expect(controller.store.getState().draft).toBe('DEMO 日本語\n'.repeat(6));
    expect(context).toHaveAttribute('tabindex', '0');
    expect(context.firstElementChild).toBe(request);
    document.documentElement.style.removeProperty('font-size');
  });

  it('includes the bounded search region in the editor budget and keeps its query in memory', () => {
    const controller = demoController();
    controller.store.setState({ generationAllowed: false, generationReason: 'DEMO readonly caption' });
    const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    const { container } = openConversation(controller);
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
    fireEvent.click(screen.getByRole('button', { name: 'この会話を検索' }));
    const section = container.querySelector<HTMLElement>('.remote-conversation')!;
    const heading = container.querySelector<HTMLElement>('.remote-chat-heading')!;
    const search = container.querySelector<HTMLElement>('.remote-chat-search')!;
    const searchRow = container.querySelector<HTMLElement>('.remote-search-input')!;
    const form = container.querySelector<HTMLElement>('.remote-composer')!;
    const actions = container.querySelector<HTMLElement>('.remote-composer-actions')!;
    const context = container.querySelector<HTMLElement>('.remote-composer-context')!;
    const transcript = container.querySelector<HTMLElement>('.remote-transcript')!;
    const input = screen.getByLabelText('Hermesへのメッセージ') as HTMLTextAreaElement;
    const priorFont = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = '16px';
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 280));
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 44));
    vi.spyOn(actions, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 340, 48));
    vi.spyOn(searchRow, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 340, 44));
    vi.spyOn(search, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 390,
      Number.parseFloat(search.style.getPropertyValue('--remote-search-max-height')) || 134));
    search.style.padding = '8px 12px'; search.style.borderBottom = '1px solid black';
    form.parentElement!.style.padding = '2px 12px 4px'; form.style.padding = '6px 12px'; form.style.border = '1px solid black';
    actions.style.marginTop = '4px'; transcript.style.padding = '2px 16px 4px';
    const info = context.querySelector<HTMLElement>('p.remote-meta')!;
    info.style.fontSize = '13px'; info.style.lineHeight = '20px'; info.style.margin = '2px 0';
    input.style.lineHeight = '24px'; input.style.padding = '4px 0';
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(context, 'scrollHeight', { configurable: true, value: 70 });
    Object.defineProperty(search, 'scrollHeight', { configurable: true, value: 134 });
    fireEvent.change(screen.getByLabelText('会話内の検索語'), { target: { value: 'DEMO query' } });
    fireEvent.change(input, { target: { value: 'DEMO 日本語\n'.repeat(6) } });
    expect(search.style.getPropertyValue('--remote-search-min-height')).toBe('61px');
    expect(search.style.getPropertyValue('--remote-search-max-height')).toBe('63px');
    expect(Number.parseFloat(input.style.height)).toBe(44);
    expect(screen.getByLabelText('会話内の検索語')).toHaveValue('DEMO query');
    expect(controller.store.getState().draft).toBe('DEMO 日本語\n'.repeat(6));
    expect(submit).not.toHaveBeenCalled();
    document.documentElement.style.fontSize = priorFont;
  });

  it('uses the existing new-message action inside the compact control row without submitting the draft', () => {
    const controller = demoController();
    controller.store.setState({ draft: 'DEMO keep draft' });
    const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    const { container } = openConversation(controller);
    const transcript = container.querySelector<HTMLElement>('.remote-transcript')!;
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 300 });
    transcript.scrollTop = 50; fireEvent.scroll(transcript);
    act(() => controller.store.setState({ messages: [{ id: 'DEMO-new-layout', role: 'assistant', text: 'DEMO new text' }] }));
    const newer = screen.getByRole('button', { name: '新着を表示' });
    expect(newer).toHaveAttribute('type', 'button');
    expect(newer.closest('.remote-composer-actions')).not.toBeNull();
    fireEvent.click(newer);
    expect(transcript.scrollTo).toHaveBeenCalledWith({ top: 1000 });
    expect(controller.store.getState().draft).toBe('DEMO keep draft');
    expect(submit).not.toHaveBeenCalled();
  });

  it('preserves a reader position when the transcript is resized', () => {
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const schedule = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = ++nextFrame; frames.set(id, callback); return id;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); act(() => callbacks.forEach(callback => callback(0))); };
    let onResize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { onResize = callback; }
      observe() { /* Layout-only observer. */ }
      disconnect = disconnect;
    });
    const { container } = openConversation(demoController());
    const transcript = container.querySelector<HTMLElement>('.remote-transcript')!;
    Object.defineProperty(transcript, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(transcript, 'clientHeight', { value: 300, configurable: true });
    const scroll = vi.spyOn(transcript, 'scrollTo');
    scroll.mockClear();
    transcript.scrollTop = 50;
    fireEvent.scroll(transcript);
    act(() => onResize?.());
    flush();
    expect(scroll).not.toHaveBeenCalled();
    transcript.scrollTop = 700;
    fireEvent.scroll(transcript);
    schedule.mockClear();
    act(() => { onResize?.(); onResize?.(); });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(scroll).not.toHaveBeenCalled();
    // A reader may move up after resize delivery but before its scheduled frame.
    transcript.scrollTop = 50;
    fireEvent.scroll(transcript);
    flush();
    expect(scroll).not.toHaveBeenCalled();
    transcript.scrollTop = 700;
    fireEvent.scroll(transcript);
    act(() => onResize?.());
    flush();
    expect(scroll).toHaveBeenCalledWith({ top: 1000 });
    scroll.mockClear();
    act(() => onResize?.());
    const pendingFrame = nextFrame;
    cleanup();
    expect(disconnect).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(pendingFrame);
    expect(frames.size).toBe(0);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('preserves the message and fractional reading offset after root text enlargement', async () => {
    const previousFont = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = '16px';
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = ++nextFrame; frames.set(id, callback); return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    vi.stubGlobal('ResizeObserver', class {
      observe() { /* The font change also needs handling when container height is unchanged. */ }
      disconnect() { /* No browser layout in this fixture. */ }
    });
    const controller = demoController();
    controller.store.setState({ draft: 'DEMO 下書きを保つ', messages: [{ id: 'DEMO-anchor', role: 'assistant', text: 'DEMO 読んでいる本文' }] });
    try {
      const { container } = openConversation(controller);
      const transcript = container.querySelector<HTMLElement>('.remote-transcript')!;
      const message = container.querySelector<HTMLElement>('[data-message-id="DEMO-anchor"]')!;
      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 4000 });
      Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 300 });
      vi.spyOn(transcript, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 390, 300));
      vi.spyOn(message, 'getBoundingClientRect').mockImplementation(() => {
        const enlarged = document.documentElement.style.fontSize === '32px';
        return new DOMRect(0, 100 + (enlarged ? 1200 : 600) - transcript.scrollTop, 390, enlarged ? 400 : 200);
      });
      transcript.scrollTop = 660;
      fireEvent.scroll(transcript);
      await act(async () => {
        document.documentElement.style.fontSize = '32px';
        await new Promise(resolve => window.setTimeout(resolve, 0));
      });
      const scheduled = [...frames.values()]; frames.clear();
      act(() => scheduled.forEach(callback => callback(0)));
      expect(transcript.scrollTop).toBe(1320);
      const rect = message.getBoundingClientRect();
      expect((100 - rect.top) / rect.height).toBeCloseTo(.3, 6);
      expect(controller.store.getState().draft).toBe('DEMO 下書きを保つ');
    } finally {
      cleanup(); document.documentElement.style.fontSize = previousFont;
    }
  });

  it('does not follow a resize after search opens before the frame', () => {
    let onResize: (() => void) | undefined;
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1; });
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { onResize = callback; }
      observe() { /* Layout-only observer. */ }
      disconnect() { /* Layout-only observer. */ }
    });
    const controller = demoController();
    const submit = vi.spyOn(controller, 'submit').mockResolvedValue(undefined);
    const { container } = openConversation(controller);
    const transcript = container.querySelector<HTMLElement>('.remote-transcript')!;
    const scroll = vi.spyOn(transcript, 'scrollTo');
    scroll.mockClear();
    act(() => onResize?.());
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
    fireEvent.click(screen.getByRole('button', { name: 'この会話を検索' }));
    act(() => frame?.(0));
    expect(scroll).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
