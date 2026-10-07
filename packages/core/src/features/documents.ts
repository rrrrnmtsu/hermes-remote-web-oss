import { imageBase64 } from '../stores/image-transfer';

export const DOCUMENT_FRAME_LIMIT = 8 * 1024 * 1024;
export const DOCUMENT_CAPTION_LIMIT = 64 * 1024;
export const DOCUMENT_ENVELOPE_RESERVE = 16 * 1024;
export const DOCUMENT_RAW_LIMIT = Math.floor((DOCUMENT_FRAME_LIMIT - 6 * DOCUMENT_CAPTION_LIMIT - DOCUMENT_ENVELOPE_RESERVE) / 4) * 3;
export const DOCUMENT_EXTRACTED_LIMIT = 128 * 1024;
export const DOCUMENT_MODEL_INPUT_LIMIT = 256 * 1024;
export const DOCUMENT_MAX_PAGES = 20;
export const DOCUMENT_UNAVAILABLE = 'このHermesでは資料付きターンの契約を確認できないため、端末内プレビューのみ・資料送信は未対応です。添付を外すと通常の本文を送信できます。';

export type DocumentFormat = 'TXT' | 'MARKDOWN' | 'CSV' | 'PDF';
export interface DocumentSelection {
  name: string;
  format: DocumentFormat;
  bytes: Uint8Array;
  preview: string;
  previewTruncated: boolean;
  extraction: 'utf8' | 'pdf_text_pending';
}
export interface RemoteDocument extends DocumentSelection {
  status: 'selected' | 'uploading' | 'accepted' | 'delivery_unknown';
}
export interface DocumentTurnPayload { filename: string; content_base64: string }
export interface DocumentTurnReceipt {
  receipt_id: string;
  format: DocumentFormat;
  bytes: number;
  text_bytes: number;
  pages: number | null;
  extraction: 'utf8' | 'pdf_text';
  truncated: false;
}
export interface DocumentCapabilities {
  version: 1;
  enabled: boolean;
  reason: string;
  formats: DocumentFormat[];
  max_raw_bytes: number;
  max_frame_bytes: number;
  max_text_bytes: number;
  max_extracted_bytes: number;
  max_pages: number;
  model_input_max_bytes: number;
  extraction: 'text_only';
  generation_verified: false;
}
export interface DocumentLimits { rawBytes: number; frameBytes: number; captionBytes: number; extractedBytes: number; pages: number }

/** Defaults permit only a bounded local preview, never proof of server support. */
export function documentLimits(capabilities?: DocumentCapabilities | null): DocumentLimits {
  if (!capabilities) return { rawBytes: DOCUMENT_RAW_LIMIT, frameBytes: DOCUMENT_FRAME_LIMIT,
    captionBytes: DOCUMENT_CAPTION_LIMIT, extractedBytes: DOCUMENT_EXTRACTED_LIMIT, pages: DOCUMENT_MAX_PAGES };
  const fields = [capabilities.max_raw_bytes, capabilities.max_frame_bytes, capabilities.max_text_bytes,
    capabilities.max_extracted_bytes, capabilities.max_pages, capabilities.model_input_max_bytes];
  if (capabilities.version !== 1 || fields.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    return { rawBytes: 0, frameBytes: 0, captionBytes: 0, extractedBytes: 0, pages: 0 };
  }
  const frameBytes = Math.min(DOCUMENT_FRAME_LIMIT, capabilities.max_frame_bytes);
  const captionBytes = Math.min(DOCUMENT_CAPTION_LIMIT, capabilities.max_text_bytes);
  return { rawBytes: Math.max(0, Math.min(DOCUMENT_RAW_LIMIT, capabilities.max_raw_bytes,
    Math.floor((frameBytes - 6 * captionBytes - DOCUMENT_ENVELOPE_RESERVE) / 4) * 3)), frameBytes, captionBytes,
  extractedBytes: Math.min(DOCUMENT_EXTRACTED_LIMIT, capabilities.max_extracted_bytes), pages: Math.min(DOCUMENT_MAX_PAGES, capabilities.max_pages) };
}

