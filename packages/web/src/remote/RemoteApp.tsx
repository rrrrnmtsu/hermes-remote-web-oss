import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { RemoteController, RemoteRequest } from '../../../core/src/stores/remote';
import { availableBuild, readSetting, readChatFontSize, saveChatFontSize, remoteController, remoteAuthSender, writeSetting } from './runtime';
import type { ConversationScrollMemory } from './conversation-scroll';
import { ConfirmDialog } from './ConfirmDialog';
import { useRemoteViewport } from './viewport';
import { usePageScroll } from './page-scroll';
import { Conversation } from './Conversation';
import { ConversationList } from './ConversationList';
import { SessionSidebar } from './SessionSidebar';
import { Settings } from './Settings';
import { RemoteIcon } from './RemoteIcon';
import { Notice } from './Notice';
import { phaseLabels } from './remote-labels';
import { ProductControls, type ProductSelection } from './ProductControls';
import { activateWaitingWorker } from './storage/worker';
import { QuickNavigation } from './QuickNavigation';
import { isNavigationShortcut, navigationCommands, type NavigationDestination } from './quick-navigation';
import './remote.css';

declare const __REMOTE_BUILD_ID__: string;

const requestLabels: Record<RemoteRequest['status'], string> = {
  pending: '未回答', checking: '要求を再確認中', response_unknown: '回答結果不明', resolved: '解決済み', cancelled: '取消済み', unsupported: '未対応として応答済み',
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }

function RequestCard({ card, controller, enabled }: { card: RemoteRequest; controller: RemoteController; enabled: boolean }) {
  const locked = object(card.params.answers);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [confirmChoice, setConfirmChoice] = useState<string | null>(null);
  const questions = Array.isArray(card.params.questions) ? card.params.questions.map(object) : [];
  const canAnswer = enabled && card.status === 'pending';
  const submitAnswers = (event: FormEvent): void => {
    event.preventDefault();
    const result = Object.fromEntries(questions.map(question => {
      const qid = string(question.qid);
      if (qid in locked) return [qid, locked[qid]];
      const selected = selection[qid] || [];
      return [qid, answers[qid]?.trim() || (question.multi_select ? JSON.stringify(selected) : selected[0] || null)];
    }));
    void controller.answer(card.key, { answers: result });
  };
  return <article className="remote-card" aria-label={`${card.method === 'approval' ? '承認要求' : '追加質問'} ${card.profile}`}>
    <p className="remote-meta">{card.profile} / {card.sessionId} · {requestLabels[card.status]}</p>
    <h3>{card.method === 'approval' ? '操作の承認' : card.method === 'clarify' ? '追加質問' : '未対応の要求'}</h3>
    {card.method === 'approval' ? <>
      <p>{string(card.params.description)}</p>
      {['tool_name', 'target', 'cwd', 'path'].filter(field => typeof card.params[field] === 'string').map(field => <p className="remote-meta" key={field}>{field}: {string(card.params[field]).slice(0, 4000)}</p>)}
      {typeof card.params.diff === 'string' && <details><summary>提示された差分</summary><pre>{card.params.diff.slice(0, 12000)}</pre></details>}
      <pre aria-label="要求されたコマンド">{string(card.params.command).slice(0, 12000)}</pre>
      {string(card.params.command).length > 12000 && <p>表示を12,000文字で省略しています。全文を確認できる端末で回答してください。</p>}
      {['once', 'deny'].filter(choice => Array.isArray(card.params.choices) && card.params.choices.includes(choice)).map(choice =>
        <button key={choice} disabled={!canAnswer || (choice === 'once' && (string(card.params.command).length > 12000 || string(card.params.diff).length > 12000))} onClick={() => setConfirmChoice(choice)}>{choice === 'once' ? '今回だけ許可' : '拒否'}</button>)}
      {confirmChoice && canAnswer && <ConfirmDialog label="承認対象の確認" onDismiss={() => setConfirmChoice(null)}>
        <p>{card.profile} / {card.sessionId} の要求へ、{confirmChoice === 'once' ? '今回だけ許可' : '拒否'}を送信します。</p>
        <button onClick={() => { const choice = confirmChoice; setConfirmChoice(null); void controller.answer(card.key, { choice }); }}>確認して回答</button>
        <button autoFocus data-dialog-initial-focus onClick={() => setConfirmChoice(null)}>戻る</button>
      </ConfirmDialog>}
    </> : card.method === 'clarify' ? <form onSubmit={submitAnswers}>
      {questions.map(question => {
        const qid = string(question.qid);
        const accepted = qid in locked;
        const choices = Array.isArray(question.choices) ? question.choices.filter((choice): choice is string => typeof choice === 'string') : [];
        return <fieldset key={qid} disabled={!canAnswer || accepted}>
          <legend>{string(question.question)}</legend>
          {accepted ? <p>受理済み: {locked[qid] === null ? 'スキップ' : string(locked[qid])}</p> : <>
            {choices.map(choice => <label className="remote-choice" key={choice}>
              <input type={question.multi_select ? 'checkbox' : 'radio'} name={`${card.key}-${qid}`} value={choice}
                checked={(selection[qid] || []).includes(choice)} onChange={event => setSelection(previous => ({ ...previous,
                  [qid]: question.multi_select ? (event.target.checked ? [...(previous[qid] || []), choice] : (previous[qid] || []).filter(item => item !== choice)) : [choice],
                }))} /> {choice}
            </label>)}
            <label>自由入力<textarea aria-label={`${string(question.question)} 自由入力`} value={answers[qid] || ''} onChange={event => setAnswers(previous => ({ ...previous, [qid]: event.target.value }))} /></label>
          </>}
        </fieldset>;
      })}
      <button disabled={!canAnswer}>回答を送信</button>
      <p className="remote-meta">空欄の質問はスキップとして送信します。</p>
    </form> : <p>このWebでは対応できないため、正式なunsupportedエラーを返しました。</p>}
    {card.status === 'response_unknown' && <p role="status">再同期で受理状態を確認してください。自動で再回答しません。</p>}
    {!enabled && card.status === 'pending' && <p>現在開いている会話の要求へ回答できます。この対象を再開して同期してください。</p>}
  </article>;
}

