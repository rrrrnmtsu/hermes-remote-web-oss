import { describe, expect, it } from 'vitest';
import { documentLimits, documentSnapshot, validateDocumentBytes, DOCUMENT_RAW_LIMIT,
  DOCUMENT_EXTRACTED_LIMIT, type DocumentCapabilities, type DocumentSelection } from './documents';

export const documentCapabilities: DocumentCapabilities = { version: 1, enabled: true, reason: '', formats: ['TXT', 'MARKDOWN', 'CSV', 'PDF'],
  max_raw_bytes: DOCUMENT_RAW_LIMIT, max_frame_bytes: 8 * 1048576, max_text_bytes: 65536,
  max_extracted_bytes: 131072, max_pages: 20, model_input_max_bytes: 262144, extraction: 'text_only', generation_verified: false };

function selection(text = '日本語の合成資料\n') : DocumentSelection {
  return { name: 'synthetic.md', format: 'MARKDOWN', bytes: new TextEncoder().encode(text), preview: text, previewTruncated: false, extraction: 'utf8' };
}

describe('bounded atomic document snapshot', () => {
  it('reserves escaped caption/envelope and only lowers the verified transport limits', () => {
    expect(DOCUMENT_RAW_LIMIT).toBe(5984256);
    expect(documentLimits().rawBytes).toBe(DOCUMENT_RAW_LIMIT);
    expect(documentLimits({ ...documentCapabilities, max_raw_bytes: 2000 }).rawBytes).toBe(2000);
    expect(documentLimits({ ...documentCapabilities, max_frame_bytes: 65536 }).rawBytes).toBe(0);
    expect(documentLimits({ ...documentCapabilities, max_pages: Number.NaN }).rawBytes).toBe(0);
  });
  it('fixes one immutable byte/name snapshot and never substitutes an attachment identifier/path', () => {
    const doc = selection(); const snapshot = documentSnapshot(doc, 'この資料について教えてください。', documentCapabilities);
    expect(snapshot.filename).toBe('synthetic.md');
    expect(atob(snapshot.content_base64)).toBe(String.fromCharCode(...doc.bytes));
    doc.bytes.fill(0); doc.name = 'later.md';
    expect(snapshot.filename).toBe('synthetic.md'); expect(atob(snapshot.content_base64)).not.toBe('\0');
    expect(Object.keys(snapshot).sort()).toEqual(['content_base64', 'filename']);
  });
  it('requires a caption and explicit current capability, with no text-only fallback', () => {
    expect(() => documentSnapshot(selection(), ' ', documentCapabilities)).toThrow(/説明本文/);
    expect(() => documentSnapshot(selection(), '本文', { ...documentCapabilities, enabled: false })).toThrow(/未対応/);
    expect(() => documentSnapshot(selection(), '本文', { ...documentCapabilities, formats: ['PDF'] })).toThrow(/未対応/);
    expect(() => documentSnapshot({ ...selection(), name: '../escape.md' }, '本文', documentCapabilities)).toThrow(/資料名/);
  });
  it.each(['<svg/>', '<!DOCTYPE html><html/>', '%PDF-1.7', 'bad\0text', '\u0001control'])('rejects disguised/binary text %s', value => {
    expect(() => validateDocumentBytes(new TextEncoder().encode(value), 'TXT', documentLimits())).toThrow();
  });
  it('preserves literal source content safely and enforces bytes instead of character/token claims', () => {
    const text = '# 合成資料\n```\ncode\n```\n<script>unsafe text</script>\n@/server-secret';
    expect(validateDocumentBytes(new TextEncoder().encode(text), 'MARKDOWN', documentLimits())).toBe(text);
    expect(() => validateDocumentBytes(Uint8Array.of(255), 'TXT', documentLimits())).toThrow(/UTF-8/);
    expect(() => documentSnapshot(selection('あ'.repeat(43700)), '本文', documentCapabilities)).toThrow(/上限/);
    expect(() => validateDocumentBytes(new TextEncoder().encode('x'.repeat(DOCUMENT_EXTRACTED_LIMIT + 1)), 'TXT', documentLimits())).toThrow(/テキスト上限/);
  });
  it('does not claim local PDF bytes are fully decoded or extracted', () => {
    expect(validateDocumentBytes(new TextEncoder().encode('%PDF-1.7\nlocal header only\n%%EOF\n'), 'PDF', documentLimits())).toBeNull();
    expect(() => validateDocumentBytes(new TextEncoder().encode('not a PDF'), 'PDF', documentLimits())).toThrow(/形式/);
  });
});
