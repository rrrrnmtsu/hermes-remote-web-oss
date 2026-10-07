import { documentLimits, type DocumentCapabilities, type RemoteDocument } from '../../../core/src/features/documents';
import { attachmentStatusLabel } from './attachment-labels';
import './FileAttachment.css';

/** All operations come from the shared controller; selection/cancel never uploads. */
export function FileAttachment({ document, localOnly, onCancel, onDetails, capabilities }: {
  document: RemoteDocument; localOnly: boolean; onCancel(): void; onDetails(): void; capabilities?: DocumentCapabilities | null;
}) {
  const limits = documentLimits(capabilities);
  return <section className="remote-file-attachment" aria-label="選択した資料">
    <div className="remote-file-name"><strong>{document.name}</strong><span className="remote-meta">{document.format} · {(document.bytes.byteLength / 1024).toFixed(1)}KiB</span></div>
    <span className="remote-meta" role="status">{attachmentStatusLabel('document', document.status, localOnly)}</span>
    {document.format === 'PDF' ? <p className="remote-meta">PDF原本を添付し、サーバーで最大{limits.pages}頁のテキストを抽出します。ページ画像化は行いません。暗号化・破損・文字のないPDFは送信時に拒否します。</p>
      : <><pre className="remote-file-preview">{document.preview}</pre>{document.previewTruncated && <span className="remote-meta">プレビューは先頭4,000文字まで。送信時は上限内の本文を検証します。</span>}</>}
    <p className="remote-meta">選択だけでは転送しません。送信すると原本がVPSに残り、抽出テキストが生成先へ渡ります。原本のメタデータは除去していません。</p>
    <div className="remote-file-actions"><button type="button" aria-label="資料の詳細と上限" title="資料の詳細と上限" onClick={onDetails}>詳細</button>
      <button type="button" aria-label="添付を外す" title="添付を外す" disabled={document.status !== 'selected'} onClick={onCancel}>外す</button></div>
  </section>;
}
