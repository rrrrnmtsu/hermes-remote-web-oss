import type { RemoteImage } from '../../../core/src/stores/image-transfer';

export type AttachmentKind = 'image' | 'document';

/** Transfer status never stands in for generation completion or cancellation. */
export function attachmentStatusLabel(kind: AttachmentKind, status: RemoteImage['status'], localOnly: boolean): string {
  const subject = kind === 'image' ? '画像' : '資料';
  if (status === 'selected') return localOnly ? `端末内プレビューのみ · ${subject}送信は未対応` : '端末内のみ · 未転送';
  if (status === 'uploading') return `${subject}と本文を送信中 · 受付は未確認`;
  if (status === 'delivery_unknown') return `${subject}と本文の送信結果不明 · 自動再送しません`;
  return '当該本文ターンの受付確認済み · 生成状態は別途確認';
}
