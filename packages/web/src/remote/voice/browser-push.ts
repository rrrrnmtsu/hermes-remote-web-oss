import type { BrowserPushPort, BrowserPushSubscription } from '../../../../core/src/features/notifications';
import { ensureRemoteWorker } from '../storage/worker';

/** The browser owns PushSubscription storage; no copy is made in app localStorage/IDB. */
export function browserPushPort(): BrowserPushPort {
  const supported = typeof Notification !== 'undefined' && typeof PushManager !== 'undefined' && !!navigator.serviceWorker && window.isSecureContext;
  const json = (subscription: PushSubscription | null): BrowserPushSubscription | null => {
    if (!subscription) return null;
    const value = subscription.toJSON();
    if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) throw new Error('invalid browser subscription');
    return { endpoint: value.endpoint, expirationTime: value.expirationTime ?? null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  };
  const registration = async (): Promise<ServiceWorkerRegistration | null> => !supported ? null :
    (await navigator.serviceWorker.getRegistrations()).find(item => item.scope === `${window.location.origin}/hermes-remote-web/`) || null;
  return {
    supported,
    permission: () => supported ? Notification.permission : 'unsupported',
    requestPermission: async () => !supported ? 'unsupported' : Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : await Notification.requestPermission(),
    subscription: async () => json(await (await registration())?.pushManager.getSubscription() || null),
    subscribe: async publicKey => {
      const worker = await ensureRemoteWorker();
      const raw = atob(publicKey.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '='));
      const key = Uint8Array.from(raw, character => character.charCodeAt(0));
      if (key.length !== 65 || key[0] !== 4) throw new Error('invalid application public key');
      return json(await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))!;
    },
    unsubscribe: async () => { const subscription = await (await registration())?.pushManager.getSubscription(); return subscription ? subscription.unsubscribe() : true; },
    fingerprint: async endpoint => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))].map(value => value.toString(16).padStart(2, '0')).join(''),
  };
}
