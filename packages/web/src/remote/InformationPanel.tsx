import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InformationState, InformationTab, InformationUsage } from '../../../core/src/features/information';
import { ConfirmDialog } from './ConfirmDialog';
import { revealDialogControl } from './dialog-focus';
import { SessionModelPicker } from './SessionModelPicker';
import './InformationPanel.css';

export interface InformationPanelProps {
  state: InformationState;
  onLoad(tab: InformationTab, query?: string): void;
  onModel(model: string): void;
  onInsert(text: string): void;
  onOpenSession(durableId: string): void;
  onClose(): void;
  canChangeModel?: boolean;
  modelChangeSupported?: boolean;
}
const tabs: { value: InformationTab; label: string }[] = [
  { value: 'models', label: 'モデル' }, { value: 'agent', label: '情報・利用量' },
  { value: 'commands', label: 'Skills' }, { value: 'cron', label: '予定・履歴' }, { value: 'activity', label: '実行状況' },
];
const known = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value)
  ? value > 0 && value < 0.000001 ? '<0.000001' : value.toLocaleString('ja-JP', { maximumFractionDigits: 6 }) : '未確認';
const stamp = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未確認';
const states: Record<string, string> = { running: '実行中', waiting_input: '確認が必要', completed: '終了', failed: '失敗', idle: '待機', unknown: '状態不明', available: '利用可能', configured: '設定あり・実効状態は未確認', disabled: '無効' };
const supports: Record<string, string> = { draft: '下書きへ挿入', device_only: '端末専用・この画面から実行不可', management: '設定・管理操作・挿入不可', unsupported: 'このWebでは実行未対応' };

function Usage({ usage }: { usage: InformationUsage }) {
  return <section aria-label="利用量"><h3>利用量・時間・費用</h3>
    <p>{usage.source === 'live' ? '現在の実行runtimeの記録' : usage.source === 'stored' ? '保存された利用量の記録' : '利用量をまだ確認できていません'}</p>
    <dl className="remote-information-values">
      <dt>入力token</dt><dd>{known(usage.input)}</dd><dt>出力token</dt><dd>{known(usage.output)}</dd>
      <dt>推論token（出力の内数）</dt><dd>{known(usage.reasoning)}</dd>
      <dt>cache read / write</dt><dd>{known(usage.cache_read)} / {known(usage.cache_write)}</dd>
      <dt>サーバー集計token</dt><dd>{known(usage.total)}</dd><dt>主処理 / 補助呼出</dt><dd>{known(usage.calls)} / {known(usage.auxiliary_calls)}</dd>
      <dt>開始 / 終了（JST）</dt><dd>{stamp(usage.started_at)} / {stamp(usage.completed_at)}</dd>
      <dt>経過秒</dt><dd>{known(usage.elapsed_seconds)}</dd>
      <dt>推定費用（USD）</dt><dd>{known(usage.estimated_cost_usd)}</dd><dt>記録済み実費（USD）</dt><dd>{known(usage.actual_cost_usd)}</dd>
      <dt>価格の取得日時（JST）</dt><dd>{stamp(usage.price_checked_at)}</dd><dt>価格の情報源 / 版</dt><dd>{usage.pricing_source || '未確認'} / {usage.pricing_version || '未確認'}</dd>
      <dt>入力 / 出力単価（USD・100万token）</dt><dd>{known(usage.unit_input_usd_per_million)} / {known(usage.unit_output_usd_per_million)}</dd>
      <dt>cache read / write単価（USD・100万token）</dt><dd>{known(usage.unit_cache_read_usd_per_million)} / {known(usage.unit_cache_write_usd_per_million)}</dd>
    </dl><p>現在の保存会話区間だけが対象です。補助呼出は別表示。推論tokenを総量へ重複加算しません。費用が未確認の場合は0円と扱いません。</p>
  </section>;
}

