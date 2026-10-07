import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('safe dialog focus and nested event scope', () => {
  it('defaults to the dialog, even when an unmarked write button requested autofocus', () => {
    const write = vi.fn();
    render(<ConfirmDialog label="DEMO確認" onDismiss={vi.fn()}><button autoFocus onClick={write}>書込みを実行</button></ConfirmDialog>);
    const dialog = screen.getByRole('dialog', { name: 'DEMO確認' });
    expect(dialog).toHaveFocus(); fireEvent.keyDown(dialog, { key: 'Enter' }); expect(write).not.toHaveBeenCalled();
  });

  it('uses the explicit safe control and returns focus to the still-connected trigger', () => {
    function Shell() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>開く</button>{open && <ConfirmDialog label="DEMO明示確認" onDismiss={() => setOpen(false)}>
        <button>実行</button><button data-dialog-initial-focus onClick={() => setOpen(false)}>戻る</button>
      </ConfirmDialog>}</>;
    }
    render(<Shell />); const trigger = screen.getByRole('button', { name: '開く' }); trigger.focus(); fireEvent.click(trigger);
    const cancel = screen.getByRole('button', { name: '戻る' }); expect(cancel).toHaveFocus(); fireEvent.click(cancel);
    expect(trigger).toHaveFocus();
  });

  it('preserves an explicitly focused text editor and its selection', () => {
    render(<ConfirmDialog label="DEMO編集" onDismiss={vi.fn()}><textarea autoFocus aria-label="合成下書き" defaultValue="DEMO 日本語" /></ConfirmDialog>);
    const input = screen.getByLabelText('合成下書き') as HTMLTextAreaElement;
    expect(input).toHaveFocus(); input.setSelectionRange(2, 5);
    expect(input.selectionStart).toBe(2); expect(input.selectionEnd).toBe(5); expect(input.value).toBe('DEMO 日本語');
  });

  it('handles Tab only in the innermost dialog, without focusing a background control', () => {
    const bounds = new DOMRect(0, 0, 44, 44);
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => Object.assign([bounds], {
      item: (index: number) => index === 0 ? bounds : null,
    }) as unknown as DOMRectList);
    render(<ConfirmDialog label="DEMO外側" onDismiss={vi.fn()}><button>背景操作</button>
      <ConfirmDialog label="DEMO内側" onDismiss={vi.fn()}><button data-dialog-initial-focus>内側の戻る</button></ConfirmDialog>
    </ConfirmDialog>);
    const inner = screen.getByRole('button', { name: '内側の戻る' }), outer = screen.getByRole('button', { name: '背景操作' });
    inner.focus(); const outerFocus = vi.spyOn(outer, 'focus'), innerFocus = vi.spyOn(inner, 'focus');
    fireEvent.keyDown(inner, { key: 'Tab' });
    expect(inner).toHaveFocus(); expect(innerFocus).toHaveBeenCalledTimes(1); expect(outerFocus).not.toHaveBeenCalled();
  });

  it('does not dismiss an ancestor when a nested cancel event bubbles through React', () => {
    const outside = vi.fn(), inside = vi.fn();
    render(<ConfirmDialog label="DEMO外側取消" onDismiss={outside}>
      <ConfirmDialog label="DEMO内側取消" onDismiss={inside}><button>戻る</button></ConfirmDialog>
    </ConfirmDialog>);
    fireEvent(screen.getByRole('dialog', { name: 'DEMO内側取消' }), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(inside).toHaveBeenCalledTimes(1); expect(outside).not.toHaveBeenCalled();
  });
});
