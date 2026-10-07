import type { RemoteState } from '../../../core/src/stores/remote';

export const phaseLabels: Record<RemoteState['connection'], string> = {
  idle: '接続前', https: 'HTTPSを確認中', auth: 'Hermes認証を確認中', ticket: '接続ticketを取得中',
  wss: 'WSSへ接続中', gateway: 'gateway.readyを確認', rpc: '会話一覧RPCを確認中', connected: '接続・同期済み',
  reconnecting: '再接続中', offline: 'オフライン', reauth: '再認証が必要', unsupported: '未対応', error: '接続エラー', logged_out: 'ログアウト',
};
export const executionLabels: Record<RemoteState['execution'], string> = {
  idle: '待機', running: '実行中', waiting_input: '確認待ち', stop_requested: '停止要求中',
  completed: '完了', failed: '実行失敗', unknown: '実行状態不明', stopped: '停止を確認',
};

export function scopeBusyReason(state: RemoteState): string {
  return state.sessionLoading ? '会話の作成・再開を確認中です。'
    : state.delivery === 'sending' ? '送信の受付を確認しています。'
    : state.draft ? '開いている会話に下書きがあります。送信するか、入力を消すと切り替えできます。'
    : ['running', 'stop_requested'].includes(state.execution) ? '開いている会話の実行状態を確認してから切り替えできます。'
    : '開いている会話の確認要求へ回答してから切り替えできます。';
}

export function sessionDate(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || !Number.isFinite(new Date(seconds * 1000).getTime())) return '';
  return new Date(seconds * 1000).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}