/** Explicit user reads only; callbacks remain owned by the central adapter. */
export function InformationPanel({ state, onLoad, onModel, onInsert, onOpenSession, onClose, canChangeModel = true, modelChangeSupported = true }: InformationPanelProps) {
  const [tab, setTab] = useState<InformationTab>('models');
  const [query, setQuery] = useState('');
  const load = useRef(onLoad);
  load.current = onLoad;
  const scope = state.scope;
  const scopeKey = [scope?.origin, scope?.principal, scope?.profile, scope?.liveId, scope?.durableId, scope?.generation].join('\u0000');
  const scroll = useRef<HTMLDivElement>(null), positions = useRef<Partial<Record<InformationTab, number>>>({});
  const positionScope = useRef(scopeKey);
  useLayoutEffect(() => {
    if (positionScope.current !== scopeKey) { positions.current = {}; positionScope.current = scopeKey; }
    if (scroll.current) scroll.current.scrollTop = positions.current[tab] || 0;
  }, [scopeKey, tab]);
  useEffect(() => { setQuery(''); }, [scopeKey]);
  useEffect(() => { if (tab !== 'commands') load.current(tab); }, [tab, scopeKey]);
  useEffect(() => {
    if (tab !== 'commands') return;
    const timer = setTimeout(() => load.current('commands', query), 250);
    return () => clearTimeout(timer);
  }, [tab, query, scopeKey]);
  const status = state.load[tab];
  const close = (): void => { if (!state.writing) onClose(); };
  return <ConfirmDialog label="会話の情報" onDismiss={close} dismissDisabled={state.writing} className="remote-information">
    <header className="remote-information-header"><h2>会話の情報</h2><button data-dialog-initial-focus="" type="button" disabled={state.writing} onClick={close}>閉じる</button></header>
    <nav aria-label="情報の種類" className="remote-information-tabs" onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || state.writing
        || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0 || !buttons.length) return;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      const target = buttons[index]; if (!target) return;
      event.preventDefault(); target.focus({ preventScroll: true });
      const dialog = target.closest('dialog'); if (dialog) revealDialogControl(dialog, target);
    }}>{tabs.map(item => <button type="button" key={item.value} disabled={state.writing} aria-pressed={tab === item.value} onClick={() => setTab(item.value)}>{item.label}</button>)}</nav>
    <div ref={scroll} className="remote-information-scroll" role="region" aria-label="会話の情報の内容" tabIndex={0} aria-busy={status === 'loading' || state.writing}
      onScroll={event => { if (status !== 'loading') positions.current[tab] = event.currentTarget.scrollTop; }}>
      <p>profile: {scope?.profile || '未選択'} · 現在の接続先の権限内だけ</p>
      <button type="button" disabled={status === 'loading' || state.writing} onClick={() => onLoad(tab, tab === 'commands' ? query : '')}>現在の情報を再取得</button>
      {status === 'loading' && <p role="status">情報を取得中…</p>}
      {state.writing && <p role="status">変更の受付と現在の状態を確認中… 結果が返るまでお待ちください。</p>}
      {status === 'unsupported' && <p role="status">このHermes版は、この情報の読み取りに未対応です。</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {tab === 'models' && state.models && <SessionModelPicker key={scopeKey} models={state.models} load={status}
        writing={state.writing} writeUnknown={state.modelWriteUnknown} canChange={canChangeModel} changeSupported={modelChangeSupported} onModel={onModel} />}
      {tab === 'agent' && state.agent && <><section><h3>実行・設定の情報</h3><p>{state.agent.provider} / {state.agent.model || '未確認'} · {state.agent.api_mode || '通信方式未確認'}</p>
        {(['tools', 'skills', 'mcp'] as const).map(kind => <div key={kind}><h4>{kind === 'tools' ? 'ツール' : kind === 'skills' ? 'Skills' : 'MCP'} · {states[state.agent?.[`${kind}_state`] || 'unknown'] || '未確認'}</h4>
          {state.agent?.[kind].length ? <ul>{state.agent[kind].map(row => <li key={row.name}>{row.name} · {states[row.state]}</li>)}</ul> : <p>{state.agent?.[`${kind}_state`] === 'unknown' ? '未取得・状態不明' : 'この範囲の登録なし'}</p>}</div>)}
        {state.agent.truncated && <p>各情報は先頭100件までです。</p>}</section><Usage usage={state.agent.usage} /></>}
      {tab === 'commands' && <section><h3>Skills・コマンド</h3><label>取得したcatalogを検索<input type="search" autoComplete="off" maxLength={200} value={query} onChange={event => setQuery(event.target.value.slice(0, 200))} /></label>
        <p>選択だけでは実行せず、対応するSkillだけを下書きへ挿入します。送信・管理操作は別の明示操作です。</p>
        {state.commands?.skills_state === 'unknown' && <p>Skillsの状態は未確認です。</p>}
        {state.commands?.rows.map(row => <article key={row.text}><strong>{row.text}</strong><p>{row.description}</p><p>{row.category} · {supports[row.support]}</p>{row.insertable && row.support === 'draft' && <button type="button" disabled={state.writing || status !== 'ready'} onClick={() => onInsert(`${row.text} `)}>下書きへ挿入</button>}</article>)}
        {state.commands && !state.commands.rows.length && <p>この取得範囲に一致する項目はありません。</p>}
        {state.commands?.truncated && <p>検索に一致した先頭50件までです。検索語を絞り込めます。</p>}
      </section>}
      {tab === 'cron' && state.cron && <section><h3>定期ジョブの予定・履歴</h3><p>選択したprofileの読み取り専用情報です。作成・変更・即時実行はありません。</p>
        {state.cron.state !== 'available' ? <p>予定を取得できませんでした。</p> : !state.cron.jobs.length ? <p>このprofileに予定の登録なし</p> : state.cron.jobs.map(job => <article key={job.id}><strong>{job.name || '名称なし'}</strong><p>{job.schedule} · 元timezone: {job.timezone || '未確認'}</p>
          <p>次回（元の時刻）: {job.next_run_at || '未確認'}<br />次回（JST）: {job.next_run_jst || '未確認'}</p>
          <p>前回: {job.last_run_at || '未確認'} · JST: {job.last_run_jst || '未確認'} · 結果: {job.last_status || '未確認'}</p></article>)}
        <h4>実行履歴</h4>{state.cron.history_state !== 'available' ? <p>履歴ストアを確認できません。</p> : !state.cron.history.length ? <p>取得範囲に実行履歴なし</p> : state.cron.history.map(row => <article key={row.id}><strong>{row.status}</strong><p>開始: {row.started_at || '未確認'} · JST: {row.started_jst || '未確認'}<br />終了: {row.finished_at || '未確認'} · JST: {row.finished_jst || '未確認'}</p></article>)}
        {state.cron.truncated && <p>予定・実行履歴はそれぞれ最大50件です。</p>}
      </section>}
      {tab === 'activity' && state.activity && <section><h3>会話の実行・確認待ち</h3><p>このprofileの認証利用者に属する最近の会話、最大50件。閲覧で実行所有権を変更しません。</p>
        <p>確認日時（JST）: {stamp(state.activity.observed_at)}</p>
        {state.activity.stored_state !== 'available' && <p>保存会話ストアは未取得です。確認できたlive会話だけを表示します。</p>}
        {!state.activity.rows.length && <p>{state.activity.stored_state === 'available' ? 'この取得範囲に会話なし' : '確認できたlive会話なし。保存会話の有無は未確認です。'}</p>}
        {state.activity.rows.map(row => <article key={row.durable_id}><strong>{row.title}</strong><p>{states[row.state]} · 未回答要求: {row.open_request_count}件</p><button type="button" disabled={state.writing || status !== 'ready'} onClick={() => onOpenSession(row.durable_id)}>この会話を開く</button></article>)}
        {state.activity.truncated && <p>表示上限に達しました。全会話・全profileを網羅した一覧ではありません。</p>}
      </section>}
    </div>
  </ConfirmDialog>;
}
