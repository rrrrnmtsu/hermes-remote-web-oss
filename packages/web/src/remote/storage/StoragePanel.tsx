import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { ChatMessage } from '../ChatMessage';
import { BrowserEncryptedStore, sameScope } from './encrypted-store';
import { storageErrorMessage, type SavedEntry, type StorageScope, type StoredHistory } from './types';
import './storage.css';

export function StoragePanel({ store, scope, online, history, onRestoreDraft, onStateChange, onCacheShell, onClearShell, onSafetyChange }: {
  store: BrowserEncryptedStore; scope: StorageScope | null; online: boolean; history: StoredHistory | null;
  onRestoreDraft(text: string, scope: StorageScope): void; onStateChange?(): void;
  onCacheShell?(): Promise<void>; onClearShell?(): Promise<void>;
  onSafetyChange?(busy: boolean): void;
}) {
  const [revision, setRevision] = useState(0); const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState(''); const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<SavedEntry[]>([]);
  const [histories, setHistories] = useState<Array<{ entry: SavedEntry; scope: StorageScope }>>([]);
  const [restoring, setRestoring] = useState<{ text: string; scope: StorageScope } | null>(null);
  const [viewing, setViewing] = useState<{ history: StoredHistory; entry: SavedEntry; scope: StorageScope } | null>(null);
  const [viewCount, setViewCount] = useState(50); const [clearing, setClearing] = useState(false);
  const unsafeToUpdate = busy || Boolean(passphrase) || Boolean(restoring) || Boolean(viewing) || clearing;
  useEffect(() => { onSafetyChange?.(unsafeToUpdate); return () => onSafetyChange?.(false); }, [unsafeToUpdate, onSafetyChange]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const refresh = useCallback(async () => {
    await store.inspect();
    if (!sameScope(scope, currentScope.current)) return;
    if (store.unlocked) {
      const savedDrafts = scope ? await store.list('draft', scope) : [];
      const savedHistories = await store.listOfflineHistories();
      if (!sameScope(scope, currentScope.current)) return;
      setDrafts(savedDrafts); setHistories(savedHistories);
    } else { setDrafts([]); setHistories([]); }
    setRevision(value => value + 1);
  }, [scope, store]);
  useEffect(() => { store.setScope(scope); setRestoring(null); setViewing(null); setMessage(''); void refresh().catch(error => setMessage(storageErrorMessage(error))); }, [scope, store, refresh]);
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return; setBusy(true); setMessage('');
    try { await action(); await refresh(); onStateChange?.(); }
    catch (error) { setMessage(storageErrorMessage(error)); }
    finally { setBusy(false); }
  };
  // Revision mirrors deliberate local storage operations; secrets are never in React keys/URLs.
  void revision;
  return <section className="remote-panel remote-storage-panel" aria-label="端末の暗号化保存"><h2>端末の暗号化保存</h2>
    <p>保存は既定OFFです。選んだ保存だけを、この端末・このoriginへ暗号化して残します。</p>
    <p className="remote-meta">下書きは24時間・10件・各64KiB・合計1MiB、履歴は7日・合計20MiB。ブラウザ消去・保存失敗では復元できないことがあります。</p>
    <p className="remote-meta">パスフレーズは端末へ保存しません。忘れた場合の復旧や、同一originの不正なプログラムへの完全な防御は保証できません。ログアウト時は鍵を破棄し、このアプリの暗号化保存を消去します。保存領域の失敗時は、暗号文が端末に残る場合があります。</p>
    {!store.unlocked ? <form onSubmit={event => { event.preventDefault(); const secret = passphrase; setPassphrase('');
      void run(async () => { if (store.hasStorage) await store.unlock(secret); else await store.initialize(secret); store.setScope(currentScope.current); setMessage('解錠しました。保存は個別に有効化してください。'); }); }}>
      <label>端末保存のパスフレーズ<input type="password" autoComplete="off" minLength={12} maxLength={256} value={passphrase} onChange={event => setPassphrase(event.target.value)} required /></label>
      <button disabled={busy}>{store.hasStorage ? '保存を解錠' : '暗号化保存を準備'}</button>
      <p className="remote-meta">12〜256文字。サーバーのログイン用パスワードとは別に指定します。</p>
    </form> : <>
      <label className="remote-storage-choice"><input type="checkbox" checked={store.enabled.draft} disabled={busy || !scope} onChange={event => { const value = event.target.checked; void run(() => store.setEnabled('draft', value)); }} /><span>未送信下書きを暗号化して保持</span></label>
      <p className="remote-meta">有効化後の下書きだけが対象です。復元には同じ認証利用者・profile・保存会話と明示確認が必要です。自動送信しません。</p>
      <label className="remote-storage-choice"><input type="checkbox" checked={store.enabled.history} disabled={busy} onChange={event => { const value = event.target.checked;
        void run(async () => { if (value) await onCacheShell?.(); await store.setEnabled('history', value); if (!value) await onClearShell?.(); }); }} /><span>選んだ履歴をオフラインで閲覧</span></label>
      <p className="remote-meta">過去の会話をまとめて自動保存しません。切断中の権限失効は即時検知できません。通信復帰時の送信・承認も自動実行しません。</p>
      <button disabled={busy || !scope || !history || !store.enabled.history || !online} onClick={() => { if (!scope || !history) return; const fixedScope = { ...scope }; const fixedHistory = structuredClone(history);
        void run(async () => { await store.saveHistory(fixedScope, fixedHistory); setMessage('現在取得済みの発言を暗号化保存しました。'); }); }}>現在取得済みの履歴を端末へ保存</button>
      {history && <p className="remote-meta">{history.messages.length}発言。{history.limited && '取得・表示範囲の上限あり。'}{history.partial && '生成途中の現在時点スナップショット。'}system・tool詳細は保存対象外です。</p>}
      <h3>この会話の保存下書き</h3>
      {!drafts.length && <p className="remote-meta">同じ認証利用者・profile・保存会話の有効な保存下書きはありません。</p>}
      <ul className="remote-storage-list">{drafts.map(entry => <li key={entry.id}><p className="remote-meta">保存 {formatTime(entry.savedAt)} / 期限 {formatTime(entry.expiresAt)}</p>
        <button disabled={busy || !scope} onClick={() => { if (!scope) return; const fixed = { ...scope };
          void run(async () => { const text = await store.restoreDraft(fixed, entry.id); if (sameScope(fixed, currentScope.current)) setRestoring({ text, scope: fixed }); }); }}>下書きの復元を確認</button>
        <button disabled={busy || !scope} onClick={() => { if (scope) void run(() => store.remove(entry.id, scope)); }}>下書きを消去</button>
      </li>)}</ul>
      <h3>保存した履歴</h3>
      {!histories.length && <p className="remote-meta">有効なオフライン保存履歴はありません。</p>}
      <ul className="remote-storage-list">{histories.map(({ entry, scope: savedScope }) => <li key={entry.id}>
        <p className="remote-meta">{savedScope.profile} / 保存 {formatTime(entry.savedAt)} / 期限 {formatTime(entry.expiresAt)}</p>
        <button disabled={busy} onClick={() => { const fixedScope = currentScope.current; void run(async () => { const saved = await store.readOfflineHistory(entry.id); if (sameScope(fixedScope, currentScope.current)) { setViewing(saved); setViewCount(50); } }); }}>保存履歴を閲覧</button>
        <button disabled={busy} onClick={() => { void run(() => store.removeOfflineHistory(entry.id)); }}>履歴を消去</button>
      </li>)}</ul>
      <button disabled={busy} onClick={() => { store.lock(); setViewing(null); setRestoring(null); setDrafts([]); setHistories([]); setRevision(value => value + 1); onStateChange?.(); }}>保存を施錠</button>
    </>}
    <button disabled={busy} onClick={() => setClearing(true)}>このアプリの暗号化保存を全て消去</button>
    {message && <p role="status">{message}</p>}
    {restoring && <ConfirmDialog label="保存下書きを復元" onDismiss={() => setRestoring(null)}><h2>保存下書きを復元</h2>
      <p>この会話の入力欄へ戻します。現在の下書きがある場合は置き換えます。送信はしません。</p><pre className="remote-storage-preview">{restoring.text.slice(0, 8_000)}</pre>
      {restoring.text.length > 8_000 && <p className="remote-meta">確認表示は8,000文字で省略しています。復元対象は保存された全文です。</p>}
      <div className="remote-actions"><button data-dialog-initial-focus="" onClick={() => setRestoring(null)}>取消</button><button disabled={!sameScope(restoring.scope, scope)} onClick={() => { if (sameScope(restoring.scope, currentScope.current)) onRestoreDraft(restoring.text, restoring.scope); setRestoring(null); }}>入力欄へ復元</button></div>
    </ConfirmDialog>}
    {viewing && <ConfirmDialog label="端末に保存した履歴" className="remote-offline-history" onDismiss={() => setViewing(null)}>
      <div className="remote-sheet-heading"><h2>端末に保存した履歴</h2><button data-dialog-initial-focus="" onClick={() => setViewing(null)}>閉じる</button></div>
      <div className="remote-offline-messages" role="region" aria-label="保存履歴の内容" tabIndex={0}>
        <p className="remote-meta">閲覧専用 · {viewing.scope.profile} · 最終同期 {formatTime(viewing.history.syncedAt)} · 保存期限 {formatTime(viewing.entry.expiresAt)}</p>
        <p className="remote-meta">現在取得済みの範囲を保存した履歴です。{viewing.history.limited && '全履歴を含みません。'}{viewing.history.partial && '生成途中のスナップショットです。'}最新の状態・未回答要求は接続後に再確認してください。</p>
        {viewing.history.messages.slice(0, viewCount).map((item, index) => <ChatMessage key={index} message={{ id: `local-view-${index}`, ...item }} />)}
      </div>
      {viewCount < viewing.history.messages.length && <button onClick={() => setViewCount(value => value + 50)}>次の50発言を表示</button>}
    </ConfirmDialog>}
    {clearing && <ConfirmDialog label="暗号化保存を消去" onDismiss={() => setClearing(false)}><h2>この端末の暗号化保存を消去</h2>
      <p>このアプリが保存した下書き・履歴・包んだ鍵だけを消去します。VPSの元会話と他アプリのデータは消しません。復元はできません。</p>
      <div className="remote-actions"><button data-dialog-initial-focus="" onClick={() => setClearing(false)}>取消</button><button disabled={busy} onClick={() => { setClearing(false); void run(async () => { await store.clearOwnData(); await onClearShell?.(); setViewing(null); setRestoring(null); setMessage('暗号化保存を消去しました。'); }); }}>暗号化保存を消去</button></div>
    </ConfirmDialog>}
  </section>;
}
function formatTime(value: number): string { return new Date(value).toLocaleString('ja-JP'); }
