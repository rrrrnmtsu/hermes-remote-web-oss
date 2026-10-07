import { waitForReadOnlyObservation } from './worker-readiness.mjs';
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

// Real compiled UI, browser, cookies, IndexedDB, CacheStorage and scoped workers.
// Two disposable loopback gateway fixtures; no live servers, provider or generation.
const root = fileURLToPath(new URL('..', import.meta.url));
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const appRoot = resolve(argument('app-root') || root);
const build = argument('build') || readFileSync(join(appRoot, 'releases/current-build.txt'), 'utf8').trim();
assert.match(build, /^remote-v2-[a-f0-9]+$/);
const engines = argument('engine') ? [argument('engine')] : ['chromium', 'webkit'];
assert.ok(engines.every(name => ['chromium', 'webkit'].includes(name)));
// An explicit GTK run needs a display (e.g. xvfb-run on Linux). Default pinned
// headless WPE/CI behavior is unchanged; this selects a driver, not an exception.
const webkitPort = argument('webkit-port') || process.env.HERMES_TEST_WEBKIT_PORT || 'wpe';
assert.ok(['wpe', 'gtk'].includes(webkitPort), 'WebKit port must be wpe or gtk');
// Keep the canonical Playwright context unchanged. Persistent mode is an
// explicit driver diagnostic and is reported separately from isolated mode.
const browserProfile = argument('browser-profile') || 'isolated';
assert.ok(['persistent', 'isolated'].includes(browserProfile), 'Browser profile must be persistent or isolated');
// The foreign app's exact bytes and registration are mandatory. Historical
// page-created-cache INCONCLUSIVE receipts remain separate driver diagnostics.
assert.notEqual(argument('allow-driver-cache-inconclusive'), '1', 'The foreign application retention gate cannot be bypassed');
const allowDriverCacheInconclusive = false;
const release = join(appRoot, 'releases', build);
assert.equal(JSON.parse(readFileSync(join(release, 'build.json'), 'utf8')).buildId, build);
const index = readFileSync(join(release, 'index.html'));
const { startFixture } = await import(pathToFileURL(join(appRoot, 'scripts/fixture-server.mjs')).href);
assert.ok(startFixture.toString().includes('originHostname'), 'Two host-scoped cookie origins require the approved fixture option');
mkdirSync(join(root, 'output/playwright'), { recursive: true });
const output = mkdtempSync(join(root, 'output/playwright/product-origins-'));
const digest = value => createHash('sha256').update(value).digest('hex');
const report = { schema: 'hermes_remote_web_two_origin_browser_v1', observedAt: new Date().toISOString(), build,
  scriptSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scriptSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
  appSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(),
  indexSha256: digest(index), fixtureSha256: digest(readFileSync(join(appRoot, 'scripts/fixture-server.mjs'))),
  fixtureOnly: true, backend: 'TWO_INDEPENDENT_SYNTHETIC_GATEWAYS', browserStorage: 'ACTUAL_BROWSER',
  productionWrites: 0, providerCalls: 0, secondLiveServer: 'NOT_RUN', iphone: 'NOT_RUN',
  allowDriverCacheInconclusive, cases: [] };
const markers = { a: 'DEMO_ORIGIN_A_ONLY_HISTORY', b: 'DEMO_ORIGIN_B_ONLY_HISTORY', draft: 'DEMO_ORIGIN_A_UNSENT_DRAFT', image: 'DEMO-origin-A-local.png' };
const PASSPHRASE = 'DEMO-only-two-origin-local-passphrase';
const FOREIGN_CACHE = 'DEMO.foreign-app.static.v1';
const FOREIGN_SCOPE = '/__DEMO_other_app/';
const FOREIGN_WORKER = FOREIGN_SCOPE + 'sw.js';
// The approved fixture serves this public build metadata alias over real HTTPS.
// The Hermes worker's fixed asset list never fetches or caches this test alias.
const FOREIGN_ASSET = '/hermes-remote-web/DEMO-foreign-static/build.json';
const FOREIGN_SHA256 = digest(JSON.stringify({ buildId: build }));
const foreignWorkerSource = `// DEMO-only other-application worker. Install is its only write entry.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if ((await caches.keys()).includes(${JSON.stringify(FOREIGN_CACHE)})) throw new Error('DEMO reseeding forbidden');
    const asset = new URL(${JSON.stringify(FOREIGN_ASSET)}, self.location.origin).href;
    const response = await fetch(asset, { cache: 'no-store', credentials: 'omit' });
    const bytes = await response.clone().arrayBuffer();
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (response.status !== 200 || sha !== ${JSON.stringify(FOREIGN_SHA256)}) throw new Error('DEMO foreign public asset invalid');
    await (await caches.open(${JSON.stringify(FOREIGN_CACHE)})).put(asset, response);
  })());
});
`;

