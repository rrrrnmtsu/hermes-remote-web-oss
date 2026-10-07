import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareImage } from './image-content';
import { imageRawLimit, validateImageSelection } from '../../../core/src/stores/image-transfer';
import { demoImage, demoPng } from '../../../core/src/stores/image-fixtures.test-data';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const file = (bytes = demoPng(), name = 'DEMO.png', type = 'image/png') => ({ size: bytes.length, name, type, arrayBuffer: async () => bytes.slice().buffer }) as File;
describe('bounded local image validation and cleanup', () => {
  it('accepts only actual bytes, tests exact raw capacity boundary before any decode', async () => {
    expect(validateImageSelection(demoImage(), demoPng().length)).toBe(true);
    expect(validateImageSelection(demoImage(), demoPng().length - 1)).toBe(false);
    const input = file(); const read = vi.spyOn(input, 'arrayBuffer');
    await expect(prepareImage(input, input.size - 1)).rejects.toThrow(/容量上限/); expect(read).not.toHaveBeenCalled();
    expect(imageRawLimit({ backendBytes: 10000, websocketBytes: 5000, proxyBytes: 4900 })).toBe(603);
  });
  it.each([['DEMO.jpg', 'image/jpeg'], ['DEMO.png', 'image/jpeg']])('rejects MIME/extension spoof %s before Blob creation', async (name, type) => {
    const create = vi.fn(); vi.stubGlobal('URL', { createObjectURL: create });
    await expect(prepareImage(file(demoPng(), name, type))).rejects.toThrow(/一致/); expect(create).not.toHaveBeenCalled();
  });
  it('rejects decoder corruption and releases its temporary Blob without retaining content', async () => {
    const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:DEMO', revokeObjectURL: revoke });
    class BrokenImage { onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal('Image', BrokenImage); await expect(prepareImage(file())).rejects.toThrow(/破損/); expect(revoke).toHaveBeenCalledWith('blob:DEMO');
  });
  it('aborts a pending decode on scope/logout cleanup and revokes Blob immediately', async () => {
    const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:DEMO', revokeObjectURL: revoke });
    class PendingImage { set src(_value: string) { void _value; } }
    vi.stubGlobal('Image', PendingImage); const abort = new AbortController(); const result = prepareImage(file(), undefined, abort.signal);
    await Promise.resolve(); abort.abort(); await expect(result).rejects.toThrow(/取消/); expect(revoke).toHaveBeenCalledOnce();
  });
});
