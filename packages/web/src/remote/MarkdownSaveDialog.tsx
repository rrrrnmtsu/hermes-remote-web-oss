import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import type { MarkdownSnapshot } from './chat-content';

export function MarkdownSaveDialog({ snapshot, onDismiss }: { snapshot: MarkdownSnapshot; onDismiss(): void }) {
  const url = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const [requested, setRequested] = useState(false);
  const [feedback, setFeedback] = useState('');
  const supported = typeof URL.createObjectURL === 'function' && typeof URL.revokeObjectURL === 'function'
    && 'download' in HTMLAnchorElement.prototype;
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);
  return <ConfirmDialog label="会話のMarkdown保存" className="remote-sheet" onDismiss={onDismiss}>
    <div className="remote-sheet-heading"><h2>会話をMarkdownで保存</h2><button data-dialog-initial-focus="" autoFocus onClick={onDismiss}>閉じる</button></div>
    <p>現在取得済みの会話: ユーザーとHermesの発言 {snapshot.count}件。</p>
    <p>会話内容が端末のファイルに残ります。本文に機密情報が含まれていないか確認してください。機密情報の自動除去は行いません。</p>
    <p className="remote-meta">全履歴ではありません。未取得の発言・system prompt・ツール詳細・接続や会話IDなどの内部情報は自動で含めません。保存確認を開いた時点の内容に固定しています。</p>
    {snapshot.limited && <p className="remote-scope-hint">画面の表示上限を超える取得済み本文を含みます。未取得の履歴は含みません。</p>}
    {snapshot.partial && <p className="remote-scope-hint">停止・失敗した時点の本文です。生成途中の発言を含む可能性があります。</p>}
    <p className="remote-meta">UTF-8 · 上限1MiB · {snapshot.filename}</p>
    {snapshot.error && <p role="alert">{snapshot.error}</p>}
    {!supported && <p role="status">このブラウザではファイル保存を提供できません。閉じて、各発言の「メッセージ操作 → コピー」を使うか、本文を選択してください。</p>}
    <button disabled={!supported || Boolean(snapshot.error) || snapshot.count === 0 || requested} onClick={() => {
      if (url.current || requested) return;
      try {
        url.current = URL.createObjectURL(new Blob([snapshot.content], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url.current; link.download = snapshot.filename;
        document.body.append(link); link.click(); link.remove();
        setRequested(true);
        setFeedback('ブラウザへ保存を依頼しました。端末側の保存完了は確認できません。');
        timer.current = window.setTimeout(() => { if (url.current) URL.revokeObjectURL(url.current); url.current = null; }, 1000);
      } catch {
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = null;
        setFeedback('ファイルを生成できません。各発言のメッセージ操作からコピーしてください。');
      }
    }}>確認してファイルを保存</button>
    <button onClick={onDismiss}>キャンセル</button><p role="status">{feedback}</p>
  </ConfirmDialog>;
}