function seed(fixture, name) {
  for (const profile of ['default', 'DEMO-secondary']) fixture.state.sessions.set(profile, {
    live: `DEMO-${name}-live-${profile}`, durable: `DEMO-${name}-durable-${profile}`, running: false, seq: 0, events: [], images: [],
    messages: [{ role: 'assistant', text: markers[name.toLowerCase()], row_id: 1 }],
  });
  fixture.state.ticketSequence = name === 'A' ? 100 : 900;
}
async function ready(page) { await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor({ timeout: 20000 }); }
async function settings(page) {
  const back = page.getByRole('button', { name: '← 会話一覧', exact: true }); if (await back.count()) await back.click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
}
async function chatList(page) { await page.getByRole('button', { name: '会話', exact: true }).click(); }
async function openSaved(page, profile) {
  await page.getByRole('region', { name: '会話一覧', exact: true }).getByRole('button', { name: `DEMO会話 ${profile}`, exact: true }).click();
  await page.getByLabel('Hermesへのメッセージ', { exact: true }).waitFor();
}
async function inspectStore(page) {
  return page.evaluate(async foreignCacheName => {
    async function read(name, store, key) {
      return new Promise((resolveResult, reject) => {
        let absent = false; const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => { absent = true; request.transaction.abort(); resolveResult(null); };
        request.onerror = () => { if (!absent) reject(new Error('DEMO own store inspection failed')); };
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) { db.close(); resolveResult(null); return; }
          const item = db.transaction(store, 'readonly').objectStore(store).get(key);
          item.onsuccess = () => { db.close(); resolveResult(item.result ?? null); };
          item.onerror = () => { db.close(); reject(new Error('DEMO own store read failed')); };
        };
      });
    }
    const content = await read('hermes-remote-web.encrypted.v1', 'owned', 'contents');
    const connections = await read('hermes-remote-web.connections.v1', 'origins', 'allowed');
    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheNames = await caches.keys();
    const canary = cacheNames.includes(foreignCacheName) ? await caches.open(foreignCacheName) : null;
    return { entries: content?.entries?.length || 0, wrappedKey: Boolean(content?.key),
      ciphertextOnly: (content?.entries || []).every(entry => entry.ciphertext instanceof ArrayBuffer && !('scope' in entry) && !('value' in entry)),
      containsPlainDEMO: JSON.stringify(content).includes('DEMO_ORIGIN_'), connections: (connections || []).map(row => ({ origin: row.origin, label: row.label })),
      workers: registrations.map(row => ({ scope: row.scope, active: Boolean(row.active) })), caches: cacheNames,
      manualCacheKeys: canary ? (await canary.keys()).map(request => ({ origin: new URL(request.url).origin, path: new URL(request.url).pathname })) : [],
      localKeys: Object.keys(localStorage), sessionKeys: Object.keys(sessionStorage) };
  }, FOREIGN_CACHE);
}
async function saveHistory(page) {
  await settings(page);
  await page.getByLabel('端末保存のパスフレーズ', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: '暗号化保存を準備', exact: true }).click();
  await page.getByText('解錠しました。保存は個別に有効化してください。', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: '選んだ履歴をオフラインで閲覧', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('label')].some(label => label.textContent.includes('選んだ履歴をオフラインで閲覧') && label.querySelector('input')?.checked));
  await page.getByRole('button', { name: '現在取得済みの履歴を端末へ保存', exact: true }).click();
  await page.getByText('現在取得済みの発言を暗号化保存しました。', { exact: true }).waitFor();
  await waitForReadOnlyObservation(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/hermes-remote-web/'))?.active?.state === 'activated'), { label: 'origin_active_worker' });
  const data = await inspectStore(page);
  assert.equal(data.entries, 1); assert.equal(data.wrappedKey, true); assert.equal(data.ciphertextOnly, true); assert.equal(data.containsPlainDEMO, false);
  return data;
}
async function addDestination(page, origin, label) {
  const panel = page.getByRole('region', { name: '別接続先', exact: true });
  await panel.getByLabel('HTTPS接続先', { exact: true }).fill(origin);
  await panel.getByLabel('表示名', { exact: true }).fill(label);
  await panel.getByRole('checkbox', { name: '自分が利用を許可された接続先です', exact: true }).check();
  await panel.getByRole('button', { name: '接続先を登録', exact: true }).click();
  await panel.getByText(label, { exact: true }).waitFor();
  return panel;
}

