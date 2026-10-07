/* Dedicated /hermes-remote-web/ worker. Build replaces this fixed SHA-256 allowlist. */
/* REMOTE_WORKER_CONFIG */
const CONFIG = { buildId: 'development', assets: [] };
const APP_PATH = '/hermes-remote-web/';
const CACHE_PREFIX = 'hermes-remote-web.static.v1.';
const CACHE_NAME = CACHE_PREFIX + CONFIG.buildId;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_SHELL_BYTES = 20 * 1024 * 1024;
const MAX_RETAINED_BUILDS = 3;
const ALLOWLIST = new Map(CONFIG.assets.filter(validAsset).map(asset => [asset.path, asset.sha256]));
let cacheGeneration = 0;
let clearingShell = false;
const shellTasks = new Set();

function validAsset(asset) {
  if (!asset || typeof asset.path !== 'string' || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) return false;
  if (!asset.path.startsWith(APP_PATH) || /[?\#\\]/.test(asset.path) || asset.path.includes('..') || /%(?:2e|2f|5c)/i.test(asset.path)) return false;
  if (asset.path === APP_PATH + 'build.json' || asset.path === APP_PATH + 'remote-worker.js') return false;
  const url = new URL(asset.path, self.location.origin);
  return url.origin === self.location.origin && url.pathname === asset.path;
}
function ownedClient(client) {
  if (!client || typeof client.url !== 'string') return false;
  const url = new URL(client.url);
  return url.origin === self.location.origin && url.pathname.startsWith(APP_PATH);
}
function reply(event, ok, message) { event.ports[0]?.postMessage({ ok, message }); }

self.addEventListener('install', () => { /* Offline caching requires an explicit user action. */ });
self.addEventListener('activate', () => { /* Keep old build caches; no claim or automatic reload. */ });

async function verifiedAsset(path, expectedHash) {
  const response = await fetch(new Request(path, { credentials: 'omit', cache: 'no-store', redirect: 'error' }));
  if (!response.ok || response.type === 'opaque' || !response.body) throw new Error('static_asset_unavailable');
  const responseUrl = new URL(response.url || path, self.location.origin);
  if (responseUrl.origin !== self.location.origin || responseUrl.pathname !== path) throw new Error('static_asset_redirect');
  const reader = response.body.getReader(); const parts = []; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_ASSET_BYTES) { await reader.cancel(); throw new Error('static_asset_limit'); }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const contents = new Uint8Array(bytes); let offset = 0;
  for (const part of parts) { contents.set(part, offset); offset += part.byteLength; }
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', contents))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== expectedHash) throw new Error('static_asset_hash');
  return { bytes, response: new Response(contents, { status: 200, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' } }) };
}
async function cacheShell() {
  const generation = cacheGeneration;
  if (!ALLOWLIST.size || !ALLOWLIST.has(APP_PATH + 'index.html')) throw new Error('static_allowlist_missing');
  const owned = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX));
  if (!owned.includes(CACHE_NAME) && owned.length >= MAX_RETAINED_BUILDS) throw new Error('static_cache_limit');
  const collected = []; let bytes = 0;
  // Verify every response before modifying the current cache; no authenticated data is accepted.
  for (const [path, hash] of ALLOWLIST) {
    const asset = await verifiedAsset(path, hash); bytes += asset.bytes;
    if (generation !== cacheGeneration) throw new Error('static_cache_cancelled');
    if (bytes > MAX_SHELL_BYTES) throw new Error('static_shell_limit');
    collected.push({ path, response: asset.response });
  }
  const cache = await caches.open(CACHE_NAME);
  for (const asset of collected) {
    if (generation !== cacheGeneration) throw new Error('static_cache_cancelled');
    await cache.put(asset.path, asset.response);
  }
}
async function clientsAllowUpdate() {
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(ownedClient);
  const safety = await Promise.all(clients.map(client => new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 2000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.safe === true); };
    client.postMessage({ type: 'REMOTE_CAN_UPDATE' }, [channel.port2]);
  })));
  return safety.every(value => value === true);
}
self.addEventListener('message', event => {
  if (!ownedClient(event.source)) return;
  if (event.data?.type === 'CACHE_SHELL') {
    if (clearingShell) { reply(event, false, 'static_shell_not_cached'); return; }
    const task = cacheShell(); shellTasks.add(task);
    event.waitUntil(task.then(() => reply(event, true, 'static_shell_cached'), () => reply(event, false, 'static_shell_not_cached'))
      .finally(() => shellTasks.delete(task)));
  } else if (event.data?.type === 'CLEAR_OFFLINE_SHELL') {
    cacheGeneration += 1; clearingShell = true;
    // A pending cache.open/put must settle before deletion can be acknowledged.
    event.waitUntil(Promise.allSettled([...shellTasks])
      .then(() => caches.keys()).then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key))))
      .then(() => reply(event, true, 'own_static_cache_cleared'), () => reply(event, false, 'own_static_cache_not_cleared'))
      .finally(() => { clearingShell = false; }));
  } else if (event.data?.type === 'ACTIVATE_REQUEST') {
    event.waitUntil(clientsAllowUpdate().then(async safe => {
      if (!safe) { reply(event, false, 'work_in_progress'); return; }
      await self.skipWaiting(); reply(event, true, 'update_activated');
    }));
  }
});

self.addEventListener('fetch', event => {
  const request = event.request; if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || url.hash || !url.pathname.startsWith(APP_PATH)) return;
  if (request.mode === 'navigate' && (url.pathname === APP_PATH || url.pathname === APP_PATH + 'index.html')) {
    event.respondWith(fetch(request).catch(async () => {
      const index = await cachedAsset(APP_PATH + 'index.html');
      return index || new Response('オフライン起動は未保存です。接続後に開き直してください。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })); return;
  }
  if (!ALLOWLIST.has(url.pathname)) return;
  event.respondWith(cachedAsset(url.pathname).then(cached => cached || fetch(request)));
});
async function cachedAsset(path) {
  if (!(await caches.keys()).includes(CACHE_NAME)) return undefined;
  return (await caches.open(CACHE_NAME)).match(path);
}

self.addEventListener('push', event => {
  let kind = 'result';
  try { if (event.data?.json()?.kind === 'waiting') kind = 'waiting'; } catch { /* Keep a generic result notification. */ }
  event.waitUntil(self.registration.showNotification('Hermes Remote Web', {
    body: kind === 'waiting' ? '確認が必要です。アプリを開いて確認してください。' : '結果があります。アプリを開いて確認してください。',
    tag: 'hermes-remote-web-' + kind,
    data: { kind },
    icon: APP_PATH + 'icons/icon-192.png',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(ownedClient);
    if (client) { await client.focus(); client.postMessage({ type: 'REMOTE_NOTIFICATION_OPEN' }); return; }
    await self.clients.openWindow(APP_PATH);
  }));
});
self.addEventListener('pushsubscriptionchange', event => {
  // A fresh explicit registration is required; never invent a background credential flow.
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients.filter(ownedClient)) client.postMessage({ type: 'REMOTE_PUSH_SUBSCRIPTION_CHANGED' });
  }));
});
