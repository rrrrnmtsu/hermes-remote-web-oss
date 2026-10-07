const APP_PATH = '/hermes-remote-web/';
const TIMEOUT_MS = 15_000;

/** One worker for offline shell and push; registration never reloads this page. */
export async function ensureRemoteWorker(): Promise<ServiceWorkerRegistration> {
  if (!navigator.serviceWorker || typeof navigator.serviceWorker.register !== 'function' || !window.isSecureContext) throw new Error('このブラウザではオフライン起動・通知を利用できません。');
  const registration = await navigator.serviceWorker.register(`${APP_PATH}remote-worker.js`, { scope: APP_PATH, updateViaCache: 'none' });
  if (registration.scope !== `${window.location.origin}${APP_PATH}`) throw new Error('アプリの専用範囲を確認できません。');
  if (registration.active) return registration;
  const installing = registration.installing || registration.waiting;
  if (!installing) throw new Error('アプリのworkerを利用できません。');
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { installing.removeEventListener('statechange', changed); reject(new Error('workerの起動確認がタイムアウトしました。')); }, TIMEOUT_MS);
    const changed = (): void => {
      if (installing.state === 'activated') { window.clearTimeout(timer); installing.removeEventListener('statechange', changed); resolve(); }
      else if (installing.state === 'redundant') { window.clearTimeout(timer); installing.removeEventListener('statechange', changed); reject(new Error('workerを起動できません。')); }
    };
    installing.addEventListener('statechange', changed); changed();
  });
  return registration;
}
async function messageWorker(worker: ServiceWorker, type: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('端末保存のworker確認がタイムアウトしました。')); }, TIMEOUT_MS);
    channel.port1.onmessage = event => {
      window.clearTimeout(timer); channel.port1.close();
      if (event.data?.ok === true) resolve(); else reject(new Error('端末の保存または更新を確認できません。入力・実行中や保存上限を確認してください。'));
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}
export async function cacheOfflineShell(): Promise<void> {
  const registration = await ensureRemoteWorker();
  const worker = registration.waiting || registration.active;
  if (!worker) throw new Error('オフライン起動用workerを確認できません。');
  await messageWorker(worker, 'CACHE_SHELL');
}
export async function clearOfflineShell(): Promise<void> {
  if (!navigator.serviceWorker || typeof navigator.serviceWorker.getRegistrations !== 'function') return;
  const registration = (await navigator.serviceWorker.getRegistrations()).find(candidate => candidate.scope === `${window.location.origin}${APP_PATH}`);
  // Cancel caches in every generation of our one registration before reporting OFF.
  const workers = [...new Set([registration?.active, registration?.waiting, registration?.installing].filter((worker): worker is ServiceWorker => Boolean(worker)))];
  if (workers.length) {
    const results = await Promise.allSettled(workers.map(worker => messageWorker(worker, 'CLEAR_OFFLINE_SHELL')));
    if (results.some(result => result.status === 'rejected')) throw new Error('端末の保存消去を確認できません。再確認してください。');
  } else if ('caches' in window) {
    await Promise.all((await caches.keys()).filter(name => name.startsWith('hermes-remote-web.static.v1.')).map(name => caches.delete(name)));
  }
}
export async function activateWaitingWorker(): Promise<void> {
  if (!navigator.serviceWorker || typeof navigator.serviceWorker.getRegistrations !== 'function') return;
  const registration = (await navigator.serviceWorker.getRegistrations()).find(candidate => candidate.scope === `${window.location.origin}${APP_PATH}`);
  if (!registration) return;
  await registration.update();
  if (registration.installing) await waitState(registration.installing, 'installed');
  const waiting = registration.waiting;
  if (!waiting) return;
  // Cache the new immutable shell only when this app's offline shell was opted in.
  if ('caches' in window && (await caches.keys()).some(name => name.startsWith('hermes-remote-web.static.v1.'))) await messageWorker(waiting, 'CACHE_SHELL');
  await messageWorker(waiting, 'ACTIVATE_REQUEST');
  await waitState(waiting, 'activated');
}
async function waitState(worker: ServiceWorker, target: 'installed' | 'activated'): Promise<void> {
  if (worker.state === target || worker.state === 'activated') return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('更新workerの確認がタイムアウトしました。現在の画面を維持します。')); }, TIMEOUT_MS);
    const changed = (): void => {
      if (worker.state === target || worker.state === 'activated') { window.clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); }
      else if (worker.state === 'redundant') { window.clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(new Error('更新workerを有効化できません。現在の画面を維持します。')); }
    };
    worker.addEventListener('statechange', changed); changed();
  });
}
/** Every open app tab supplies its current draft/send/run/approval safety state. */
export function installWorkerSafetyGuard(canUpdate: () => boolean, onNotificationOpen: () => void, onSubscriptionChange?: () => void): () => void {
  if (!navigator.serviceWorker || typeof navigator.serviceWorker.addEventListener !== 'function') return () => undefined;
  const listener = (event: MessageEvent): void => {
    const worker = event.source;
    if (!(worker instanceof ServiceWorker) || new URL(worker.scriptURL).origin !== window.location.origin || new URL(worker.scriptURL).pathname !== `${APP_PATH}remote-worker.js`) return;
    if (event.data?.type === 'REMOTE_CAN_UPDATE') event.ports[0]?.postMessage({ safe: canUpdate() });
    else if (event.data?.type === 'REMOTE_NOTIFICATION_OPEN') onNotificationOpen();
    else if (event.data?.type === 'REMOTE_PUSH_SUBSCRIPTION_CHANGED') onSubscriptionChange?.();
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