async function foreignCacheObservation(page, origin) {
  return page.evaluate(async ({ origin: owner, cacheName, assetPath, scopePath }) => {
    const scope = owner + scopePath;
    const registrations = await navigator.serviceWorker.getRegistrations();
    const registration = registrations.find(item => item.scope === scope);
    const hasCache = (await caches.keys()).includes(cacheName);
    const cache = hasCache ? await caches.open(cacheName) : null;
    const response = cache ? await cache.match(owner + assetPath) : null;
    const bytes = response ? await response.arrayBuffer() : null;
    const sha256 = bytes ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('') : null;
    return { hasCache, sha256, byteLength: bytes?.byteLength ?? null,
      registration: registration ? { scope: registration.scope, scriptURL: registration.active?.scriptURL ?? null,
        state: registration.active?.state ?? null } : null,
      workerScopes: registrations.map(item => item.scope),
      keys: cache ? (await cache.keys()).map(request => ({ origin: new URL(request.url).origin, path: new URL(request.url).pathname })) : [] };
  }, { origin, cacheName: FOREIGN_CACHE, assetPath: FOREIGN_ASSET, scopePath: FOREIGN_SCOPE });
}
async function installForeignWorkerOnce(context, origin) {
  // Only the foreign test worker's public script is supplied by test routing.
  // No Hermes application script, worker, API, auth or gateway frame is replaced.
  await context.route(origin + FOREIGN_WORKER, route => route.fulfill({ status: 200, contentType: 'text/javascript',
    headers: { 'cache-control': 'no-store' }, body: foreignWorkerSource }));
  const seedPage = await context.newPage();
  try {
    const response = await seedPage.goto(origin + FOREIGN_SCOPE + 'seed'); assert.equal(response.status(), 404);
    assert.equal(await seedPage.locator('script').count(), 0);
    assert.deepEqual(await seedPage.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(item => item.scope)), []);
    await seedPage.evaluate(async ({ script, scope }) => { await navigator.serviceWorker.register(script, { scope, updateViaCache: 'none' }); },
      { script: FOREIGN_WORKER, scope: FOREIGN_SCOPE });
    await waitForReadOnlyObservation(() => seedPage.evaluate(async path => {
      const registration = (await navigator.serviceWorker.getRegistrations()).find(item => item.scope === location.origin + path);
      return registration?.active?.state === 'activated';
    }, FOREIGN_SCOPE), { label: 'foreign_fixture_worker_initial_activation' });
    return await foreignCacheObservation(seedPage, origin);
  } finally {
    // All windows in the foreign scope are closed before either A/B/A test.
    // Return visits may only read: no register/update/fetch/put/reseed helper.
    await seedPage.close();
  }
}
const foreignReads = fixture => fixture.state.httpRequests.filter(request => request.path === FOREIGN_ASSET).length;
async function openProfile(engine, launchOptions, directory, options) {
  if (browserProfile === 'persistent') return await engine.launchPersistentContext(mkdtempSync(join(directory, 'browser-profile-')), { ...launchOptions, ...options });
  const browser = await engine.launch(launchOptions);
  try { return await browser.newContext(options); }
  catch (error) { await browser.close(); throw error; }
}
async function closeProfile(context) {
  const browser = context?.browser(); await context?.close(); await browser?.close();
}
async function driverCacheControl(engine, launchOptions, origins, directory, fixture) {
  // This control has no Hermes UI or worker: only one independent foreign app's
  // narrow worker and static cache. Launch options alone do not prove that the
  // MiniBrowser port retains actual stored bytes.
  const control = await openProfile(engine, launchOptions, directory, { ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
  const result = { applicationCode: false, hermesWorkers: 0, foreignWorkers: 1, browserProfile,
    responseSource: 'REAL_PUBLIC_STATIC_HTTP_RESPONSE', fixtureWorkerSourceSha256: digest(foreignWorkerSource),
    assetPath: FOREIGN_ASSET, cacheName: FOREIGN_CACHE, expectedSha256: FOREIGN_SHA256,
    registerCalls: 0, writes: 0, initialMatch: false, foreignMatch: false, restoredMatch: false };
  const before = foreignReads(fixture);
  try {
    await control.route(url => !origins.includes(url.origin), route => route.abort());
    result.seed = await installForeignWorkerOnce(control, origins[0]); result.registerCalls = 1;
    assert.equal(result.seed.sha256, FOREIGN_SHA256); assert.equal(foreignReads(fixture) - before, 1);
    assert.deepEqual(result.seed.registration, { scope: origins[0] + FOREIGN_SCOPE, scriptURL: origins[0] + FOREIGN_WORKER, state: 'activated' });
    const page = await control.newPage();
    const path = '/__DEMO_no_application_cache_control';
    const first = await page.goto(origins[0] + path); assert.equal(first.status(), 404);
    assert.equal(await page.locator('script').count(), 0);
    result.initial = await foreignCacheObservation(page, origins[0]); result.initialMatch = result.initial.sha256 === FOREIGN_SHA256;
    const second = await page.goto(origins[1] + path); assert.equal(second.status(), 404);
    result.foreignOriginAWindows = control.pages().filter(item => new URL(item.url()).origin === origins[0]).length;
    assert.equal(result.foreignOriginAWindows, 0, 'No origin A keeper window may survive the control navigation');
    result.foreign = await foreignCacheObservation(page, origins[0]); result.foreignMatch = result.foreign.hasCache || result.foreign.registration !== null;
    const third = await page.goto(origins[0] + path); assert.equal(third.status(), 404);
    result.restored = await foreignCacheObservation(page, origins[0]); result.restoredMatch = result.restored.sha256 === FOREIGN_SHA256;
    result.writes = foreignReads(fixture) - before;
    assert.equal(result.writes, 1, 'Foreign fixture worker must never fetch or reseed its asset on return');
    assert.deepEqual(result.initial.registration, result.seed.registration);
    assert.deepEqual(result.restored.registration, result.seed.registration);
    assert.deepEqual(result.foreign.workerScopes, []);
    return result;
  } catch (error) {
    result.error = error.message; result.writes = foreignReads(fixture) - before;
    return result;
  } finally { await closeProfile(control); }
}

for (const engineName of engines) {
  const a = await startFixture({ releaseDirectory: release, originHostname: '127.0.0.1' });
  const b = await startFixture({ releaseDirectory: release, originHostname: 'localhost' });
  assert.equal(new URL(a.origin).hostname, '127.0.0.1'); assert.equal(new URL(b.origin).hostname, 'localhost');
  assert.ok(Array.isArray(a.state.httpRequests) && Array.isArray(a.state.wsUpgrades) && Array.isArray(b.state.httpRequests) && Array.isArray(b.state.wsUpgrades),
    'Fixture must expose value-free server-header cookie metadata; browser protocol headers alone are insufficient');
  seed(a, 'A'); seed(b, 'B'); b.state.auth = false;
  const result = { engine: engineName, status: 'RUNNING', checks: [], screenshots: [], origins: { a: a.origin, b: b.origin },
    cookieBoundary: { foreignOnA: 0, foreignOnB: 0, ownOnA: 0, ownOnB: 0 }, foreignPayloads: 0, externalRequests: 0, pageErrors: [] };
  report.cases.push(result);
  const passed = (id, details = {}) => result.checks.push({ id, status: 'PASS', measurement: 'ACTUAL_BROWSER_SYNTHETIC_GATEWAY', ...details });
  let browser, context, page;
  const dir = join(output, engineName); mkdirSync(dir);
  try {
    const certificate = new X509Certificate(readFileSync(join(appRoot, 'output/playwright/tls/fixture-cert.pem')));
    assert.equal(certificate.subject, 'CN=localhost'); assert.ok(certificate.subjectAltName.includes('DNS:localhost'));
    const spki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const engine = engineName === 'webkit' ? webkit : chromium;
    const localWebkit = engineName === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1';
    const launchOptions = { headless: !(engineName === 'webkit' && webkitPort === 'gtk'),
      ...(engineName === 'chromium' ? { args: [`--ignore-certificate-errors-spki-list=${spki}`] } : {}),
      ...(localWebkit ? { executablePath: join(appRoot, 'scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()), HERMES_TEST_WEBKIT_PORT: webkitPort } } : {}) };
    // Exception is for this disposable loopback certificate only; allowed network
    // targets below contain no deployed URL. No system TLS setting is changed.
    // Playwright 1.60 passes --user-data-dir for its persistent default context.
    // The independent control below measures actual retention; this launch option
    // alone does not establish the MiniBrowser port's internal persistence.
    context = await openProfile(engine, launchOptions, dir, { viewport: { width: 390, height: 844 }, locale: 'ja-JP',
      ignoreHTTPSErrors: true, serviceWorkers: 'allow', isMobile: true, hasTouch: true });
    browser = context.browser();
    result.engineVersion = browser.version(); result.browserProfile = browserProfile;
    result.driver = engineName === 'webkit' ? `${localWebkit ? 'PLAYWRIGHT_MINIBROWSER' : 'PLAYWRIGHT_BUNDLED_WEBKIT'}_${webkitPort}` : 'PLAYWRIGHT_BUNDLED_CHROMIUM';
    result.headless = launchOptions.headless;
    const allowedOrigins = [a.origin, b.origin]; const requests = []; const pendingObservations = new Set();
    // Qualify the independent foreign-app storage before loading application
    // code. An unsupported/losing control remains FAIL, never a UI retention PASS.
    result.driverCacheControl = await driverCacheControl(engine, launchOptions, allowedOrigins, dir, a);
    assert.equal(result.driverCacheControl.error, undefined, 'Independent foreign application control must qualify without hidden setup failure');
    assert.equal(result.driverCacheControl.initialMatch, true, 'Independent no-application cache control must store its canary');
    assert.equal(result.driverCacheControl.foreignMatch, false, 'Independent origin B must not expose origin A cache');
    assert.equal(result.driverCacheControl.restoredMatch, true, 'Independent no-application browser profile must retain cache after A/B/A');
    const observationErrors = [];
    const drainObservations = async () => {
      for (let attempt = 0; attempt < 4 && pendingObservations.size; attempt++) await Promise.allSettled([...pendingObservations]);
      assert.equal(pendingObservations.size, 0, 'Request-header observations must settle before boundary assertions');
      assert.deepEqual(observationErrors, []);
    };
    await context.route(url => !allowedOrigins.includes(url.origin), async route => { result.externalRequests++; await route.abort(); });
    await context.routeWebSocket(url => !allowedOrigins.some(origin => url.origin === origin.replace('https:', 'wss:')),
      route => { result.externalRequests++; route.close({ code: 1008, reason: 'DEMO external origin blocked' }); });
    context.on('request', request => {
      const observation = (async () => {
        const url = new URL(request.url()); if (!allowedOrigins.includes(url.origin)) return;
        const headers = await request.allHeaders(); const which = url.origin === a.origin ? 'A' : 'B';
        const cookie = headers.cookie || '';
        if (cookie.includes(which === 'A' ? 'DEMO_B_session=' : 'DEMO_A_session=')) result.cookieBoundary[`foreignOn${which}`]++;
        if (cookie.includes(`DEMO_${which}_session=`)) result.cookieBoundary[`ownOn${which}`]++;
        const data = request.postData() || '';
        const foreignMarkers = which === 'B' ? [markers.a, markers.draft, markers.image, 'DEMO-A-durable-', 'DEMO-A-live-'] : [markers.b, 'DEMO-B-durable-', 'DEMO-B-live-'];
        if (foreignMarkers.some(marker => data.includes(marker) || request.url().includes(marker))) result.foreignPayloads++;
        requests.push({ which, method: request.method(), path: url.pathname, query: Boolean(url.search), fragment: Boolean(url.hash) });
      })().catch(() => { observationErrors.push('DEMO request-header observation failed'); });
      pendingObservations.add(observation); observation.finally(() => pendingObservations.delete(observation));
    });
    await context.addCookies([{ name: 'DEMO_A_session', value: 'DEMO-owned-A-cookie', url: a.origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
    result.pageCacheDeleteCalls = [];
    result.pageForeignCacheWriteCalls = [];
    await context.exposeBinding('__DEMO_cacheDeleteWitness', (_source, metadata) => { result.pageCacheDeleteCalls.push(metadata); });
    await context.exposeBinding('__DEMO_cacheWriteWitness', (_source, metadata) => { result.pageForeignCacheWriteCalls.push(metadata); });
    // Passive constructor instrumentation keeps URL/protocol arguments unchanged.
    // Only booleans are retained, never cookie/ticket/frame values.
    await context.addInitScript(({ origins, foreignCacheName, foreignAssetPath }) => {
      // Passive page-realm deletion witness. Worker operations are a separate
      // acceptance gate; no worker source/response is replaced for this test.
      const removeCache = CacheStorage.prototype.delete;
      CacheStorage.prototype.delete = function(name) {
        void window.__DEMO_cacheDeleteWitness({ kind: 'cache', ownStatic: String(name).startsWith('hermes-remote-web.static.v1.'), canary: name === foreignCacheName });
        return removeCache.call(this, name);
      };
      const cacheNames = new WeakMap(); const openCache = CacheStorage.prototype.open;
      CacheStorage.prototype.open = async function(name) { const cache = await openCache.call(this, name); cacheNames.set(cache, name); return cache; };
      const putEntry = Cache.prototype.put;
      Cache.prototype.put = function(request, response) {
        if (cacheNames.get(this) === foreignCacheName) void window.__DEMO_cacheWriteWitness({ foreignCache: true });
        return putEntry.call(this, request, response);
      };
      const removeEntry = Cache.prototype.delete;
      Cache.prototype.delete = function(request, options) {
        const url = new URL(request instanceof Request ? request.url : String(request), location.href);
        void window.__DEMO_cacheDeleteWitness({ kind: 'entry', canary: url.pathname === foreignAssetPath });
        return removeEntry.call(this, request, options);
      };
      window.__DEMO_originSockets = [];
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url, protocols) {
          const target = new URL(url, location.href); const current = location.origin;
          const list = typeof protocols === 'string' ? [protocols] : protocols || [];
          const foreignPrefix = current === origins[0] ? 'hermes-gateway-ticket.DEMO-ticket-90' : 'hermes-gateway-ticket.DEMO-ticket-10';
          window.__DEMO_originSockets.push({ sameOrigin: target.host === location.host, query: Boolean(target.search),
            hasForeignTicket: list.some(value => value.startsWith(foreignPrefix)), hasFreshTicket: list.some(value => value.startsWith('hermes-gateway-ticket.')) });
          super(url, protocols);
        }
      };
    }, { origins: allowedOrigins, foreignCacheName: FOREIGN_CACHE, foreignAssetPath: FOREIGN_ASSET });
    const foreignReadsBeforeSeed = foreignReads(a);
    result.foreignWorkerSeed = await installForeignWorkerOnce(context, a.origin);
    assert.equal(result.foreignWorkerSeed.sha256, FOREIGN_SHA256);
    assert.deepEqual(result.foreignWorkerSeed.registration, { scope: a.origin + FOREIGN_SCOPE, scriptURL: a.origin + FOREIGN_WORKER, state: 'activated' });
    assert.equal(foreignReads(a) - foreignReadsBeforeSeed, 1);
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => result.pageErrors.push(error.message.replaceAll(a.origin, 'DEMO-origin-A').replaceAll(b.origin, 'DEMO-origin-B')));
    page.on('websocket', socket => {
      const host = new URL(socket.url()).host;
      if (![new URL(a.origin).host, new URL(b.origin).host].includes(host)) { result.externalRequests++; return; }
      const foreignMarkers = host === new URL(b.origin).host ? [markers.a, markers.draft, markers.image, 'DEMO-A-durable-', 'DEMO-A-live-'] : [markers.b, 'DEMO-B-durable-', 'DEMO-B-live-'];
      socket.on('framesent', event => { if (foreignMarkers.some(marker => String(event.payload).includes(marker))) result.foreignPayloads++; });
    });
    const aIndex = await page.goto(a.origin + '/hermes-remote-web/'); assert.equal(digest(await aIndex.body()), report.indexSha256); await ready(page);
    assert.equal(await page.evaluate(async () => (await (await fetch('/hermes-remote-web/build.json', { cache: 'no-store' })).json()).buildId), build);
    // Two ports on one hostname share browser Cookie scope. Refuse this target
    // before navigation, without testing by actually leaking a synthetic cookie.
    const alternatePort = new URL(a.origin); alternatePort.port = new URL(b.origin).port;
    assert.notEqual(alternatePort.origin, a.origin);
    await settings(page);
    const originPanel = page.getByRole('region', { name: '別接続先', exact: true });
    await originPanel.getByLabel('HTTPS接続先', { exact: true }).fill(alternatePort.origin);
    await originPanel.getByRole('checkbox', { name: '自分が利用を許可された接続先です', exact: true }).check();
    await originPanel.getByRole('button', { name: '接続先を登録', exact: true }).click();
    await originPanel.getByRole('status').filter({ hasText: '同じホストの別ポートや親子ホスト' }).waitFor();
    await drainObservations();
    assert.equal(requests.filter(row => row.which === 'B').length, 0); assert.equal(result.externalRequests, 0);
    assert.deepEqual((await inspectStore(page)).connections, []);
    assert.equal(await originPanel.getByRole('button', { name: '別接続先を開く', exact: true }).count(), 0);
    passed('R21_same_hostname_alternate_port_registration_rejected_before_navigation_or_cookie_transfer');
    // A metadata-only legacy entry is rejected on read, without auto-deleting it.
    await page.evaluate(async origin => await new Promise((resolveWrite, reject) => {
      const request = indexedDB.open('hermes-remote-web.connections.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('origins');
      request.onerror = () => reject(new Error('DEMO legacy destination store unavailable'));
      request.onsuccess = () => {
        const db = request.result; const transaction = db.transaction('origins', 'readwrite');
        transaction.objectStore('origins').put([{ origin, label: 'DEMO legacy alternate port' }], 'allowed');
        transaction.oncomplete = () => { db.close(); resolveWrite(); };
        transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error('DEMO legacy destination seed failed')); };
      };
    }), alternatePort.origin);
    await chatList(page); await settings(page);
    assert.equal(await page.getByText('DEMO legacy alternate port', { exact: true }).count(), 0);
    assert.equal(await originPanel.getByRole('button', { name: '別接続先を開く', exact: true }).count(), 0);
    assert.deepEqual((await inspectStore(page)).connections, [{ origin: alternatePort.origin, label: 'DEMO legacy alternate port' }]);
    await drainObservations(); assert.equal(result.externalRequests, 0); assert.equal(requests.filter(row => row.which === 'B').length, 0);
    passed('R21_persisted_same_host_alternate_port_cannot_be_selected_and_is_not_auto_deleted');
    await chatList(page);
    await page.getByLabel('登録profile', { exact: true }).selectOption('DEMO-secondary'); await ready(page);
    await openSaved(page, 'DEMO-secondary'); await page.getByText(markers.a, { exact: true }).waitFor();
    const aSockets = await page.evaluate(() => window.__DEMO_originSockets);
    assert.ok(aSockets.length > 0 && aSockets.every(row => row.sameOrigin && row.hasFreshTicket && !row.hasForeignTicket && !row.query));
    const aStore = await saveHistory(page); passed('R21_origin_A_explicit_encrypted_history_and_scoped_worker', { entries: aStore.entries, workers: aStore.workers.length });
    result.cacheObservations = { createdA: await inspectStore(page) };
    result.cacheObservations.createdAForeign = await foreignCacheObservation(page, a.origin);
    assert.equal(result.cacheObservations.createdAForeign.sha256, FOREIGN_SHA256);
    assert.deepEqual(result.cacheObservations.createdAForeign.registration, result.foreignWorkerSeed.registration);
    const connections = await addDestination(page, b.origin, 'DEMO 独立接続先 B');
    await drainObservations();
    assert.equal(requests.filter(row => row.which === 'B').length, 0, 'registering a destination must not contact it');
    passed('R21_register_without_cross_origin_HTTP');
    await chatList(page); await page.getByRole('button', { name: '開いている会話へ', exact: true }).click();
    const input = page.getByLabel('Hermesへのメッセージ', { exact: true }); await input.fill(markers.draft);
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1f7a65'; ctx.fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.getByLabel('JPEGまたはPNGを1枚選択', { exact: true }).setInputFiles({ name: markers.image, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.getByRole('region', { name: '選択した画像', exact: true }).waitFor(); await settings(page);
    assert.equal(await connections.getByRole('button', { name: '別接続先を開く', exact: true }).isDisabled(), true);
    await drainObservations();
    assert.equal(requests.filter(row => row.which === 'B').length, 0);
    await connections.screenshot({ path: join(dir, '01-origin-A-draft-attachment-navigation-blocked.png') }); result.screenshots.push(join(dir, '01-origin-A-draft-attachment-navigation-blocked.png'));
    passed('R21_draft_and_attachment_block_cross_origin_navigation_no_transfer');
    await chatList(page); await page.getByRole('button', { name: '開いている会話へ', exact: true }).click();
    await page.getByRole('button', { name: '画像の選択を取消', exact: true }).click(); await input.fill(''); await settings(page);
    await connections.getByRole('button', { name: '別接続先を開く', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '別接続先へ移動', exact: true }); await dialog.waitFor();
    await drainObservations();
    assert.equal(requests.filter(row => row.which === 'B').length, 0, 'opening confirmation must not contact destination');
    const [, bIndex] = await Promise.all([page.waitForURL(b.origin + '/hermes-remote-web/'),
      page.waitForResponse(response => response.url() === b.origin + '/hermes-remote-web/' && response.request().isNavigationRequest()),
      dialog.getByRole('button', { name: '接続先を開く', exact: true }).click()]);
    assert.equal(digest(await bIndex.body()), report.indexSha256);
    await page.getByRole('region', { name: '接続案内', exact: true }).getByRole('link', { name: 'Hermesのログイン画面を開く', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: '再認証が必要' }).waitFor();
    result.originAWindowsWhileOnB = context.pages().filter(item => new URL(item.url()).origin === a.origin).length;
    assert.equal(result.originAWindowsWhileOnB, 0, 'No origin A keeper window may preserve its cache across navigation');
    assert.equal(await page.evaluate(async () => (await (await fetch('/hermes-remote-web/build.json', { cache: 'no-store' })).json()).buildId), build);
    assert.equal(b.state.ticketSequence, 900, 'origin B must issue no ticket before its own auth'); assert.equal(b.state.methods.length, 0);
    assert.equal(new URL(page.url()).search, ''); assert.equal(new URL(page.url()).hash, '');
    passed('R21_explicit_navigation_without_ticket_query_and_destination_requires_own_auth');
    await settings(page); const bEmpty = await inspectStore(page);
    assert.equal(bEmpty.entries, 0); assert.equal(bEmpty.wrappedKey, false); assert.deepEqual(bEmpty.connections, []); assert.deepEqual(bEmpty.workers, []);
    result.cacheObservations.foreignOnB = await foreignCacheObservation(page, a.origin);
    assert.equal(result.cacheObservations.foreignOnB.hasCache, false);
    assert.equal(result.cacheObservations.foreignOnB.sha256, null);
    assert.equal(result.cacheObservations.foreignOnB.registration, null);
    result.cacheObservations.emptyB = await inspectStore(page);
    assert.deepEqual(result.cacheObservations.emptyB.manualCacheKeys, []);
    assert.equal(await page.getByText(markers.a, { exact: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: '選択した画像', exact: true }).count(), 0);
    passed('R21_origin_B_receives_no_A_encrypted_store_connections_worker_cache_or_attachment');
    b.state.auth = true;
    await context.addCookies([{ name: 'DEMO_B_session', value: 'DEMO-owned-B-cookie', url: b.origin, secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await page.reload();
    // Auth expiry intentionally persists signed-out. Even a new own cookie must
    // not silently authenticate; use the existing explicit reconnect action.
    await page.getByRole('button', { name: '認証後に接続・再接続', exact: true }).click();
    await ready(page); assert.equal(await page.getByLabel('登録profile', { exact: true }).inputValue(), 'default');
    await openSaved(page, 'default'); await page.getByText(markers.b, { exact: true }).waitFor();
    assert.equal(await input.inputValue(), ''); assert.equal(await page.getByText(markers.a, { exact: true }).count(), 0);
    const bSockets = await page.evaluate(() => window.__DEMO_originSockets);
    assert.ok(bSockets.length > 0 && bSockets.every(row => row.sameOrigin && row.hasFreshTicket && !row.hasForeignTicket && !row.query));
    passed('R21_B_own_auth_fresh_ticket_default_profile_and_own_history_no_A_memory');
    const bStore = await saveHistory(page); assert.ok(bStore.workers.length > 0 && bStore.workers.every(row => row.scope.startsWith(b.origin + '/hermes-remote-web/')));
    await page.getByRole('region', { name: '端末の暗号化保存', exact: true }).screenshot({ path: join(dir, '02-origin-B-own-auth-storage-worker.png') }); result.screenshots.push(join(dir, '02-origin-B-own-auth-storage-worker.png'));
    passed('R21_B_independent_explicit_store_and_worker_scope', { entries: bStore.entries, workers: bStore.workers.length });
    await page.goto(a.origin + '/hermes-remote-web/'); await ready(page); await settings(page);
    const restoredA = await inspectStore(page); assert.equal(restoredA.entries, 1); assert.equal(restoredA.wrappedKey, true);
    result.cacheObservations.restoredA = restoredA;
    assert.deepEqual(restoredA.connections, [{ origin: b.origin, label: 'DEMO 独立接続先 B' }]);
    assert.ok(restoredA.workers.some(row => row.scope === a.origin + '/hermes-remote-web/' && row.active));
    assert.deepEqual(restoredA.workers.map(row => row.scope).sort(), [a.origin + '/hermes-remote-web/', a.origin + FOREIGN_SCOPE].sort());
    await page.getByRole('button', { name: '保存を解錠', exact: true }).waitFor();
    passed('R21_A_encrypted_store_connection_and_worker_survive_B_without_unwrapped_key_transfer');
    result.cacheObservations.restoredAForeign = await foreignCacheObservation(page, a.origin);
    assert.deepEqual(result.pageCacheDeleteCalls, [], 'The application page must perform no cache/entry removal during origin navigation');
    assert.deepEqual(result.pageForeignCacheWriteCalls, [], 'The application page must never write or recreate the foreign cache');
    assert.equal(result.cacheObservations.restoredAForeign.sha256, FOREIGN_SHA256, 'Foreign cached bytes must survive origin navigation without refetch/reseed');
    assert.deepEqual(result.cacheObservations.restoredAForeign.registration, result.foreignWorkerSeed.registration);
    assert.deepEqual(result.cacheObservations.restoredAForeign.keys, [{ origin: a.origin, path: FOREIGN_ASSET }]);
    result.foreignAssetFetches = foreignReads(a) - foreignReadsBeforeSeed;
    assert.equal(result.foreignAssetFetches, 1, 'The foreign worker must fetch once at initial install; no return fallback is allowed');
    passed('R21_foreign_cache_canary_retained_after_origin_return', { cacheKind: 'INDEPENDENT_FOREIGN_WORKER_STATIC_CACHE',
      expectedSha256: FOREIGN_SHA256, observedSha256: result.cacheObservations.restoredAForeign.sha256,
      registerCalls: 1, installAssetFetches: result.foreignAssetFetches, scopeAndScriptUnchanged: true, foreignPageCacheWrites: 0, pageCacheDeleteCalls: 0 });
    assert.equal(a.state.submissions, 0); assert.equal(b.state.submissions, 0); assert.deepEqual(a.state.answers, []); assert.deepEqual(b.state.answers, []);
    const readMethods = new Set(['client.capabilities', 'gateway.capabilities', 'remote.app.capabilities', 'gateway.ping', 'ping', 'session.list', 'session.resume', 'session.activate', 'session.events.since', 'projects.tree', 'projects.project_sessions']);
    const forbidden = [...a.state.methods, ...b.state.methods].filter(method => !readMethods.has(method)); assert.deepEqual(forbidden, []);
    await drainObservations();
    // The local WebKit protocol does not expose every Cookie header. The real
    // HTTPS/upgrade receivers are authoritative; only two DEMO names are kept.
    result.browserHeaderCookieBoundary = { ...result.cookieBoundary };
    const countCookie = (fixture, name) => [...fixture.state.httpRequests, ...fixture.state.wsUpgrades].filter(request => request.cookieNames.includes(name)).length;
    result.cookieBoundary = { measurement: 'ACTUAL_HTTPS_AND_WS_SERVER_RECEIPT_NAMES_ONLY',
      foreignOnA: countCookie(a, 'DEMO_B_session'), foreignOnB: countCookie(b, 'DEMO_A_session'),
      ownOnA: countCookie(a, 'DEMO_A_session'), ownOnB: countCookie(b, 'DEMO_B_session') };
    assert.equal(result.cookieBoundary.foreignOnA, 0); assert.equal(result.cookieBoundary.foreignOnB, 0);
    assert.ok(result.cookieBoundary.ownOnA > 0 && result.cookieBoundary.ownOnB > 0);
    assert.equal(result.foreignPayloads, 0); assert.equal(result.externalRequests, 0); assert.deepEqual(result.pageErrors, []);
    passed('R21_host_only_cookie_headers_no_foreign_payload_no_backend_write_or_generation');
    result.requestCounts = { a: requests.filter(row => row.which === 'A').length, b: requests.filter(row => row.which === 'B').length };
    result.rpcCounts = { a: a.state.methods.length, b: b.state.methods.length }; result.boundaryStatus = 'PASS';
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.error = error.message; process.exitCode = 1;
    result.failureMetadata = { a: { auth: a.state.auth, ticketsIssued: a.state.ticketSequence - 100, methods: a.state.methods.slice(-12) },
      b: { auth: b.state.auth, ticketsIssued: b.state.ticketSequence - 900, methods: b.state.methods.slice(-12) } };
    if (page) {
      try { result.failureMetadata.statuses = (await page.getByRole('status').allTextContents()).slice(0, 8).map(value => value.slice(0, 500));
        result.failureMetadata.connectionText = (await page.getByRole('region', { name: '接続案内', exact: true }).allTextContents()).map(value => value.slice(0, 500)); }
      catch { result.failureMetadata.pageObservation = 'UNAVAILABLE'; }
    }
  }
  finally {
    await context?.close(); await browser?.close(); await a.close(); await b.close();
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ engine: engineName, status: result.status, checks: result.checks.length, error: result.error, output }));
  }
}
assert.equal(report.cases.length, engines.length);
if (report.cases.some(row => row.status === 'FAIL' || (row.status === 'INCONCLUSIVE' && !allowDriverCacheInconclusive))) process.exitCode = 1;
