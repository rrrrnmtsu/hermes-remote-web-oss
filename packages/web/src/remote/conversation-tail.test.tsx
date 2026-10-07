import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { Conversation } from './Conversation';
import type { ConversationScrollMemory } from './conversation-scroll';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture() {
  const callbacks: FrameRequestCallback[] = [];
  const sampledText: string[] = [];
  const selectedEnds: number[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  let resize: (() => void) | undefined;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() { /* Real geometry is supplied explicitly in this regression. */ }
    disconnect() { /* Cleanup must not schedule another frame. */ }
  });
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  const controller = new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('DEMO layout never connects'); }, withOperationLock: async action => action() });
  controller.store.setState({ connection: 'connected', generationAllowed: false, profile: 'default', liveId: 'DEMO-live', durableId: 'DEMO-durable',
    draft: 'DEMO\n日本語の下書き', messages: [{ id: 'DEMO-message', role: 'assistant', text: 'DEMO synthetic answer' }] });
  const scrollMemory = { current: null as ConversationScrollMemory | null };
  const renderState = () => <Conversation state={controller.store.getState()} controller={controller} scrollMemory={scrollMemory} onBack={() => undefined}
    onRequests={() => undefined} onSidebar={() => undefined} onComposerFocus={() => undefined} />;
  const view = render(renderState());
  const transcript = view.container.querySelector<HTMLDivElement>('.remote-transcript')!;
  transcript.style.padding = '2px 16px 4px';
  Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 415 });
  Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 33 });
  vi.spyOn(transcript, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 390, 33));
  const content = view.container.querySelector<HTMLElement>('.remote-message-content')!;
  content.style.lineHeight = '25.6px';
  vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => new DOMRect(16, 370 - transcript.scrollTop, 326, 20));
  const rangeRects = vi.fn(() => [content.getBoundingClientRect()]);
  vi.spyOn(document, 'createRange').mockImplementation(() => ({
    selectNodeContents: (text: Node) => { sampledText.push(text.textContent || ''); selectedEnds.push(text.textContent?.length || 0); },
    setStart: vi.fn(),
    setEnd: (_text: Node, offset: number) => { selectedEnds.push(offset); }, detach: vi.fn(),
    getClientRects: rangeRects,
  }) as unknown as Range);
  const scroll = vi.spyOn(transcript, 'scrollTo').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') transcript.scrollTop = Math.max(0, Math.min(options.top || 0, transcript.scrollHeight - transcript.clientHeight));
  });
  scroll.mockClear();
  const flush = () => { const frames = callbacks.splice(0); act(() => frames.forEach(callback => callback(0))); };
  return { controller, transcript, content, scrollMemory, scroll, sampledText, selectedEnds, rangeRects, resize: () => resize?.(), flush, rerender: () => view.rerender(renderState()) };
}

