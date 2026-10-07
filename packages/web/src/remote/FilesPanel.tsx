import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FileEntry, FilesState } from '../../../core/src/features/files';
import { ConfirmDialog } from './ConfirmDialog';
import { FilePreview } from './FilePreview';
import { revealDialogControl } from './dialog-focus';
import './FilesPanel.css';

export interface FilesPanelProps { state: FilesState; onLoadRoots(): void; onBrowse(root: string, path?: string): void; onOpen(entry: FileEntry): void; onCloseContent(): void; onClose(): void; }
export function FilesPanel({ state, onLoadRoots, onBrowse, onOpen, onCloseContent, onClose }: FilesPanelProps) {
  const load = useRef(onLoadRoots); load.current = onLoadRoots;
  const scopeKey = JSON.stringify(state.scope);
  const busy = [state.rootsLoad, state.listLoad, state.contentLoad].includes('loading');
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const positionScope = useRef(scopeKey);
  const showingContent = Boolean(state.content), previousContent = useRef(showingContent);
  const selectedFile = useRef<string | null>(null);
  const fileButtons = useRef(new Map<string, HTMLButtonElement>());
  const positionKey = `${state.rootId}\u0000${state.path}`;
  useLayoutEffect(() => {
    if (positionScope.current !== scopeKey) {
      positions.current.clear(); selectedFile.current = null; previousContent.current = false; positionScope.current = scopeKey;
    }
    if (scroll.current) scroll.current.scrollTop = showingContent ? 0 : positions.current.get(positionKey) || 0;
    const target = showingContent && document.activeElement === document.body
      ? scroll.current?.querySelector<HTMLButtonElement>('.remote-file-preview > button')
      : previousContent.current && !showingContent && selectedFile.current ? fileButtons.current.get(selectedFile.current) : null;
    if (target) {
      target.focus({ preventScroll: true }); const dialog = target.closest('dialog'); if (dialog) revealDialogControl(dialog, target);
    }
    previousContent.current = showingContent;
  }, [scopeKey, positionKey, showingContent]);
  useEffect(() => { load.current(); }, [scopeKey]);
  return <ConfirmDialog label="登録projectのファイル" className="remote-files" onDismiss={onClose}>
    <header><h2>登録projectのファイル</h2><button data-dialog-initial-focus="" type="button" onClick={onClose}>閉じる</button></header>
    <div ref={scroll} className="remote-files-scroll" role="region" aria-label="ファイルの一覧と内容" tabIndex={0} aria-busy={busy}
      onScroll={event => { if (!showingContent && !busy) positions.current.set(positionKey, event.currentTarget.scrollTop); }}>
      <p>profile: {state.scope?.profile || '未選択'} · この会話のproject/cwd所属の登録先 · 読み取り専用 · 1フォルダー最大100件・1ファイル最大1MiB。秘密・内部・リンクの項目は除外します。</p>
      {state.error && <p role="alert">{state.error}</p>}
      {busy && <p role="status">読み取り中…</p>}
      {[state.rootsLoad, state.listLoad, state.contentLoad].includes('unsupported') && <p>このHermes版では、この読み取りに未対応です。</p>}
      {state.content ? <FilePreview content={state.content} onClose={onCloseContent} /> : <>
        <button type="button" disabled={busy} aria-busy={state.rootsLoad === 'loading'} onClick={onLoadRoots}>登録先を再取得</button>
        {state.contentLoad === 'error' && <p>内容を開く前に、この一覧を再取得して現在の状態を確認してください。</p>}
        {state.rootsLoad === 'ready' && !state.roots.length && <p>この範囲に閲覧可能な登録projectなし</p>}
        <ul>{state.roots.map(root => <li key={root.id}><button type="button" disabled={busy} aria-pressed={root.id === state.rootId} onClick={() => onBrowse(root.id, '')}>{root.name || '名称なし'} / {root.folder_name}</button></li>)}</ul>
        {state.rootId && <><p>相対位置: {state.path || '登録folderの先頭'}</p>
          {state.path && <button type="button" disabled={busy} onClick={() => onBrowse(state.rootId, state.path.split('/').slice(0, -1).join('/'))}>上のフォルダーへ</button>}
          <button type="button" disabled={busy} aria-busy={state.listLoad === 'loading'} onClick={() => onBrowse(state.rootId, state.path)}>この一覧を再取得</button>
          <ul>{state.entries.map(entry => <li key={entry.path}><button type="button"
            ref={node => { if (node) fileButtons.current.set(entry.path, node); else fileButtons.current.delete(entry.path); }}
            disabled={busy || !entry.directory && (!entry.readable || state.listLoad !== 'ready' || state.contentLoad === 'error')}
            onClick={() => { if (entry.directory) onBrowse(state.rootId, entry.path); else { selectedFile.current = entry.path; onOpen(entry); } }}>{entry.directory ? 'フォルダー: ' : ''}{entry.name}</button>
            {!entry.directory && <span>{entry.bytes?.toLocaleString('ja-JP')} bytes · {entry.mime || '未対応形式'}{entry.reason === 'size_limit' ? ' · 1MiBの上限超過' : entry.reason ? ' · 閲覧未対応' : ''}</span>}</li>)}</ul>
          {state.listLoad === 'ready' && !state.entries.length && <p>この読み取り範囲に表示できる項目なし</p>}
        </>}
        {state.truncated && <p>上限で読み取りを打ち切りました。全項目を取得した一覧ではありません。</p>}
      </>}
    </div>
  </ConfirmDialog>;
}
