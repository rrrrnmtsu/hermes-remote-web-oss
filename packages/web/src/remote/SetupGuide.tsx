import { useRef, useState } from 'react';
import type { RemoteState } from '../../../core/src/stores/remote';
import { diagnosticText } from './safe-diagnostics';

export function SetupGuide({ state, buildId }: { state: RemoteState; buildId: string }) {
  const [copyStatus, setCopyStatus] = useState('');
  const [copying, setCopying] = useState(false);
  const pending = useRef(false);
  const diagnostic = diagnosticText(state, buildId);
  const connected = state.https && state.authenticated && state.wss && state.gatewayReady && state.readRpc;
  async function copy() {
    if (pending.current) return;
    pending.current = true; setCopying(true); setCopyStatus('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(diagnostic);
      setCopyStatus('サニタイズ診断をコピーしました。共有先はご自身で選択してください。');
    } catch { setCopyStatus('コピーを確認できません。下の診断テキストを選択してコピーできます。'); }
    finally { pending.current = false; setCopying(false); }
  }
  return <section className="remote-panel" aria-label="導入と対応機能">
    <h2>導入と対応機能</h2>
    <p>Developer Preview · 既存Hermesと同じHTTPS originで利用します。</p>
    <ol>
      <li>既存Dashboardの認証で接続します。</li>
      <li>HTTPS・認証・WSS・gateway.ready・読取RPCの5段階を確認します。</li>
      <li>serverが対応する機能とprofileの実行方針を確認します。</li>
    </ol>
    <p className="remote-scope-hint">{connected ? '接続と読み取りを確認済みです。実生成・実機の合格とは別です。' : '上の接続確認を完了してください。HTTPの成功だけでは利用開始と判定しません。'}</p>
    <p>{state.generationAllowed ? 'serverはこのscopeの生成を許可しています。モデル・画像解析の実接続は別の確認です。' : '生成の許可範囲を確認できないため、閲覧・端末内編集の範囲で利用します。'}</p>
    <p className="remote-meta">全機能は固定backendの追加契約に依存します。標準版への互換性や未対応機能は、この画面の表示だけで補いません。暗号化保存・通知・音声は本人の明示操作で有効化します。</p>
    <details><summary>共有する診断の項目を確認</summary>
      <p className="remote-meta">版・接続段階・能力の真偽だけです。origin、profile名、会話ID、本文、下書き、ticket、資格情報、ログは含めません。</p>
      <pre style={{ maxWidth: '100%', overflowX: 'auto', fontSize: '0.8125rem' }} aria-label="サニタイズ診断テキスト">{diagnostic}</pre>
      <button disabled={copying} aria-busy={copying || undefined} onClick={() => { void copy(); }}>サニタイズ診断をコピー</button>
      {copyStatus && <p role="status">{copyStatus}</p>}
    </details>
  </section>;
}
