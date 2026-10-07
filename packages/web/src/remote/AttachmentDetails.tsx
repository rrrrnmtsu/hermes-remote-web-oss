import { useEffect, useState } from 'react';
import { IMAGE_MAX_EDGE, IMAGE_MAX_PIXELS, type RemoteImage } from '../../../core/src/stores/image-transfer';
import { documentLimits, type DocumentCapabilities, type RemoteDocument } from '../../../core/src/features/documents';
import type { ImageTurnCapabilities } from '../../../core/src/vendor/hermes/gateway-contract.generated';
import { ConfirmDialog } from './ConfirmDialog';
import { attachmentStatusLabel } from './attachment-labels';
import './AttachmentDetails.css';

type DetailsProps = { onDismiss(): void; onCancel(): void; localOnly: boolean; rawLimit: number } & (
  { kind: 'image'; image: RemoteImage; capabilities: ImageTurnCapabilities | null }
  | { kind: 'document'; document: RemoteDocument; capabilities: DocumentCapabilities | null }
);

/** Reads only the currently selected memory payload; no fetch, export, decode of PDFs or storage. */
export function AttachmentDetails(props: DetailsProps) {
  const attachment = props.kind === 'image' ? props.image : props.document;
  const subject = props.kind === 'image' ? '画像' : '資料';
  const bytes = props.kind === 'image' ? props.image.bytes : null;
  const mime = props.kind === 'image' ? props.image.mime : null;
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!bytes || !mime) return;
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes, mime]);
  const documentLimit = props.kind === 'document' ? documentLimits(props.capabilities) : null;
  return <ConfirmDialog label={`${subject}の詳細`} className="remote-sheet remote-attachment-detail" dismissOnBackdrop onDismiss={props.onDismiss}>
    <div className="remote-sheet-heading"><h2>{subject}の詳細</h2>
      <button autoFocus data-dialog-initial-focus type="button" onClick={props.onDismiss}>閉じる</button></div>
    <p className="remote-attachment-filename"><strong>{attachment.name}</strong></p>
    <p role={attachment.status === 'delivery_unknown' ? 'alert' : 'status'}>{attachmentStatusLabel(props.kind, attachment.status, props.localOnly)}</p>
    {props.kind === 'image' ? <>
      {preview && <img className="remote-attachment-image-preview" src={preview} alt="選択した画像の端末内プレビュー" />}
      <dl className="remote-attachment-facts">
        <dt>形式・寸法</dt><dd>{props.image.mime === 'image/png' ? 'PNG' : 'JPEG'} · {props.image.width}×{props.image.height}px</dd>
        <dt>選択できる寸法</dt><dd>各辺{Math.min(IMAGE_MAX_EDGE, props.capabilities?.max_edge ?? IMAGE_MAX_EDGE).toLocaleString('ja-JP')}px・{Math.floor(Math.min(IMAGE_MAX_PIXELS, props.capabilities?.max_pixels ?? IMAGE_MAX_PIXELS) / 10_000).toLocaleString('ja-JP')}万画素まで</dd>
      </dl>
      <p className="remote-meta">メタデータは除去していません。送信すると原本がVPSに残り得ます。生成時には画像が生成先へ渡ります。実モデルでの画像解析は未確認です。</p>
    </> : <>
      {props.document.format === 'PDF' ? <p>PDF原本を添付し、サーバーで最大{documentLimit!.pages}頁のテキストを抽出します。端末内でPDFのページ表示・画像化は行いません。暗号化・破損・文字のないPDFは送信時に拒否します。</p>
        : <><pre className="remote-attachment-text-preview" aria-label="選択した資料の端末内プレビュー">{props.document.preview}</pre>
          {props.document.previewTruncated && <p className="remote-meta">プレビューは先頭4,000文字までです。省略部分を含む原本を送信時に検証します。</p>}</>}
      <dl className="remote-attachment-facts"><dt>形式</dt><dd>{props.document.format}</dd>
        <dt>抽出テキストの上限</dt><dd>{documentLimit!.extractedBytes / 1024}KiB</dd></dl>
      <p className="remote-meta">送信すると原本がVPSに残り、抽出テキストが生成先へ渡ります。原本のメタデータは除去していません。</p>
    </>}
    <dl className="remote-attachment-facts"><dt>原本の容量</dt><dd>{(attachment.bytes.byteLength / 1024).toFixed(1)}KiB</dd>
      <dt>端末内の容量上限</dt><dd>{(props.rawLimit / 1048576).toFixed(2)}MiB</dd>
      <dt>base64での容量</dt><dd>{(Math.ceil(attachment.bytes.byteLength / 3) * 4 / 1024).toFixed(1)}KiB + 本文・通信形式</dd></dl>
    {attachment.status === 'selected' ? <>
      <p className="remote-meta">選択・プレビューだけでは転送しません。短い説明本文を書き、会話の送信ボタンから明示送信してください。生成先・通信の上限は送信直前にも検証します。</p>
      <button type="button" className="remote-menu-action" onClick={props.onCancel}>添付を外す</button>
      <p className="remote-meta">「添付を外す」は端末内の選択を外します。本文の下書きは残ります。</p>
    </> : <p className="remote-meta">転送開始後の添付はこの画面から外せません。閉じても送信・実行やVPS原本は取消・削除されません。</p>}
  </ConfirmDialog>;
}
