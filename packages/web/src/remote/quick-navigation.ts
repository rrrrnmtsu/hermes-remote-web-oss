import type { RemoteState } from '../../../core/src/stores/remote';

export type NavigationDestination = 'current' | 'conversations' | 'sessions' | 'requests' | 'settings'
  | 'templates' | 'info' | 'artifacts' | 'files';

export interface NavigationCommand {
  id: NavigationDestination;
  label: string;
  description: string;
  keywords: string;
  disabledReason?: string | undefined;
}

/** Only existing navigation/read destinations; never execution or consent actions. */
export function navigationCommands(state: RemoteState): NavigationCommand[] {
  const unavailable = state.connection !== 'connected' ? '接続後に利用できます。' : '';
  const capability = (method: string): string | undefined => unavailable
    || (!state.featureMethods.includes(method) ? 'このサーバーでは未対応です。' : undefined);
  const pending = state.requests.filter(card => card.profile === state.profile && card.sessionId === state.liveId
    && ['pending', 'checking', 'response_unknown'].includes(card.status)).length;
  return [
    { id: 'current', label: '開いている会話へ', description: '同じ会話と下書きに戻ります。',
      keywords: 'chat conversation current resume 本文 チャット 下書き', disabledReason: !state.liveId ? '会話を先に開いてください。' : undefined },
    { id: 'conversations', label: '会話一覧', description: '選択中のprofileの会話を表示します。', keywords: 'conversations history list search 履歴 検索' },
    { id: 'sessions', label: 'profile・projectの会話', description: '登録されたprofile・projectから会話を選べます。', keywords: 'sessions sidebar profile project プロファイル プロジェクト セッション' },
    { id: 'requests', label: '確認待ち', description: `現在開いた会話の未回答 ${pending}件を確認します。`, keywords: 'requests approval clarify pending 承認 質問' },
    { id: 'settings', label: '設定・診断', description: '接続状態、表示、導入の案内を確認します。', keywords: 'settings diagnostics connection theme font 設定 接続 文字 更新' },
    { id: 'templates', label: '個人用定型文', description: '定型文を確認し、下書きへ挿入できます。',
      keywords: 'templates snippets 定型文 テンプレート', disabledReason: capability('remote.templates.list') },
    { id: 'info', label: 'Hermesの情報', description: '会話モデル、利用量、機能の情報を確認します。',
      keywords: 'information models usage skills cron activity 情報 モデル 利用量 機能', disabledReason: capability('remote.info.models') },
    { id: 'artifacts', label: 'この会話の成果物', description: '現在の会話に登録された成果物を確認します。',
      keywords: 'artifacts outputs 成果物 出力', disabledReason: !state.liveId ? '会話を先に開いてください。' : capability('remote.artifacts.list') },
    { id: 'files', label: '許可されたファイル', description: '許可された作業先のファイルを閲覧します。',
      keywords: 'files browse ファイル 閲覧', disabledReason: capability('remote.files.roots') },
  ];
}

/** Bounded literal matching over built-in labels, not conversations or server data. */
export function filterNavigationCommands(commands: readonly NavigationCommand[], query: string): NavigationCommand[] {
  const words = query.slice(0, 128).normalize('NFKC').toLocaleLowerCase('ja-JP').trim().split(/\s+/).filter(Boolean);
  return commands.filter(command => {
    const text = `${command.label} ${command.keywords}`.normalize('NFKC').toLocaleLowerCase('ja-JP');
    return words.every(word => text.includes(word));
  });
}

export function isNavigationShortcut(event: KeyboardEvent, composing: boolean): boolean {
  return !event.defaultPrevented && !event.repeat && !event.isComposing && !composing && event.keyCode !== 229
    && !event.altKey && !event.shiftKey && event.ctrlKey !== event.metaKey && event.key.toLowerCase() === 'k';
}
