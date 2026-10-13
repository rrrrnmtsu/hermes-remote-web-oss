import { ConfirmDialog } from './ConfirmDialog';
import type { ConversationOutline as Outline, OutlineEntry } from './chat-outline';

export function ConversationOutline({ outline, canReturn, error, onDismiss, onJump, onReturn }: {
  outline: Outline; canReturn: boolean; error: string;
  onDismiss(): void; onJump(entry: OutlineEntry): void; onReturn(): void;
}) {
  return <ConfirmDialog label="この会話の目次" className="remote-sheet remote-outline" actionNavigation dismissOnBackdrop onDismiss={onDismiss}>
    <div className="remote-sheet-heading"><h2>この会話の目次</h2><button data-dialog-initial-focus onClick={onDismiss}>閉じる</button></div>
    <p className="remote-meta">読み込み済みの質問と回答見出し · {outline.entries.length}件。開いた時点の内容です。</p>
    <p className="remote-meta">選ぶと本文へ移動します。会話メニューから移動前の位置へ戻れます。見出しのない回答と未取得の履歴は含みません。</p>
    {outline.limited && <p className="remote-meta" role="status">範囲打切り：表示中の最新400発言の先頭から本文50万文字・各8万文字・目次200件までです。</p>}
    {canReturn && <button className="remote-menu-action" onClick={onReturn}>移動前の位置へ戻る</button>}
    {error && <p role="alert">{error}</p>}
    {!outline.entries.length && <p>この範囲には質問や回答見出しがありません。</p>}
    <ol className="remote-outline-list">{outline.entries.map((entry, index) => <li key={`${index}:${entry.messageId}`}>
      <button className="remote-menu-action remote-outline-entry" aria-label={`${entry.role === 'user' ? 'あなたの質問' : `Hermes · 見出し${entry.level}`} ${entry.label}`} onClick={() => onJump(entry)}>
        <span className="remote-meta">{entry.role === 'user' ? 'あなたの質問' : `Hermes · 見出し${entry.level}`}</span>
        <span>{entry.label}</span>
      </button>
    </li>)}</ol>
  </ConfirmDialog>;
}
