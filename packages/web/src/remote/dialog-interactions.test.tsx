import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function(this: HTMLDialogElement) { this.open = false; } });
  const bounds = new DOMRect(0, 0, 44, 44);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => Object.assign([bounds], {
    item: (index: number) => index === 0 ? bounds : null,
  }) as unknown as DOMRectList);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('dialog interaction continuity', () => {
  it('returns to the original trigger after a menu is replaced by another panel', () => {
    function Shell() {
      const [stage, setStage] = useState('closed');
      return <><button onClick={() => setStage('menu')}>会話メニューを開く</button>
        {stage === 'menu' && <ConfirmDialog label="DEMOメニュー" onDismiss={() => setStage('closed')}>
          <button data-dialog-initial-focus onClick={() => setStage('panel')}>情報を見る</button>
        </ConfirmDialog>}
        {stage === 'panel' && <ConfirmDialog label="DEMO情報" onDismiss={() => setStage('closed')}>
          <button data-dialog-initial-focus onClick={() => setStage('closed')}>情報を閉じる</button>
        </ConfirmDialog>}</>;
    }
    render(<Shell />);
    const trigger = screen.getByRole('button', { name: '会話メニューを開く' }); trigger.focus(); fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '情報を見る' }));
    expect(screen.getByRole('button', { name: '情報を閉じる' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '情報を閉じる' }));
    expect(trigger).toHaveFocus();
  });

  it('returns an inner dialog to its connected outer trigger', () => {
    function Shell() {
      const [inner, setInner] = useState(false);
      return <ConfirmDialog label="DEMO外側" onDismiss={vi.fn()}>
        <button data-dialog-initial-focus onClick={() => setInner(true)}>内側を開く</button>
        {inner && <ConfirmDialog label="DEMO内側" onDismiss={() => setInner(false)}>
          <button data-dialog-initial-focus onClick={() => setInner(false)}>内側を閉じる</button>
        </ConfirmDialog>}
      </ConfirmDialog>;
    }
    render(<Shell />); const trigger = screen.getByRole('button', { name: '内側を開く' });
    trigger.focus(); fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: '内側を閉じる' }));
    expect(trigger).toHaveFocus();
  });

  it('blocks native dismiss while a write is pending and permits it after resolution', () => {
    const dismiss = vi.fn();
    const view = render(<ConfirmDialog label="DEMO処理中" onDismiss={dismiss} dismissDisabled><button>取消</button></ConfirmDialog>);
    const event = new Event('cancel', { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('dialog', { name: 'DEMO処理中' }), event);
    expect(event.defaultPrevented).toBe(true); expect(dismiss).not.toHaveBeenCalled();
    view.rerender(<ConfirmDialog label="DEMO処理中" onDismiss={dismiss} dismissDisabled={false}><button>取消</button></ConfirmDialog>);
    fireEvent(screen.getByRole('dialog', { name: 'DEMO処理中' }), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('preserves an IME composition when native Escape would cancel the dialog', () => {
    const dismiss = vi.fn();
    render(<ConfirmDialog label="DEMO入力" onDismiss={dismiss}><textarea aria-label="本文" defaultValue={'日本語\n下書き'} /></ConfirmDialog>);
    const input = screen.getByLabelText('本文'); fireEvent.compositionStart(input);
    fireEvent(screen.getByRole('dialog', { name: 'DEMO入力' }), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(dismiss).not.toHaveBeenCalled(); expect(input).toHaveValue('日本語\n下書き');
    fireEvent.compositionEnd(input);
    fireEvent(screen.getByRole('dialog', { name: 'DEMO入力' }), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('moves through action buttons without activating one or touching a text field', () => {
    const action = vi.fn();
    render(<ConfirmDialog label="DEMO操作一覧" onDismiss={vi.fn()} actionNavigation>
      <button data-dialog-initial-focus>閉じる</button><button className="remote-menu-action" onClick={action}>検索</button>
      <button className="remote-menu-action" disabled>未対応</button><button className="remote-menu-action" onClick={action}>情報</button>
      <input aria-label="検索語" defaultValue="日本語" />
    </ConfirmDialog>);
    fireEvent.keyDown(screen.getByRole('button', { name: '閉じる' }), { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: '検索' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); expect(screen.getByRole('button', { name: '情報' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' }); expect(screen.getByRole('button', { name: '検索' })).toHaveFocus();
    const input = screen.getByLabelText('検索語'); input.focus(); fireEvent.keyDown(input, { key: 'End' }); expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(input).toHaveValue('日本語'); expect(action).not.toHaveBeenCalled();
  });

  it('dismisses a backdrop tap but preserves backdrop drags and inner clicks', () => {
    const dismiss = vi.fn();
    render(<ConfirmDialog label="DEMO外側タップ" onDismiss={dismiss} dismissOnBackdrop><button>本文の操作</button></ConfirmDialog>);
    const dialog = screen.getByRole('dialog', { name: 'DEMO外側タップ' });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 50, 200, 200));
    fireEvent.pointerDown(dialog, { clientX: 10, clientY: 10, pointerId: 1 }); fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(dismiss).toHaveBeenCalledTimes(1); dismiss.mockClear();
    fireEvent.pointerDown(dialog, { clientX: 10, clientY: 10, pointerId: 1 }); fireEvent.click(dialog, { clientX: 30, clientY: 30 });
    fireEvent.pointerDown(dialog, { clientX: 100, clientY: 100, pointerId: 1 }); fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    fireEvent.pointerDown(dialog, { clientX: 10, clientY: 10, pointerId: 1 }); fireEvent.pointerCancel(dialog); fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(dismiss).not.toHaveBeenCalled();
  });
});
