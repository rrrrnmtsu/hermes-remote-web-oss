import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ArtifactEntry, FilesState } from '../../../core/src/features/files';
import { ConfirmDialog } from './ConfirmDialog';
import { FilePreview } from './FilePreview';
import { revealDialogControl } from './dialog-focus';
import './FilesPanel.css';

export interface ArtifactPanelProps { state: FilesState; onLoad(): void; onOpen(entry: ArtifactEntry): void; onCloseContent(): void; onClose(): void; }
export function ArtifactPanel({ state, onLoad, onOpen, onCloseContent, onClose }: ArtifactPanelProps) {
  const load = useRef(onLoad); load.current = onLoad;
  const scopeKey = JSON.stringify(state.scope);
  const busy = [state.artifactsLoad, state.contentLoad].includes('loading');
  const scroll = useRef<HTMLDivElement>(null), listPosition = useRef(0);
  const positionScope = useRef(scopeKey);
  const showingContent = Boolean(state.content), previousContent = useRef(showingContent);
  const selectedArtifact = useRef<string | null>(null);
  const artifactButtons = useRef(new Map<string, HTMLButtonElement>());
  useLayoutEffect(() => {
    if (positionScope.current !== scopeKey) {
      listPosition.current = 0; selectedArtifact.current = null; previousContent.current = false; positionScope.current = scopeKey;
    }
    if (scroll.current) scroll.current.scrollTop = showingContent ? 0 : listPosition.current;
    const target = showingContent && document.activeElement === document.body
      ? scroll.current?.querySelector<HTMLButtonElement>('.remote-file-preview > button')
      : previousContent.current && !showingContent && selectedArtifact.current ? artifactButtons.current.get(selectedArtifact.current) : null;
    if (target) {
      target.focus({ preventScroll: true }); const dialog = target.closest('dialog'); if (dialog) revealDialogControl(dialog, target);
    }
    previousContent.current = showingContent;
  }, [scopeKey, showingContent]);
  useEffect(() => { load.current(); }, [scopeKey]);
  return <ConfirmDialog label="この会話の成果物" className="remote-files" onDismiss={onClose}>
    <header><h2>この会話の成果物</h2><button data-dialog-initial-focus="" type="button" onClick={onClose}>閉じる</button></header>
    <div ref={scroll} className="remote-files-scroll" role="region" aria-label="成果物の一覧と内容" tabIndex={0} aria-busy={busy}
      onScroll={event => { if (!showingContent && !busy) listPosition.current = event.currentTarget.scrollTop; }}>
      <p>この認証利用者・profile・保存会話に正式登録された成果物だけ。正式metadata付きの最近のtool行100件が対象です。本文中のパスから追加しません。</p>
      {state.error && <p role="alert">{state.error}</p>}
      {busy && <p role="status">成果物を確認中…</p>}
      {[state.artifactsLoad, state.contentLoad].includes('unsupported') && <p>このHermes版では、正式な成果物の取得に未対応です。</p>}
      {state.content ? <FilePreview content={state.content} onClose={onCloseContent} /> : <>
        <button type="button" disabled={busy} aria-busy={state.artifactsLoad === 'loading'} onClick={onLoad}>成果物を再取得</button>
        {state.contentLoad === 'error' && <p>内容を開く前に、成果物の一覧を再取得して現在の状態を確認してください。</p>}
        {state.artifactsLoad === 'ready' && !state.artifacts.length && <p>取得した範囲に正式登録された成果物なし。過去の回答にファイル名があっても、この一覧へ自動追加しません。</p>}
        <ul>{state.artifacts.map(entry => <li key={entry.id}><button type="button"
          ref={node => { if (node) artifactButtons.current.set(entry.id, node); else artifactButtons.current.delete(entry.id); }}
          disabled={busy || state.artifactsLoad !== 'ready' || state.contentLoad === 'error'}
          onClick={() => { selectedArtifact.current = entry.id; onOpen(entry); }}>{entry.name}</button><span>{entry.mime} · {entry.bytes.toLocaleString('ja-JP')} bytes</span></li>)}</ul>
        {state.artifactsTruncated && <p>取得上限に達しました。全成果物を網羅した一覧ではありません。</p>}
      </>}
    </div>
  </ConfirmDialog>;
}
