import { useId, useState } from 'react';
import type { InformationLoad, InformationModel, InformationModels } from '../../../core/src/features/information';

const fact = (value: boolean | null): string => value === true ? 'あり' : value === false ? 'なし' : '未確認';
const reason = (row: InformationModel): string => row.reason === 'running_or_pending' ? '実行・開始待ちの間は変更できません'
  : row.reason === 'text_pilot_fixed_route' ? '検証用の固定モデル方針'
  : row.reason === 'limits_unknown' ? 'このモデルの出力・文脈上限が未確認のため変更できません'
  : row.reason ? '現在の実行方針では変更できません' : '';

/** Search and selection are presentation-only, scoped to the parent's mounted session. */
export function SessionModelPicker({ models, load, writing, writeUnknown, canChange, changeSupported, onModel }: {
  models: InformationModels; load: InformationLoad; writing: boolean; writeUnknown: boolean;
  canChange: boolean; changeSupported: boolean; onModel(model: string): void;
}) {
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<{ model: string; revision: string } | null>(null);
  const id = useId();
  // A new authoritative revision cannot silently preserve a choice made against an older catalog.
  const selection = choice?.revision === models.revision && models.rows.some(row => row.model === choice.model) ? choice.model : '';
  const selected = models.rows.find(row => row.model === (selection || models.model));
  const search = query.trim().toLocaleLowerCase('ja-JP');
  const matches = models.rows.filter(row => !search || `${row.model} ${row.provider}`.toLocaleLowerCase('ja-JP').includes(search));
  const visible = models.rows.filter(row => matches.includes(row) || row.model === models.model || row.model === selection);
  const canApply = changeSupported && canChange && !writing && !writeUnknown && load === 'ready'
    && Boolean(selection) && selection !== models.model && selected?.selectable === true;
  const unavailable = !changeSupported ? 'このHermes版はモデル変更に未対応です。現在値の読み取りだけ利用できます。'
    : !canChange && !writing ? '現在は変更を待つ状態です。下書き・添付・実行・確認要求がない状態で、接続を確認してから操作してください。入力内容は保持しています。' : '';

  return <section className="remote-session-model" aria-label="会話単位モデル">
    <h3>現在の会話のモデル</h3>
    <p className="remote-session-model-current"><strong>{models.model || '未確認'}</strong><span>{models.provider || '提供元未確認'}</span></p>
    <p id={`${id}-help`}>変更はこの会話の次ターンへ反映します。選択だけでは変更・送信しません。</p>
    <label>モデルを絞り込む<input type="search" autoComplete="off" maxLength={200} value={query}
      disabled={writing || load !== 'ready'} aria-describedby={`${id}-matches`}
      onChange={event => setQuery(event.target.value.slice(0, 200))} /></label>
    <p id={`${id}-matches`} role="status" className="remote-session-model-hint">{search
      ? `${matches.length}件一致。現在・選択中のモデルは検索中も残します。` : `${models.rows.length}件の設定済み候補。検索は取得済みの範囲だけです。`}</p>
    <label htmlFor={`${id}-selection`}>次に使うモデル</label>
    <select id={`${id}-selection`} value={selection || models.model}
      disabled={!changeSupported || writing || writeUnknown || load !== 'ready'}
      aria-describedby={`${id}-help ${id}-guard`}
      onChange={event => setChoice({ model: event.target.value, revision: models.revision })}>
      {!models.rows.some(row => row.model === models.model) && models.model && <option value={models.model}>{models.model}（現在）</option>}
      {visible.map(row => <option key={row.model} value={row.model} disabled={!row.selectable && !row.current}>{row.model}{row.current ? '（現在）' : ''}</option>)}
    </select>
    {selection && selected && <p className="remote-session-model-hint">選択中: {selected.model} · {selected.provider}{reason(selected) ? ` · ${reason(selected)}` : ''}</p>}
    <button type="button" className="remote-primary" disabled={!canApply} aria-describedby={`${id}-guard`}
      onClick={() => { if (canApply && selection) onModel(selection); }}>この会話へ適用</button>
    <div id={`${id}-guard`}>
      {unavailable && <p role="status">{unavailable}</p>}
      {writeUnknown && <p role="status">変更の結果不明。現在値の再取得で照合してください。自動再変更は行いません。</p>}
      {!models.rows.length && <p>この接続経路で表示できるモデル候補はありません。</p>}
    </div>
    <details className="remote-session-model-details"><summary>モデルの詳細（{models.rows.length}件）</summary>
      <p>同じ接続経路で設定済みのモデルだけが対象です。既定profileや別会話を変更しません。候補の掲載は生成成功の証明ではありません。</p>
      <p>通信方式: {models.api_mode || '未確認'}</p>
      {models.endpoint_origin && <p>接続先: {models.endpoint_origin}</p>}
      <ul>{models.rows.map(row => <li key={row.model}><strong>{row.model}</strong><span>{row.provider} · 掲載: {fact(row.listed)} · 資格情報: {fact(row.credential_present)} · このruntimeで実応答: {fact(row.response_confirmed)}</span>{reason(row) && <span>{reason(row)}</span>}</li>)}</ul>
      {models.truncated && <p>設定済みモデルの先頭100件までを表示しています。</p>}
    </details>
  </section>;
}
