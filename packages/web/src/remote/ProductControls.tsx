import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RemoteController, RemoteMessage, RemoteState } from '../../../core/src/stores/remote';
import { ConversationFeatureClient, type BranchMode, type ConversationMetadata } from '../../../core/src/features/conversations';
import { ConversationToolsBrowser, ConversationToolsOrganization, ConversationToolsTemplates, ConversationToolsBranchDialog } from './ConversationTools';
import { ConfirmDialog } from './ConfirmDialog';
import { BrowserEncryptedStore, sameScope } from './storage/encrypted-store';
import { BrowserConnections } from './storage/connections';
import { StoragePanel } from './storage/StoragePanel';
import { ConnectionsPanel } from './storage/ConnectionsPanel';
import type { StorageScope, StoredHistory } from './storage/types';
import { cacheOfflineShell, clearOfflineShell, installWorkerSafetyGuard } from './storage/worker';
import { InformationController } from '../../../core/src/features/information';
import { InformationPanel } from './InformationPanel';
import { NotificationController } from '../../../core/src/features/notifications';
import { browserPushPort } from './voice/browser-push';
import { NotificationsPanel } from './voice/NotificationsPanel';
import { VoicePanel, ReadAloud } from './voice/VoicePanel';
import { DeviceVoiceController } from './voice/device-voice';
import { FilesController } from '../../../core/src/features/files';
import { FilesPanel } from './FilesPanel';
import { ArtifactPanel } from './ArtifactPanel';
import { NativeControls } from './NativeControls';
import { remoteAuthSender } from './runtime';
import './ProductControls.css';

export type ProductAction = 'organize' | 'templates' | 'info' | 'files' | 'artifacts' | 'voice' | 'read-aloud' | BranchMode;
export interface ProductSelection { action: ProductAction; message?: RemoteMessage; }

