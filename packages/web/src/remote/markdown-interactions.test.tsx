import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('stable Markdown control interactions', () => {
  it('keeps a focused code-copy button connected across a parent callback render', async () => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const message = { id: 'DEMO-code', role: 'assistant' as const, text: '```js\nconst 日本語 = 1;\n```' };
    const view = render(<ChatMessage message={message} onQuote={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'コードをコピー' }); button.focus(); fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('const 日本語 = 1;\n');
    view.rerender(<ChatMessage message={message} onQuote={vi.fn()} />);
    expect(button.isConnected).toBe(true); expect(screen.getByRole('button', { name: 'コードをコピー' })).toBe(button);
    expect(button).toHaveFocus(); await act(async () => finish());
    expect(screen.getByText('コピーしました')).toBeInTheDocument();
  });
  it('keeps safe links and code content through a streamed-message rerender', () => {
    const text = '[DEMO](https://example.com) [unsafe](javascript:alert(1))\n```text\nDEMO\n日本語\n```';
    const view = render(<ChatMessage message={{ id: 'DEMO-stream', role: 'assistant', text }} />);
    const copy = screen.getByRole('button', { name: 'コードをコピー' });
    view.rerender(<ChatMessage message={{ id: 'DEMO-stream', role: 'assistant', text: text + '\n追記' }} />);
    expect(screen.getByRole('button', { name: 'コードをコピー' })).toBe(copy);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(view.container.querySelector('pre')?.textContent).toBe('DEMO\n日本語\n');
  });
});
