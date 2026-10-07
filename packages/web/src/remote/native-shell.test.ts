import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeShellClient, bindNativeResume, sharedDraftFile } from './native-shell';
import type { NativeChannel, NativeSharedDraft } from '../../../core/src/features/native-shell';

const originalOrigin = window.location.origin;
beforeEach(() => { Object.assign(window.location, { origin: 'https://example.com' }); });
afterEach(() => { Object.assign(window.location, { origin: originalOrigin }); delete (window as Window & { webkit?: unknown }).webkit; vi.restoreAllMocks(); });
function channel(): NativeChannel { return { postMessage: vi.fn(async () => undefined) }; }
describe('thin native browser port', () => {
  it('Safari stays a normal Web app and registers no native requests', () => { expect(nativeShellClient()).toBeNull(); });
  it('detects only main-frame HTTPS bridge without network or credential reads', () => {
    const bridge = channel(); Object.assign(window, { webkit: { messageHandlers: { hermesRemote: bridge } } });
    expect(nativeShellClient()).not.toBeNull(); expect(bridge.postMessage).not.toHaveBeenCalled();
  });
  it('fails closed for malformed native location metadata without throwing in a resume listener', () => {
    Object.assign(window, { webkit: { messageHandlers: { hermesRemote: channel() } } });
    Object.assign(window.location, { origin: 'https://example.com/other' });
    expect(nativeShellClient()).toBeNull();
    const recover = vi.fn(async () => undefined); const dispose = bindNativeResume(recover);
    expect(() => window.dispatchEvent(new Event('hermes-native-resume'))).not.toThrow();
    expect(recover).not.toHaveBeenCalled(); dispose();
  });
  it('coalesces native foreground recovery and cleans up listeners', async () => {
    Object.assign(window, { webkit: { messageHandlers: { hermesRemote: channel() } } });
    let complete!: () => void; const recover = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const dispose = bindNativeResume(recover); window.dispatchEvent(new Event('hermes-native-resume')); window.dispatchEvent(new Event('hermes-native-resume'));
    expect(recover).toHaveBeenCalledTimes(1); complete(); await Promise.resolve(); await Promise.resolve();
    dispose(); window.dispatchEvent(new Event('hermes-native-resume')); expect(recover).toHaveBeenCalledTimes(1);
  });
  it('creates a local File only from a confirmed memory payload, with no automatic upload', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const draft: NativeSharedDraft = { id: '12345678-1234-1234-1234-123456789abc', kind: 'file', name: 'synthetic.txt',
      bytes: 3, expiresAt: 2000, text: '説明', mime: 'text/plain', contentBase64: 'YWJj' };
    const file = sharedDraftFile(draft); expect(file?.name).toBe('synthetic.txt'); expect(file?.size).toBe(3);
    expect(sharedDraftFile({ ...draft, kind: 'text' })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
});
