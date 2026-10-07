import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareDocument } from './file-content';
import { DOCUMENT_RAW_LIMIT } from '../../../core/src/features/documents';

const file = (text = '日本語の合成資料\n', name = 'DEMO.md', type = 'text/markdown') => {
  const bytes = new TextEncoder().encode(text);
  return { size: bytes.length, name, type, arrayBuffer: async () => bytes.slice().buffer } as File;
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('local document selection has no transport or persistence', () => {
  it('keeps Japanese/newlines as safe text, without writes or Blob URLs', async () => {
    const fetch = vi.fn(); const ws = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('WebSocket', ws);
    const create = vi.fn(); vi.stubGlobal('URL', { createObjectURL: create });
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const doc = await prepareDocument(file()); expect(doc.preview).toBe('日本語の合成資料\n'); expect(doc.extraction).toBe('utf8');
    expect(fetch).not.toHaveBeenCalled(); expect(ws).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });
  it('bounds declared capacity and unsupported format before reading local bytes', async () => {
    const input = file(); Object.defineProperty(input, 'size', { value: DOCUMENT_RAW_LIMIT + 1 }); const read = vi.spyOn(input, 'arrayBuffer');
    await expect(prepareDocument(input)).rejects.toThrow(/容量上限/); expect(read).not.toHaveBeenCalled();
    await expect(prepareDocument(file('x', 'bad.html', 'text/html'))).rejects.toThrow(/1つ/);
  });
  it('checks actual bytes and declared MIME/extension independently', async () => {
    await expect(prepareDocument(file('text', 'fake.pdf', 'application/pdf'))).rejects.toThrow(/形式/);
    await expect(prepareDocument(file('text', 'fake.txt', 'application/pdf'))).rejects.toThrow(/MIME/);
    await expect(prepareDocument(file('<html>fake</html>', 'fake.txt', 'text/plain'))).rejects.toThrow(/偽装/);
    const declared = file(); Object.defineProperty(declared, 'size', { value: 5 });
    await expect(prepareDocument(declared)).rejects.toThrow(/実際の容量/);
  });
  it('limits preview without changing the complete verified UTF-8 bytes and preserves the extension', async () => {
    const input = file('x'.repeat(5000), '../' + 'a'.repeat(200) + '.md'); const doc = await prepareDocument(input);
    expect(doc.preview).toHaveLength(4000); expect(doc.previewTruncated).toBe(true); expect(doc.bytes).toHaveLength(5000);
    expect(doc.name.length).toBeLessThanOrEqual(120); expect(doc.name.endsWith('.md')).toBe(true); expect(doc.name).not.toContain('/');
  });
  it('cancels stale local selection on scope invalidation without any upload', async () => {
    const controller = new AbortController(); const input = file(); let finish!: (bytes: ArrayBuffer) => void;
    vi.spyOn(input, 'arrayBuffer').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = prepareDocument(input, undefined, controller.signal); controller.abort(); finish(new ArrayBuffer(input.size));
    await expect(result).rejects.toThrow();
  });
  it('PDF preview does not parse pages, render an iframe or create a URL', async () => {
    const doc = await prepareDocument(file('%PDF-1.7\nsynthetic header\n%%EOF\n', 'demo.pdf', 'application/pdf'));
    expect(doc.preview).toBe(''); expect(doc.extraction).toBe('pdf_text_pending');
  });
});
