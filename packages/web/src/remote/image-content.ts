import { IMAGE_RAW_LIMIT, type ImageSelection } from '../../../core/src/stores/image-transfer';
import { imageHeader } from '../../../core/src/stores/image-header';
export { imageHeader };

/** Read bounded bytes/header before decoding; filename and accept/MIME are not evidence. */
export async function prepareImage(file: File, limit = IMAGE_RAW_LIMIT, signal?: AbortSignal): Promise<ImageSelection> {
  if (!file.size || file.size > limit) throw new Error(`画像の容量上限は${(limit / 1048576).toFixed(2)}MiBです。`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > limit) throw new Error('実際の画像bytesが申告容量または容量上限と一致しません。');
  signal?.throwIfAborted();
  const info = imageHeader(bytes);
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (file.type && file.type !== info.mime || extension && ['png', 'jpg', 'jpeg'].includes(extension)
    && (extension === 'png') !== (info.mime === 'image/png')) throw new Error('画像bytesとMIME・拡張子が一致しません。JPEG/PNGとして保存し直してください。');
  const url = URL.createObjectURL(new Blob([bytes], { type: info.mime }));
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      const finish = (error?: Error): void => {
        window.clearTimeout(timer); signal?.removeEventListener('abort', abort);
        image.onload = null; image.onerror = null; image.src = '';
        error ? reject(error) : resolve();
      };
      const abort = (): void => finish(new Error('画像の選択を取消しました。'));
      const timer = window.setTimeout(() => finish(new Error('端末内の画像確認がタイムアウトしました。転送していません。')), 15_000);
      signal?.addEventListener('abort', abort, { once: true });
      image.onload = () => {
        const valid = image.naturalWidth === info.width && image.naturalHeight === info.height;
        finish(valid ? undefined : new Error('画像の実寸法を確認できません。'));
      };
      image.onerror = () => finish(new Error('画像が破損しているため表示できません。'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
  const name = [...(file.name.split(/[\\/]/).at(-1) || '画像')].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 120);
  return { ...info, name, bytes };
}
