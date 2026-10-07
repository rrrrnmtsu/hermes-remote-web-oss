import { validFileContent, type FileContent } from '../../../core/src/features/files';
import { documentFormat, documentLimits, validateDocumentBytes,
  type DocumentCapabilities, type DocumentSelection } from '../../../core/src/features/documents';

const mimeTypes = { TXT: ['text/plain'], MARKDOWN: ['text/plain', 'text/markdown', 'text/x-markdown'],
  CSV: ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel'], PDF: ['application/pdf'] };

/** Read only the explicitly selected local file; full PDF decode remains on the bounded backend. */
export async function prepareDocument(file: File, capabilities?: DocumentCapabilities | null, signal?: AbortSignal): Promise<DocumentSelection> {
  signal?.throwIfAborted();
  const limits = documentLimits(capabilities);
  if (!file.size || file.size > limits.rawBytes) throw new Error(`資料の容量上限は${(limits.rawBytes / 1048576).toFixed(2)}MiBです。`);
  const original = file.name.split(/[\\/]/).at(-1) || '';
  const format = documentFormat(original);
  if (!format) throw new Error('TXT・Markdown・CSV・PDFを1つ選んでください。');
  if (file.type && !mimeTypes[format].includes(file.type.toLowerCase())) throw new Error('資料のMIMEと拡張子が一致しません。対応形式で保存し直してください。');
  const extension = original.slice(original.lastIndexOf('.')).toLowerCase();
  const stem = [...original.slice(0, original.lastIndexOf('.'))].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 120 - extension.length);
  const name = (stem || 'document') + extension;
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  if (bytes.byteLength !== file.size) throw new Error('資料の実際の容量を確認できません。転送していません。');
  const text = validateDocumentBytes(bytes, format, limits);
  const preview = text?.slice(0, 4000) ?? '';
  return { name, format, bytes, preview, previewTruncated: text !== null && text.length > preview.length,
    extraction: format === 'PDF' ? 'pdf_text_pending' : 'utf8' };
}


/** The already-authorized read is a bounded memory snapshot, never a URL-derived fetch. */
export function contentBlob(content: FileContent): Blob {
  if (!validFileContent(content)) throw new Error('bounded_content_only');
  const bytes = content.text === null ? Uint8Array.from(atob(content.content_base64 || ''), char => char.charCodeAt(0)) : new TextEncoder().encode(content.text);
  if (bytes.byteLength !== content.bytes || bytes.byteLength > 1_048_576) throw new Error('content_size_mismatch');
  return new Blob([bytes], { type: content.mime });
}
