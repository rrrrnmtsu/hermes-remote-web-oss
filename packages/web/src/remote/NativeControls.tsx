import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RemoteController, RemoteState } from '../../../core/src/stores/remote';
import { NativeBridgeError, NATIVE_STORAGE_LIMIT, type NativeScope, type NativeShareMetadata } from '../../../core/src/features/native-shell';
import { nativeShellClient, bindNativeResume, sharedDraftFile } from './native-shell';
import { prepareImage } from './image-content';
import { prepareDocument } from './file-content';
import { ConfirmDialog } from './ConfirmDialog';
import './storage/storage.css';

type Snapshot = { version: 1; savedAt: number; syncedAt: number | null; limited: true; partial: boolean;
  draft: string; messages: Array<{ role: 'user' | 'assistant'; text: string }> };
type Confirmation = ({ kind: 'share'; item: NativeShareMetadata } | { kind: 'restore'; snapshot: Snapshot })
  & { scopeKey: string; epoch: number; liveId: string };
const MAX_MESSAGES = 2000;
function scopeFor(state: RemoteState, origin: string): NativeScope | null {
  return state.authenticated && !['reauth', 'logged_out'].includes(state.connection) && /^[a-f0-9]{64}$/.test(state.principalId)
    && state.profile && state.durableId ? { origin, principal: state.principalId, profile: state.profile, durableSession: state.durableId } : null;
}
function snapshotFrom(state: RemoteState): Snapshot {
  const messages = state.messages.filter((row): row is typeof row & { role: 'user' | 'assistant' } => row.role === 'user' || row.role === 'assistant')
    .map(({ role, text }) => ({ role, text }));
  if (messages.length > MAX_MESSAGES) throw new Error('snapshot_limit');
  return { version: 1, savedAt: Date.now(), syncedAt: state.lastSync, limited: true,
    partial: !['idle', 'completed', 'stopped', 'failed'].includes(state.execution), draft: state.draft, messages };
}
function parseSnapshot(value: string): Snapshot {
  if (new TextEncoder().encode(value).byteLength > NATIVE_STORAGE_LIMIT) throw new Error('snapshot_limit');
  const result = JSON.parse(value) as Partial<Snapshot>;
  if (!result || result.version !== 1 || typeof result.draft !== 'string' || !Number.isSafeInteger(result.savedAt)
    || result.syncedAt !== null && !Number.isSafeInteger(result.syncedAt) || result.limited !== true || typeof result.partial !== 'boolean'
    || !Array.isArray(result.messages) || result.messages.length > MAX_MESSAGES
    || result.messages.some(row => !row || !['user', 'assistant'].includes(row.role) || typeof row.text !== 'string')) throw new Error('snapshot_invalid');
  return { version: 1, savedAt: result.savedAt!, syncedAt: result.syncedAt!, limited: true, partial: result.partial,
    draft: result.draft, messages: result.messages.map(({ role, text }) => ({ role, text })) };
}
function problem(error: unknown): string {
  if (error instanceof NativeBridgeError && error.code === 'unsupported') return 'このiOSアプリは会話・認証変更時の取消契約に未対応です。更新まで端末保存・共有は利用できません。ブラウザ保存へ切り替えません。';
  if (error instanceof NativeBridgeError && error.code === 'scope_changed') return '会話・認証範囲が変わったため取り込みません。自動で再実行しません。';
  if (error instanceof NativeBridgeError && error.code === 'expired') return '保存または共有待ちの期限が切れています。';
  if (error instanceof NativeBridgeError && error.code === 'too_large' || error instanceof Error && error.message === 'snapshot_limit') return '端末保存上限1MiB・発言2,000件を超えています。全文保存した扱いにはしません。';
  return '結果を確認できません。下書きと共有待ちを確認してください。自動で再実行しません。';
}

