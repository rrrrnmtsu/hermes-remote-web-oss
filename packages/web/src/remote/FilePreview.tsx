import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { FileContent } from '../../../core/src/features/files';
import { safeMarkdownUrl } from './safe-markdown';
import { contentBlob } from './file-content';
import { revealDialogControl } from './dialog-focus';

/** URLs exist only for this memory snapshot; neither logs, navigation nor storage retain them. */
export function FilePreview({ content, onClose }: { content: FileContent; onClose(): void }) {
  const [url, setUrl] = useState('');
  const [confirmation, setConfirmation] = useState<'save' | 'share' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [sharing, setSharing] = useState(false);
  const revision = useRef(0), pendingShare = useRef(false);
  const resourceContent = useRef<FileContent | null>(null);
  const returnAction = useRef<HTMLButtonElement | null>(null);
  const confirmationCancel = useRef<HTMLButtonElement>(null);
  const restoreAfterShare = useRef(false);
  const confirmationId = useId(), descriptionId = useId();
  useEffect(() => {
    const snapshotRevision = ++revision.current;
    pendingShare.current = false; resourceContent.current = null; restoreAfterShare.current = false;
    setConfirmation(null); setFeedback(''); setUrl(''); setBlob(null);
    setSharing(false);
    let objectUrl: string | null = null;
    try {
      const value = contentBlob(content); objectUrl = URL.createObjectURL(value);
      resourceContent.current = content;
      setBlob(value); setUrl(objectUrl);
    } catch { setFeedback('この形式・容量のプレビューを安全に作成できません。'); }
    return () => {
      revision.current = snapshotRevision + 1; resourceContent.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [content]);
  useLayoutEffect(() => {
    if (!confirmation) return;
    const target = confirmationCancel.current;
    target?.focus({ preventScroll: true });
    const dialog = target?.closest('dialog');
    if (target && dialog) revealDialogControl(dialog, target);
  }, [confirmation]);
  useEffect(() => {
    if (sharing || !restoreAfterShare.current) return;
    restoreAfterShare.current = false;
    // A delayed OS share response must not steal focus from another control.
    if (document.activeElement === document.body) returnAction.current?.focus({ preventScroll: true });
  }, [sharing, feedback]);
  const available = Boolean(url && blob && resourceContent.current === content);
  const openConfirmation = (kind: 'save' | 'share', button: HTMLButtonElement) => {
    if (!available || pendingShare.current) return;
    returnAction.current = button; setConfirmation(kind);
  };
  const cancelConfirmation = () => {
    setConfirmation(null);
    returnAction.current?.focus({ preventScroll: true });
  };
  const binary = content.mime.startsWith('image/') || content.mime === 'application/pdf';
  const extensions: Record<string, string> = { 'text/markdown': 'md', 'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
  const filename = `hermes-artifact-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')}.${extensions[content.mime] || 'txt'}`;
  return <section className="remote-file-preview" aria-label="ファイルの内容" aria-busy={sharing || undefined}><button type="button" onClick={onClose}>一覧へ戻る</button><h3>{content.name}</h3>
    <p>{content.bytes.toLocaleString('ja-JP')} bytes · 読み取った時点の固定スナップショット · 最大1MiB</p>
    {content.mime === 'text/markdown' ? <ReactMarkdown skipHtml urlTransform={safeMarkdownUrl} components={{
      img: ({ alt }) => <span>画像: {alt || '外部画像は表示しません'}</span>,
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children} ↗</a> : <span>{children}</span>,
    }}>{content.text || ''}</ReactMarkdown> : !binary ? <pre>{content.text}</pre> : content.mime.startsWith('image/') ? available && <img src={url} alt={`読み取り確認済みの画像: ${content.name}`} /> : <>
      {available && <iframe title="PDFプレビュー" src={url} sandbox="" referrerPolicy="no-referrer" />}
      <p>PDFはscriptを許可せず表示します。ブラウザで表示できない場合は、保存後に端末の閲覧アプリで確認してください。</p>
    </>}
    <div className="remote-file-actions">
      <button type="button" disabled={!available || sharing} aria-expanded={confirmation === 'save'} aria-controls={confirmation === 'save' ? confirmationId : undefined}
        onClick={event => openConfirmation('save', event.currentTarget)}>ファイルを保存</button>
      {typeof navigator.share === 'function' && <button type="button" disabled={!available || sharing} aria-expanded={confirmation === 'share'} aria-controls={confirmation === 'share' ? confirmationId : undefined}
        onClick={event => openConfirmation('share', event.currentTarget)}>端末の共有メニュー</button>}
    </div>
    {confirmation && <div id={confirmationId} role="group" aria-label="ファイル保存の確認"><p id={descriptionId}>この1ファイル（{content.bytes.toLocaleString('ja-JP')} bytes）が{confirmation === 'share' ? '選択した共有先へ渡ります' : '端末のファイルに残ります'}。本文や画像に機密が含まれる場合があります。自動除去はしていません。</p>
      <div className="remote-file-actions"><button ref={confirmationCancel} type="button" aria-describedby={descriptionId} onClick={cancelConfirmation}>取消</button>
      <button type="button" disabled={!available || sharing} aria-describedby={descriptionId} onClick={() => {
        if (!blob || !available || pendingShare.current) return;
        setConfirmation(null);
        if (confirmation === 'save') {
          const link = document.createElement('a'); link.href = url; link.download = filename;
          try {
            document.body.append(link); link.click();
            setFeedback('ブラウザへ保存を依頼しました。端末側での保存完了は確認できません。');
          } catch { setFeedback('ブラウザへ保存を依頼できませんでした。内容はこの画面だけにあります。'); }
          finally { link.remove(); returnAction.current?.focus({ preventScroll: true }); }
        } else {
          const snapshotRevision = revision.current;
          const finish = (message: string) => {
            if (revision.current !== snapshotRevision || resourceContent.current !== content) return;
            pendingShare.current = false; restoreAfterShare.current = true; setSharing(false); setFeedback(message);
          };
          try {
            const file = new File([blob], filename, { type: content.mime });
            if (!navigator.canShare?.({ files: [file] })) {
              setFeedback('このブラウザではファイル共有できません。保存操作を利用してください。');
              returnAction.current?.focus({ preventScroll: true }); return;
            }
            pendingShare.current = true; setSharing(true); setFeedback('端末の共有メニューで操作してください。');
            // Invoke from the explicit click while its user activation is still valid.
            void navigator.share({ files: [file] }).then(
              () => finish('端末の共有操作が終了しました。共有先での保存は確認できません。'),
              () => finish('共有を完了できませんでした。内容はこの画面だけにあります。'));
          } catch { finish('共有を開始できませんでした。保存操作を利用してください。'); }
        }
      }}>{confirmation === 'share' ? '共有先を選ぶ' : '保存を開始'}</button></div>
    </div>}
    <p role="status">{feedback}</p>
  </section>;
}
