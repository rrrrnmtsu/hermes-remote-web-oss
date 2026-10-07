import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { BrowserConnections, type SavedConnection } from './connections';
import './storage.css';

export function ConnectionsPanel({ connections, currentOrigin, canNavigate, onBeforeNavigate, onSafetyChange }: {
  connections: BrowserConnections; currentOrigin: string; canNavigate: boolean;
  onBeforeNavigate?(): void;
  onSafetyChange?(busy: boolean): void;
}) {
  const [entries, setEntries] = useState<SavedConnection[]>([]);
  const [origin, setOrigin] = useState(''); const [label, setLabel] = useState('');
  const [authorized, setAuthorized] = useState(false); const [message, setMessage] = useState('');
  const [opening, setOpening] = useState<SavedConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const unsafeToUpdate = busy || Boolean(origin) || Boolean(label) || Boolean(opening);
  useEffect(() => { onSafetyChange?.(unsafeToUpdate); return () => onSafetyChange?.(false); }, [unsafeToUpdate, onSafetyChange]);
  const refresh = useCallback(async () => { try { setEntries(await connections.list()); } catch { setMessage('接続先一覧を保存領域から取得できません。'); } }, [connections]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <section className="remote-panel remote-storage-panel" aria-label="別接続先"><h2>別接続先</h2>
    <p>許可済みのHTTPS接続先を登録し、各接続先のWebを別々に開きます。認証は接続先ごとに必要です。</p>
    <p className="remote-meta">この端末・このoriginだけに、接続先originと表示名を保存します。このアプリはCookie・ticket・会話を転送しません。Cookieの適用はブラウザの仕様によるため、同じホストの別ポートや親子ホストは開けません。最大10件。</p>
    <form onSubmit={event => { event.preventDefault(); if (!authorized || busy) return; setBusy(true);
      void connections.add(origin, label).then(async () => { setOrigin(''); setLabel(''); setAuthorized(false); await refresh(); setMessage('接続先を登録しました。接続確認は開いた先で行います。'); })
        .catch(error => setMessage(error instanceof Error ? error.message : '登録できません。')).finally(() => setBusy(false)); }}>
      <label>HTTPS接続先<input type="url" inputMode="url" autoComplete="off" value={origin} onChange={event => setOrigin(event.target.value)} required placeholder="https://example.ts.net:9443" /></label>
      <label>表示名<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} autoComplete="off" /></label>
      <label className="remote-storage-choice"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} /><span>自分が利用を許可された接続先です</span></label>
      <button disabled={!authorized || busy}>接続先を登録</button>
    </form>
    <ul className="remote-storage-list">{entries.map(connection => <li key={connection.origin}>
      <div><strong>{connection.label}</strong><p className="remote-meta">{connection.origin}{connection.origin === currentOrigin ? ' · 現在の接続先' : ''}</p></div>
      <button disabled={!canNavigate || busy || connection.origin === currentOrigin} onClick={() => setOpening(connection)}>別接続先を開く</button>
      <button disabled={busy} onClick={() => { setBusy(true); void connections.remove(connection.origin).then(refresh).catch(() => setMessage('登録解除できません。')).finally(() => setBusy(false)); }}>登録解除</button>
    </li>)}</ul>
    {!canNavigate && <p className="remote-meta">入力・送信・実行・確認待ちのある間は別接続先へ移動できません。</p>}
    {message && <p role="status">{message}</p>}
    {opening && <ConfirmDialog label="別接続先へ移動" onDismiss={() => setOpening(null)}>
      <h2>別接続先を開く</h2><p>{opening.origin}へ移動します。このアプリが、ここのCookieやticketを接続先へ送る処理は行いません。</p>
      <div className="remote-actions"><button data-dialog-initial-focus="" onClick={() => setOpening(null)}>取消</button><button disabled={!canNavigate} onClick={() => {
        if (!canNavigate) return;
        try {
          // Re-read the actual browser origin before locking or navigating, including stale dialogs.
          connections.destination(opening); onBeforeNavigate?.(); connections.open(opening);
        } catch (error) { setOpening(null); setMessage(error instanceof Error ? error.message : '接続先を開けません。'); }
      }}>接続先を開く</button></div>
    </ConfirmDialog>}
  </section>;
}
