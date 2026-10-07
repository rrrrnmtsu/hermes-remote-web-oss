import { useEffect, useState } from 'react';
import type { RemoteImage } from '../../../core/src/stores/image-transfer';
import { attachmentStatusLabel } from './attachment-labels';

export function ImageAttachment({ image, onCancel, onDetails, localOnly }: { image: RemoteImage; onCancel(): void; onDetails(): void; localOnly: boolean }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([image.bytes.slice().buffer], { type: image.mime }));
    setPreview(url); return () => URL.revokeObjectURL(url);
  }, [image.bytes, image.mime]);
  return <section className="remote-image-attachment" aria-label="選択した画像">
    <button className="remote-image-details" type="button" aria-label="画像の詳細と注意を確認" onClick={onDetails}>
      {preview && <img src={preview} alt="選択した画像の端末内プレビュー" />}</button>
    <div className="remote-image-copy"><div className="remote-image-name"><strong>{image.name}</strong><span className="remote-meta">{(image.bytes.byteLength / 1024).toFixed(1)}KiB</span></div>
      <span className="remote-meta" role="status">{attachmentStatusLabel('image', image.status, localOnly)}</span>
      {!localOnly && <span className="remote-meta">実モデルでの画像解析は未確認</span>}</div>
    <button type="button" aria-label={'画像の選択を取消'}
      disabled={image.status !== 'selected'} onClick={onCancel}>取消</button>
  </section>;
}
