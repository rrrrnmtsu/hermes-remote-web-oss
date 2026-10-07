import { fromMarkdown } from 'mdast-util-from-markdown';
import { toHast } from 'mdast-util-to-hast';
import type { Root, Element, Text, ElementContent } from 'hast';
import type { RemoteMessage } from '../../../core/src/stores/remote';

export const DISPLAY_MESSAGE_LIMIT = 400;
export const DISPLAY_TEXT_LIMIT = 80_000;
export const SEARCH_CHARACTER_LIMIT = 500_000;
export const SEARCH_MATCH_LIMIT = 200;
export const SEARCH_QUERY_LIMIT = 200;
export const EXPORT_BYTE_LIMIT = 1_048_576;
export const QUICK_TEXTS = [
  { label: '要約', text: '要点を3つにまとめてください。' },
  { label: '判断', text: '結論・根拠・リスク・次の行動に分けて整理してください。' },
  { label: '手順', text: '実施手順と、それぞれの確認方法を示してください。' },
  { label: '調査のみ', text: '変更操作は行わず、現状と問題点を整理してください。' },
] as const;

interface TextLeaf { node: Text; parent: Root | Element; start: number; end: number }
const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote']);
/** The same safe Markdown tree and offsets are used for matching and React marks. */
function textLeaves(tree: Root): { text: string; leaves: TextLeaf[] } {
  let text = '';
  const leaves: TextLeaf[] = [];
  const visit = (parent: Root | Element): void => {
    for (const node of parent.children) {
      if (node.type === 'text') {
        const start = text.length;
        text += node.value;
        leaves.push({ node, parent, start, end: text.length });
      } else if (node.type === 'element') {
        if (node.tagName === 'img') {
          // Match the existing safe image label; never render or fetch the source URL.
          const alt = typeof node.properties.alt === 'string' ? node.properties.alt : '';
          node.tagName = 'span'; node.properties = {};
          node.children = [{ type: 'text', value: `画像: ${alt || '表示対象外'}` }];
        }
        visit(node);
        if (node.tagName === 'br' || blocks.has(node.tagName)) text += '\n';
      }
    }
  };
  visit(tree);
  return { text, leaves };
}
export interface SearchDocument { messageId: string; text: string; source: string }
export interface SearchIndex { documents: SearchDocument[]; limited: boolean; characters: number }
export interface SearchHit { messageId: string; start: number; end: number; order: number }
export function prepareSearchIndex(messages: RemoteMessage[], cache: Map<string, SearchDocument> = new Map()): SearchIndex {
  const documents: SearchDocument[] = [];
  let characters = 0;
  let limited = messages.length > DISPLAY_MESSAGE_LIMIT;
  for (const message of messages.slice(-DISPLAY_MESSAGE_LIMIT)) {
    if (!['user', 'assistant'].includes(message.role) || !message.text) continue;
    const source = message.text.slice(0, DISPLAY_TEXT_LIMIT);
    if (characters + source.length > SEARCH_CHARACTER_LIMIT) { limited = true; break; }
    characters += source.length;
    limited ||= message.text.length > DISPLAY_TEXT_LIMIT;
    let document = cache.get(message.id);
    if (!document || document.source !== source) {
      document = { messageId: message.id, source, text: textLeaves(toHast(fromMarkdown(source)) as Root).text };
      cache.set(message.id, document);
    }
    documents.push(document);
  }
  const retained = new Set(documents.map(document => document.messageId));
  for (const key of cache.keys()) if (!retained.has(key)) cache.delete(key);
  return { documents, limited, characters };
}
export function findSearchHits(index: SearchIndex, query: string): { hits: SearchHit[]; limited: boolean } {
  const needle = query.slice(0, SEARCH_QUERY_LIMIT);
  const hits: SearchHit[] = [];
  if (!needle) return { hits, limited: index.limited };
  for (const document of index.documents) {
    let offset = 0;
    while (offset < document.text.length) {
      const start = document.text.indexOf(needle, offset);
      if (start < 0) break;
      if (hits.length === SEARCH_MATCH_LIMIT) return { hits, limited: true };
      hits.push({ messageId: document.messageId, start, end: start + needle.length, order: hits.length });
      offset = start + needle.length;
    }
  }
  return { hits, limited: index.limited };
}
/** Split text nodes only: no raw HTML, URL rewrite, or changed copy content. */
export function searchHighlight(hits: SearchHit[], active: number) {
  return () => (tree: Root): void => {
    for (const leaf of textLeaves(tree).leaves) {
      const matches = hits.filter(hit => hit.start < leaf.end && hit.end > leaf.start);
      if (!matches.length) continue;
      const replacement: ElementContent[] = [];
      let cursor = 0;
      for (const hit of matches) {
        const start = Math.max(0, hit.start - leaf.start);
        const end = Math.min(leaf.node.value.length, hit.end - leaf.start);
        if (start > cursor) replacement.push({ type: 'text', value: leaf.node.value.slice(cursor, start) });
        replacement.push({ type: 'element', tagName: 'mark', properties: { 'data-chat-hit': hit.order,
          className: hit.order === active ? ['remote-search-active'] : [] }, children: [{ type: 'text', value: leaf.node.value.slice(start, end) }] });
        cursor = end;
      }
      if (cursor < leaf.node.value.length) replacement.push({ type: 'text', value: leaf.node.value.slice(cursor) });
      const position = leaf.parent.children.indexOf(leaf.node);
      leaf.parent.children.splice(position, 1, ...replacement);
    }
  };
}

export function insertQuickText(draft: string, text: string, position?: number): { draft: string; caret: number } {
  const at = typeof position === 'number' && Number.isFinite(position) ? Math.max(0, Math.min(draft.length, position)) : draft.length;
  return { draft: draft.slice(0, at) + text + draft.slice(at), caret: at + text.length };
}
export interface MarkdownSnapshot { content: string; count: number; bytes: number; filename: string; limited: boolean; partial: boolean; error: string | null }
export function createMarkdownSnapshot(messages: RemoteMessage[], exportedAt: Date, partial = false): MarkdownSnapshot {
  const stamp = exportedAt.toISOString();
  const filename = `hermes-chat-${stamp.slice(0, 10).replaceAll('-', '')}-${stamp.slice(11, 16).replace(':', '')}.md`;
  const selected = messages.filter(message => message.role === 'user' || message.role === 'assistant');
  const limited = messages.length > DISPLAY_MESSAGE_LIMIT || selected.some(message => message.text.length > DISPLAY_TEXT_LIMIT);
  const header = `# Hermesの会話\n\n取得範囲: 現在取得済みの会話（全履歴の保証はありません）\nエクスポート時刻: ${stamp}\n発言数: ${selected.length}\n${limited ? '画面の表示上限を超える取得済み本文を含みます。未取得の履歴は含みません。\n' : ''}${partial ? '停止・失敗した時点の本文です。生成途中の発言を含む可能性があります。\n' : ''}\n`;
  let bytes = new TextEncoder().encode(header).byteLength;
  const sections = [header];
  for (const message of selected) {
    const section = `## ${message.role === 'user' ? 'あなた' : 'Hermes'}\n\n${message.text}\n\n`;
    bytes += new TextEncoder().encode(section).byteLength;
    if (bytes > EXPORT_BYTE_LIMIT) return { content: '', count: selected.length, bytes, filename, limited, partial, error: '保存上限1MiBを超えています。全文のファイルは生成しません。必要な発言をメッセージ操作からコピーしてください。' };
    sections.push(section);
  }
  return { content: sections.join(''), count: selected.length, bytes, filename, limited, partial, error: null };
}
