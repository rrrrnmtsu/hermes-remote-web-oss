import { describe, expect, it } from 'vitest';
import { createConversationOutline, findOutlineTarget } from './chat-outline';
import type { RemoteMessage } from '../../../core/src/stores/remote';

const message = (text: string, id = 'DEMO-a', role = 'assistant'): RemoteMessage => ({ id, role, text });
describe('loaded conversation outline', () => {
  it('lists plain question excerpts and real Markdown headings in reading order', () => {
    const result = createConversationOutline([
      message('日本語**の質問**\n改行 🙂', 'DEMO-q', 'user'),
      message('# 結論 **日本語**\n\n本文\n\n## 同名\n\n> ### 同名\n\n```md\n# code is not a heading\n```\n\n次の手順\n---'),
      message('本文のみ'), message('# system secret', 'DEMO-s', 'system'), message('# tool secret', 'DEMO-t', 'tool'),
    ]);
    expect(result.entries.map(entry => entry.label)).toEqual(['日本語の質問 改行 🙂', '結論 日本語', '同名', '同名', '次の手順']);
    expect(result.entries.map(entry => entry.heading)).toEqual([null, 0, 1, 2, 3]);
    expect(result.entries.map(entry => entry.level)).toEqual([0, 1, 2, 3, 2]);
    expect(result.limited).toBe(false);
  });
  it('ignores HTML, never extracts destinations and retains visible image alternatives', () => {
    const result = createConversationOutline([message('<h1>hidden</h1>\n\n# [リンク](javascript:alert(1)) ![説明](https://example.invalid/private.png)\n\n###')]);
    expect(result.entries.map(entry => entry.label)).toEqual(['リンク 画像: 説明', '見出し（本文なし）']);
    expect(JSON.stringify(result)).not.toMatch(/javascript|private.png|hidden/);
  });
  it('bounds message, character, entry and excerpt work; snapshots do not change with new text', () => {
    const messages = [message('日'.repeat(130), 'DEMO-q', 'user')];
    const result = createConversationOutline(messages);
    expect(result.entries[0]?.label).toBe('日'.repeat(120) + '…');
    messages[0]!.text = 'DEMO changed'; expect(result.entries[0]?.label).not.toContain('changed');
    const headings = createConversationOutline([message('## 項目\n\n'.repeat(201))]);
    expect(headings.entries).toHaveLength(200); expect(headings.limited).toBe(true);
    const many = createConversationOutline(Array.from({ length: 405 }, (_, i) => message('DEMO ' + i, String(i), 'user')));
    expect(many.entries[0]?.messageId).toBe('5'); expect(many.limited).toBe(true);
    const huge = createConversationOutline(Array.from({ length: 10 }, (_, i) => message('a'.repeat(80_010), String(i))));
    expect(huge.characters).toBe(500_000); expect(huge.limited).toBe(true);
    expect(createConversationOutline([]).entries).toEqual([]);
  });
  it('finds duplicate headings by ordinal, excludes controls and treats IDs as data', () => {
    const transcript = document.createElement('div'), article = document.createElement('article');
    article.dataset.messageId = 'DEMO-"] #unsafe'; transcript.append(article);
    const controls = document.createElement('h2'); controls.textContent = 'control'; article.append(controls);
    const body = document.createElement('div'); body.className = 'remote-message-content'; article.append(body);
    const first = document.createElement('h2'), second = document.createElement('h2');
    first.textContent = second.textContent = '同名'; body.append(first, second);
    const entry = { messageId: article.dataset.messageId, role: 'assistant' as const, level: 2, label: '同名', heading: 1 };
    expect(findOutlineTarget(transcript, entry)).toBe(second);
    expect(findOutlineTarget(transcript, { ...entry, heading: null })).toBe(body);
    expect(findOutlineTarget(transcript, { ...entry, heading: 2 })).toBeNull();
    expect(findOutlineTarget(transcript, { ...entry, messageId: 'other scope' })).toBeNull();
    second.textContent = '生成完了時に変わった見出し';
    expect(findOutlineTarget(transcript, entry)).toBeNull();
  });
});
