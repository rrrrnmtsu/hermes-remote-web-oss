import type { RemoteController, RemoteState } from '../../../core/src/stores/remote';
import { ConnectionPanel } from './ConnectionPanel';
import { RemoteIcon } from './RemoteIcon';
import { executionLabels, scopeBusyReason, sessionDate } from './remote-labels';

export function ConversationList({ state, controller, scopeBusy, search, onSearch, onOpen, onChooseSession, onConnect, onDiagnostics, paginated = false }: {
  state: RemoteState; controller: RemoteController; scopeBusy: boolean; search: string;
  paginated?: boolean; onSearch(value: string): void; onOpen(): void; onChooseSession(sessionId?: string): void; onConnect(): void; onDiagnostics(): void;
}) {
  const query = search.trim().toLocaleLowerCase('ja-JP');
  const project = state.projects.find(project => project.id === state.selectedProjectId);
  const rows = project ? state.projectSessions : state.sessions;
  const matches = rows.filter(session => session.title.toLocaleLowerCase('ja-JP').includes(query));
  const currentTitle = [...state.sessions, ...state.projectSessions, ...state.projects.flatMap(project => project.previews)]
    .find(session => [state.durableId, state.lineageId].includes(session.durableId))?.title || 'Hermesとの会話';
  const loading = project ? state.projectLoading : state.listLoading;
  const canOpen = state.connection === 'connected' && !scopeBusy && Boolean(navigator.locks);
  return <section className="remote-conversation-list" aria-label="会話一覧">
    <div className="remote-list-heading"><h1>会話</h1>
      <button className="remote-new-conversation" disabled={!canOpen} aria-busy={state.sessionLoading || undefined} onClick={() => onChooseSession()}><RemoteIcon name="new" />新規会話</button>
    </div>
    {project && <div className="remote-project-context" aria-label="選択中のプロジェクト">
      <RemoteIcon name="folder" /><div><strong>{project.label}</strong><p>{state.profile} の所属セッションを表示</p></div>
      <button onClick={() => { onSearch(''); void controller.selectProject(''); }}>絞り込みを解除</button>
      <p className="remote-meta">この選択は一覧の絞り込みです。新規会話はprofileの既定の作業先で始まります。</p>
    </div>}
    <div className="remote-profile-switch">
      <label><span>profile</span><select aria-label="登録profile" value={state.profile} disabled={scopeBusy || state.connection !== 'connected'} onChange={event => {
        onSearch(''); void controller.selectProfile(event.target.value);
      }}>{(state.profiles.length ? state.profiles : [state.profile]).map(profile => <option key={profile}>{profile}</option>)}</select></label>
      <details><summary aria-label="会話一覧の取得範囲">このprofileの会話を表示</summary><p className="remote-meta">{paginated ? '所有者と選択profileの保存会話。既定50件のページを明示取得し、タイトル・期間・登録projectで検索します。' : '選択profileの直近100会話以内。検索は取得済みの一覧だけが対象です。'}</p></details>
    </div>
    {state.liveId && <button className="remote-current-conversation" aria-label="開いている会話へ" onClick={onOpen}>
      <span><span className="remote-eyebrow">開いている会話へ</span><strong>{currentTitle}</strong>
        <span className="remote-meta">{executionLabels[state.execution]}{state.draft ? ' · 下書きあり' : ''}</span></span><RemoteIcon name="chevron" />
    </button>}
    {scopeBusy && <p className="remote-scope-hint" role="status">{scopeBusyReason(state)}</p>}
    {state.connection !== 'connected' && <ConnectionPanel state={state} onConnect={onConnect} onDiagnostics={onDiagnostics} />}
    {!paginated && <><div className="remote-search">
      <RemoteIcon name="search" />
      <label className="remote-sr-only" htmlFor="remote-search">会話を検索</label>
      <input id="remote-search" type="search" placeholder={project ? 'このprojectの会話を検索' : 'このprofileの会話を検索'} value={search} onChange={event => onSearch(event.target.value)} />
      {search && <button className="remote-icon-button" aria-label="検索をクリア" onClick={() => onSearch('')}>×</button>}
    </div>
    <div className="remote-list-tools"><h2>{query ? `検索結果 · ${matches.length}件` : project ? `所属セッション · ${matches.length}件` : '最近の会話'}</h2>
      <button aria-label="一覧を再取得" disabled={state.connection !== 'connected' || loading} onClick={() => {
        if (project) void controller.selectProject(project.id); else void controller.refreshSessions().catch(() => undefined);
      }}><RemoteIcon name="refresh" />再取得</button>
    </div>
    {project && state.projectError && <p className="remote-scope-hint" role="status">{state.projectError}</p>}
    <div className="remote-session-list" aria-busy={loading}>
      {loading && <p className="remote-meta" role="status">会話一覧を取得中…</p>}
      {matches.map(session => <button className="remote-session" aria-label={session.title} key={session.durableId} disabled={!canOpen}
        onClick={() => onChooseSession(session.durableId)}>
        <span><strong>{session.title}</strong><span className="remote-meta">{session.durableId === state.durableId ? '開いている会話' : '保存された会話を再開'}{project && sessionDate(session.lastActive) ? ` · ${sessionDate(session.lastActive)}` : ''}</span></span><RemoteIcon name="chevron" />
      </button>)}
      {!loading && !(project && state.projectError) && state.connection === 'connected' && matches.length === 0 && <div className="remote-empty-state">
        <RemoteIcon name={query ? 'search' : 'chat'} />
        <h2>{query ? '一致する会話がありません' : project ? 'この取得範囲に所属セッションはありません' : 'このprofileには会話がありません'}</h2>
        <p>{query ? '検索は取得済みの会話タイトルが対象です。別の言葉で検索できます。' : project ? '直近100件の通常履歴が対象です。「最近の会話」では他の履歴も確認できます。' : '「新規会話」からHermesとの会話を始められます。'}</p>
        {search && <button onClick={() => onSearch('')}>検索をクリア</button>}
      </div>}
    </div></>}
  </section>;
}
