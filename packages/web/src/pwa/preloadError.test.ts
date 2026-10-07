import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installVitePreloadErrorReload } from './preloadError';

function mockLocationReload() {
  const reload = vi.fn();
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
  return reload;
}

describe('installVitePreloadErrorReload', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    document.getElementById('hermes-preload-error')?.remove();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    document.getElementById('hermes-preload-error')?.remove();
  });

  it('reloads once when Vite reports a preload error', () => {
    const reload = mockLocationReload();
    const cleanup = installVitePreloadErrorReload();
    const first = new Event('vite:preloadError', { cancelable: true });
    const second = new Event('vite:preloadError', { cancelable: true });

    window.dispatchEvent(first);
    window.dispatchEvent(second);

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('stops automatic reloads after a persisted preload failure and shows manual refresh guidance', () => {
    const reload = mockLocationReload();
    window.sessionStorage.setItem('hermes-pwa.preloadErrorReloads.v1', '1');
    const cleanup = installVitePreloadErrorReload();
    const event = new Event('vite:preloadError', { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(document.getElementById('hermes-preload-error')).toHaveTextContent(/Refresh the page manually/i);
    cleanup();
  });

  it('removes the listener on cleanup', () => {
    const reload = mockLocationReload();
    const cleanup = installVitePreloadErrorReload();
    cleanup();

    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));

    expect(reload).not.toHaveBeenCalled();
  });
});
