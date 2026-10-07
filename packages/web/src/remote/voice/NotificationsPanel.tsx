import { useEffect, useSyncExternalStore } from 'react';
import type { NotificationController } from '../../../../core/src/features/notifications';
import './voice.css';

export function NotificationsPanel({ controller, scope }: { controller: NotificationController; scope: string }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.reset(); void controller.refresh(); return () => controller.reset(); }, [controller, scope]);
  return <section className="remote-panel" aria-label="この会話の通知"><h2>この会話の通知</h2>
    <p>通知は既定OFFです。明示登録した会話の「結果あり」「確認が必要」だけを一般文面で通知します。</p>
    <p className="remote-meta">本文・コマンド・project名は通知に載せません。通知を開いた後に認証と実状態を再確認し、通知から直接承認しません。ブラウザのPushサービスへ購読と暗号化された汎用通知が送られます。</p>
    <p className="remote-meta">登録はこの端末のブラウザ・認証利用者・profile・会話ごと。最大8件、登録期限30日。iPhoneではホーム画面WebアプリとSafariの対応・許可を別々に確認してください。</p>
    <p role="status">{state.phase === 'enabled' ? 'この会話の通知: 登録済み' : state.phase === 'working' || state.phase === 'loading' ? '通知の状態を確認中' : state.phase === 'unknown' ? '通知の操作結果: 不明' : state.phase === 'unsupported' ? 'この接続・端末では通知を利用できません' : 'この会話の通知: OFF'}</p>
    <p className="remote-meta">端末の許可: {state.permission === 'granted' ? '許可済み' : state.permission === 'denied' ? '拒否済み' : state.permission === 'unsupported' ? '未対応' : '未選択'}</p>
    {state.expiresAt && <p className="remote-meta">購読期限: {new Date(state.expiresAt * 1000).toLocaleString('ja-JP')}</p>}
    {state.diagnostic && <p role="status">{state.diagnostic}</p>}
    <div className="remote-actions"><button disabled={state.phase !== 'ready' || state.permission === 'denied'} onClick={() => { void controller.enable(); }}>この会話の通知を有効にする</button>
      <button disabled={state.phase !== 'enabled'} onClick={() => { void controller.disable(); }}>この会話の通知を解除</button>
      <button disabled={state.phase === 'working' || state.phase === 'loading'} onClick={() => { void controller.refresh(); }}>登録状態を再取得</button></div>
  </section>;
}
