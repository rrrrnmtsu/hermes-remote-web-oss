import { useEffect, useState } from 'react';
import type { RemoteState } from '../../../core/src/stores/remote';
import { APP_PATH } from './runtime';
import { phaseLabels } from './remote-labels';
import { RemoteIcon } from './RemoteIcon';

export function ConnectionPanel({ state, onConnect, onDiagnostics }: {
  state: RemoteState; onConnect(): void; onDiagnostics(): void;
}) {
  const connecting = ['https', 'auth', 'ticket', 'wss', 'gateway', 'rpc', 'reconnecting'].includes(state.connection);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!connecting) return;
    const timer = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(timer);
  }, [connecting]);
  const needsAuth = ['idle', 'reauth', 'logged_out'].includes(state.connection);
  return <section className="remote-panel remote-connect-panel" aria-label="接続案内">
    <RemoteIcon name={connecting ? 'refresh' : 'chat'} />
    <h2>{connecting ? 'Hermesへ接続しています' : needsAuth ? 'Hermesへ接続' : phaseLabels[state.connection]}</h2>
    <p>{connecting ? phaseLabels[state.connection] : needsAuth
      ? 'iPhoneのTailscaleを有効にして、Hermesの既存認証でログインしてください。'
      : state.connection === 'unsupported' ? 'このHermes版では利用できない契約があります。診断で対象版を確認してください。'
      : 'Tailscaleと通信状態を確認してから再接続してください。下書きや本文を自動再送しません。'}</p>
    {slow && <p role="status">接続に時間がかかっています。現在の段階を診断で確認するか、再接続できます。</p>}
    <div className="remote-actions">
      {needsAuth && <a className="remote-button remote-primary" href={`/login?next=${encodeURIComponent(APP_PATH)}`}>Hermesのログイン画面を開く</a>}
      {(!connecting || slow) && <button onClick={onConnect}>認証後に接続・再接続</button>}
      <button onClick={onDiagnostics}>接続の診断を見る</button>
    </div>
  </section>;
}
