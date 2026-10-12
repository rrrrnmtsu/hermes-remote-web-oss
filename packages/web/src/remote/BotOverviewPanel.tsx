import { useEffect, useMemo, useRef, useState } from 'react';
import { botSessions, type BotConnectionState, type BotOverviewState, type GatewayBotState } from '../../../core/src/features/bots';
import type { RemoteSession } from '../../../core/src/stores/remote';
import { ConfirmDialog } from './ConfirmDialog';

const gatewayLabels: Record<GatewayBotState, string> = {
  running: '稼働を報告', starting: '起動中', draining: '終了待ち', degraded: '要確認',
  stopped: '停止を報告', startup_failed: '起動に失敗', unknown: '状態未確認',
};
const platformLabels: Record<BotConnectionState, string> = {
  connected: '接続を報告', disconnected: '未接続', disabled: '無効', not_configured: '未設定',
  pending_restart: '設定反映待ち', gateway_stopped: 'Gateway停止', starting: '接続準備中',
  paused: '一時停止', fatal: '接続エラー', unknown: '状態未確認',
};
type Filter = 'all' | 'connected' | 'attention';

/** Read-only runtime evidence; native bot credentials, writes and process controls are intentionally absent. */
export function BotOverviewPanel({ state, sessions, canOpenSession, onLoad, onOpenSession, onClose }: {
  state: BotOverviewState; sessions: readonly RemoteSession[]; canOpenSession: boolean;
  onLoad(): void; onOpenSession(id: string): void; onClose(): void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const load = useRef(onLoad); load.current = onLoad;
  useEffect(() => { load.current(); }, []);
  const snapshot = state.snapshot;
  const platforms = useMemo(() => (snapshot?.platforms || []).filter(row => filter === 'all'
    || (filter === 'connected' ? row.state === 'connected' : row.state !== 'connected' && row.state !== 'disabled')), [snapshot, filter]);
  const related = useMemo(() => botSessions(sessions, platforms), [sessions, platforms]);
  return <ConfirmDialog label="ボットの状態" className="remote-tools-dialog remote-bot-overview" dismissOnBackdrop onDismiss={onClose}>
    <header className="remote-tools-dialog-header"><h2>ボットの状態</h2><button data-dialog-initial-focus onClick={onClose}>閉じる</button></header>
    <div className="remote-tools-dialog-body">
    <p className="remote-meta">取得対象: {state.scope?.profile || '未接続'}。このWebのWSS接続と、メッセージング用Gatewayは別の状態です。</p>
    <button disabled={!state.scope || state.load === 'loading'} aria-busy={state.load === 'loading' || undefined} onClick={onLoad}>状態を再取得</button>
    {state.load === 'loading' && <p role="status">ボットの状態を取得中…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.load !== 'ready' && snapshot && <p role="status">以前の取得結果を表示しています。現在の状態として扱わないでください。</p>}
    {state.load === 'unsupported' && <p>このサーバーからボット状態を取得できません。接続済みとは判断しません。</p>}
    {!state.scope && <p>Hermesへ接続し、profileを選択すると状態を取得できます。</p>}
    {snapshot && <>
      <section className="remote-panel" aria-label="メッセージングGatewayの状態">
        <h3>メッセージングGateway</h3><p>{gatewayLabels[snapshot.gatewayState]}</p>
        {snapshot.heartbeatStaleSeconds !== null && <p role="status">状態更新が遅れています。接続や処理の進行は未確認です。</p>}
        {snapshot.sharedGateway === true && <p className="remote-meta">複数profileで共有されたGatewayです。ここでは選択profileのボットだけを表示します。</p>}
        <p className="remote-meta">取得時刻: {new Date(snapshot.observedAt).toLocaleString('ja-JP')}</p>
        <p className="remote-meta">サーバーの状態更新: {snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString('ja-JP') : '未確認'}</p>
      </section>
      <label>ボットを絞り込む<select aria-label="ボットを絞り込む" value={filter} onChange={event => setFilter(event.target.value as Filter)}>
        <option value="all">すべて</option><option value="connected">接続を報告</option><option value="attention">要確認</option>
      </select></label>
      {snapshot.platformsAvailable ? <>
        <p className="remote-meta">{platforms.length}件表示 / 取得済み{snapshot.platforms.length}件。接続の報告は実際の送受信成功を保証しません。</p>
        {snapshot.truncated && <p role="status">最大50件の取得範囲です。範囲外・不明な行は表示していません。</p>}
        {platforms.length ? <ul className="remote-bot-list" aria-label="ボット接続状態">{platforms.map(platform => <li key={platform.id}>
          <strong>{platform.name}</strong><span>{platformLabels[platform.state]}</span>
        </li>)}</ul> : <p>この取得範囲・条件に表示できるボット状態はありません。設定済みボットがないとは断定しません。</p>}
      </> : <p>ボットごとの状態は、この応答では取得できませんでした。</p>}
      <section aria-label="取得済みのボット会話"><h3>関連する会話</h3>
        <p className="remote-meta">現在のprofileで取得済みの一覧から、sourceがボット名と一致する会話だけを表示します。全履歴を検索・追加取得しません。</p>
        {related.length ? <ul className="remote-bot-conversations">{related.map(session => <li key={session.durableId}>
          <span>{session.title || '無題の会話'}</span><span className="remote-meta">{session.source}</span>
          <button disabled={!canOpenSession || state.load !== 'ready'} onClick={() => onOpenSession(session.durableId)}>この会話を開く</button>
        </li>)}</ul> : <p>取得済みの一覧に、この条件の関連会話はありません。</p>}
        {!canOpenSession && <p className="remote-meta">下書き・実行・確認待ち等を確認してから別の会話へ移動してください。現在の内容は保持しています。</p>}
      </section>
    </>}
    <p className="remote-meta">状態の閲覧だけを行います。ボットへの送信・起動停止・設定変更は行いません。</p>
    </div>
  </ConfirmDialog>;
}
