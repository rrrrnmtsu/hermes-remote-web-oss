import type { RemoteState } from '../../../core/src/stores/remote';
import { phaseLabels } from './remote-labels';
import { RemoteIcon } from './RemoteIcon';
import { CHAT_FONT_REM, type ChatFontSize } from './runtime';
import type { CSSProperties } from 'react';
import { SetupGuide } from './SetupGuide';

export function Settings({ state, buildId, theme, onTheme, chatFontSize, onChatFontSize, onReconnect, onUpdate, onLogout, onNavigate, checkingUpdate = false }: {
  state: RemoteState; buildId: string; theme: string; onTheme(value: string): void;
  chatFontSize: ChatFontSize; onChatFontSize(value: ChatFontSize): void;
  onReconnect(): void; onUpdate(): void; onLogout(): void; checkingUpdate?: boolean;
  onNavigate?: () => void;
}) {
  const checks = [['HTTPS', state.https], ['Hermes認証', state.authenticated], ['WSS', state.wss],
    ['gateway.ready', state.gatewayReady], ['読取RPC', state.readRpc]] as const;
  return <section className="remote-settings"><h1>設定・診断</h1>
    <section className="remote-panel" aria-label="接続の状態">
      <h2>接続</h2><p className="remote-settings-status"><span className="remote-connection-dot" data-connection={state.connection} aria-hidden="true" />{phaseLabels[state.connection]}</p>
      <ul className="remote-checks" aria-label="接続確認の段階">{checks.map(([label, checked]) => <li key={label}>
        <span>{label}</span><span data-checked={checked}>{checked && <RemoteIcon name="check" />}{checked ? '確認済み' : '未確認'}</span>
      </li>)}</ul>
      <p className="remote-meta">最終同期: {state.lastSync ? new Date(state.lastSync).toLocaleString('ja-JP') : '未同期'}</p>
      {state.failureKind && <p className="remote-scope-hint">{phaseLabels[state.failedStage]} / {state.failureKind}</p>}
      <div className="remote-actions"><button disabled={['https', 'auth', 'ticket', 'wss', 'gateway', 'rpc', 'reconnecting'].includes(state.connection)} onClick={onReconnect}>再接続して同期</button><button disabled={checkingUpdate} aria-busy={checkingUpdate || undefined} onClick={onUpdate}>更新を確認</button></div>
      {checkingUpdate && <p role="status" className="remote-meta">更新情報を確認中…</p>}
      <details className="remote-diagnostic-details"><summary>アプリと接続の詳細</summary><dl>
        <dt>アプリbuild</dt><dd>{buildId}</dd><dt>対象Hermes</dt><dd>{state.targetVersion || '未確認'}</dd>
        <dt>固定origin</dt><dd>{window.location.origin}</dd>
        <dt>接続失敗の段階 / 種別</dt><dd>{state.failureKind ? `${phaseLabels[state.failedStage]} / ${state.failureKind}` : 'なし'}</dd>
        <dt>HTTPS / 認証 / WSS / ready / 読取RPC</dt><dd>{checks.map(([, checked]) => checked ? '確認済み' : '未確認').join(' / ')}</dd>
      </dl></details>
    </section>
    <SetupGuide state={state} buildId={buildId} />
    {onNavigate && <section className="remote-panel"><h2>画面への移動</h2>
      <p>サイドバー、または⌘ / Ctrl + Kから、既存の画面・パネルを検索して開けます。</p>
      <button aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" onClick={onNavigate}>クイックナビゲーション</button>
    </section>}
    <section className="remote-panel"><h2>表示</h2><label>表示テーマ<select value={theme} onChange={event => onTheme(event.target.value)}>
      <option value="system">端末に合わせる</option><option value="light">ライト</option><option value="dark">ダーク</option>
    </select></label>
      <label>会話の文字サイズ<select aria-label="会話の文字サイズ" value={chatFontSize} onChange={event => onChatFontSize(Number(event.target.value) as ChatFontSize)}>
        <option value="15">小 · 15px</option><option value="16">標準 · 16px</option><option value="17">大 · 17px</option>
      </select></label>
      <div className="remote-font-preview" style={{ '--chat-body-font-size': CHAT_FONT_REM[chatFontSize] } as CSSProperties} aria-label="会話の文字サイズのプレビュー">
        今日は、できたことと次の一歩を整理しましょう。
      </div>
      <button onClick={() => onChatFontSize(16)}>文字サイズを標準に戻す</button>
      <p className="remote-meta">会話本文だけに適用します。入力欄や操作ボタンの大きさは維持します。</p>
    </section>
    <section className="remote-panel"><h2>ホーム画面に追加</h2><p>Safariの共有メニューから「ホーム画面に追加」を選択します。ホーム画面起動では認証状態を改めて確認してください。</p>
      <p className="remote-meta">通常Webとして利用できます。端末の暗号化保存・オフライン起動・通知は、この下の個別設定から明示的に有効化します。</p></section>
    <section className="remote-panel"><h2>保存とログアウト</h2><p>既定では会話・ID・ツールログ・下書き・検索語を永続保存しません。選択した下書き・履歴だけは、任意の暗号化保存を有効にして端末へ残せます。保存しない履歴はHermesから再取得します。</p>
      <p className="remote-meta">平文の設定は表示テーマ・文字サイズ・ログアウト状態だけです。接続先は明示登録した非秘密の情報を専用領域に保存します。明示的にMarkdown保存を選ぶと、その会話内容は端末のファイルに残ります。</p><button className="remote-logout" onClick={onLogout}>ログアウト</button></section>
  </section>;
}