describe('following a readable conversation tail', () => {
  it('keeps a body line in view when margins, message buttons or tools extend the physical end beyond the body', () => {
    const f = fixture();
    f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript);
    act(f.resize); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    expect(f.content.getBoundingClientRect().bottom).toBe(129);
    expect(f.controller.store.getState().draft).toBe('DEMO\n日本語の下書き');
  });

  it('continues following new text from the corrected tail without treating its trailing space as unread history', () => {
    const f = fixture();
    f.transcript.scrollTop = 261; fireEvent.scroll(f.transcript);
    act(() => { f.controller.store.setState({ messages: [{ id: 'DEMO-message', role: 'assistant', text: 'DEMO synthetic answer continues' }] }); f.rerender(); });
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    expect(screen.queryByRole('button', { name: '新着を表示' })).toBeNull();
  });

  it('does not reposition a reader or search, and the explicit new-text action resumes the same readable tail', () => {
    const f = fixture();
    f.transcript.scrollTop = 20; fireEvent.scroll(f.transcript);
    act(f.resize); f.flush(); expect(f.scroll).not.toHaveBeenCalled();
    act(() => { f.controller.store.setState({ messages: [{ id: 'DEMO-message', role: 'assistant', text: 'DEMO arrived during reading' }] }); f.rerender(); });
    expect(f.scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '新着を表示' }));
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 }); f.scroll.mockClear();
    act(f.resize);
    fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
    fireEvent.click(screen.getByRole('button', { name: 'この会話を検索' }));
    f.flush(); expect(f.scroll).not.toHaveBeenCalled();
    expect(f.controller.store.getState().draft).toBe('DEMO\n日本語の下書き');
  });

  it('retains follow intent when resize reports an unchanged old position before its observer frame', () => {
    const f = fixture();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 400));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 400 });
    f.transcript.scrollTop = 15; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    f.scroll.mockClear();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 33));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 33 });
    // Native resize retains the old end. It is not a user reading movement.
    fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    // A distinct movement before the frame still immediately stops following.
    f.scroll.mockClear(); act(f.resize); f.transcript.scrollTop = 20; fireEvent.scroll(f.transcript); f.flush();
    expect(f.scroll).not.toHaveBeenCalled();
  });

  it('keeps follow intent through text/font reflow that changes extent without changing the transcript box', () => {
    const f = fixture(); f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    expect(f.transcript.scrollTop).toBe(261); f.scroll.mockClear();
    Object.defineProperty(f.transcript, 'scrollHeight', { configurable: true, value: 1015 });
    vi.mocked(f.content.getBoundingClientRect).mockImplementation(() => new DOMRect(16, 880 - f.transcript.scrollTop, 326, 20));
    // A native reflow leaves the old end unchanged before the observer frame.
    fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 771 });
    // A different movement during another extent change remains user reading.
    f.scroll.mockClear();
    Object.defineProperty(f.transcript, 'scrollHeight', { configurable: true, value: 1200 });
    f.transcript.scrollTop = 200; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    expect(f.scroll).not.toHaveBeenCalled();
    expect(f.controller.store.getState().draft).toBe('DEMO\n日本語の下書き');
  });

  it('preserves tail intent across native caret movement during the bounded composer allocation', () => {
    const f = fixture();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 300));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 300 });
    f.transcript.scrollTop = 115; fireEvent.scroll(f.transcript); act(f.resize); f.flush(); f.scroll.mockClear();
    Object.defineProperty(screen.getByRole('textbox'), 'scrollHeight', { configurable: true, get: () => {
      f.transcript.scrollTop = 103; return 152;
    } });
    act(() => { f.controller.store.setState({ draft: 'DEMO enlarged\n日本語\n三行目\n四行目' }); f.rerender(); });
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 100));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 100 });
    // The native caret reveal moves twelve pixels before the pending frame.
    // Its new distance to the physical end exceeds the reader threshold.
    f.transcript.scrollTop = 103; fireEvent.scroll(f.transcript); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 194 });
    expect(f.controller.store.getState().draft).toBe('DEMO enlarged\n日本語\n三行目\n四行目');
  });

  it.each(['wheel', 'touchmove', 'pointer', 'key'] as const)('lets explicit %s reading veto allocation-owned tail following', gesture => {
    const f = fixture();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 300));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 300 });
    f.transcript.scrollTop = 115; fireEvent.scroll(f.transcript); act(f.resize); f.flush(); f.scroll.mockClear();
    act(() => { f.controller.store.setState({ draft: 'DEMO enlarged\n日本語' }); f.rerender(); });
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 100));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 100 });
    if (gesture === 'wheel') fireEvent.wheel(f.transcript, { deltaY: -100 });
    if (gesture === 'touchmove') fireEvent.touchMove(f.content);
    if (gesture === 'pointer') fireEvent.pointerDown(f.transcript);
    if (gesture === 'key') fireEvent.keyDown(f.transcript, { key: 'PageUp' });
    f.transcript.scrollTop = 103; fireEvent.scroll(f.transcript); f.flush();
    expect(f.scroll).not.toHaveBeenCalled();
    expect(f.transcript.scrollTop).toBe(103);
  });

  it('recognizes only the observed temporary textarea-measurement clamp when the final transcript box is unchanged', () => {
    const f = fixture(); f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    f.scroll.mockClear();
    const input = screen.getByRole('textbox');
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => {
      // Measuring the collapsed textarea temporarily enlarges the transcript,
      // so native scroll clamping moves its end before the final box returns.
      f.transcript.scrollTop = 153; return 152;
    } });
    act(() => { f.controller.store.setState({ draft: 'DEMO measuring\n日本語' }); f.rerender(); });
    fireEvent.scroll(f.transcript); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    f.scroll.mockClear();
    act(() => { f.controller.store.setState({ draft: 'DEMO second measurement' }); f.rerender(); });
    // A different programmatic reading movement has no allocation witness.
    f.transcript.scrollTop = 100; fireEvent.scroll(f.transcript); f.flush();
    expect(f.scroll).not.toHaveBeenCalled();
    expect(f.transcript.scrollTop).toBe(100);
  });

  it('keeps an explicit near-tail wheel veto through both allocation frames', () => {
    const f = fixture(); f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    f.scroll.mockClear();
    act(() => { f.controller.store.setState({ draft: 'DEMO changed draft' }); f.rerender(); });
    fireEvent.wheel(f.transcript, { deltaY: -12 }); f.transcript.scrollTop = 249; fireEvent.scroll(f.transcript);
    f.flush(); f.flush();
    expect(f.scroll).not.toHaveBeenCalled();
    expect(f.transcript.scrollTop).toBe(249);
  });

  it('does not apply a pending allocation frame after the conversation unmounts', () => {
    const f = fixture(); f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    act(() => { f.controller.store.setState({ draft: 'DEMO closing scope' }); f.rerender(); });
    f.scroll.mockClear(); cleanup(); f.flush(); f.flush();
    expect(f.scroll).not.toHaveBeenCalled();
  });

  it.each(['tail', 'reader'] as const)('preserves the last %s intent when teardown geometry changes before storing the scope anchor', intent => {
    const f = fixture(); f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush(); f.flush();
    if (intent === 'reader') { f.transcript.scrollTop = 20; fireEvent.scroll(f.transcript); }
    // Switching to the list changes layout before the old layout cleanup.
    // This is not a scroll or an instruction to enter another reading mode.
    Object.defineProperty(f.transcript, 'scrollHeight', { configurable: true, value: 10015 });
    vi.mocked(f.content.getBoundingClientRect).mockImplementation(() => new DOMRect(16, 8800 - f.transcript.scrollTop, 326, 20));
    cleanup();
    expect(f.scrollMemory.current?.position.bottom).toBe(intent === 'tail');
    expect(f.scrollMemory.current?.scope).toBe('default:DEMO-live');
    expect(f.controller.store.getState().draft).toBe('DEMO\n日本語の下書き');
  });

  it.each(['gesture', 'search'] as const)('does not store tail intent when %s is pending at teardown', veto => {
    const f = fixture(); f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush(); f.flush();
    if (veto === 'gesture') fireEvent.wheel(f.transcript, { deltaY: -10 });
    else {
      fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
      fireEvent.click(screen.getByRole('button', { name: 'この会話を検索' }));
    }
    // No subsequent scroll event or frame has reached its handler yet.
    cleanup();
    expect(f.scrollMemory.current?.position.bottom).toBe(false);
    expect(f.controller.store.getState().draft).toBe('DEMO\n日本語の下書き');
  });

  it('does not restore a reader anchor into a different conversation scope', () => {
    const f = fixture(); f.transcript.scrollTop = 20; fireEvent.scroll(f.transcript); cleanup();
    expect(f.scrollMemory.current?.position.bottom).toBe(false);
    act(() => { f.controller.store.setState({ profile: 'DEMO-other', liveId: 'DEMO-other-live', durableId: 'DEMO-other-durable',
      draft: 'DEMO 別会話の下書き', messages: [{ id: 'DEMO-other-message', role: 'assistant', text: 'DEMO 別会話本文' }] }); });
    const scroll = vi.mocked(HTMLElement.prototype.scrollTo); scroll.mockClear();
    render(<Conversation state={f.controller.store.getState()} controller={f.controller} scrollMemory={f.scrollMemory}
      onBack={() => undefined} onRequests={() => undefined} onSidebar={() => undefined} onComposerFocus={() => undefined} />);
    expect(scroll).toHaveBeenCalledWith({ top: 0 });
    expect(screen.getByRole('textbox')).toHaveValue('DEMO 別会話の下書き');
    expect(screen.queryByText('DEMO synthetic answer')).toBeNull();
  });

  it('expires ordinary wheel intent before a later root text-size change and retains the reader anchor', async () => {
    const f = fixture(), originalFont = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = '16px';
    const article = f.transcript.querySelector<HTMLElement>('[data-message-id]')!;
    Object.defineProperty(f.transcript, 'scrollHeight', { configurable: true, value: 3000 });
    vi.spyOn(article, 'getBoundingClientRect').mockImplementation(() => {
      const enlarged = document.documentElement.style.fontSize === '32px';
      return new DOMRect(16, 100 + (enlarged ? 1200 : 600) - f.transcript.scrollTop, 326, enlarged ? 400 : 200);
    });
    f.flush(); f.flush();
    fireEvent.wheel(f.transcript, { deltaY: -100 }); f.transcript.scrollTop = 650; fireEvent.scroll(f.transcript);
    f.flush(); f.flush(); f.scroll.mockClear();
    await act(async () => { document.documentElement.style.fontSize = '32px'; await new Promise(resolve => setTimeout(resolve, 0)); });
    f.flush(); f.flush();
    expect(f.transcript.scrollTop).toBe(1300);
    expect(f.scroll).not.toHaveBeenCalled();
    document.documentElement.style.fontSize = originalFont;
  });

  it('reveals a slightly clipped text line on allocation while retaining the same reader message and draft', () => {
    const f = fixture();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 300));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(f.transcript, 'scrollHeight', { configurable: true, value: 3000 });
    const article = f.transcript.querySelector<HTMLElement>('[data-message-id]')!;
    vi.spyOn(article, 'getBoundingClientRect').mockImplementation(() => new DOMRect(16, 700 - f.transcript.scrollTop, 326, 240));
    vi.mocked(f.content.getBoundingClientRect).mockImplementation(() => new DOMRect(16, 761 - f.transcript.scrollTop, 326, 20));
    f.transcript.scrollTop = 650; fireEvent.scroll(f.transcript); f.scroll.mockClear();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 33));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 33 });
    act(f.resize); f.flush();
    expect(f.transcript.scrollTop).toBe(652);
    expect(f.content.getBoundingClientRect().bottom).toBe(129);
    expect(f.scroll).not.toHaveBeenCalled();
    expect(f.controller.store.getState().draft).toBe('DEMO\n日本語の下書き');
  });

  it('fully reveals fractional clipping even when native scrolling quantizes offsets to CSS pixels', () => {
    const f = fixture(); let offset = 650;
    Object.defineProperty(f.transcript, 'scrollTop', { configurable: true, get: () => offset, set: value => { offset = Math.floor(value); } });
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 300));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(f.transcript, 'scrollHeight', { configurable: true, value: 3000 });
    const article = f.transcript.querySelector<HTMLElement>('[data-message-id]')!;
    vi.spyOn(article, 'getBoundingClientRect').mockImplementation(() => new DOMRect(16, 700 - offset, 326, 240));
    vi.mocked(f.content.getBoundingClientRect).mockImplementation(() => new DOMRect(16, 760.96875 - offset, 326, 20));
    fireEvent.scroll(f.transcript);
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 33));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 33 });
    act(f.resize); f.flush();
    expect(f.transcript.scrollTop).toBe(652);
    expect(f.content.getBoundingClientRect().bottom).toBeLessThanOrEqual(129);
  });

  it.each(['gesture', 'search', 'larger-clip'] as const)('does not apply the reader-line adjustment during %s', mode => {
    const f = fixture();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 300));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(f.transcript, 'scrollHeight', { configurable: true, value: 3000 });
    const article = f.transcript.querySelector<HTMLElement>('[data-message-id]')!;
    vi.spyOn(article, 'getBoundingClientRect').mockImplementation(() => new DOMRect(16, 700 - f.transcript.scrollTop, 326, 240));
    vi.mocked(f.content.getBoundingClientRect).mockImplementation(() => new DOMRect(16, (mode === 'larger-clip' ? 771 : 761) - f.transcript.scrollTop, 326, 20));
    f.transcript.scrollTop = 650; fireEvent.scroll(f.transcript); f.scroll.mockClear();
    if (mode === 'search') {
      fireEvent.click(screen.getByRole('button', { name: '会話メニュー' }));
      fireEvent.click(screen.getByRole('button', { name: 'この会話を検索' }));
    }
    if (mode === 'gesture') fireEvent.wheel(f.transcript, { deltaY: -1 });
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 33));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 33 });
    act(f.resize); f.flush();
    expect(f.transcript.scrollTop).toBe(650);
    expect(f.scroll).not.toHaveBeenCalled();
  });

  it('realigns one late caret scroll after composer allocation and rechecks a reader before the follow-up', () => {
    const f = fixture(); f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    act(() => { f.controller.store.setState({ draft: 'DEMO changed draft' }); f.rerender(); });
    f.flush(); f.scroll.mockClear();
    f.transcript.scrollTop = 248; fireEvent.scroll(f.transcript); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    act(() => { f.controller.store.setState({ draft: 'DEMO another change' }); f.rerender(); });
    f.flush(); f.scroll.mockClear(); f.transcript.scrollTop = 20; fireEvent.scroll(f.transcript); f.flush();
    expect(f.scroll).not.toHaveBeenCalled();
    expect(f.controller.store.getState().draft).toBe('DEMO another change');
  });

  it('does not follow the space/tab-only rows after the final code characters or alter the original code', () => {
    const f = fixture(), original = 'DEMO synthetic answer\n   \n\t\n  \n';
    f.content.textContent = original;
    f.rangeRects.mockImplementation(() => {
      const body = f.content.getBoundingClientRect();
      return f.selectedEnds.at(-1) === original.trimEnd().length ? [body]
        : [body, new DOMRect(16, body.top + 80, 16, body.height)];
    });
    f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    expect(f.selectedEnds).toContain(original.trimEnd().length);
    expect(f.content.textContent).toBe(original);
    expect(f.controller.store.getState().draft).toBe('DEMO\n日本語の下書き');
  });

  it('uses the collapsed tool summary and never hidden tool text or action labels as a tail', () => {
    const f = fixture();
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'DEMO visible tool summary';
    const hidden = document.createElement('pre'); hidden.textContent = 'DEMO hidden tool details';
    details.append(summary, hidden); f.content.replaceChildren(details);
    const button = document.createElement('button'); button.textContent = 'DEMO action label'; f.content.append(button);
    f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    expect(f.sampledText).toContain('DEMO visible tool summary');
    expect(f.sampledText).not.toContain('DEMO hidden tool details');
    expect(f.sampledText).not.toContain('DEMO action label');
  });

  it('uses the preceding readable text when the final inline decoration has an oversized native range', () => {
    const f = fixture();
    const body = document.createElement('span'); body.textContent = 'DEMO readable link';
    const decoration = document.createElement('span'); decoration.textContent = ' ↗';
    f.content.replaceChildren(body, decoration);
    f.rangeRects.mockImplementation(() => f.sampledText.at(-1) === ' ↗'
      ? [new DOMRect(16, 375 - f.transcript.scrollTop, 20, 52)]
      : [f.content.getBoundingClientRect()]);
    f.transcript.scrollTop = 382; fireEvent.scroll(f.transcript); act(f.resize); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 261 });
    expect(f.content.getBoundingClientRect().bottom).toBe(129);
    expect(f.content.textContent).toBe('DEMO readable link ↗');
  });

  it('preserves the physical end when the viewport has room for the body and its trailing controls', () => {
    const f = fixture();
    vi.mocked(f.transcript.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 390, 400));
    Object.defineProperty(f.transcript, 'clientHeight', { configurable: true, value: 400 });
    f.transcript.scrollTop = 15; fireEvent.scroll(f.transcript);
    act(f.resize); f.flush();
    expect(f.scroll).toHaveBeenLastCalledWith({ top: 415 });
  });
});
