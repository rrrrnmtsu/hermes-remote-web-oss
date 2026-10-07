import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { RemoteMessage } from '../../../core/src/stores/remote';
import { ConfirmDialog } from './ConfirmDialog';
import { RemoteIcon } from './RemoteIcon';
import { safeMarkdownUrl } from './safe-markdown';
import { searchHighlight, type SearchHit, DISPLAY_TEXT_LIMIT } from './chat-content';
import { captureQuote, type QuoteCandidate } from './quote-content';

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = useRef<HTMLPreElement>(null);
  const [feedback, setFeedback] = useState('');
  return <div className="remote-code-block">
    <div className="remote-code-actions" data-quote-exclude><button type="button" aria-label="コードをコピー" onClick={() => {
      if (!navigator.clipboard) { setFeedback('コピーできません'); return; }
      void navigator.clipboard.writeText(code.current?.textContent || '').then(() => setFeedback('コピーしました'), () => setFeedback('コピーできません'));
    }}>コピー</button><span role="status">{feedback}</span></div>
    <pre ref={code}>{children}</pre>
  </div>;
}

// Stable component types keep native pointer targets and pending copy feedback
// connected when composer focus, a stream or parent callbacks rerender.
const markdownComponents: Components = {
  a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children} ↗</a> : <span>{children}</span>,
  img: ({ alt }) => <span>画像: {alt || '表示対象外'}</span>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

export const ChatMessage = memo(function ChatMessage({ message, searchHits = [], activeHit = -1, quoteScope = '', onQuote, onBranch, onReadAloud }: {
  message: RemoteMessage; searchHits?: SearchHit[]; activeHit?: number; quoteScope?: string; onQuote?(candidate: QuoteCandidate): void;
  onBranch?(mode: 'branch' | 'edit' | 'regenerate'): void;
  onReadAloud?(): void;
}) {
  const [actions, setActions] = useState(false);
  const [feedback, setFeedback] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const candidate = useRef<QuoteCandidate | null>(null);
  const capture = (): void => {
    candidate.current = body.current && ['user', 'assistant'].includes(message.role) ? captureQuote(body.current, quoteScope, message.id) : null;
  };
  const highlights = useMemo(() => searchHits.length ? [searchHighlight(searchHits, activeHit)] : [], [searchHits, activeHit]);
  const label = message.role === 'user' ? 'あなた' : message.role === 'assistant' ? 'Hermes' : message.role === 'tool' ? 'ツール' : 'システム';
  return <article className={`remote-message remote-message-${message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system'}`}
    aria-label={`${label}のメッセージ`} data-message-id={message.id}>
    <div className="remote-message-body">
      {message.role !== 'user' && message.role !== 'assistant' && <p className="remote-meta">{label}</p>}
      {message.role === 'tool' ? <details><summary>ツールログ</summary><pre>{message.text.slice(0, 12000)}</pre>
        {message.text.length > 12000 && <p>12,000文字で表示を省略しています。</p>}</details>
        : <div ref={body} className="remote-message-content"><ReactMarkdown skipHtml urlTransform={safeMarkdownUrl} rehypePlugins={highlights} components={markdownComponents}>{message.text.slice(0, DISPLAY_TEXT_LIMIT)}</ReactMarkdown></div>}
      {message.role !== 'tool' && message.text.length > 80000 && <p>表示は80,000文字で省略しています。全文はHermes側で確認してください。</p>}
    </div>
    <button className="remote-message-more remote-icon-button" aria-label={`${label}のメッセージ操作`}
      onPointerDown={capture} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') capture(); }}
      onClick={() => { if (!candidate.current) capture(); setFeedback(''); setActions(true); }}>
      <RemoteIcon name="more" />
    </button>
    {actions && <ConfirmDialog label="メッセージの操作" className="remote-sheet" actionNavigation dismissOnBackdrop onDismiss={() => { setActions(false); candidate.current = null; }}>
      <div className="remote-sheet-heading"><h2>メッセージの操作</h2><button autoFocus data-dialog-initial-focus onClick={() => { setActions(false); candidate.current = null; }}>閉じる</button></div>
      <button className="remote-menu-action" aria-label="メッセージをコピー" onClick={() => {
        if (!navigator.clipboard) { setFeedback('このブラウザではコピーできません。本文を選択してください。'); return; }
        void navigator.clipboard.writeText(message.text).then(() => setFeedback('コピーしました'), () => setFeedback('コピーできません。本文を選択してください。'));
      }}>コピー</button>
      {onQuote && ['user', 'assistant'].includes(message.role) && <button className="remote-menu-action" disabled={!candidate.current?.text}
        onClick={() => { const frozen = candidate.current; setActions(false); candidate.current = null; if (frozen) onQuote(frozen); }}>引用して質問</button>}
      <p className="remote-meta" role="status">{feedback}</p>
      {onReadAloud && ['user', 'assistant'].includes(message.role) && <button className="remote-menu-action" onClick={() => { setActions(false); onReadAloud(); }}>端末で読み上げ</button>}
      {onBranch && Number.isSafeInteger(Number(message.id)) && Number(message.id) > 0 && ['user', 'assistant'].includes(message.role) && <>
        <button className="remote-menu-action" onClick={() => { setActions(false); onBranch('branch'); }}>ここから分岐</button>
        <button className="remote-menu-action" onClick={() => { setActions(false); onBranch(message.role === 'user' ? 'edit' : 'regenerate'); }}>{message.role === 'user' ? '編集して分岐' : '再生成用に分岐'}</button>
      </>}
    </ConfirmDialog>}
  </article>;
});
