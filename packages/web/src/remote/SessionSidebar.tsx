import type { RemoteController, RemoteSession, RemoteState } from '../../../core/src/stores/remote';
import { RemoteIcon } from './RemoteIcon';
import { executionLabels, scopeBusyReason, sessionDate } from './remote-labels';

export function SessionSidebar({ state, controller, scopeBusy, search, onSearch, onFilter, onOpen, onCurrent, onList, onDismiss }: {
  state: RemoteState; controller: RemoteController; scopeBusy: boolean; search: string;
  onSearch(value: string): void; onFilter(id: string): void; onOpen(id?: string): void; onCurrent(): void; onList(): void; onDismiss?: () => void;
}) {
  const selected = state.projects.find(project => project.id === state.selectedProjectId);
  const query = search.trim().toLocaleLowerCase('ja-JP');
  const rows = selected ? state.projectSessions : state.sessions;
  const matches = rows.filter(session => session.title.toLocaleLowerCase('ja-JP').includes(query));
  const currentTitle = [...state.sessions, ...state.projectSessions, ...state.projects.flatMap(project => project.previews)]
    .find(session => [state.durableId, state.lineageId].includes(session.durableId))?.title || 'Hermesとの会話';
  const canOpen = state.connection === 'connected' && !scopeBusy && Boolean(navigator.locks);
  const pendingCount = state.requests.filter(card => card.profile === state.profile && card.sessionId === state.liveId
    && ['pending', 'checking', 'response_unknown'].includes(card.status)).length;
  const current = (session: RemoteSession): boolean => Boolean(state.liveId) && [state.durableId, state.lineageId].includes(session.durableId);
  return <div className="remote-sidebar-content" data-projects-status={state.projectsStatus} data-project-status={state.projectLoading ? 'loading' : state.projectError ? 'error' : 'ready'}>
    <div className="remote-sidebar-heading"><h2>セッション</h2>
      {onDismiss && <button autoFocus className="remote-icon-button" aria-label="サイドバーを閉じる" onClick={onDismiss}>×</button>}
    </div>
    <label className="remote-sidebar-profile"><span>profile</span><select aria-label="サイドバーのprofile" value={state.profile}
      disabled={scopeBusy || state.connection !== 'connected'} onChange={event => { onSearch(''); void controller.selectProfile(event.target.value); }}>
      {(state.profiles.length ? state.profiles : [state.profile]).map(profile => <option key={profile}>{profile}</option>)}
    </select></label>
    <button className="remote-sidebar-new" aria-label="サイドバーから新規会話" disabled={!canOpen} onClick={() => onOpen()}>
      <RemoteIcon name="new" /><span>このprofileで新規会話</span>
    </button>
    {state.liveId && <button className="remote-sidebar-current" aria-label="開いている会話を表示" onClick={onCurrent}>
      <span className="remote-eyebrow">開いている会話</span><strong>{currentTitle}</strong>
      <span className="remote-meta">{executionLabels[state.execution]}{state.draft ? ' · 下書きあり' : ''}{pendingCount ? ` · 確認 ${pendingCount}件` : ''}</span>
    </button>}
    {scopeBusy && <p className="remote-sidebar-hint" role="status">{scopeBusyReason(state)}一覧の絞り込みと、開いている会話への復帰はできます。</p>}
    <nav aria-label="プロジェクト別セッション">
      <div className="remote-sidebar-section-heading"><h3>プロジェクト</h3>
        <button className="remote-icon-button" aria-label="プロジェクトを再取得" disabled={state.connection !== 'connected' || state.projectsStatus === 'loading'}
          onClick={() => { void controller.refreshProjects(); }}><RemoteIcon name="refresh" /></button>
      </div>
      <button className="remote-sidebar-project" aria-pressed={!state.selectedProjectId} onClick={() => onFilter('')}>
        <RemoteIcon name="chat" /><span><strong>最近の会話</strong><small>{state.featureMethods?.includes('remote.sessions.list') ? '選択profile・先頭50件以内' : '選択profile・直近100件以内'}</small></span><span className="remote-sidebar-count">{state.sessions.length}</span>
      </button>
      {state.connection !== 'connected' && <p className="remote-meta">接続後に、このprofileのprojectを取得します。</p>}
      {state.projectsStatus === 'loading' && <p className="remote-meta" role="status">プロジェクトを取得中…</p>}
      {state.projectsError && <p className="remote-sidebar-hint" role="status">{state.projectsError}</p>}
      <ul className="remote-sidebar-projects">
        {state.projects.map(project => <li key={project.id}>
          <button className="remote-sidebar-project" aria-label={`プロジェクトを選択: ${project.label}`} aria-pressed={state.selectedProjectId === project.id}
            disabled={state.connection !== 'connected'} onClick={() => onFilter(project.id)}>
            <RemoteIcon name="folder" /><span><strong>{project.label}</strong><small>{project.kind === 'registered' ? '登録project' : project.kind === 'automatic' ? '作業先から自動分類' : '所属projectなし'}</small></span>
            <span className="remote-sidebar-count" aria-label={`サーバー集計 ${project.sessionCount}会話`}>{project.sessionCount}</span>
          </button>
        </li>)}
      </ul>
      {state.projectsStatus === 'ready' && state.projects.length === 0 && <p className="remote-meta">この取得範囲にprojectはありません。</p>}
    </nav>
    <section className="remote-sidebar-sessions" aria-label="サイドバーのセッション一覧">
      <div className="remote-sidebar-section-heading"><h3>{selected?.label || '最近の会話'}<span className="remote-sidebar-count">{matches.length}</span></h3></div>
      <label className="remote-sidebar-search"><RemoteIcon name="search" /><input type="search" aria-label="サイドバーの会話を検索" placeholder="会話タイトルを検索"
        value={search} onChange={event => onSearch(event.target.value)} /></label>
      {state.projectLoading && <p className="remote-meta" role="status">所属する会話を取得中…</p>}
      {state.projectError && <p className="remote-sidebar-hint" role="status">{state.projectError}</p>}
      {!state.projectLoading && !state.projectError && <ul>
        {matches.slice(0, 8).map(session => <li key={session.durableId}>
          <button className="remote-sidebar-session" aria-label={`セッションを開く: ${session.title}`} aria-current={current(session) ? 'page' : undefined}
            disabled={!current(session) && !canOpen} onClick={() => current(session) ? onCurrent() : onOpen(session.durableId)}>
            <strong>{session.title}</strong><span className="remote-meta">{current(session) ? executionLabels[state.execution] : sessionDate(session.lastActive) || '保存された会話'}</span>
          </button>
        </li>)}
        {matches.length === 0 && state.connection === 'connected' && <li className="remote-meta">{query ? '一致する会話はありません。' : '取得した会話はありません。'}</li>}
      </ul>}
      <button className="remote-sidebar-show-list" onClick={onList}>一覧で表示{matches.length > 8 ? ` · ${matches.length}件` : ''}<RemoteIcon name="chevron" /></button>
    </section>
    <p className="remote-sidebar-scope">現在のprofileだけを取得。projectの会話は直近100件の通常履歴から分類されます。件数は全履歴の総数ではありません。切替で実行を停止したり、既定の作業先を変更したりしません。</p>
  </div>;
}