/** One optional native adapter. Keep mounted; visible only controls its settings presentation. */
export function NativeControls({ controller, state, onInsert, onSafetyChange, onLogoutPreparation, visible = true }: {
  controller: RemoteController; state: RemoteState; onInsert(text: string): void; onSafetyChange(busy: boolean): void;
  onLogoutPreparation?(prepare: (() => Promise<void>) | null): void; visible?: boolean;
}) {
  const client = useMemo(() => nativeShellClient(), []);
  const [ready, setReady] = useState(false); const [sharing, setSharing] = useState(false);
  const [locked, setLocked] = useState(false); const lockedRef = useRef(false);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [consent, setConsent] = useState(false); const [expiry, setExpiry] = useState(86400_000);
  const [pending, setPending] = useState<NativeShareMetadata | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null); const [status, setStatus] = useState('');
  const epoch = useRef(0); const operation = useRef(0); const mounted = useRef(true);
  const blockedByLogout = useRef(false); const abort = useRef<AbortController | null>(null);
  const imported = useRef(new Set<string>());
  const invalidateOperations = useCallback(() => { epoch.current++; operation.current++; abort.current?.abort(); }, []);
  const callbacks = useRef({ onInsert, onSafetyChange }); callbacks.current = { onInsert, onSafetyChange };
  const scope = client ? scopeFor(state, client.origin) : null; const key = JSON.stringify(scope);
  const boundaryKey = JSON.stringify({ scope, liveId: state.liveId });
  function current(capturedKey: string, capturedEpoch: number): boolean {
    return mounted.current && !lockedRef.current && !blockedByLogout.current && epoch.current === capturedEpoch
      && JSON.stringify(client ? scopeFor(controller.store.getState(), client.origin) : null) === capturedKey;
  }
  useLayoutEffect(() => {
    epoch.current++; operation.current++; abort.current?.abort(); abort.current = null;
    client?.invalidate(); client?.setScope(scope);
    blockedByLogout.current = false; busyRef.current = false; setBusy(false); setConsent(false);
    setSnapshot(null); setPending(null); setConfirmation(null); setStatus(''); imported.current.clear();
    // The canonical scope is the dependency. Other state updates never restore old saved content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaryKey, client]);
  useEffect(() => {
    if (!client) return;
    let active = true; setReady(false); setSharing(false);
    void client.capabilities().then(value => { if (active) { setReady(value.keychain); setSharing(value.sharing); } }).catch(error => { if (active) { setReady(false); setSharing(false); setStatus(error instanceof NativeBridgeError && error.code === 'unsupported' ? problem(error) : '端末のKeychain・共有権限を確認できません。ブラウザ保存へ切り替えません。'); } });
    return () => { active = false; };
  }, [client, boundaryKey]);
  useEffect(() => {
    if (!client) return;
    mounted.current = true;
    const dispose = bindNativeResume(async () => {
      if (blockedByLogout.current) return;
      await controller.recover();
    });
    const privacy = (): void => {
      if (!document.hidden) return;
      epoch.current++; operation.current++; abort.current?.abort(); client.invalidate();
      lockedRef.current = true; setLocked(true); busyRef.current = false; setBusy(false);
      setSnapshot(null); setPending(null); setConfirmation(null); setConsent(false);
    };
    const resumed = (): void => {
      if (blockedByLogout.current) return;
      lockedRef.current = false; setLocked(false); client.setScope(scopeFor(controller.store.getState(), client.origin));
    };
    document.addEventListener('visibilitychange', privacy); window.addEventListener('hermes-native-resume', resumed);
    return () => {
      mounted.current = false; invalidateOperations(); client.invalidate();
      dispose(); document.removeEventListener('visibilitychange', privacy); window.removeEventListener('hermes-native-resume', resumed);
    };
  }, [client, controller, invalidateOperations]);
  useEffect(() => { if (!client) return; onSafetyChange(busy || Boolean(confirmation)); return () => onSafetyChange(false); }, [client, busy, confirmation, onSafetyChange]);
  useEffect(() => {
    if (!client || !onLogoutPreparation) return;
    onLogoutPreparation(async () => {
      blockedByLogout.current = true; epoch.current++; operation.current++; abort.current?.abort();
      try {
        const selected = scopeFor(controller.store.getState(), client.origin);
        if (selected) { client.setScope(selected); await client.removeSnapshot(); }
      }
      catch { throw new Error('端末保存の消去を確認できません。Keychain認証を要する暗号化保存・共有待ちが端末に残る場合があります。'); }
      finally {
        client.invalidate(); lockedRef.current = true; setLocked(true); setSnapshot(null); setPending(null); setConfirmation(null); setConsent(false);
        busyRef.current = false; setBusy(false);
      }
    });
    return () => onLogoutPreparation(null);
  }, [client, controller, onLogoutPreparation]);
  async function perform(action: (capturedKey: string, capturedEpoch: number) => Promise<void>): Promise<void> {
    if (!client || busyRef.current || !scope || lockedRef.current || blockedByLogout.current) return;
    const selected = scopeFor(controller.store.getState(), client.origin);
    if (!selected || JSON.stringify(selected) !== key) return;
    busyRef.current = true; setBusy(true); setStatus('');
    const id = ++operation.current; const capturedEpoch = epoch.current; const capturedKey = JSON.stringify(selected);
    try { await action(capturedKey, capturedEpoch); }
    catch (error) { if (current(capturedKey, capturedEpoch)) setStatus(problem(error)); }
    finally { if (mounted.current && operation.current === id) { busyRef.current = false; setBusy(false); } }
  }
  async function authenticate(): Promise<void> {
    if (!client || busyRef.current || blockedByLogout.current) return;
    busyRef.current = true; setBusy(true); const id = ++operation.current; const capturedEpoch = epoch.current;
    try {
      await client.authenticate(); if (!mounted.current || capturedEpoch !== epoch.current) return;
      lockedRef.current = false; setLocked(false); client.setScope(scopeFor(controller.store.getState(), client.origin));
      setStatus('端末認証を確認しました。Hermesの認証とは別です。');
    } catch { if (mounted.current && capturedEpoch === epoch.current) setStatus('端末認証を確認できません。内容は取り込んでいません。'); }
    finally { if (mounted.current && operation.current === id) { busyRef.current = false; setBusy(false); } }
  }
  async function importShare(dialog: Confirmation & { kind: 'share' }): Promise<void> {
    if (!current(dialog.scopeKey, dialog.epoch) || controller.store.getState().liveId !== dialog.liveId) return;
    const item = dialog.item;
    setConfirmation(null);
    await perform(async (capturedKey, capturedEpoch) => {
      if (imported.current.has(item.id)) throw new Error('already_imported');
      const before = controller.store.getState(); const generation = controller.imageSelectionGeneration;
      const allowed = (): boolean => current(capturedKey, capturedEpoch) && controller.imageSelectionGeneration === generation
        && controller.store.getState().liveId === before.liveId && !controller.store.getState().submitInProgress
        && !['sending', 'delivery_unknown'].includes(controller.store.getState().delivery);
      if (!before.liveId || before.imageSelecting || !allowed()) throw new NativeBridgeError('scope_changed');
      controller.setImageSelecting(true, before.profile, before.liveId);
      try {
        const value = await client!.acceptShare(item.id); if (!allowed()) return;
        if (!value.text.trim()) throw new Error('empty_caption');
        const localFile = sharedDraftFile(value); const cancellation = new AbortController(); abort.current = cancellation;
        const image = localFile && value.mime.startsWith('image/') ? await prepareImage(localFile, controller.imageLimit, cancellation.signal) : null;
        const document = localFile && !image ? await prepareDocument(localFile, before.documentCapabilities, cancellation.signal) : null;
        if (!allowed() || controller.store.getState().draft !== before.draft || controller.store.getState().attachment !== before.attachment
          || controller.store.getState().document !== before.document) return;
        if (localFile && (before.attachment || before.document)) {
          if (before.attachment?.status !== 'selected' && before.attachment || before.document?.status !== 'selected' && before.document) throw new Error('attachment_busy');
          if (before.attachment) await controller.cancelImage(); if (before.document) controller.cancelDocument();
          if (!allowed() || controller.store.getState().attachment || controller.store.getState().document) return;
        }
        if (image && !controller.selectImage(image, before.profile, before.liveId, generation)
          || document && !controller.selectDocument(document, before.profile, before.liveId, generation)) throw new Error('selection_changed');
        if (!allowed()) return;
        callbacks.current.onInsert(value.text);
        if (!allowed() || controller.store.getState().draft.length < before.draft.length + value.text.length) throw new Error('import_unknown');
        imported.current.add(item.id);
        try { await client!.finishShare(item.id); if (current(capturedKey, capturedEpoch)) { setPending(null); setStatus('下書きへ取り込みました。まだ転送・送信していません。'); } }
        catch { if (current(capturedKey, capturedEpoch)) setStatus('下書きへ取り込みましたが、共有待ちの解除結果は不明です。もう一度取り込まず、共有待ちを確認してください。'); }
      } finally {
        if (controller.imageSelectionGeneration === generation) controller.setImageSelecting(false, before.profile, before.liveId);
        abort.current = null;
      }
    });
  }
  if (!client) return null;
  const disabled = busy || !scope || locked || blockedByLogout.current;
  const importDisabled = disabled || !state.liveId || state.submitInProgress || state.imageSelecting || ['sending', 'delivery_unknown'].includes(state.delivery);
  return <section className="remote-card remote-storage-panel" aria-label="iOS端末連携" hidden={!visible}>
    <h2>iOS端末連携</h2><p className="remote-meta">既存Webの入力・認証・送信経路を使います。共有だけではVPSへ転送しません。</p>
    <button type="button" disabled={busy || blockedByLogout.current} onClick={() => { void authenticate(); }}>端末認証を確認</button>
    {!scope && <p>Hermesに認証し、保存済みの会話を開いてから端末保存と共有取り込みを利用できます。</p>}
    {locked && <p>端末連携は施錠中です。端末認証を確認してください。</p>}
    <h3>Keychainを使う明示保存</h3><p className="remote-meta">現在の下書きと取得済みのユーザー/Hermes本文だけ。保存範囲は1MiB・2,000発言、期限最大7日。ブラウザ保存へ自動移行しません。</p>
    <label className="remote-storage-choice"><input type="checkbox" checked={consent} disabled={disabled || !ready} onChange={event => setConsent(event.target.checked)} /><span>この会話内容が端末の暗号化ファイルに残ることを確認した</span></label>
    <label>保存期限<select value={expiry} disabled={disabled} onChange={event => setExpiry(Number(event.target.value))}><option value={3600_000}>1時間</option><option value={86400_000}>1日</option><option value={7 * 86400_000}>7日</option></select></label>
    <div className="remote-menu-actions"><button disabled={disabled || !ready || !consent} onClick={() => { void perform(async (capturedKey, capturedEpoch) => {
      const value = JSON.stringify(snapshotFrom(controller.store.getState())); await client.saveSnapshot(value, Date.now() + expiry);
      if (current(capturedKey, capturedEpoch)) setStatus('現在時点の下書きと取得済み発言を、端末へ暗号化保存しました。Hermesの履歴は変更していません。');
    }); }}>現在時点を端末へ保存</button>
      <button disabled={disabled || !ready} onClick={() => { void perform(async (capturedKey, capturedEpoch) => {
        const value = await client.readSnapshot(); if (!current(capturedKey, capturedEpoch)) return;
        setSnapshot(value === null ? null : parseSnapshot(value)); setStatus(value === null ? 'この会話の端末保存はありません。' : '保存内容を取得しました。現在のHermes状態を復旧した扱いにはしません。');
      }); }}>端末保存を確認</button>
      <button disabled={disabled || !ready} onClick={() => { void perform(async (capturedKey, capturedEpoch) => {
        await client.removeSnapshot(); if (current(capturedKey, capturedEpoch)) { setSnapshot(null); setStatus('この会話の端末保存と鍵を消去しました。Hermesの履歴は変更していません。'); }
      }); }}>この会話の端末保存を消去</button></div>
    {snapshot && <section aria-label="保存内容の確認"><p>保存時刻: {new Date(snapshot.savedAt).toLocaleString('ja-JP')} · 現在取得済みだった発言{snapshot.messages.length}件{snapshot.partial ? ' · 生成途中の保存' : ''}</p>
      <p className="remote-meta">保存会話は当時の取得範囲です。現在の実行状態・未回答要求はHermesから再同期します。</p>
      <pre className="remote-storage-preview">{snapshot.draft.slice(0, 4000)}</pre>{snapshot.draft.length > 4000 && <p>下書きの表示は先頭4,000文字です。</p>}
      <button disabled={importDisabled || !snapshot.draft} onClick={() => setConfirmation({ kind: 'restore', snapshot, scopeKey: key, epoch: epoch.current, liveId: state.liveId })}>保存した下書きを挿入</button>
      <details><summary>保存した本文を見る（最大50発言・各2,000文字の表示）</summary>{snapshot.messages.slice(0, 50).map((message, index) => <div key={index}><strong>{message.role === 'user' ? 'ユーザー' : 'Hermes'}</strong><pre className="remote-storage-preview">{message.text.slice(0, 2000)}</pre></div>)}</details>
    </section>}
    <h3>共有された下書き</h3><p className="remote-meta">共有待ちは端末内に1件・期限1時間。共有ファイルは最大5MiB。ログアウト時に消去を確認できない共有待ちは暗号化して残る場合があります。</p>
    <button disabled={disabled || !sharing} onClick={() => { void perform(async (capturedKey, capturedEpoch) => {
      const value = await client.pendingShare(); if (current(capturedKey, capturedEpoch)) { setPending(value); setStatus(value ? '端末の共有待ちを確認しました。本文とファイルはまだ取り込んでいません。' : '端末の共有待ちはありません。'); }
    }); }}>共有待ちを確認</button>
    {pending && <div><p>{pending.kind === 'text' ? 'テキスト' : 'ファイル'}: {pending.name} · {(pending.bytes / 1024).toFixed(1)}KiB · 期限{new Date(pending.expiresAt).toLocaleString('ja-JP')}</p>
      <button disabled={importDisabled || imported.current.has(pending.id)} onClick={() => setConfirmation({ kind: 'share', item: pending, scopeKey: key, epoch: epoch.current, liveId: state.liveId })}>確認して下書きへ取り込む</button>
      <button disabled={disabled} onClick={() => { void perform(async (capturedKey, capturedEpoch) => {
        await client.cancelShare(pending.id); if (current(capturedKey, capturedEpoch)) { setPending(null); setStatus('一致する端末内の共有待ちを外しました。共有元の原本とVPSは変更していません。'); }
      }); }}>共有待ちを取消</button></div>}
    {status && <p role="status">{status}</p>}
    {confirmation && <ConfirmDialog label={confirmation.kind === 'share' ? '共有下書きの取り込み確認' : '保存下書きの挿入確認'} onDismiss={() => setConfirmation(null)}>
      <h2>{confirmation.kind === 'share' ? '共有内容を現在の会話へ取り込む' : '保存下書きを現在の会話へ挿入'}</h2><p>宛先: {state.profile} · 現在の保存会話。元の本文下書きを残して入力位置へ挿入します。ここでは送信しません。</p>
      {state.draft && <p>入力中の下書きは置き換えません。確認して追加します。</p>}
      {confirmation.kind === 'share' && confirmation.item.kind === 'file' && (state.attachment || state.document) && <p>確認すると、現在の端末内添付を外して共有ファイルを選択します。送信中・結果不明の添付は置き換えません。</p>}
      {confirmation.kind === 'restore' && <pre className="remote-storage-preview">{confirmation.snapshot.draft.slice(0, 1000)}</pre>}
      <button disabled={importDisabled} onClick={() => {
        if (confirmation.kind === 'share') { void importShare(confirmation); return; }
        const value = confirmation.snapshot.draft; setConfirmation(null);
        if (current(confirmation.scopeKey, confirmation.epoch) && controller.store.getState().liveId === confirmation.liveId
          && !controller.store.getState().submitInProgress && !['sending', 'delivery_unknown'].includes(controller.store.getState().delivery)) callbacks.current.onInsert(value);
      }}>確認して挿入</button><button data-dialog-initial-focus="" autoFocus onClick={() => setConfirmation(null)}>取消</button>
    </ConfirmDialog>}
  </section>;
}
