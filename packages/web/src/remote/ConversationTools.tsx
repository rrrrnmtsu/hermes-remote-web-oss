import { useEffect, useRef, useState } from 'react';
import { appendConversationPage, type BranchMode, type ConversationBranch, type ConversationListItem,
  type ConversationMetadata, type ConversationOperationPort, type ConversationQuery, type UserTemplate } from '../../../core/src/features/conversations';
import { ConfirmDialog } from './ConfirmDialog';
import { DateField } from './DateField';
import './ConversationTools.css';

function useScopeGuard(scopeKey: string) {
  const scope = useRef(scopeKey); scope.current = scopeKey;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return (captured: string) => alive.current && scope.current === captured;
}
function failure(error: unknown): string {
  return error instanceof Error ? error.message : '取得・変更結果を確認できません。自動で再実行しません。';
}
type ToolsScope = { scopeKey: string; port: ConversationOperationPort };

function dateTime(value: string, end = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}`);
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;
  return date.getTime() / 1000;
}
function sameFilters(a: ConversationQuery, b: ConversationQuery): boolean {
  return (a.query || '') === (b.query || '') && (a.archive || 'active') === (b.archive || 'active')
    && (a.project_id || '') === (b.project_id || '') && a.from_time === b.from_time && a.to_time === b.to_time;
}

export function ConversationToolsBrowser({ scopeKey, port, profile, projects, onOpen, onOrganize }: ToolsScope & {
  profile: string; projects: readonly { id: string; name: string }[];
  onOpen(sessionId: string): void; onOrganize(session: ConversationMetadata): void;
}) {
  const current = useScopeGuard(scopeKey);
  const serial = useRef(0);
  const [query, setQuery] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [project, setProject] = useState(''); const [archive, setArchive] = useState<'active' | 'archived' | 'all'>('active');
  const [rows, setRows] = useState<ConversationListItem[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [dataScope, setDataScope] = useState(scopeKey); const [activeQuery, setActiveQuery] = useState<ConversationQuery>({});
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [received, setReceived] = useState(false);
  const [fromBad, setFromBad] = useState(false); const [toBad, setToBad] = useState(false);
  const [dateReset, setDateReset] = useState(0);
  const [cancelled, setCancelled] = useState(false); const composing = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const loadingRef = useRef(false);
  const fromTime = from ? dateTime(from) : null, toTime = to ? dateTime(to, true) : null;
  const dateError = fromBad || toBad || from && fromTime === null || to && toTime === null
    ? '日付を確認してください。年4桁の有効な日付を選ぶか、クリアしてください。'
    : from && to && from > to ? '開始日は終了日以前を選んでください。' : '';
  function searchQuery(): ConversationQuery {
    return { query, archive, ...(project ? { project_id: project } : {}),
      ...(fromTime !== null ? { from_time: fromTime } : {}), ...(toTime !== null ? { to_time: toTime } : {}) };
  }
  async function load(filters: ConversationQuery, additional = false) {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true); setError(''); setCancelled(false);
    const generation = ++serial.current; const captured = scopeKey;
    const fixedFilters = { ...filters };
    try {
      const page = await port.list(fixedFilters);
      if (!current(captured) || serial.current !== generation) return;
      setRows(previous => additional ? appendConversationPage(previous, page) : page.sessions);
      setCursor(page.next_cursor); setActiveQuery(fixedFilters); setDataScope(captured); setReceived(true);
    } catch (caught) { if (current(captured) && serial.current === generation) setError(failure(caught)); }
    finally { if (current(captured) && serial.current === generation) { loadingRef.current = false; setLoading(false); } }
  }
  useEffect(() => {
    serial.current++; loadingRef.current = false; setLoading(false); setRows([]); setCursor(null); setError(''); setReceived(false);
    setQuery(''); setFrom(''); setTo(''); setProject(''); setArchive('active');
    setFromBad(false); setToBad(false); setCancelled(false); composing.current = false; setIsComposing(false);
    void load({ limit: 50 });
    // Scope is the canonical boundary. Query changes require the explicit search button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, port]);
  const visible = dataScope === scopeKey ? rows : [];
  const unapplied = dataScope === scopeKey && (Boolean(dateError) || !sameFilters(activeQuery, searchQuery()));
  const cancelLoad = (): void => {
    if (!loadingRef.current) return;
    serial.current++; loadingRef.current = false; setLoading(false); setCancelled(true); setError('');
  };
  return <section className="remote-conversation-tools" aria-label="過去の会話">
    <p>{profile} の取得可能な会話。作成日時の新しい順・1回50件。本文の全文検索ではありません。</p>
    <form aria-busy={loading} onCompositionStart={() => { composing.current = true; setIsComposing(true); }}
      onCompositionEnd={() => { composing.current = false; setIsComposing(false); }}
      onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
      onSubmit={event => { event.preventDefault(); if (!dateError && !composing.current) void load(searchQuery()); }}>
      <label>タイトル<input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>
      <div className="remote-conversation-fields">
        <DateField key={`${scopeKey}:from:${dateReset}`} label="開始日" value={from} invalid={fromBad || Boolean(from && fromTime === null)} onChange={(value, bad) => { setFrom(value); setFromBad(bad); }} />
        <DateField key={`${scopeKey}:to:${dateReset}`} label="終了日" value={to} invalid={toBad || Boolean(to && toTime === null)} onChange={(value, bad) => { setTo(value); setToBad(bad); }} />
      </div>
      {dateError && <p role="alert" className="remote-date-error">{dateError}</p>}
      <label>project<select value={project} onChange={event => setProject(event.target.value)}><option value="">すべての登録project範囲</option>
        {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>表示<select value={archive} onChange={event => setArchive(event.target.value as typeof archive)}>
        <option value="active">通常の会話</option><option value="archived">アーカイブ</option><option value="all">両方</option></select></label>
      <div className="remote-conversation-search-actions"><button type="submit" disabled={loading || Boolean(dateError) || isComposing}>条件を指定して取得</button>
        <button type="button" disabled={isComposing} onClick={() => {
          setQuery(''); setFrom(''); setTo(''); setProject(''); setArchive('active'); setFromBad(false); setToBad(false); setError('');
          setDateReset(value => value + 1);
        }}>検索条件をクリア</button>
        {loading && <button type="button" onClick={cancelLoad}>取得を取り消す</button>}
      </div>
    </form>
    {unapplied && !loading && <p className="remote-meta">条件はまだ反映されていません。「条件を指定して取得」で表示を更新します。</p>}
    {cancelled && <p role="status">取得結果の表示への反映を取り消しました。</p>}
    {error && <p role="alert">{error}</p>}{loading && <p role="status">取得中…</p>}
    <p>現在取得済み: {visible.length} 件。追加取得は下の操作で行います。</p>
    {!visible.length && !loading && !error && (received && dataScope === scopeKey
      ? <p>この取得範囲の会話はありません。</p> : <p>この範囲はまだ取得できていません。条件を指定して取得してください。</p>)}
    <ul>{visible.map(row => <li key={row.session_id}><button onClick={() => onOpen(row.session_id)}>
      {row.pinned ? '📌 ' : ''}{row.title || '無題の会話'}{row.archived ? '（アーカイブ）' : ''}
      <small>{new Date(row.started_at * 1000).toLocaleString('ja-JP')}</small></button>
      <button aria-label={`${row.title || '無題の会話'}を整理`} onClick={() => onOrganize(row)}>整理</button></li>)}</ul>
    {dataScope === scopeKey && cursor && <button disabled={loading || unapplied} onClick={() => void load({ ...activeQuery, cursor }, true)}>次の50件を取得</button>}
  </section>;
}

export function ConversationToolsOrganization({ scopeKey, port, session, onChanged, onDismiss }: ToolsScope & {
  session: ConversationMetadata; onChanged(session: ConversationMetadata): void; onDismiss(): void;
}) {
  const current = useScopeGuard(scopeKey); const busyRef = useRef(false);
  const [snapshot, setSnapshot] = useState(session); const [title, setTitle] = useState(session.title);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    setFresh(false); const captured = scopeKey;
    void port.metadata(session.session_id).then(value => {
      if (current(captured)) { setSnapshot(value); setTitle(value.title); setFresh(true); }
    }).catch(caught => { if (current(captured)) setError(failure(caught)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, port, session.session_id]);
  async function change(value: { title?: string; pinned?: boolean; archived?: boolean }) {
    if (busyRef.current || !fresh) return;
    busyRef.current = true; setBusy(true); setError(''); const captured = scopeKey;
    try {
      const result = await port.organize(snapshot, value);
      if (current(captured)) { setSnapshot(result); setTitle(result.title); onChanged(result); }
    } catch (caught) { if (current(captured)) { setError(failure(caught)); setFresh(false); } }
    finally { busyRef.current = false; if (current(captured)) setBusy(false); }
  }
  return <ConfirmDialog label="会話の整理" onDismiss={busy ? () => undefined : onDismiss} className="remote-conversation-tools remote-tools-dialog">
    <header className="remote-tools-dialog-header"><h2>会話の整理</h2></header>
    <div className="remote-tools-dialog-body" role="region" aria-label="会話の整理の内容" tabIndex={0}>
      <p>名前・ピン・アーカイブは現在の利用者とprofileの保存会話に反映します。本文は削除しません。</p>
      <label>会話名<input value={title} maxLength={200} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
      <button disabled={busy || !fresh || !title.trim()} onClick={() => void change({ title: title.trim() })}>名前を保存</button>
      <button disabled={busy || !fresh} onClick={() => void change({ pinned: !snapshot.pinned })}>{snapshot.pinned ? 'ピンを外す' : 'ピン留め'}</button>
      <button disabled={busy || !fresh} onClick={() => void change({ archived: !snapshot.archived })}>{snapshot.archived ? 'アーカイブから復帰' : 'アーカイブ'}</button>
      {error && <p role="alert">{error}</p>}{busy && <p role="status">変更結果を確認中…</p>}
      {!fresh && <button disabled={busy} onClick={() => { const captured = scopeKey; void port.metadata(session.session_id).then(value => {
        if (current(captured)) { setSnapshot(value); setTitle(value.title); setFresh(true); setError(''); }
      }).catch(caught => { if (current(captured)) setError(failure(caught)); }); }}>最新の状態を取得</button>}
    </div>
    <footer className="remote-tools-dialog-footer"><button data-dialog-initial-focus="" autoFocus disabled={busy} onClick={onDismiss}>閉じる</button></footer>
  </ConfirmDialog>;
}

export function ConversationToolsTemplates({ scopeKey, port, onInsert }: ToolsScope & { onInsert(body: string): void }) {
  const current = useScopeGuard(scopeKey); const busyRef = useRef(false);
  const [items, setItems] = useState<UserTemplate[]>([]); const [dataScope, setDataScope] = useState(scopeKey);
  const [editing, setEditing] = useState<UserTemplate | null>(null); const [deleting, setDeleting] = useState<UserTemplate | null>(null);
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const clear = () => { setEditing(null); setName(''); setCategory(''); setBody(''); };
  async function refresh() {
    const captured = scopeKey;
    try { const result = await port.templates(); if (current(captured)) { setItems(result.templates); setDataScope(captured); setError(''); } }
    catch (caught) { if (current(captured)) setError(failure(caught)); }
  }
  useEffect(() => { setItems([]); clear(); setDeleting(null); setError(''); busyRef.current = false; setBusy(false); void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, port]);
  async function mutate(action: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); const captured = scopeKey;
    try { await action(); if (current(captured)) { clear(); setDeleting(null); await refresh(); } }
    catch (caught) { if (current(captured)) setError(failure(caught)); }
    finally { busyRef.current = false; if (current(captured)) setBusy(false); }
  }
  const visible = dataScope === scopeKey ? items : [];
  return <section className="remote-conversation-tools" aria-label="自分の定型文">
    <h3>登録した定型文</h3><p>現在の利用者・profileのHermesサーバーに保存します。最大50件、本文8,000文字。ブラウザの平文保存は行いません。</p>
    <ul>{visible.map(item => <li key={item.id}><div><strong>{item.name}</strong>{item.category && <small>{item.category}</small>}</div>
      <button disabled={busy} onClick={() => onInsert(item.body)}>下書きへ挿入</button>
      <button disabled={busy} aria-label={`${item.name}を編集`} onClick={() => { setEditing(item); setName(item.name); setCategory(item.category); setBody(item.body); }}>編集</button>
      <button disabled={busy} aria-label={`${item.name}を削除`} onClick={() => setDeleting(item)}>削除</button></li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); if (!name.trim() || !body.trim()) return;
      void mutate(() => port.putTemplate({ name, category, body, ...(editing ? { id: editing.id, expected_version: editing.version } : {}) })); }}>
      <h3>{editing ? '定型文を編集' : '定型文を追加'}</h3>
      <label>名前<input value={name} disabled={busy} maxLength={100} onChange={event => setName(event.target.value)} /></label>
      <label>分類<input value={category} disabled={busy} maxLength={50} onChange={event => setCategory(event.target.value)} /></label>
      <label>本文<textarea value={body} disabled={busy} maxLength={8000} rows={5} onChange={event => setBody(event.target.value)} /></label>
      <p>{body.length.toLocaleString('ja-JP')} / 8,000文字</p><button type="submit" disabled={busy || !name.trim() || !body.trim() || !editing && visible.length >= 50}>定型文を保存</button>
      {editing && <button type="button" disabled={busy} onClick={clear}>編集を取り消す</button>}
    </form>{busy && <p role="status">保存結果を確認中…</p>}{error && <p role="alert">{error}</p>}
    {deleting && <ConfirmDialog label="定型文の削除確認" onDismiss={busy ? () => undefined : () => setDeleting(null)}>
      <p>「{deleting.name}」を現在の利用者・profileの定型文から削除します。会話本文は変更しません。</p>
      <button disabled={busy} onClick={() => void mutate(() => port.removeTemplate(deleting))}>この定型文を削除</button>
      <button data-dialog-initial-focus="" autoFocus disabled={busy} onClick={() => setDeleting(null)}>取消</button>
    </ConfirmDialog>}
  </section>;
}

export function ConversationToolsBranchDialog({ scopeKey, port, sessionId, rowId, mode, sourcePreview, hasDraft = false, onCreated, onDismiss }: ToolsScope & {
  sessionId: string; rowId: number; mode: BranchMode; sourcePreview: string; hasDraft?: boolean;
  onCreated(result: ConversationBranch): void; onDismiss(): void;
}) {
  const current = useScopeGuard(scopeKey); const busyRef = useRef(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function create() {
    if (busyRef.current || hasDraft) return;
    busyRef.current = true; setBusy(true); setError(''); const captured = scopeKey;
    try { const result = await port.branch(sessionId, rowId, mode); if (current(captured)) onCreated(result); }
    catch (caught) { if (current(captured)) setError(failure(caught)); }
    finally { busyRef.current = false; if (current(captured)) setBusy(false); }
  }
  return <ConfirmDialog label="元の会話を残して分岐" onDismiss={busy ? () => undefined : onDismiss} className="remote-conversation-tools remote-tools-dialog">
    <header className="remote-tools-dialog-header"><h2>{mode === 'edit' ? '編集用の会話に分岐' : mode === 'regenerate' ? '再生成用の会話に分岐' : '元の会話を残して分岐'}</h2></header>
    <div className="remote-tools-dialog-body" role="region" aria-label="分岐内容の確認" tabIndex={0}>
      <p>選んだ保存済み発言を基準に、ユーザー/Hermesの表示本文と元のsystem contextを新しい会話へ引き継ぎます。画像原本・tool詳細・推論内容は引き継ぎません。元の履歴・実施済みの操作は変更しません。</p>
      <blockquote>{sourcePreview.slice(0, 1000)}</blockquote>
      <p>ここでは会話の分岐だけを行います。編集・再生成の本文は下書きへ戻し、内容・継承範囲・追加費用を確認して通常の送信ボタンで送ります。</p>
      <p>最大2,000行・継承本文2MiB。保存前の発言や別会話の行を推測して分岐しません。</p>
      {hasDraft && <p role="alert">現在の下書きを先に保持・整理してください。別会話の下書きで上書きしません。</p>}
      {error && <p role="alert">{error}</p>}{busy && <p role="status">分岐の保存結果を確認中…</p>}
      <button disabled={busy || hasDraft || rowId < 1} onClick={() => void create()}>分岐を作成して下書きを開く</button>
    </div>
    <footer className="remote-tools-dialog-footer"><button data-dialog-initial-focus="" autoFocus disabled={busy} onClick={onDismiss}>取消</button></footer>
  </ConfirmDialog>;
}
