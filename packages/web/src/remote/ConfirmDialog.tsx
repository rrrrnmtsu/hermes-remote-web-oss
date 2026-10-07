import { useEffect, useRef, type ReactNode } from 'react';
import { captureDialogReturnPath, dialogControls, registerDialogReturnPath, restoreDialogReturnPath, revealDialogControl } from './dialog-focus';

/** Native modality plus explicit Tab cycling, Escape and return-to-trigger focus. */
export function ConfirmDialog({ label, onDismiss, children, className = '', dismissDisabled = false, actionNavigation = false, dismissOnBackdrop = false }: {
  label: string; onDismiss(): void; children: ReactNode; className?: string;
  dismissDisabled?: boolean; actionNavigation?: boolean; dismissOnBackdrop?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Capture before React applies autofocus inside the modal (WebKit otherwise restores body).
  const returnPath = useRef<HTMLElement[] | null>(null);
  if (!returnPath.current) returnPath.current = captureDialogReturnPath();
  const composing = useRef(false);
  const backdrop = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const node = dialog.current;
    const path = returnPath.current || [];
    if (node) registerDialogReturnPath(node, path);
    node?.showModal();
    if (node) {
      const explicit = node.querySelector<HTMLElement>('[data-dialog-initial-focus]');
      const active = document.activeElement;
      // Text editors retain their intended caret/keyboard. Other dialogs begin
      // at an explicit safe control, or the dialog itself, never a default write.
      const editing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
        && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(active.type);
      if (explicit) explicit.focus({ preventScroll: true });
      else if (!editing || !node.contains(active)) node.focus({ preventScroll: true });
    }
    return () => { node?.close(); if (node) restoreDialogReturnPath(node, path); };
  }, []);
  const outside = (node: HTMLDialogElement, x: number, y: number): boolean => {
    const box = node.getBoundingClientRect();
    return x < box.left || x > box.right || y < box.top || y > box.bottom;
  };
  return <dialog ref={dialog} tabIndex={-1} aria-label={label} aria-busy={dismissDisabled || undefined} className={`remote-confirm ${className}`}
    onCompositionStart={event => { if (event.target instanceof Element && event.target.closest('dialog') === event.currentTarget) composing.current = true; }}
    onCompositionEnd={event => { if (event.target instanceof Element && event.target.closest('dialog') === event.currentTarget) composing.current = false; }}
    onPointerDown={event => {
      backdrop.current = dismissOnBackdrop && !dismissDisabled && !composing.current && event.target === event.currentTarget
        && outside(event.currentTarget, event.clientX, event.clientY) ? { x: event.clientX, y: event.clientY } : null;
    }}
    onPointerCancel={() => { backdrop.current = null; }}
    onClick={event => {
      const start = backdrop.current; backdrop.current = null;
      if (start && dismissOnBackdrop && !dismissDisabled && !composing.current && event.target === event.currentTarget
        && outside(event.currentTarget, event.clientX, event.clientY) && Math.hypot(start.x - event.clientX, start.y - event.clientY) <= 8) onDismiss();
    }} onCancel={event => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    event.preventDefault(); if (!dismissDisabled && !composing.current) onDismiss();
  }}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || composing.current
        || !(event.target instanceof Element) || event.target.closest('dialog') !== event.currentTarget) return;
      const controls = dialogControls(event.currentTarget);
      if (actionNavigation && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && event.target.closest('button')) {
        const actions = controls.filter(node => node.matches('button.remote-menu-action, button.remote-quick-text'));
        if (actions.length) {
          const current = actions.indexOf(document.activeElement as HTMLElement);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
            : event.key === 'ArrowDown' ? (current + 1) % actions.length
            : current < 0 ? actions.length - 1 : (current - 1 + actions.length) % actions.length;
          event.preventDefault(); const target = actions[index];
          if (target) { target.focus({ preventScroll: true }); revealDialogControl(event.currentTarget, target); }
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); first.focus();
      }
    }}>{children}</dialog>;
}