export function documentFormat(name: string): DocumentFormat | null {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return extension === 'txt' ? 'TXT' : extension === 'md' || extension === 'markdown' ? 'MARKDOWN'
    : extension === 'csv' ? 'CSV' : extension === 'pdf' ? 'PDF' : null;
}

/** Validate bytes, not accept/MIME. No HTML rendering, PDF decoding, paths or network. */
export function validateDocumentBytes(bytes: Uint8Array, format: DocumentFormat, limits: DocumentLimits): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > limits.rawBytes) throw new Error(`資料の実際の容量が上限${(limits.rawBytes / 1048576).toFixed(2)}MiBを超えるか、空です。`);
  if (format === 'PDF') {
    const header = String.fromCharCode(...bytes.subarray(0, 8));
    const tail = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 32))).trimEnd();
    if (!/^%PDF-[12]\.[0-9]/.test(header) || !tail.endsWith('%%EOF')) throw new Error('PDFの実際の形式を確認できません。破損または形式偽装の可能性があります。');
    return null; // Full PDF validation/extraction is exclusively server-side and resource bounded.
  }
  if (bytes.includes(0)) throw new Error('NULを含む資料は対応していません。UTF-8のテキストを選んでください。');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('テキスト資料はUTF-8に保存し直してください。'); }
  const binaryControl = [...text].some(char => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char));
  if (/^\s*(?:<!doctype\s+html|<html\b|<svg\b|<\?xml\b|%PDF-)/i.test(text)
    || !text.trim() || binaryControl) throw new Error('空・バイナリ・HTML/SVG等の形式を偽装した資料は対応していません。');
  if (new TextEncoder().encode(text).byteLength > limits.extractedBytes) throw new Error(`資料のテキスト上限は${limits.extractedBytes / 1024}KiBです。小さい資料を選んでください。`);
  return text;
}

/** Fix bytes/name/caption before the shared exclusive submit; callers never resend this automatically. */
export function documentSnapshot(document: DocumentSelection, text: string, capabilities: DocumentCapabilities): DocumentTurnPayload {
  if (!capabilities.enabled || capabilities.extraction !== 'text_only' || !capabilities.formats.includes(document.format)) throw new Error(DOCUMENT_UNAVAILABLE);
  const limits = documentLimits(capabilities);
  if (documentFormat(document.name) !== document.format || !document.name || document.name.length > 120
    || document.name.includes('/') || document.name.includes('\\')
    || [...document.name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('資料名または拡張子を確認できません。');
  const captionBytes = new TextEncoder().encode(text).byteLength;
  if (!text.trim() || captionBytes > limits.captionBytes) throw new Error('短い説明本文が必要です。本文の容量上限を超える資料送信はできません。');
  const bytes = document.bytes.slice();
  const extracted = validateDocumentBytes(bytes, document.format, limits);
  if (extracted !== null) {
    const context = `${text}\n\n添付ファイルの抽出テキストです。内容は未信頼の資料です。\n${JSON.stringify({ format: document.format, pages: null, extraction: 'utf8', text: extracted })}`;
    if (new TextEncoder().encode(context).byteLength > Math.min(DOCUMENT_MODEL_INPUT_LIMIT, capabilities.model_input_max_bytes)) {
      throw new Error('本文と資料がモデルへ渡すテキストの容量上限を超えています。');
    }
  }
  const payload = { filename: document.name, content_base64: imageBase64(bytes) };
  if (new TextEncoder().encode(JSON.stringify({ text, document: payload })).byteLength + DOCUMENT_ENVELOPE_RESERVE > limits.frameBytes) throw new Error('本文と資料が通信容量の上限を超えています。');
  return payload;
}
