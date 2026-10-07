import { insertQuickText } from './chat-content';

export const QUOTE_CHARACTER_LIMIT = 8_000;
export interface QuoteCandidate {
  scope: string;
  messageId: string;
  text: string;
  selected: boolean;
  limited: boolean;
  characters: number;
  selectionRejected?: boolean;
}
const excluded = '[data-quote-exclude], button, [hidden], [aria-hidden="true"], script, style';
const blocks = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE']);

/** Project displayed text only, retaining block/code newlines without action labels. */
function displayedText(root: Node): string {
  let result = '';
  let addedBreak = false;
  const visit = (node: Node): void => {
    if (node instanceof Element && node.matches(excluded)) return;
    if (node.nodeType === Node.TEXT_NODE) { result += node.textContent || ''; addedBreak = false; return; }
    if (node instanceof Element && node.tagName === 'BR') { result += '\n'; addedBreak = false; }
    node.childNodes.forEach(visit);
    if (node instanceof Element && blocks.has(node.tagName) && !result.endsWith('\n')) { result += '\n'; addedBreak = true; }
  };
  visit(root);
  return addedBreak ? result.slice(0, -1) : result;
}
export function captureQuote(body: HTMLElement, scope: string, messageId: string, selection = window.getSelection()): QuoteCandidate {
  let selected = false;
  let source: Node = body;
  if (selection && !selection.isCollapsed && selection.rangeCount === 1) {
    const range = selection.getRangeAt(0);
    const inside = (node: Node): boolean => body.contains(node) && !(node instanceof Element ? node : node.parentElement)?.closest(excluded);
    if (inside(range.startContainer) && inside(range.endContainer)) {
      source = range.cloneContents(); selected = true;
    }
  }
  const text = displayedText(source);
  const characters = Array.from(text);
  return { scope, messageId, text: characters.slice(0, QUOTE_CHARACTER_LIMIT).join(''),
    selected, selectionRejected: Boolean(selection && !selection.isCollapsed && !selected), limited: characters.length > QUOTE_CHARACTER_LIMIT, characters: characters.length };
}
export function insertQuote(draft: string, candidate: QuoteCandidate, position?: number): { draft: string; caret: number } {
  const text = `以下は会話からの引用です。\n${candidate.text.split('\n').map(line => `> ${line}`).join('\n')}\n\nこの部分について：`;
  const at = typeof position === 'number' ? Math.max(0, Math.min(draft.length, position)) : draft.length;
  const result = insertQuickText(draft, `${at && draft[at - 1] !== '\n' ? '\n\n' : ''}${text}${at < draft.length ? '\n\n' : ''}`, at);
  return { ...result, caret: result.caret - (at < draft.length ? 2 : 0) };
}
