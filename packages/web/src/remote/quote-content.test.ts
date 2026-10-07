import { describe, expect, it } from 'vitest';
import { captureQuote, insertQuote } from './quote-content';

describe('memory-only displayed quote projection', () => {
  it('retains Japanese, code and line breaks, excluding buttons, hidden and unsafe nodes', () => {
    const body = document.createElement('div');
    body.innerHTML = '<p>日本語<mark>検索</mark><br>改行</p><div data-quote-exclude>コピー</div><pre><code>one\ntwo</code></pre><span hidden>hidden</span><script>bad()</script>';
    const quote = captureQuote(body, 'DEMO-scope', 'DEMO-id', null);
    expect(quote.text).toBe('日本語検索\n改行\none\ntwo');
    expect(quote.selected).toBe(false);
  });
  it('freezes an in-message selection before menu clears it, and refuses cross-message text', () => {
    const body = document.createElement('div'); body.textContent = '日本語\n固定選択';
    const other = document.createElement('div'); other.textContent = '他の発言';
    document.body.append(body, other);
    const selection = window.getSelection()!;
    const range = document.createRange(); range.setStart(body.firstChild!, 4); range.setEnd(body.firstChild!, 8);
    selection.removeAllRanges(); selection.addRange(range);
    const quote = captureQuote(body, 'DEMO-scope', 'DEMO-id');
    selection.removeAllRanges(); body.textContent = '後から届いた本文';
    expect(quote.text).toBe('固定選択'); expect(quote.selected).toBe(true);
    range.selectNodeContents(other); selection.addRange(range);
    expect(captureQuote(body, 'DEMO-scope', 'DEMO-id').text).toBe('後から届いた本文');
    selection.removeAllRanges(); body.remove(); other.remove();
  });
  it('limits by characters, without splitting surrogate pairs, explicitly recording omission', () => {
    const body = document.createElement('div'); body.textContent = '🗾'.repeat(8001);
    const quote = captureQuote(body, 'DEMO', 'DEMO', null);
    expect(Array.from(quote.text)).toHaveLength(8000); expect(quote.limited).toBe(true); expect(quote.characters).toBe(8001);
  });
  it('inserts plain untrusted text at the caret without replacing a selected draft', () => {
    const quote = { scope: 'DEMO', messageId: 'DEMO', selected: true, limited: false, characters: 8, text: '日本語\n<script>' };
    const result = insertQuote('前半後半', quote, 2);
    expect(result.draft).toBe('前半\n\n以下は会話からの引用です。\n> 日本語\n> <script>\n\nこの部分について：\n\n後半');
    expect(result.draft.slice(0, result.caret)).toContain('この部分について：');
    expect(insertQuote('元の下書き', quote).draft).toMatch(/^元の下書き/);
  });
  it('preserves meaningful indentation and explicitly selected newlines in code text', () => {
    const body = document.createElement('div'); body.textContent = '  日本語\n    code\n';
    expect(captureQuote(body, 'DEMO', 'DEMO', null).text).toBe('  日本語\n    code\n');
  });
});