/** Central feature composition. Topic views only receive scoped operation ports. */
export function ProductControls({ controller, state, settings, browser, selection, onSelection, onOpen, safeNavigate, safeUpdate, onInsert, onSafetyChange, onLogoutPreparation }: {
  controller: RemoteController; state: RemoteState; settings?: boolean; browser?: boolean;
  selection: ProductSelection | null; onSelection(value: ProductSelection | null): void;
  onOpen(id: string): void; safeNavigate: boolean; safeUpdate: boolean; onInsert(text: string): void;
  onSafetyChange(busy: boolean): void; onLogoutPreparation(prepare: (() => Promise<void>) | null): void;
}) {
  const [organization, setOrganization] = useState<ConversationMetadata | null>(null);
  const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [storageBusy, setStorageBusy] = useState(false);
  const [connectionsBusy, setConnectionsBusy] = useState(false);
  const [nativeBusy, setNativeBusy] = useState(false);
  const nativeLogout = useRef<(() => Promise<void>) | null>(null);
  const registerNativeLogout = useCallback((prepare: (() => Promise<void>) | null) => { nativeLogout.current = prepare; }, []);
  const store = useMemo(() => new BrowserEncryptedStore(window.location.origin), []);
  const connections = useMemo(() => new BrowserConnections(), []);
  const scopeKey = controller.featureScopeKey;
  const scope = useMemo<StorageScope | null>(() => state.principalId && state.durableId ? {
    origin: window.location.origin, principal: state.principalId, profile: state.profile, durableSession: state.durableId,
  } : null, [state.principalId, state.profile, state.durableId]);
  const history = useMemo<StoredHistory | null>(() => scope && state.lastSync ? {
    messages: state.messages.filter((row): row is RemoteMessage & { role: 'user' | 'assistant' } => row.role === 'user' || row.role === 'assistant').map(({ role, text }) => ({ role, text })),
    syncedAt: state.lastSync, limited: true, partial: !['idle', 'completed', 'stopped'].includes(state.execution),
  } : null, [scope, state.lastSync, state.messages, state.execution]);
  const current = useRef({ scope, safeUpdate }); current.current = { scope, safeUpdate };
  const previousPrincipal = useRef('');
  const receivedLogout = useRef(false);
  const [projectId, setProjectId] = useState(''); const [projectConfirm, setProjectConfirm] = useState(false);
  const canOperateSession = (): boolean => {
    const now = controller.store.getState();
    return now.connection === 'connected' && !now.featureBusy && !now.sessionLoading && !now.submitInProgress
      && !now.draft && !now.attachment && !now.document && now.delivery !== 'delivery_unknown' && now.delivery !== 'sending'
      && ['idle', 'completed', 'stopped'].includes(now.execution)
      && !now.requests.some(card => card.profile === now.profile && card.sessionId === now.liveId && ['pending', 'checking', 'response_unknown'].includes(card.status));
  };
  const information = useMemo(() => new InformationController({
    request: (method, params) => controller.featureRequest(method, params, ['remote.session.model_set', 'remote.project.create_session'].includes(method)),
    canChangeModel: () => canOperateSession() && Boolean(controller.store.getState().liveId),
    canCreateSession: canOperateSession,
    // RemoteController already owns the sole browser operation lock.
    withOperationLock: action => action(),
  }), [controller]); // eslint-disable-line react-hooks/exhaustive-deps
  const infoState = useSyncExternalStore(information.store.subscribe, information.store.getState, information.store.getState);
  const catalogRead = useRef<{ scope: string; query: string } | null>(null);
  const files = useMemo(() => new FilesController({ request: (method, params) => controller.featureRequest(method, params) }), [controller]);
  const filesState = useSyncExternalStore(files.store.subscribe, files.store.getState, files.store.getState);
  const closeFiles = (): void => { files.closeContent(); onSelection(null); };
  const closeTemplates = (): void => { if (!controller.store.getState().featureBusy) onSelection(null); };
  const closeInformation = (): void => { if (!information.store.getState().writing && !controller.store.getState().featureBusy) onSelection(null); };
  const closeProject = (): void => { if (!information.store.getState().writing && !controller.store.getState().featureBusy) setProjectConfirm(false); };
  const canReadFiles = (): boolean => {
    const now = files.store.getState();
    return ![now.rootsLoad, now.listLoad, now.artifactsLoad, now.contentLoad].includes('loading');
  };
  useEffect(() => { files.setScope(state.connection === 'connected' ? {
    origin: window.location.origin, principal: state.principalId, profile: state.profile, liveId: state.liveId, durableId: state.durableId, generation: controller.imageSelectionGeneration,
  } : null, state.featureMethods); }, [scopeKey, state.connection, state.featureMethods, files]); // eslint-disable-line react-hooks/exhaustive-deps
  const voice = useMemo(() => new DeviceVoiceController(), []);
  const voiceState = useSyncExternalStore(voice.subscribe, voice.snapshot, voice.snapshot);
  const notifications = useMemo(() => new NotificationController({
    scope: () => { const now = controller.store.getState(); return { profile: now.profile, durableSession: now.durableId, generation: controller.featureScopeKey, connected: now.connection === 'connected' }; },
    supports: method => controller.store.getState().featureMethods.includes(method),
    request: (method, params, write) => controller.featureRequest(method, params, write),
  }, browserPushPort()), [controller]);
  const pushState = useSyncExternalStore(notifications.subscribe, notifications.snapshot, notifications.snapshot);
  const localBusy = storageBusy || connectionsBusy || nativeBusy || Boolean(selection) || Boolean(organization) || projectConfirm || infoState.writing || infoState.modelWriteUnknown || infoState.projectWriteUnknown
    || pushState.phase === 'working' || pushState.phase === 'unknown' || voiceState.reading || ['listening', 'finishing'].includes(voiceState.phase) || Boolean(voiceState.text);
  current.current.safeUpdate = safeUpdate && !localBusy;
  useEffect(() => { onSafetyChange(localBusy); return () => onSafetyChange(false); }, [localBusy, onSafetyChange]);
  useEffect(() => { voice.setScope(scopeKey); notifications.reset(); return () => { voice.reset(); notifications.reset(); }; }, [scopeKey, state.connection, voice, notifications]);
  useEffect(() => {
    onLogoutPreparation(async () => { voice.reset(); store.lock(); let cleanupUnknown = false;
      try { await nativeLogout.current?.(); } catch { cleanupUnknown = true; }
      const result = await notifications.logout();
      if (result.browser === 'unknown' || result.server === 'unknown' || cleanupUnknown) throw new Error('logout_cleanup_unknown');
    });
    return () => onLogoutPreparation(null);
  }, [notifications, voice, store, onLogoutPreparation]);
  useEffect(() => { information.setScope(state.connection === 'connected' ? {
    origin: window.location.origin, principal: state.principalId, profile: state.profile, liveId: state.liveId, durableId: state.durableId, generation: controller.imageSelectionGeneration,
  } : null, state.featureMethods); catalogRead.current = null; setProjectConfirm(false); setProjectId(''); }, [scopeKey, state.connection, state.featureMethods, information]); // eslint-disable-line react-hooks/exhaustive-deps
  const port = useMemo(() => new ConversationFeatureClient({
    scope: () => { const now = controller.store.getState(); return now.connection === 'connected' ? { key: controller.featureScopeKey, profile: now.profile } : null; },
    supports: method => controller.store.getState().featureMethods.includes(method),
    request: (method, params) => controller.featureRequest(method, params, !['remote.sessions.list', 'remote.session.metadata', 'remote.templates.list'].includes(method)),
  }), [controller]);
  useEffect(() => { setOrganization(null); setError(''); onSelection(null); }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { store.setScope(scope); }, [scope, store]);
  useEffect(() => {
    if (state.principalId && previousPrincipal.current && state.principalId !== previousPrincipal.current) {
      void store.clearOwnData().catch(() => setError('以前の端末保存を消去できませんでした。鍵は破棄しました。'));
    }
    if (state.principalId) previousPrincipal.current = state.principalId;
    if (state.connection === 'reauth' || state.connection === 'logged_out') {
      store.lock(); setOrganization(null); onSelection(null);
      void store.clearOwnData().catch(() => undefined); void clearOfflineShell().catch(() => undefined);
    }
  }, [state.connection, state.principalId, store]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hermes-remote-web.local-auth') : null;
    if (channel) channel.onmessage = event => {
      if (event.data?.type === 'logout' && event.data?.sender !== remoteAuthSender) {
        receivedLogout.current = true;
        store.lock();
        if (!['logged_out', 'reauth'].includes(controller.store.getState().connection)) controller.hideLocalSession();
      }
    };
    return () => channel?.close();
  }, [controller, store]);
  useEffect(() => {
    if (state.connection !== 'logged_out' && state.connection !== 'reauth') { receivedLogout.current = false; return; }
    // Do not echo a received logout back to the tab still revoking its subscription.
    if (receivedLogout.current) return;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hermes-remote-web.local-auth') : null;
    channel?.postMessage({ type: 'logout', sender: remoteAuthSender }); channel?.close();
  }, [state.connection]);
  useEffect(() => installWorkerSafetyGuard(() => current.current.safeUpdate, () => { void controller.recover(navigator.onLine); }, () => {
    notifications.reset(); void notifications.refresh();
  }), [controller, notifications]);
  useEffect(() => {
    if (!scope || !store.unlocked || !store.enabled.draft) return;
    const text = state.draft; const captured = scope;
    const timer = window.setTimeout(() => {
      if (!sameScope(captured, current.current.scope)) return;
      void store.saveDraft(captured, text).catch(() => setError('暗号化下書きの保存を確認できません。メモリ上の入力は維持しています。'));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [scope, store, state.draft, revision]);
  useEffect(() => {
    if (selection?.action !== 'organize' || !state.durableId) return;
    const captured = scopeKey;
    void port.metadata(state.durableId).then(row => { if (controller.featureScopeKey === captured) setOrganization(row); }).catch(() => setError('会話の整理情報を取得できません。'));
  }, [selection, state.durableId, scopeKey, port, controller]);
  const supported = state.featureMethods.includes('remote.sessions.list');
  useEffect(() => {
    if ((browser || settings) && state.connection === 'connected' && state.featureMethods.includes('remote.project.create_session')
      && state.projectsStatus === 'idle') void controller.refreshProjects();
  }, [browser, settings, state.connection, state.profile, state.projectsStatus, state.featureMethods, controller]);
  return <>
    <NativeControls controller={controller} state={state} visible={Boolean(settings)} onInsert={onInsert}
      onSafetyChange={setNativeBusy} onLogoutPreparation={registerNativeLogout} />
    {browser && supported && state.connection === 'connected' && <ConversationToolsBrowser key={scopeKey} scopeKey={scopeKey} port={port} profile={state.profile}
      projects={state.projects.map(project => ({ id: project.id, name: project.label }))} onOpen={onOpen} onOrganize={row => { setOrganization(row); onSelection({ action: 'organize' }); }} />}
    {(settings || browser) && state.featureMethods.includes('remote.project.create_session') && <section className="remote-panel">
      <h2>登録作業先で新規会話</h2><p>一覧の絞り込みとは別に、選んだ登録projectの作業先で新しい会話を作成します。生成は開始しません。</p>
      <label>作業先<select value={projectId} onChange={event => setProjectId(event.target.value)} disabled={!safeNavigate || infoState.writing || state.featureBusy || infoState.projectWriteUnknown}><option value="">作業先を選択</option>
        {state.projects.filter(project => project.kind === 'registered').map(project => <option key={project.id} value={project.id}>{project.label}</option>)}</select></label>
      <button disabled={!projectId || !safeNavigate || infoState.writing || state.featureBusy || infoState.projectWriteUnknown} onClick={() => setProjectConfirm(true)}>この作業先で新規会話</button>
      {infoState.projectWriteUnknown && <p role="status">会話作成の受付結果が不明です。この範囲では作り直さず、会話一覧から状態を確認してください。</p>}
    </section>}
    {projectConfirm && <ConfirmDialog label="新規会話の作業先" className="remote-tools-dialog remote-product-project-confirmation"
      dismissDisabled={infoState.writing || state.featureBusy} onDismiss={closeProject}>
      <header className="remote-tools-dialog-header"><h2>登録作業先の確認</h2><button data-dialog-initial-focus disabled={infoState.writing || state.featureBusy} onClick={closeProject}>取消</button></header>
      <div className="remote-tools-dialog-body" role="region" aria-label="作業先の確認内容" tabIndex={0} aria-busy={infoState.writing || state.featureBusy}>
        <p>{state.profile} / {state.projects.find(project => project.id === projectId)?.label}</p><p>サーバーから返された会話IDと実際の作業先を照合してから開きます。</p>
        {infoState.writing && <p role="status">作業先と会話の受付を確認中… 結果が返るまでお待ちください。</p>}
        {infoState.error && <p role="alert">{infoState.error}</p>}
        {infoState.projectWriteUnknown && <p role="status">受付結果が不明なため、もう一度作成しません。会話一覧から状態を確認してください。</p>}
      </div>
      <footer className="remote-tools-dialog-footer"><button disabled={!safeNavigate || infoState.writing || state.featureBusy || infoState.projectWriteUnknown}
        aria-busy={infoState.writing} onClick={() => {
          const requestedScope = controller.featureScopeKey, requestedPrincipal = controller.store.getState().principalId;
          void information.createProjectSession(projectId).then(async result => {
            if (!result || controller.featureScopeKey !== requestedScope) return;
            setProjectConfirm(false);
            try { await controller.adoptCreatedSession(result); }
            catch {
              const now = controller.store.getState();
              if (now.principalId === requestedPrincipal && now.profile === result.profile && (now.liveId === result.session_id || controller.featureScopeKey === requestedScope)) {
                setError('新しい会話の同期を確認できませんでした。自動で作り直さず、会話一覧から状態を確認してください。');
              }
              return;
            }
            const now = controller.store.getState();
            if (now.principalId === requestedPrincipal && now.profile === result.profile && now.liveId === result.session_id && now.lineageId === result.stored_session_id) onOpen(result.stored_session_id);
            else if (controller.featureScopeKey === requestedScope) setError('会話作成の応答は返りましたが、現在の状態では開けませんでした。会話一覧で確認してください。');
          }).catch(() => {
            if (controller.featureScopeKey === requestedScope) setError('会話の受付を確認できませんでした。自動で作り直さず、会話一覧から状態を確認してください。');
          });
        }}>確認して新規会話</button></footer>
    </ConfirmDialog>}
    {settings && <>
      <section className="remote-panel"><h2>Hermesの情報</h2><p>選択profile・会話のモデル、利用量、Skills、定期ジョブ、複数会話の状態を読み取ります。</p><button onClick={() => onSelection({ action: 'info' })}>情報を開く</button></section>
      <StoragePanel store={store} scope={scope} online={state.connection === 'connected' && state.authenticated && state.readRpc} history={history} onStateChange={() => setRevision(value => value + 1)}
        onSafetyChange={setStorageBusy}
        onRestoreDraft={(text, captured) => { if (sameScope(captured, current.current.scope) && controller.store.getState().delivery !== 'delivery_unknown') controller.setDraft(text); }}
        onCacheShell={cacheOfflineShell} onClearShell={clearOfflineShell} />
      <ConnectionsPanel connections={connections} currentOrigin={window.location.origin} canNavigate={safeNavigate} onBeforeNavigate={() => store.lock()} onSafetyChange={setConnectionsBusy} />
      <NotificationsPanel controller={notifications} scope={scopeKey} />
    </>}
    {organization && <ConversationToolsOrganization key={`${scopeKey}:${organization.session_id}`} scopeKey={scopeKey} port={port} session={organization}
      onChanged={() => { void controller.refreshSessions(); }} onDismiss={() => { setOrganization(null); onSelection(null); }} />}
    {selection?.action === 'info' && <InformationPanel state={{ ...infoState, writing: infoState.writing || state.featureBusy }} canChangeModel={canOperateSession() && Boolean(state.liveId)}
      modelChangeSupported={state.featureMethods.includes('remote.session.model_set')}
      onLoad={(tab, query) => {
        const now = information.store.getState(); if (now.writing) return;
        if (tab === 'commands') {
          const next = { scope: controller.featureScopeKey, query: query || '' };
          if (now.load.commands === 'loading' && catalogRead.current?.scope === next.scope && catalogRead.current.query === next.query) return;
          catalogRead.current = next;
        } else if (now.load[tab] === 'loading') return;
        if (tab === 'models') void information.refreshModel(); else void information.load(tab, query);
      }} onModel={model => { void information.setModel(model); }} onInsert={onInsert} onOpenSession={onOpen} onClose={closeInformation} />}
    {selection?.action === 'files' && <FilesPanel state={filesState} onLoadRoots={() => { if (canReadFiles()) void files.loadRoots(); }}
      onBrowse={(root, path) => { if (canReadFiles()) void files.browse(root, path); }} onOpen={entry => { if (canReadFiles()) void files.openFile(entry); }}
      onCloseContent={() => files.closeContent()} onClose={closeFiles} />}
    {selection?.action === 'artifacts' && <ArtifactPanel state={filesState} onLoad={() => {
      if (!canReadFiles()) return;
      if (files.store.getState().contentLoad === 'error') files.closeContent();
      void files.loadArtifacts();
    }}
      onOpen={entry => { if (canReadFiles()) void files.openArtifact(entry); }} onCloseContent={() => files.closeContent()} onClose={closeFiles} />}
    {selection?.action === 'voice' && <VoicePanel controller={voice} scope={scopeKey} composing={false}
      onInsert={(text, captured) => { if (captured === controller.featureScopeKey) onInsert(text); }} onDismiss={() => onSelection(null)} />}
    {selection?.action === 'read-aloud' && selection.message && <ConfirmDialog label="端末で読み上げ" onDismiss={() => { voice.reset(); onSelection(null); }}>
      <h2>端末で読み上げ</h2><p className="remote-meta">選択時点の本文を端末機能で読み上げます。端末側の音声サービスへ本文が渡る場合があります。</p>
      <ReadAloud controller={voice} scope={scopeKey} text={selection.message.text.slice(0, 8000)} />
      <button onClick={() => { voice.reset(); onSelection(null); }}>閉じる</button>
    </ConfirmDialog>}
    {selection?.action === 'templates' && <ConfirmDialog label="個人用定型文" className="remote-tools-dialog" dismissDisabled={state.featureBusy} onDismiss={closeTemplates}>
      <header className="remote-tools-dialog-header"><h2>個人用定型文</h2><button data-dialog-initial-focus disabled={state.featureBusy} onClick={closeTemplates}>閉じる</button></header>
      <div className="remote-tools-dialog-body" role="region" aria-label="個人用定型文の内容" tabIndex={0}>
        <ConversationToolsTemplates key={scopeKey} scopeKey={scopeKey} port={port} onInsert={text => { onInsert(text); onSelection(null); }} />
      </div>
    </ConfirmDialog>}
    {selection && ['branch', 'edit', 'regenerate'].includes(selection.action) && selection.message && <ConversationToolsBranchDialog
      key={`${scopeKey}:${selection.message.id}`} scopeKey={scopeKey} port={port} sessionId={state.durableId} rowId={Number(selection.message.id)}
      mode={selection.action as BranchMode} sourcePreview={selection.message.text} hasDraft={Boolean(state.draft) || !safeNavigate}
      onCreated={result => { onSelection(null); void controller.openSession(result.stored_session_id).then(() => {
        if (controller.store.getState().lineageId === result.stored_session_id) { controller.setDraft(result.draft); onOpen(result.stored_session_id); }
      }); }} onDismiss={() => onSelection(null)} />}
    {error && <p className="remote-scope-hint" role="status">{error}</p>}
  </>;
}
