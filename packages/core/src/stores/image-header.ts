export const IMAGE_MAX_EDGE = 8192;
export const IMAGE_MAX_PIXELS = 16_000_000;

export function imageHeader(bytes: Uint8Array): { mime: 'image/jpeg' | 'image/png'; width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  let mime: 'image/jpeg' | 'image/png';
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) {
    mime = 'image/png';
    let offset = 8, ihdr = false, idat = false, end = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset);
      const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (size > bytes.length - offset - 12) throw new Error('PNGの構造が破損しています。');
      if (offset === 8 && (kind !== 'IHDR' || size !== 13)) throw new Error('PNGのヘッダーが不正です。');
      if (kind === 'IHDR') {
        if (ihdr) throw new Error('PNGのヘッダーが重複しています。');
        ihdr = true; width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      }
      if (kind === 'acTL') throw new Error('アニメーション画像は対象外です。');
      if (kind === 'IDAT') idat = true;
      offset += size + 12;
      if (kind === 'IEND') { end = size === 0 && offset === bytes.length; break; }
    }
    if (!ihdr || !idat || !end) throw new Error('PNGの内容が欠けています。');
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mime = 'image/jpeg';
    if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('JPEGの内容が欠けています。');
    let offset = 2, scan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) throw new Error('JPEGの構造が不正です。');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 0xd9 || marker === 0x00 || marker === 0xd8) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) throw new Error('JPEGの構造が破損しています。');
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8 || width) throw new Error('JPEGの寸法ヘッダーが不正です。');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      if (marker === 0xda) { scan = true; break; }
      offset += size;
    }
    if (!scan || !width) throw new Error('JPEGの画像データを確認できません。');
  } else throw new Error('実際の画像bytesがJPEG/PNGではありません。SVG・HEIC・GIF・PDF等は対象外です。');
  if (!width || !height || width > IMAGE_MAX_EDGE || height > IMAGE_MAX_EDGE || width * height > IMAGE_MAX_PIXELS)
    throw new Error('画像の寸法上限は各辺8,192px・合計1,600万画素です。小さいJPEG/PNGを選んでください。');
  return { mime, width, height };
}