export function RemoteApp({ controller = remoteController }: { controller?: RemoteController }) {
  useRemoteViewport();
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.getState, controller.store.getState);
  const [productSelection, setProductSelection] = useState<ProductSelection | null>(null);
  const insertDraft = useRef<((text: string) => void) | null>(null);
  const registerInsert = useCallback((insert: ((text: string) => void) | null) => { insertDraft.current = insert; }, []);
  const [tab, setTab] = useState<'chat' | 'requests' | 'settings'>('chat');
  const [list, setList] = useState(true);
  const [composerFocused, setComposerFocused] = useState(false);
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState(readSetting('theme') || 'system');
  const [chatFontSize, setChatFontSize] = useState(readChatFontSize);
  const conversationPosition = useRef<ConversationScrollMemory | null>(null);
  const [update, setUpdate] = useState<string | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [productBusy, setProductBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const logoutPreparation = useRef<(() => Promise<void>) | null>(null);
  const registerLogoutPreparation = useCallback((prepare: (() => Promise<void>) | null) => { logoutPreparation.current = prepare; }, []);
  const [notice, setNotice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebar, setDesktopSidebar] = useState(false);
  const [navigationScope, setNavigationScope] = useState<string | null>(null);
  const navigationComposing = useRef(false);
  const navigationFrame = useRef(0);
  const currentScope = controller.featureScopeKey;
  const pageIntent = useRef(0);
  const opening = useRef(0);
  const openingSerial = useRef(0);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkingUpdateRef = useRef(false);
  const openNavigation = useCallback((): void => {
    if (loggingOut || logoutConfirm || updating) return;
    setNavigationScope(controller.featureScopeKey); setSidebarOpen(false);
  }, [controller, loggingOut, logoutConfirm, updating]);
  useEffect(() => { setNavigationScope(null); navigationComposing.current = false; }, [currentScope, state.connection]);
  useEffect(() => {
    const begin = (): void => { navigationComposing.current = true; };
    const end = (): void => { navigationComposing.current = false; };
    const key = (event: KeyboardEvent): void => {
      if (!isNavigationShortcut(event, navigationComposing.current) || document.visibilityState === 'hidden'
        || document.querySelector('dialog[open]')) return;
      event.preventDefault(); openNavigation();
    };
    window.addEventListener('compositionstart', begin); window.addEventListener('compositionend', end);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('compositionstart', begin); window.removeEventListener('compositionend', end);
      window.removeEventListener('keydown', key);
    };
  }, [openNavigation]);
  useEffect(() => () => window.cancelAnimationFrame(navigationFrame.current), []);
  useEffect(() => { pageIntent.current++; opening.current = 0; }, [state.profile, state.principalId]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const resize = (): void => { setDesktopSidebar(media.matches); if (media.matches) setSidebarOpen(false); };
    resize(); media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if ((desktopSidebar || sidebarOpen) && state.connection === 'connected') void controller.refreshProjects();
  }, [controller, desktopSidebar, sidebarOpen, state.connection, state.profile]);
  useEffect(() => {
    if (readSetting('signed-out') !== 'yes') void controller.start();
    const recover = (): void => {
      if (document.visibilityState !== 'hidden') {
        void controller.recover(navigator.onLine);
        void availableBuild().then(build => { if (build && build !== __REMOTE_BUILD_ID__) setUpdate(build); });
      }
    };
    const offline = (): void => { void controller.recover(false); };
    window.addEventListener('online', recover);
    window.addEventListener('offline', offline);
    window.addEventListener('pageshow', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      window.removeEventListener('online', recover); window.removeEventListener('offline', offline); window.removeEventListener('pageshow', recover);
      document.removeEventListener('visibilitychange', recover);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeSetting('theme', theme);
  }, [theme]);
  useEffect(() => {
    if (state.connection === 'reauth' || state.connection === 'logged_out') {
      conversationPosition.current = null;
      setSearch(''); setNotice(''); setList(true); setTab('chat'); setLogoutConfirm(false); setComposerFocused(false); setSidebarOpen(false); setNavigationScope(null);
    }
  }, [state.connection]);
  const scopedRequests = state.requests.filter(card => card.profile === state.profile && card.sessionId === state.liveId);
  const pending = scopedRequests.filter(card => ['pending', 'checking', 'response_unknown'].includes(card.status));
  const scopeBusy = state.featureBusy || state.submitInProgress || state.sessionLoading || state.imageSelecting || state.delivery === 'sending' || Boolean(state.draft) || Boolean(state.attachment) || Boolean(state.document) || ['checking', 'foreign', 'unknown'].includes(state.imageQueue) || pending.length > 0
    || ['running', 'waiting_input', 'stop_requested'].includes(state.execution);
  const safeUpdate = !loggingOut && !productBusy && !navigationScope && !state.featureBusy && !state.draft && !state.imageSelecting && !state.attachment && !state.document && !['checking', 'foreign', 'unknown'].includes(state.imageQueue) && state.delivery !== 'sending' && state.delivery !== 'delivery_unknown' && pending.length === 0
    && !['running', 'waiting_input', 'stop_requested', 'unknown'].includes(state.execution) && !state.sessionLoading && !state.submitInProgress;
  const inConversation = tab === 'chat' && !list && Boolean(state.liveId);
  const pageScroll = usePageScroll(`${tab}:${tab === 'chat' ? inConversation ? state.liveId : `list:${state.selectedProjectId}` : ''}`,
    `${state.principalId}:${state.profile}:${['reauth', 'logged_out'].includes(state.connection) ? 'signed-out' : 'active'}`);
  const updateSafety = useRef(safeUpdate); updateSafety.current = safeUpdate;
  const diagnosticTone = ['error', 'reauth', 'unsupported'].includes(state.connection) ? 'critical'
    : state.delivery === 'failed_before_send' || /できません|失敗|不明|別タブ|変わりました/.test(state.diagnostic) ? 'warning' : 'info';
  const selectTab = (next: typeof tab): void => { pageIntent.current++; setComposerFocused(false); setTab(next); };
  const showList = (): void => { pageIntent.current++; setList(true); setTab('chat'); setSidebarOpen(false); setComposerFocused(false); };
  const showCurrent = (): void => { pageIntent.current++; setList(false); setTab('chat'); setSidebarOpen(false); setComposerFocused(false); };
  const openFromSidebar = (id?: string): void => {
    const before = controller.store.getState(), intent = pageIntent.current;
    if (id && before.liveId && [before.durableId, before.lineageId].includes(id)) { showCurrent(); return; }
    if (opening.current) return;
    const requestSerial = ++openingSerial.current;
    opening.current = requestSerial;
    void controller.openSession(id).then(() => {
      const current = controller.store.getState();
      if (pageIntent.current === intent && current.profile === before.profile && current.principalId === before.principalId
        && current.connection === 'connected' && current.liveId && !current.sessionLoading && !current.diagnostic
        && (id ? [current.durableId, current.lineageId].includes(id) : current.liveId !== before.liveId)) showCurrent();
    }).catch(() => { if (pageIntent.current === intent) setNotice('会話の作成・再開を確認できません。現在の画面を維持しています。'); })
      .finally(() => { if (opening.current === requestSerial) opening.current = 0; });
  };
  const openProduct = (id: string): void => {
    const current = controller.store.getState();
    if ([current.durableId, current.lineageId].includes(id)) showCurrent(); else openFromSidebar(id);
  };
  const navigate = (destination: NavigationDestination): void => {
    const scope = navigationScope;
    if (!scope || scope !== controller.featureScopeKey || loggingOut || updating) { setNavigationScope(null); return; }
    const command = navigationCommands(controller.store.getState()).find(row => row.id === destination);
    if (!command || command.disabledReason) return;
    setNavigationScope(null); setSidebarOpen(false);
    if (destination === 'current') showCurrent();
    else if (destination === 'conversations') showList();
    else if (destination === 'requests' || destination === 'settings') selectTab(destination);
    else if (destination === 'sessions') { pageIntent.current++; setSidebarOpen(!desktopSidebar); }
    else { pageIntent.current++; setProductSelection({ action: destination }); return; }
    const intent = pageIntent.current;
    window.cancelAnimationFrame(navigationFrame.current);
    navigationFrame.current = window.requestAnimationFrame(() => {
      if (scope !== controller.featureScopeKey || intent !== pageIntent.current || document.querySelector('dialog[open]')) return;
      const target = destination === 'sessions' ? document.querySelector<HTMLElement>('.remote-sidebar-heading h2')
        : pageScroll.main.current?.querySelector<HTMLElement>('.remote-chat-heading, h1');
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    });
  };
  const sidebar = <SessionSidebar state={state} controller={controller} scopeBusy={scopeBusy} search={search} onSearch={setSearch}
    onFilter={id => { pageIntent.current++; setSearch(''); setList(true); setTab('chat'); setComposerFocused(false); void controller.selectProject(id); }}
    onOpen={openFromSidebar} onCurrent={showCurrent} onList={showList} onNavigate={openNavigation} {...(desktopSidebar ? {} : { onDismiss: () => setSidebarOpen(false) })} />;
  return <>
    {loggingOut && <div className="remote-panel" role="status">ログアウト中です。会話と入力内容を隠しています。端末保存・通知の解除を確認しています。</div>}
    <div className="remote-workspace" hidden={loggingOut} style={loggingOut ? { display: 'none' } : undefined} data-sidebar={desktopSidebar ? 'persistent' : 'drawer'}>
    {desktopSidebar && <aside className="remote-sidebar" aria-label="セッション管理">{sidebar}</aside>}
    <div className="remote-app" data-conversation={inConversation ? 'true' : 'false'} data-editing={inConversation && composerFocused ? 'true' : 'false'}>
    {!inConversation && <header className="remote-header"><div className="remote-brand">
      {!desktopSidebar && <button className="remote-icon-button" aria-label="セッションのサイドバーを開く" aria-haspopup="dialog" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><RemoteIcon name="menu" /></button>}
      <strong>Hermes Remote</strong></div>
      <button className="remote-connection-chip" aria-label="接続状態と診断" onClick={() => selectTab('settings')}><span role="status">
        <span className="remote-connection-dot" data-connection={state.connection} aria-hidden="true" />{phaseLabels[state.connection]}
      </span></button>
    </header>}
    <div className="remote-notices">
    {state.diagnostic && !(inConversation && (state.delivery === 'delivery_unknown' || state.stopUnknown)) && <Notice tone={diagnosticTone} title={state.diagnostic.split('。')[0] || state.diagnostic}><p>{state.diagnostic}</p></Notice>}
    {state.syncWarning && <Notice tone="info" title="同期情報が変わりました"><p>{state.syncWarning}</p></Notice>}
    {!inConversation && state.delivery === 'delivery_unknown' && <Notice tone="critical" title="送信結果不明 · 送信結果を確認できません"><p>本文を自動再送しません。再同期で履歴を確認してください。同文の履歴だけでは今回の受付を断定できません。別会話への移動は以前の実行を取り消しません。</p></Notice>}
    {notice && <Notice tone="info" title={notice} />}
    {!navigator.locks && <Notice tone="warning" title="このブラウザは閲覧のみ利用できます"><p>タブ間操作制御に未対応のため、送信や回答はできません。</p></Notice>}
    {update && <Notice tone="info" title={`更新あり · ${update}`} action={<button disabled={!safeUpdate || updating} onClick={() => {
      if (!safeUpdate) return;
      setUpdating(true);
      void activateWaitingWorker().then(() => {
        if (!updateSafety.current || controller.hasScopeWork() || controller.store.getState().delivery === 'delivery_unknown') {
          setUpdating(false); setNotice('更新中に入力または操作が始まったため、画面の再読込を止めました。下書きは維持しています。'); return;
        }
        window.location.reload();
      }, () => {
        setUpdating(false); setNotice('別タブの入力・実行状態または更新workerを確認できません。現在の画面を維持しています。');
      });
    }}>操作と下書きがない状態で更新</button>} />}
    </div>
    <main ref={pageScroll.main} onScroll={pageScroll.remember} className={inConversation ? 'remote-main remote-main-chat' : 'remote-main'}>
      {tab === 'chat' ? <>
        {list || !state.liveId ? <ConversationList state={state} controller={controller} scopeBusy={scopeBusy} search={search}
          paginated={state.featureMethods.includes('remote.sessions.list')} onSearch={setSearch} onOpen={showCurrent} onChooseSession={openFromSidebar} onDiagnostics={() => selectTab('settings')}
          onConnect={() => { writeSetting('signed-out', 'no'); void controller.start(); }} />
          : <Conversation key={`${state.profile}:${state.liveId}`} state={state} controller={controller} chatFontSize={chatFontSize} scrollMemory={conversationPosition}
            onDraftInserter={registerInsert} onFeature={(action, message) => setProductSelection({ action, ...(message ? { message } : {}) })}
            onComposerFocus={setComposerFocused} onRequests={() => selectTab('requests')}
          onSidebar={() => { setComposerFocused(false); if (desktopSidebar) showList(); else setSidebarOpen(true); }}
          onBack={showList} />}
      </> : tab === 'requests' ? <section>
        {state.liveId && !list && <button className="remote-return-chat" onClick={() => selectTab('chat')}><RemoteIcon name="back" />会話へ戻る</button>}
        <h1>確認待ち</h1>
        <p>取得範囲: {state.profile} / 現在開いた1会話。全profileの一覧ではありません。</p>
        <button disabled={state.connection !== 'connected' || !state.liveId} onClick={() => { void controller.synchronize().catch(() => undefined); }}>要求を再同期</button>
        {scopedRequests.length === 0 && <div className="remote-empty-state"><RemoteIcon name="check" /><h2>この取得範囲に確認待ちはありません</h2>
          <p>{state.liveId ? '確認要求が届くと、会話中にも表示します。' : '会話を開いて同期すると、その会話の要求を確認できます。'}</p>
          {!state.liveId && <button onClick={showList}>会話を選ぶ</button>}
        </div>}
        {scopedRequests.map(card => <RequestCard card={card} key={card.key} controller={controller}
          enabled={card.profile === state.profile && card.sessionId === state.liveId && state.connection === 'connected' && Boolean(navigator.locks)} />)}
      </section> : <><Settings state={state} buildId={__REMOTE_BUILD_ID__} theme={theme} onTheme={setTheme}
        chatFontSize={chatFontSize} onChatFontSize={value => setChatFontSize(saveChatFontSize(value))}
        onReconnect={() => { void controller.recover(navigator.onLine); }}
        onNavigate={openNavigation} checkingUpdate={checkingUpdate} onUpdate={() => {
          if (checkingUpdateRef.current) return;
          checkingUpdateRef.current = true; setCheckingUpdate(true);
          void availableBuild().then(build => {
          if (build && build !== __REMOTE_BUILD_ID__) setUpdate(build); else setNotice(build ? 'このbuildは最新です。' : '更新情報を取得できません。');
        }).finally(() => { checkingUpdateRef.current = false; setCheckingUpdate(false); }); }} onLogout={() => setLogoutConfirm(true)} />
        {logoutConfirm && <ConfirmDialog label="ログアウト確認" onDismiss={() => setLogoutConfirm(false)}>
          <p>同じHermes認証を使うDashboardにも影響することがあります。このページの下書き・表示内容を消去します。</p>
          {state.attachment && <p>端末内の画像参照を解放します。VPSへ登録済み・結果不明の画像がある場合、ログアウトはその登録や原本を取消・削除しません。</p>}
          <button onClick={() => { setLogoutConfirm(false); setList(true); setLoggingOut(true); writeSetting('signed-out', 'yes');
            const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hermes-remote-web.local-auth') : null;
            channel?.postMessage({ type: 'logout', sender: remoteAuthSender }); channel?.close();
            void (async () => {
            let warning = ''; let timer = 0;
            try { await Promise.race([logoutPreparation.current?.(), new Promise<never>((_, reject) => {
              timer = window.setTimeout(() => reject(new Error('logout_cleanup_unknown')), 20_000);
            })]); } catch { warning = '端末保存または通知解除を確認できません。暗号化保存・共有待ち・未解除購読が残る場合があります。'; }
            finally { window.clearTimeout(timer); await controller.logout(); setLoggingOut(false); if (warning) setNotice(warning); }
          })(); }}>ログアウトを実行</button><button autoFocus data-dialog-initial-focus onClick={() => setLogoutConfirm(false)}>戻る</button>
        </ConfirmDialog>}
      </>}
      <ProductControls controller={controller} state={state} selection={productSelection} onSelection={setProductSelection}
        browser={tab === 'chat' && (list || !state.liveId)} settings={tab === 'settings'} onOpen={openProduct} safeNavigate={!scopeBusy && state.delivery !== 'delivery_unknown'} safeUpdate={safeUpdate}
        onSafetyChange={setProductBusy} onLogoutPreparation={registerLogoutPreparation}
        onInsert={text => { if (!controller.store.getState().liveId) { setNotice('本文を挿入する会話を先に開いてください。'); return; }
          if (insertDraft.current) insertDraft.current(text); else controller.setDraft(controller.store.getState().draft + text);
          showCurrent(); }} />
    </main>
    {!inConversation && <nav className="remote-nav" aria-label="下部ナビゲーション">
      <button aria-current={tab === 'chat' ? 'page' : undefined} onClick={() => selectTab('chat')}><RemoteIcon name="chat" /><span>会話</span></button>
      <button aria-label={`確認待ち${pending.length ? ` (${pending.length})` : ''}`} aria-current={tab === 'requests' ? 'page' : undefined} onClick={() => selectTab('requests')}><RemoteIcon name="requests" /><span>確認待ち{pending.length ? <span className="remote-count"> ({pending.length})</span> : ''}</span></button>
      <button aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => selectTab('settings')}><RemoteIcon name="settings" /><span>設定</span></button>
    </nav>}
    </div>
    {sidebarOpen && !desktopSidebar && <ConfirmDialog label="セッション管理" className="remote-sidebar-drawer" dismissOnBackdrop onDismiss={() => setSidebarOpen(false)}>{sidebar}</ConfirmDialog>}
    {!loggingOut && navigationScope === currentScope && <QuickNavigation commands={navigationCommands(state)} onSelect={navigate} onDismiss={() => setNavigationScope(null)} />}
  </div></>;
}
