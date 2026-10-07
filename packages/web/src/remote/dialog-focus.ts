const returnPaths = new WeakMap<HTMLDialogElement, readonly HTMLElement[]>();

/** Preserve the launch chain when a menu is replaced by another modal. */
export function captureDialogReturnPath(): HTMLElement[] {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return [];
  const path = [active];
  const owner = active.closest('dialog');
  if (owner instanceof HTMLDialogElement) {
    for (const target of returnPaths.get(owner) || []) {
      if (!path.includes(target) && path.length < 8) path.push(target);
    }
  }
  return path;
}

export function registerDialogReturnPath(dialog: HTMLDialogElement, path: readonly HTMLElement[]): void {
  returnPaths.set(dialog, path);
}

export function restoreDialogReturnPath(dialog: HTMLDialogElement, path: readonly HTMLElement[]): void {
  returnPaths.delete(dialog);
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
  const target = path.find(node => node.isConnected && !node.matches(':disabled, [aria-disabled="true"]') && !node.closest('[hidden], [inert]')
    && (!open || open.contains(node)));
  target?.focus({ preventScroll: true });
}

export function dialogControls(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(node => node.getClientRects().length > 0 && !node.closest('[hidden], [inert]') && node.closest('dialog') === dialog)
    .sort((left, right) => left === right ? 0 : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

/** Scroll the modal's own containers, never the page behind native modality. */
export function revealDialogControl(dialog: HTMLDialogElement, target: HTMLElement): void {
  for (let parent = target.parentElement, count = 0; parent && count < 8; parent = parent.parentElement, count++) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
      const view = parent.getBoundingClientRect(), box = target.getBoundingClientRect();
      if (box.bottom > view.bottom - 3) parent.scrollTop += box.bottom - view.bottom + 3;
      else if (box.top < view.top + 3) parent.scrollTop -= view.top - box.top + 3;
    }
    if (parent === dialog) break;
  }
}
