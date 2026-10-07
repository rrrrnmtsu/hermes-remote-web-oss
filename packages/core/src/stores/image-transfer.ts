import { imageHeader, IMAGE_MAX_EDGE, IMAGE_MAX_PIXELS } from './image-header';

export const IMAGE_RAW_LIMIT = 5 * 1024 * 1024;
export { IMAGE_MAX_EDGE, IMAGE_MAX_PIXELS } from './image-header';
export const IMAGE_UNAVAILABLE = 'このHermesでは画像付きターンの契約または画像解析対応を確認できないため、端末内プレビューのみ・画像送信は未対応です。添付を外すと通常の本文を送信できます。';
export type ImageStatus = 'selected' | 'uploading' | 'accepted' | 'delivery_unknown';
export type ImageQueue = 'unavailable' | 'checking' | 'empty' | 'own' | 'foreign' | 'unknown';
export interface ImageSelection {
  name: string;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: Uint8Array;
}
export interface RemoteImage extends ImageSelection { status: ImageStatus }
export interface ImageScope { profile: string; sessionId: string }
export interface ImageLimits { backendBytes: number; websocketBytes: number; proxyBytes: number }

export function imageRawLimit(limits?: ImageLimits): number {
  if (!limits) return IMAGE_RAW_LIMIT; // Local preview only; not a verified transfer allowance.
  const values = Object.values(limits);
  if (values.some(value => !Number.isSafeInteger(value) || value <= 4096)) return 0;
  return Math.max(0, Math.min(IMAGE_RAW_LIMIT, limits.backendBytes,
    Math.floor((Math.min(limits.websocketBytes, limits.proxyBytes) - 4096) / 4) * 3));
}
export function validateImageSelection(image: ImageSelection, limit: number): boolean {
  try {
    const header = imageHeader(image.bytes);
    if (header.mime !== image.mime || header.width !== image.width || header.height !== image.height) return false;
  } catch { return false; }
  return (image.mime === 'image/jpeg' || image.mime === 'image/png') && image.bytes.byteLength > 0 && image.bytes.byteLength <= limit
    && Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height) && image.width > 0 && image.height > 0
    && image.width <= IMAGE_MAX_EDGE && image.height <= IMAGE_MAX_EDGE && image.width * image.height <= IMAGE_MAX_PIXELS;
}
/** Bounded encoding with no browser globals or provider calls. */
export function imageBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const parts: string[] = [];
  let part = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    part += alphabet[(value >>> 18) & 63]! + alphabet[(value >>> 12) & 63]!
      + (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63]! : '=') + (i + 2 < bytes.length ? alphabet[value & 63]! : '=');
    if (part.length >= 8192) { parts.push(part); part = ''; }
  }
  return parts.join('') + part;
}
