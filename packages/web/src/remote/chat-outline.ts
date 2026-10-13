import { fromMarkdown } from 'mdast-util-from-markdown';
import { toHast } from 'mdast-util-to-hast';
import type { Root, Element, Text } from 'hast';
import type { RemoteMessage } from '../../../core/src/stores/remote';
import { DISPLAY_MESSAGE_LIMIT, DISPLAY_TEXT_LIMIT } from './chat-content';

export const OUTLINE_ENTRY_LIMIT = 200;
export const OUTLINE_CHARACTER_LIMIT = 500_000;
export interface OutlineEntry {
  messageId: string;
  role: 'user' | 'assistant';
  heading: number | null;
  level: number;
  label: string;
}
export interface ConversationOutline { entries: OutlineEntry[]; limited: boolean; characters: number }

function text(node: Root | Element | Text): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element' && node.tagName === 'img') return `画像: ${String(node.properties.alt || '表示対象外')}`;
  if (node.type === 'element' && node.tagName === 'br') return ' ';
  const content = node.children.map(child => ['text', 'element'].includes(child.type) ? text(child as Element | Text) : '').join('');
  return node.type === 'element' && /^(p|h[1-6]|li|pre|blockquote)$/.test(node.tagName) ? content + ' ' : content;
}
function label(value: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(clean);
  return characters.length > 120 ? characters.slice(0, 120).join('') + '…' : clean;
}

/** Frozen on explicit opening: no history fetch, network, storage or stream-time parsing. */
export function createConversationOutline(messages: readonly RemoteMessage[]): ConversationOutline {
  const result: ConversationOutline = { entries: [], limited: messages.length > DISPLAY_MESSAGE_LIMIT, characters: 0 };
  for (const message of messages.slice(-DISPLAY_MESSAGE_LIMIT)) {
    if (!['user', 'assistant'].includes(message.role) || !message.text) continue;
    const available = OUTLINE_CHARACTER_LIMIT - result.characters;
    if (available <= 0 || result.entries.length >= OUTLINE_ENTRY_LIMIT) { result.limited = true; break; }
    const source = message.text.slice(0, Math.min(DISPLAY_TEXT_LIMIT, available));
    result.characters += source.length;
    result.limited ||= source.length < message.text.length;
    const tree = toHast(fromMarkdown(source));
    if (tree.type !== 'root') continue;
    if (message.role === 'user') {
      const excerpt = label(text(tree));
      if (excerpt) result.entries.push({ messageId: message.id, role: 'user', heading: null, level: 0, label: excerpt });
    } else {
      let ordinal = 0;
      const visit = (node: Root | Element): void => {
        if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
          const heading = ordinal++;
          if (result.entries.length >= OUTLINE_ENTRY_LIMIT) { result.limited = true; return; }
          const title = label(text(node)) || '見出し（本文なし）';
          result.entries.push({ messageId: message.id, role: 'assistant', heading, level: Number(node.tagName[1]), label: title });
        }
        for (const child of node.children) if (child.type === 'element') visit(child);
      };
      visit(tree);
    }
  }
  return result;
}

/** IDs remain data; duplicate/untrusted heading labels never become selectors. */
export function findOutlineTarget(transcript: HTMLElement, entry: OutlineEntry): HTMLElement | null {
  const message = [...transcript.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === entry.messageId);
  const body = message?.querySelector<HTMLElement>('.remote-message-content');
  if (!body) return null;
  if (entry.heading === null) return body;
  const target = body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')[entry.heading];
  return target && (label(target.textContent || '') || '見出し（本文なし）') === entry.label ? target : null;
}
