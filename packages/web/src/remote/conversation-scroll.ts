export interface ConversationPosition {
  bottom: boolean;
  messageId: string | null;
  fraction: number;
  scrollTop: number;
}
export interface ConversationScrollMemory { scope: string; position: ConversationPosition }

/** Memory-only visual anchor, including an offset inside a long message. */
export function captureConversationPosition(node: HTMLDivElement): ConversationPosition {
  const edge = node.getBoundingClientRect().top;
  const message = [...node.querySelectorAll<HTMLElement>('[data-message-id]')]
    .find(item => item.getBoundingClientRect().bottom > edge + 1);
  const rect = message?.getBoundingClientRect();
  return { bottom: node.scrollHeight - node.scrollTop - node.clientHeight < 70,
    messageId: message?.dataset.messageId ?? null,
    fraction: rect?.height ? (edge - rect.top) / rect.height : 0, scrollTop: node.scrollTop };
}
export function restoreConversationPosition(node: HTMLDivElement, position: ConversationPosition): void {
  if (position.bottom) { node.scrollTo({ top: node.scrollHeight }); return; }
  const message = [...node.querySelectorAll<HTMLElement>('[data-message-id]')]
    .find(item => item.dataset.messageId === position.messageId);
  if (message) {
    const rect = message.getBoundingClientRect();
    node.scrollTop += rect.top - node.getBoundingClientRect().top + position.fraction * rect.height;
  } else node.scrollTop = position.scrollTop;
}

/** Reveal a match inside bounded code/table overflow, then move only the transcript. */
export function scrollConversationHit(node: HTMLDivElement, mark: HTMLElement): void {
  const local = mark.closest<HTMLElement>('pre, table');
  if (local) {
    const bounds = local.getBoundingClientRect();
    const match = mark.getBoundingClientRect();
    if (match.top < bounds.top || match.bottom > bounds.bottom) local.scrollTop += match.top - bounds.top - 24;
    if (match.left < bounds.left || match.right > bounds.right) local.scrollLeft += match.left - bounds.left - 12;
  }
  node.scrollTo({ top: node.scrollTop + mark.getBoundingClientRect().top - node.getBoundingClientRect().top - 24 });
}
