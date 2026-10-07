import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toHast } from 'mdast-util-to-hast';
import { createMarkdownSnapshot, findSearchHits, insertQuickText, prepareSearchIndex, searchHighlight, QUICK_TEXTS } from './chat-content';
import type { RemoteMessage } from '../../../core/src/stores/remote';

const message = (text: string, id = 'DEMO-a'): RemoteMessage => ({ id, role: 'assistant', text });
describe('bounded memory-only chat utilities', () => {
  it('finds Japanese, literal regex symbols and inline Markdown without treating input as code', () => {
    const index = prepareSearchIndex([message('日本語 **の回答**\n\n[a.*](https://example.invalid)\n\n```text\na.* 日本語\n```'),
      { id: 'DEMO-system', role: 'system', text: '日本語 system private' }, { id: 'DEMO-tool', role: 'tool', text: '日本語 tool private' }]);
    expect(index.documents).toHaveLength(1);
    expect(findSearchHits(index, '日本語').hits).toHaveLength(2);
    expect(findSearchHits(index, 'a.*').hits).toHaveLength(2);
    expect(findSearchHits(index, '日本語 の回答').hits).toHaveLength(1);
    expect(findSearchHits(index, '不存在').hits).toHaveLength(0);
    expect(findSearchHits(index, '').hits).toHaveLength(0);
    expect(findSearchHits(prepareSearchIndex([message('![日本語の代替ラベル](https://untrusted.invalid/DEMO.png)')]), '日本語').hits).toHaveLength(1);
  });
  it('bounds visible messages, source characters, query and matches; evicts old cache entries', () => {
    const cache = new Map();
    const index = prepareSearchIndex(Array.from({ length: 405 }, (_, i) => message('DEMO '.repeat(2000), `DEMO-${i}`)), cache);
    expect(index.limited).toBe(true);
    expect(index.characters).toBeLessThanOrEqual(500_000);
    expect(cache.has('DEMO-0')).toBe(false);
    const result = findSearchHits(index, 'DEMO');
    expect(result.hits).toHaveLength(200); expect(result.limited).toBe(true);
    expect(prepareSearchIndex([message('x'.repeat(80_010))]).limited).toBe(true);
    prepareSearchIndex([message('DEMO changed')], cache);
    expect(cache.size).toBe(1);
  });
  it('marks text nodes without inserting HTML or changing text/code/link content', () => {
    const source = '**日本語**\n\n```text\n日本語 <script>\n```\n\n[日本語](javascript:alert(1))';
    const hits = findSearchHits(prepareSearchIndex([message(source)]), '日本語').hits;
    const tree = toHast(fromMarkdown(source));
    if (tree.type !== 'root') throw new Error('DEMO Markdown must produce a root');
    const before = JSON.stringify(tree);
    searchHighlight(hits, 1)()(tree);
    const after = JSON.stringify(tree);
    expect(after).toContain('mark'); expect(after).toContain('remote-search-active');
    expect(after).not.toContain('"type":"raw"');
    const text = (node: { type: string; value?: string; children?: unknown[] }): string => node.type === 'text' ? node.value || ''
      : (node.children || []).map(child => text(child as Parameters<typeof text>[0])).join('');
    expect(text(tree)).toBe(text(JSON.parse(before) as Parameters<typeof text>[0]));
  });
  it('inserts the four fixed templates without replacing or sending the draft', () => {
    expect(QUICK_TEXTS).toHaveLength(4);
    expect(insertQuickText('前\n後', QUICK_TEXTS[0].text, 2)).toEqual({ draft: `前\n${QUICK_TEXTS[0].text}後`, caret: 2 + QUICK_TEXTS[0].text.length });
    expect(insertQuickText('前', '後')).toEqual({ draft: '前後', caret: 2 });
    expect(insertQuickText('前', '後', Number.NaN).draft).toBe('前後');
  });
  it('exports a frozen UTF-8 Markdown snapshot without internal metadata or non-chat roles', () => {
    const messages: RemoteMessage[] = [{ id: 'DEMO-secret-id', role: 'user', text: '日本語\n改行' },
      message('```js\nconst text = "日本語";\n```'), { id: 'DEMO-s', role: 'system', text: 'DEMO private system prompt' },
      { id: 'DEMO-t', role: 'tool', text: '/root/private DEMO secret tool https://gateway.invalid' }];
    const snapshot = createMarkdownSnapshot(messages, new Date('2026-10-04T04:05:00Z'));
    expect(snapshot.count).toBe(2); expect(snapshot.error).toBeNull();
    expect(snapshot.filename).toBe('hermes-chat-20261004-0405.md');
    expect(snapshot.content).toContain('現在取得済みの会話');
    expect(snapshot.content).toContain('2026-10-04T04:05:00.000Z');
    expect(snapshot.content).toContain('日本語\n改行'); expect(snapshot.content).toContain('```js\nconst text = "日本語";\n```');
    for (const excluded of ['DEMO-secret-id', 'private system', '/root/private', 'gateway.invalid']) expect(snapshot.content).not.toContain(excluded);
    messages[0]!.text = 'DEMO later changed'; expect(snapshot.content).not.toContain('later changed');
    expect(snapshot.bytes).toBe(new TextEncoder().encode(snapshot.content).byteLength);
  });
  it('rejects an oversized export instead of silently saving a partial file and discloses display limits', () => {
    const oversized = createMarkdownSnapshot([message('日'.repeat(400_000))], new Date());
    expect(oversized.content).toBe(''); expect(oversized.error).toContain('1MiB'); expect(oversized.limited).toBe(true);
    const limited = createMarkdownSnapshot(Array.from({ length: 401 }, (_, i) => message('DEMO', `DEMO-${i}`)), new Date());
    expect(limited.count).toBe(401); expect(limited.content).toContain('画面の表示上限');
    const partial = createMarkdownSnapshot([message('DEMO interrupted')], new Date(), true);
    expect(partial.partial).toBe(true); expect(partial.content).toContain('生成途中の発言');
  });
});
