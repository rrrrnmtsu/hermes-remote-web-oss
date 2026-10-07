import { useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

export interface DraftSelection { start: number; end: number }
export function ExpandedEditor({ draft, selection, composing, onComposition, onDraft, onDismiss }: {
  draft: string; selection: MutableRefObject<DraftSelection | null>; composing: boolean;
  onComposition(value: boolean): void; onDraft(value: string): void; onDismiss(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = input.current;
    if (node) {
      node.focus({ preventScroll: true });
      node.setSelectionRange(selection.current?.start ?? node.value.length, selection.current?.end ?? node.value.length);
    }
  }, [selection]);
  const remember = (): void => {
    const node = input.current;
    if (node) selection.current = { start: node.selectionStart, end: node.selectionEnd };
  };
  return <ConfirmDialog label="拡大入力" className="remote-expanded-editor" dismissDisabled={composing} onDismiss={() => { if (!composing) onDismiss(); }}>
    <div className="remote-sheet-heading"><h2>入力欄を広げる</h2><button disabled={composing} onClick={onDismiss}>通常表示へ戻る</button></div>
    <label className="remote-sr-only" htmlFor="remote-expanded-input">拡大したメッセージ入力</label>
    <textarea autoFocus ref={input} id="remote-expanded-input" value={draft} aria-describedby="remote-expanded-hint"
      onSelect={remember} onBlur={remember} onChange={event => { onDraft(event.target.value); remember(); }}
      onCompositionStart={() => onComposition(true)} onCompositionEnd={() => onComposition(false)} />
    <div className="remote-editor-footer"><span role="status">{Array.from(draft).length.toLocaleString('ja-JP')}文字</span>
      <details><summary>入力の注意</summary><p id="remote-expanded-hint" className="remote-meta">下書きはメモリのみ。戻ってから送信。</p></details></div>
  </ConfirmDialog>;
}
