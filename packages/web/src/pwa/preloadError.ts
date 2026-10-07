const PRELOAD_ERROR_RELOAD_KEY = 'hermes-pwa.preloadErrorReloads.v1';
const MAX_PRELOAD_ERROR_RELOADS = 1;
let preloadCleanup: (() => void) | undefined;

function readPreloadReloadCount(): number {
  try {
    const value = window.sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY);
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writePreloadReloadCount(count: number): void {
  try {
    window.sessionStorage.setItem(PRELOAD_ERROR_RELOAD_KEY, String(count));
  } catch {
    // If storage is blocked, the in-memory handler still prevents repeated
    // reloads within this page instance.
  }
}

function showManualRefreshMessage(): void {
  if (document.getElementById('hermes-preload-error')) return;
  const message = document.createElement('div');
  message.id = 'hermes-preload-error';
  message.setAttribute('role', 'alert');
  message.className = 'hm-warning-banner hm-warning-banner--error';
  message.textContent = 'Hermes update could not be loaded. Refresh the page manually.';
  document.body.prepend(message);
}

export function installVitePreloadErrorReload(): () => void {
  preloadCleanup?.();
  let preloadReloaded = false;

  const onPreloadError = (event: Event) => {
    event.preventDefault();
    if (preloadReloaded) return;
    preloadReloaded = true;

    const reloadCount = readPreloadReloadCount();
    if (reloadCount >= MAX_PRELOAD_ERROR_RELOADS) {
      showManualRefreshMessage();
      return;
    }

    writePreloadReloadCount(reloadCount + 1);
    window.location.reload();
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  preloadCleanup = () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
    preloadCleanup = undefined;
  };
  return preloadCleanup;
}
