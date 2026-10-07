import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { waitForOwnedWorkerState } from './worker-readiness.mjs';
import { observeWorkerNetworkIsolation } from './worker-network-boundary.mjs';

// Real built UI and real Service Worker; synthetic localhost gateway only.
// Every browser, cache, release and TLS fixture belongs to this test process.
const root = fileURLToPath(new URL('..', import.meta.url));
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const appRoot = resolve(argument('app-root') || root);
const engines = argument('engine') ? [argument('engine')] : ['webkit', 'chromium'];
const widths = argument('width') ? [Number(argument('width'))] : [320, 390];
const networkBoundary = process.env.HERMES_TEST_WORKER_NETWORK_ISOLATED === '1'
  ? await observeWorkerNetworkIsolation() : null;
assert.ok(engines.every(value => ['webkit', 'chromium'].includes(value)));
assert.ok(widths.every(value => [320, 390].includes(value)));
const { startFixture } = await import(pathToFileURL(join(appRoot, 'scripts/fixture-server.mjs')).href);
const build = readFileSync(join(appRoot, 'releases/current-build.txt'), 'utf8').trim();
const source = join(appRoot, 'releases', build);
const sourceIndex = readFileSync(join(source, 'index.html'), 'utf8');
const scriptPath = html => html.match(/src="(\/hermes-remote-web\/assets\/[^"?]+\.js)"/)?.[1];
const currentJs = scriptPath(sourceIndex);
const staticPath = value => value.slice('/hermes-remote-web/'.length);
const digest = value => createHash('sha256').update(value).digest('hex');
assert.ok(currentJs, 'current built module missing');
const workerSource = readFileSync(join(source, 'remote-worker.js'), 'utf8');
const workerConfig = JSON.parse(workerSource.match(/^const CONFIG = (.+);$/m)?.[1] || 'null');
assert.equal(workerConfig?.buildId, build, 'build must contain its real injected worker allowlist');
assert.ok(workerConfig.assets.some(value => value.path.endsWith('/index.html')));
mkdirSync(join(root, 'output/playwright'), { recursive: true });
const output = mkdtempSync(join(root, 'output/playwright/product-worker-'));
const oldRelease = join(output, 'old');
const combined = join(output, 'combined');
cpSync(source, oldRelease, { recursive: true });
cpSync(source, combined, { recursive: true });
const oldBuild = 'remote-v2-0000000000000000';
const oldScript = readFileSync(join(source, staticPath(currentJs)), 'utf8').replaceAll(build, oldBuild);
assert.ok(oldScript.includes(oldBuild), 'compiled UI must expose its build marker');
const oldJs = `/hermes-remote-web/assets/index-${digest(oldScript).slice(0, 8)}.js`;
assert.notEqual(oldJs, currentJs);
writeFileSync(join(oldRelease, staticPath(oldJs)), oldScript);
writeFileSync(join(combined, staticPath(oldJs)), oldScript);
writeFileSync(join(oldRelease, 'index.html'), sourceIndex.replace(currentJs, oldJs));
writeFileSync(join(oldRelease, 'build.json'), JSON.stringify({ buildId: oldBuild }) + '\n');
const oldAssets = workerConfig.assets.map(asset => {
  const path = asset.path === currentJs ? oldJs : asset.path;
  return { path, sha256: digest(readFileSync(join(oldRelease, staticPath(path)))) };
});
writeFileSync(join(oldRelease, 'remote-worker.js'), workerSource.replace(/^const CONFIG = .+;$/m,
  `const CONFIG = ${JSON.stringify({ buildId: oldBuild, assets: oldAssets })};`));
writeFileSync(join(combined, '__DEMO_worker_silent.html'), '<!doctype html><html lang="ja"><title>DEMO no safety listener</title><p>DEMO timeout-only client</p></html>');
const report = { schema: 'hermes_remote_web_product_worker_browser_v1', observedAt: new Date().toISOString(),
  build, sourceApp: appRoot, sourceIndexSha256: digest(sourceIndex), sourceWorkerSha256: digest(workerSource),
  sourceJsSha256: digest(readFileSync(join(source, staticPath(currentJs)))),
  fixtureSourceSha256: digest(startFixture.toString()),
  oldBuild, fixture: 'synthetic prior build from current compiled UI; real worker and browser cache',
  providerCalls: 0, productionMutation: 0, networkBoundary, iphoneSafari: 'NOT_RUN', homeScreen: 'NOT_RUN', cases: [] };

async function workerMessage(page, target, type) {
  return page.evaluate(async ({ target, type }) => {
    const registration = await navigator.serviceWorker.getRegistration('/hermes-remote-web/');
    const worker = registration?.[target];
    if (!worker) throw new Error('DEMO expected worker unavailable');
    return await new Promise((resolveResult, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('DEMO worker message timed out')); }, 15000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolveResult(event.data); };
      worker.postMessage({ type }, [channel.port2]);
    });
  }, { target, type });
}
async function settings(page) {
  const back = page.getByRole('button', { name: '← 会話一覧', exact: true });
  if (await back.count()) await back.click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
}
async function ready(page) {
  await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor({ timeout: 20000 });
}
async function updateState(page, enabled) {
  await page.waitForFunction(expected => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('操作と下書きがない状態で更新'));
    return Boolean(button && button.disabled === !expected);
  }, enabled);
}
async function cacheKeys(page) { return await page.evaluate(() => caches.keys()); }
const DEMO_PASSPHRASE = 'DEMO-only-local-test-passphrase-20261005';
async function saveDemoHistory(page) {
  await page.getByRole('button', { name: '新規会話', exact: true }).click();
  await page.getByRole('button', { name: '← 会話一覧', exact: true }).waitFor();
  await settings(page);
  await page.getByLabel('端末保存のパスフレーズ').fill(DEMO_PASSPHRASE);
  await page.getByRole('button', { name: '暗号化保存を準備', exact: true }).click();
  await page.getByText('解錠しました。保存は個別に有効化してください。', { exact: true }).waitFor();
  const historyChoice = page.getByRole('checkbox', { name: '選んだ履歴をオフラインで閲覧', exact: true });
  await historyChoice.click();
  await page.waitForFunction(() => [...document.querySelectorAll('label')].some(label =>
    label.textContent.includes('選んだ履歴をオフラインで閲覧') && label.querySelector('input')?.checked === true));
  assert.equal(await historyChoice.isChecked(), true, 'the async shell/cache opt-in must finish before history save');
  await page.getByRole('button', { name: '現在取得済みの履歴を端末へ保存', exact: true }).click();
  await page.getByText('現在取得済みの発言を暗号化保存しました。', { exact: true }).waitFor();
  const inspection = await page.evaluate(async () => {
    const contents = await new Promise((resolveContents, reject) => {
      const request = indexedDB.open('hermes-remote-web.encrypted.v1', 1);
      request.onerror = () => reject(new Error('DEMO own IDB unavailable'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('owned', 'readonly');
        const query = transaction.objectStore('owned').get('contents');
        query.onerror = () => { database.close(); reject(new Error('DEMO own IDB read failed')); };
        query.onsuccess = () => { database.close(); resolveContents(query.result); };
      };
    });
    return { entries: contents.entries.length,
      ciphertextOnly: contents.entries.every(entry => entry.ciphertext instanceof ArrayBuffer && !('value' in entry) && !('scope' in entry)),
      wrappedKey: contents.key.ciphertext instanceof ArrayBuffer && contents.key.ciphertext.byteLength === 48 && !(contents.key instanceof CryptoKey),
      metadataContainsPlaintext: JSON.stringify(contents).includes('DEMO') };
  });
  assert.equal(inspection.entries, 1); assert.equal(inspection.ciphertextOnly, true);
  assert.equal(inspection.wrappedKey, true); assert.equal(inspection.metadataContainsPlaintext, false);
  await page.reload(); await ready(page); await settings(page);
  await page.getByRole('button', { name: '保存を解錠', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存履歴を閲覧', exact: true }).count(), 0, 'reload must discard the unwrapped key');
  return inspection;
}
async function viewDemoHistoryOffline(page, screenshot) {
  await page.locator('.remote-app').waitFor(); await settings(page);
  await page.getByRole('button', { name: '保存を解錠', exact: true }).waitFor();
  await page.getByLabel('端末保存のパスフレーズ').fill(DEMO_PASSPHRASE);
  await page.getByRole('button', { name: '保存を解錠', exact: true }).click();
  await page.getByRole('button', { name: '保存履歴を閲覧', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '端末に保存した履歴', exact: true });
  await dialog.getByText('DEMO 保存済み回答。実サーバーには接続していません。', { exact: true }).waitFor();
  await dialog.screenshot({ path: screenshot });
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
}
async function controllerBuild(page) {
  return await page.evaluate(async () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return null;
    // Identify the cache read by this controller by asking its offline navigation.
    const cached = (await caches.keys()).filter(value => value.startsWith('hermes-remote-web.static.v1.'));
    return { script: new URL(controller.scriptURL).pathname, cached, state: controller.state };
  });
}
async function observeOwnedRegistration(page) {
  return await page.evaluate(async () => {
    const scope = `${location.origin}/hermes-remote-web/`;
    const registrations = (await navigator.serviceWorker.getRegistrations()).filter(item => item.scope === scope);
    const worker = value => value ? { state: value.state, path: new URL(value.scriptURL).pathname } : null;
    const cacheKeys = await caches.keys();
    return { controller: worker(navigator.serviceWorker.controller), registrations: registrations.map(item => ({
      scopePath: new URL(item.scope).pathname, active: worker(item.active), waiting: worker(item.waiting), installing: worker(item.installing),
    })), ownCacheKeys: cacheKeys.filter(name => name.startsWith('hermes-remote-web.static.v1.')),
    foreignDemoCachePresent: cacheKeys.includes('DEMO.other-app.cache') };
  });
}

async function logoutPrivacy(page, context, fixture, url) {
  // Only the device subscription boundary is synthetic. The app's BroadcastChannel,
  // controller, Web Lock, JSON-RPC transport and formal HTTP logout remain real.
  const other = await context.newPage(); await other.goto(url); await ready(other);
  await other.getByRole('button', { name: '新規会話', exact: true }).click();
  await other.getByLabel('Hermesへのメッセージ').fill('DEMO 他タブで隠す下書き');
  await settings(page);
  const baselineRevokes = fixture.state.methods.filter(method => method === 'remote.notifications.unsubscribe_all').length;
  const order = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/auth/logout') order.push({ type: 'auth_logout',
      revokesObserved: fixture.state.methods.filter(method => method === 'remote.notifications.unsubscribe_all').length - baselineRevokes });
  });
  await page.evaluate(() => { window.__DEMO_PUSH_REVOKE_WAIT = true; });
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウトを実行', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'ログアウト中です。会話と入力内容を隠しています。' }).waitFor();
  await page.waitForFunction(() => window.__DEMO_PUSH_REVOKE_CALLS === 1);
  assert.equal(await page.locator('.remote-workspace').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '設定', exact: true }).count(), 0, 'hidden workspace must not be reachable through the accessibility tree');
  await other.locator('.remote-connection-dot[data-connection="logged_out"]').waitFor();
  assert.equal(await other.getByLabel('Hermesへのメッセージ').count(), 0);
  assert.equal(fixture.state.auth, true, 'auth logout must wait until scoped revocation finishes');
  assert.ok(fixture.state.sockets.size >= 1, 'initiating tab must retain its authenticated RPC channel despite same-page and other-tab logout broadcasts');
  assert.equal(fixture.state.methods.filter(method => method === 'remote.notifications.unsubscribe_all').length, baselineRevokes);
  assert.deepEqual(order, []);
  await page.evaluate(() => { window.__DEMO_PUSH_REVOKE_RELEASE(); });
  await page.locator('.remote-workspace').waitFor({ state: 'visible' });
  await page.getByRole('status').filter({ hasText: 'Hermesのログアウトを実施しました' }).waitFor();
  assert.equal(await page.getByRole('status').filter({ hasText: 'ログアウト中です。会話と入力内容を隠しています。' }).count(), 0);
  assert.equal(fixture.state.methods.filter(method => method === 'remote.notifications.unsubscribe_all').length, baselineRevokes + 1,
    'formal scoped server revocation must occur once before the auth session is closed');
  assert.deepEqual(order, [{ type: 'auth_logout', revokesObserved: 1 }]);
  assert.equal(fixture.state.auth, false);
  assert.equal(await page.getByLabel('Hermesへのメッセージ').count(), 0);
  assert.deepEqual((await cacheKeys(page)).filter(name => name.startsWith('hermes-remote-web.static.v1.')), []);
  assert.equal(await page.evaluate(async () => (await (await caches.open('DEMO.other-app.cache')).match('/other-app/fixture')).text()), 'DEMO foreign content');
  await other.close();
  return { deviceSubscriptionBoundary: 'synthetic delayed getSubscription; real Push permission/delivery NOT_RUN',
    initiatingRpcRetainedWhileHidden: true, otherTabDraftHidden: true, serverRevocations: 1, authLogouts: 1, order };
}

async function run(engineName, width) {
  const fixture = await startFixture({ releaseDirectory: oldRelease, staticCacheControl: 'no-store' });
  fixture.state.nextBuild = oldBuild;
  assert.equal(new URL(fixture.origin).hostname, '127.0.0.1');
  assert.equal(fixture.state.networkOffline, false, 'fixture must start with its real listener available');
  assert.equal(typeof fixture.setNetworkOffline, 'function', 'HTTP and WS must share the same transport failure boundary');
  assert.equal(fixture.state.staticDelayMs, 0, 'fixture must support bounded in-flight static response delay');
  assert.deepEqual(fixture.state.featureMethods, [], 'fixture must expose only explicitly enabled synthetic feature handlers');
  fixture.state.featureMethods = ['remote.notifications.unsubscribe_all'];
  // Chromium's SW script fetch ignores a context's TLS override. Pin only the
  // public key of this generated localhost certificate, never disable TLS globally.
  const certificate = new X509Certificate(readFileSync(join(appRoot, 'output/playwright/tls/fixture-cert.pem')));
  assert.equal(certificate.subject, 'CN=localhost');
  assert.ok(certificate.subjectAltName.includes('IP Address:127.0.0.1'));
  const fixtureSpki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const result = { engine: engineName, viewport: width, status: 'RUNNING', checks: [], productionWrite: 0, providerCalls: 0 };
  report.cases.push(result);
  let browser; let closingBrowser = false;
  try {
    const engine = engineName === 'webkit' ? webkit : chromium;
    const localWebkit = engineName === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1';
    // Keep every browser's desktop settings and runtime files in its own empty
    // test home. Do not inherit operator credentials, proxy or desktop sessions.
    const fixtureHome = join(output, `${engineName}-${width}-home`);
    for (const directory of ['', 'cache', 'config', 'data', 'runtime']) {
      mkdirSync(join(fixtureHome, directory), { recursive: true, mode: 0o700 });
    }
    const browserEnvironment = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: fixtureHome,
      XDG_CACHE_HOME: join(fixtureHome, 'cache'), XDG_CONFIG_HOME: join(fixtureHome, 'config'),
      XDG_DATA_HOME: join(fixtureHome, 'data'), XDG_RUNTIME_DIR: join(fixtureHome, 'runtime'),
      ...(localWebkit ? { HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()),
        ...(process.env.HERMES_TEST_WEBKIT_PORT ? { HERMES_TEST_WEBKIT_PORT: process.env.HERMES_TEST_WEBKIT_PORT } : {}),
        ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
        ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}) } : {}) };
    browser = await engine.launch({ headless: !(localWebkit && process.env.HERMES_TEST_WEBKIT_PORT === 'gtk'), timeout: 20000,
      ...(engineName === 'chromium' ? { args: [`--ignore-certificate-errors-spki-list=${fixtureSpki}`] } : {}),
      ...(localWebkit ? { executablePath: join(appRoot, 'scripts/run-webkit-local.sh') } : {}),
      env: browserEnvironment });
    result.browserEnvironment = { ownedEmptyHome: true, inheritedOperatorEnvironment: false,
      desktopSessionBusInherited: false, proxyEnvironmentInherited: false };
    result.engineVersion = browser.version();
    result.driverObservations = { pageCrashes: 0, unexpectedBrowserDisconnects: 0 };
    browser.on('disconnected', () => { if (!closingBrowser) result.driverObservations.unexpectedBrowserDisconnects++; });
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
      ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
    // Count only public API kinds and connection states. Delegate to the real
    // browser APIs; never register again, reseed a cache or capture payloads.
    result.storageApiObservations = [];
    result.storageApiObservationLimit = 500;
    result.storageApiObservationsTruncated = false;
    const allowedObservations = new Set(['cache_delete_own', 'cache_delete_foreign', 'worker_unregister_own',
      'worker_unregister_foreign', 'worker_clear_own', 'worker_clear_foreign',
      'connection_idle', 'connection_https', 'connection_auth', 'connection_ticket', 'connection_wss',
      'connection_gateway', 'connection_rpc', 'connection_connected', 'connection_reconnecting',
      'connection_offline', 'connection_reauth', 'connection_unsupported', 'connection_error', 'connection_logged_out']);
    await context.exposeBinding('__DEMO_observe_worker_api', (_source, kind) => {
      if (!allowedObservations.has(kind)) return;
      if (result.storageApiObservations.length < result.storageApiObservationLimit) {
        result.storageApiObservations.push({ kind, stage: result.stage ?? 'initial' });
      } else result.storageApiObservationsTruncated = true;
    });
    await context.addInitScript(() => {
      const note = kind => { void window.__DEMO_observe_worker_api(kind).catch(() => undefined); };
      const removeCache = CacheStorage.prototype.delete;
      CacheStorage.prototype.delete = function (name) {
        note(String(name).startsWith('hermes-remote-web.static.v1.') ? 'cache_delete_own' : 'cache_delete_foreign');
        return Reflect.apply(removeCache, this, [name]);
      };
      const unregister = ServiceWorkerRegistration.prototype.unregister;
      ServiceWorkerRegistration.prototype.unregister = function () {
        note(this.scope === `${location.origin}/hermes-remote-web/` ? 'worker_unregister_own' : 'worker_unregister_foreign');
        return Reflect.apply(unregister, this, []);
      };
      const post = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (...args) {
        if (args[0]?.type === 'CLEAR_OFFLINE_SHELL') {
          const url = new URL(this.scriptURL);
          note(url.origin === location.origin && url.pathname === '/hermes-remote-web/remote-worker.js'
            ? 'worker_clear_own' : 'worker_clear_foreign');
        }
        return Reflect.apply(post, this, args);
      };
      document.addEventListener('DOMContentLoaded', () => {
        let previous;
        const observe = () => {
          const connection = document.querySelector('.remote-connection-dot')?.getAttribute('data-connection');
          if (connection && connection !== previous) { previous = connection; note(`connection_${connection}`); }
        };
        new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true,
          attributes: true, attributeFilter: ['data-connection'] });
        observe();
      }, { once: true });
    });
    context.on('page', observedPage => observedPage.on('crash', () => result.driverObservations.pageCrashes++));
    result.workerEvents = [];
    context.on('serviceworker', worker => {
      const path = new URL(worker.url()).pathname;
      result.workerEvents.push({ type: 'created', path });
      worker.on('close', () => result.workerEvents.push({ type: 'closed', path }));
    });
    await context.addInitScript(() => {
      // No permission prompt, subscription registration or external Push request.
      if (typeof Notification === 'undefined') Object.defineProperty(window, 'Notification', { configurable: true,
        value: class { static permission = 'default'; static requestPermission() { throw new Error('DEMO permission forbidden'); } } });
      if (typeof PushManager === 'undefined') Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
      window.__DEMO_PUSH_REVOKE_WAIT = false;
      window.__DEMO_PUSH_REVOKE_CALLS = 0;
      const port = { async getSubscription() {
        if (window.__DEMO_PUSH_REVOKE_WAIT) { window.__DEMO_PUSH_REVOKE_CALLS++;
          await new Promise(resolveRevoke => { window.__DEMO_PUSH_REVOKE_RELEASE = resolveRevoke; });
        }
        return null;
      }, subscribe() { throw new Error('DEMO subscription forbidden'); } };
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { configurable: true, get: () => port });
    });
    const externalRequests = [];
    if (networkBoundary) {
      // All browser/worker children inherit the proven kernel namespace. Page
      // observations alone do not account for every SW-internal request.
      context.on('request', request => {
        if (new URL(request.url()).origin !== fixture.origin) externalRequests.push('outside_fixture_attempt');
      });
    } else {
      // Legacy direct runs retain their external-origin guard. Playwright also
      // enables protocol interception/cache-disable for owned WebKit requests.
      await context.route(url => url.origin !== fixture.origin, async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== fixture.origin) { externalRequests.push('outside_fixture_attempt'); await route.abort(); }
        else await route.continue();
      });
    }
    const page = await context.newPage();
    const url = fixture.origin + '/hermes-remote-web/';
    const setNetworkOffline = async value => {
      await fixture.setNetworkOffline(value);
      // WebKit's driver-level offline emulation blocks first-page navigation before
      // its SW can run. A closed localhost listener exercises the actual worker fetch/catch.
      if (engineName === 'chromium') await context.setOffline(value);
    };
    result.offlineSimulation = engineName === 'chromium' ? 'driver_offline_and_closed_fixture_listener' : 'closed_fixture_TCP_listener_and_own_HTTP_WS_sockets';
    await page.goto(url); await ready(page);
    assert.equal(await page.locator('script[type="module"]').getAttribute('src'), oldJs);
    await page.evaluate(async () => {
      if (!window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('DEMO browser worker unsupported');
      await navigator.serviceWorker.register('/hermes-remote-web/remote-worker.js', { scope: '/hermes-remote-web/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    });
    await page.reload(); await ready(page);
    assert.equal((await controllerBuild(page))?.state, 'activated');
    const oldCache = 'hermes-remote-web.static.v1.' + oldBuild;
    const newCache = 'hermes-remote-web.static.v1.' + build;
    assert.deepEqual((await cacheKeys(page)).filter(name => name.startsWith('hermes-remote-web.static.v1.')), [], 'OFF default must not pre-cache');
    await page.evaluate(async () => { await (await caches.open('DEMO.other-app.cache')).put('/other-app/fixture', new Response('DEMO foreign content')); });
    assert.equal((await workerMessage(page, 'active', 'CACHE_SHELL')).ok, true);
    assert.ok((await cacheKeys(page)).includes(oldCache));
    const cachedPaths = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(item => new URL(item.url).pathname), oldCache);
    assert.deepEqual(cachedPaths.sort(), oldAssets.map(value => value.path).sort());
    assert.ok(cachedPaths.every(path => !path.startsWith('/api/') && !path.includes('auth') && !path.endsWith('build.json')));
    result.checks.push('OFF_default_cache_zero; explicit_static_allowlist_only; no_API_auth_ticket_cache');
    result.stage = 'real_encrypted_store_save_reload';
    result.encryptedStore = await saveDemoHistory(page);
    result.checks.push('explicit_history_save_to_real_AES_IDB; no_plaintext_metadata_or_plain_key; reload_locks_key');
    // Public static cache state is observed before the real socket-failure probe.
    // This adds no retries and records no transcript, ciphertext, auth or ticket.
    result.beforeOfflineNavigation = await page.evaluate(async expectedCache => {
      const registration = await navigator.serviceWorker.getRegistration('/hermes-remote-web/');
      const observeWorker = worker => worker ? { state: worker.state, path: new URL(worker.scriptURL).pathname } : null;
      const ownCacheKeys = (await caches.keys()).filter(name => name.startsWith('hermes-remote-web.static.v1.'));
      const cache = await caches.open(expectedCache);
      const index = await cache.match('/hermes-remote-web/index.html');
      const indexText = index ? await index.text() : null;
      const indexHash = indexText === null ? null : [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(indexText)))].map(value => value.toString(16).padStart(2, '0')).join('');
      return { controller: observeWorker(navigator.serviceWorker.controller), active: observeWorker(registration?.active),
        waiting: observeWorker(registration?.waiting), installing: observeWorker(registration?.installing), ownCacheKeys,
        cachedPaths: (await cache.keys()).map(request => new URL(request.url).pathname).sort(),
        cachedIndexSha256: indexHash, cachedModule: indexText?.match(/src="(\/hermes-remote-web\/assets\/[^"?]+\.js)"/)?.[1] ?? null };
    }, oldCache);
    await setNetworkOffline(true);
    const offline = await context.newPage();
    result.stage = 'real_offline_navigation';
    await offline.goto(url, { waitUntil: 'domcontentloaded' });
    assert.equal(await offline.locator('script[type="module"]').getAttribute('src'), oldJs);
    const historyScreenshot = join(output, `${engineName}-${width}-encrypted-history.png`);
    await viewDemoHistoryOffline(offline, historyScreenshot);
    result.screenshots = [historyScreenshot];
    await offline.close(); await setNetworkOffline(false);
    result.checks.push('old_worker_offline_shell_boot_from_real_Cache_Storage');
    result.checks.push('offline_explicit_passphrase_unlock_and_encrypted_history_view; no_restore_autosend');

    // A second ordinary app tab owns a memory draft. Its guard must veto activation.
    const other = await context.newPage(); await other.goto(url); await ready(other);
    await other.getByRole('button', { name: '新規会話', exact: true }).click();
    const draft = other.getByLabel('Hermesへのメッセージ');
    await draft.fill('DEMO 更新しても保持する日本語の下書き');
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    fixture.state.staticRelease = combined; fixture.state.nextBuild = build;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/hermes-remote-web/');
      await registration.update();
    });
    await waitForOwnedWorkerState(page, 'waiting');
    await settings(page);
    await page.getByRole('button', { name: '更新を確認', exact: true }).click();
    await page.getByText(`更新あり · ${build}`).waitFor();
    const updateButton = page.getByRole('button', { name: '操作と下書きがない状態で更新' });
    result.stage = 'idle_initiator_before_connection_input';
    await updateState(page, true);
    assert.equal(await updateButton.isEnabled(), true);
    const endpointInput = page.getByLabel('HTTPS接続先', { exact: true });
    await endpointInput.fill('https://DEMO-endpoint.invalid');
    result.stage = 'unfinished_connection_input';
    await updateState(page, false);
    assert.equal(await updateButton.isDisabled(), true, 'an unfinished connection registration must also block reload');
    assert.equal(navigations, 0);
    await endpointInput.fill('');
    result.stage = 'cleared_connection_input';
    await updateState(page, true);
    assert.equal(await updateButton.isEnabled(), true);
    result.checks.push('unfinished_connection_registration_blocks_explicit_update');
    await updateButton.click();
    await page.getByText('別タブの入力・実行状態または更新workerを確認できません。現在の画面を維持しています。').waitFor();
    assert.equal(navigations, 0);
    assert.equal(await draft.inputValue(), 'DEMO 更新しても保持する日本語の下書き');
    assert.equal(await page.locator('script[type="module"]').getAttribute('src'), oldJs);
    result.checks.push('unsafe_other_tab_draft_rejects_activation; no_reload; draft_preserved');
    await draft.fill(''); await other.close();

    // A silent owned client exercises the bounded timeout instead of assuming all tabs reply.
    const silent = await context.newPage(); await silent.goto(url + '__DEMO_worker_silent.html');
    const timeoutStart = Date.now();
    await updateButton.click();
    await page.getByText('別タブの入力・実行状態または更新workerを確認できません。現在の画面を維持しています。').waitFor();
    await waitForOwnedWorkerState(page, 'waiting');
    // Wait for the button's busy flag to settle; an already-visible diagnostic alone is insufficient.
    await updateButton.waitFor({ state: 'visible' });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent?.includes('操作と下書きがない状態で更新'))?.disabled);
    result.silentClientElapsedMs = Date.now() - timeoutStart;
    assert.ok(result.silentClientElapsedMs >= 1800 && result.silentClientElapsedMs < 15000);
    assert.equal(navigations, 0); await silent.close();
    result.checks.push('silent_other_tab_timeout_rejects_activation; no_reload');

    // Actual UI helper must accept its own initiating tab and reload only after activation.
    result.stage = 'explicit_update_activation';
    await updateButton.click();
    await page.waitForURL(url);
    await ready(page);
    await page.waitForFunction(expected => document.querySelector('script[type="module"]')?.getAttribute('src') === expected, currentJs);
    assert.equal(navigations, 1);
    assert.equal((await controllerBuild(page))?.state, 'activated');
    assert.ok((await cacheKeys(page)).includes(newCache));
    const controlledIndex = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/hermes-remote-web/'))?.waiting === null);
    assert.equal(controlledIndex, true);
    result.registrationTimeline = [{ stage: 'new_active_before_offline', state: await observeOwnedRegistration(page) }];
    result.stage = 'new_offline_navigation';
    await setNetworkOffline(true);
    const newOffline = await context.newPage(); await newOffline.goto(url, { waitUntil: 'domcontentloaded' });
    assert.equal(await newOffline.locator('script[type="module"]').getAttribute('src'), currentJs);
    await newOffline.locator('.remote-app').waitFor();
    await newOffline.screenshot({ path: join(output, `${engineName}-${width}-new-offline.png`), fullPage: true });
    result.screenshots.push(join(output, `${engineName}-${width}-new-offline.png`));
    result.registrationTimeline.push({ stage: 'new_offline_tab_before_close', state: await observeOwnedRegistration(newOffline) });
    result.newOfflineConnection = await newOffline.locator('.remote-connection-dot').getAttribute('data-connection');
    await newOffline.close(); await setNetworkOffline(false);
    result.registrationTimeline.push({ stage: 'original_tab_after_online', state: await observeOwnedRegistration(page) });
    result.checks.push('explicit_UI_update_activates_new_controller; new_offline_index_JS_from_new_cache');

    // Roll back index/worker while retaining both immutable asset generations.
    result.stage = 'rollback_worker_registration';
    fixture.state.staticRelease = oldRelease; fixture.state.indexRelease = oldRelease; fixture.state.nextBuild = oldBuild;
    const rollback = await context.newPage(); await rollback.goto(url); await ready(rollback);
    assert.equal(await rollback.locator('script[type="module"]').getAttribute('src'), oldJs);
    result.beforeRollbackRegistration = await rollback.evaluate(async () => ({
      controller: navigator.serviceWorker.controller ? new URL(navigator.serviceWorker.controller.scriptURL).pathname : null,
      registrations: (await navigator.serviceWorker.getRegistrations()).map(item => ({ scopePath: new URL(item.scope).pathname,
        active: item.active?.state ?? null, waiting: item.waiting?.state ?? null, installing: item.installing?.state ?? null })),
    }));
    result.rollbackRegistrationWait = await waitForOwnedWorkerState(rollback, 'registered');
    result.registrationTimeline.push({ stage: 'rollback_registration_ready', state: await observeOwnedRegistration(rollback) });
    await rollback.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/hermes-remote-web/')).update(); });
    await waitForOwnedWorkerState(rollback, 'waiting');
    await settings(page);
    await page.getByRole('button', { name: '更新を確認', exact: true }).click();
    await page.getByText(`更新あり · ${oldBuild}`).waitFor();
    await page.getByRole('button', { name: '操作と下書きがない状態で更新' }).click();
    await ready(page);
    await page.waitForFunction(expected => document.querySelector('script[type="module"]')?.getAttribute('src') === expected, oldJs);
    assert.equal(navigations, 2);
    fixture.state.staticRelease = combined; // Hash assets remain served after index rollback.
    await setNetworkOffline(true);
    const rollbackOffline = await context.newPage(); await rollbackOffline.goto(url, { waitUntil: 'domcontentloaded' });
    assert.equal(await rollbackOffline.locator('script[type="module"]').getAttribute('src'), oldJs);
    await rollbackOffline.close(); await setNetworkOffline(false);
    await page.screenshot({ path: join(output, `${engineName}-${width}-rollback.png`), fullPage: true });
    result.screenshots.push(join(output, `${engineName}-${width}-rollback.png`));
    assert.equal(await page.evaluate(async () => (await (await caches.open('DEMO.other-app.cache')).match('/other-app/fixture')).text()), 'DEMO foreign content');
    assert.ok((await cacheKeys(page)).includes(oldCache) && (await cacheKeys(page)).includes(newCache));
    assert.equal((await workerMessage(page, 'active', 'CLEAR_OFFLINE_SHELL')).ok, true);
    assert.deepEqual((await cacheKeys(page)).filter(name => name.startsWith('hermes-remote-web.static.v1.')), []);
    assert.equal(await page.evaluate(async () => (await (await caches.open('DEMO.other-app.cache')).match('/other-app/fixture')).text()), 'DEMO foreign content');
    assert.equal(fixture.state.submissions, 0); assert.deepEqual(fixture.state.answers, []);
    assert.deepEqual(externalRequests, [], 'the fixture app must not attempt another HTTP origin');
    const forbidden = fixture.state.methods.filter(method => /^(?:prompt\.submit|image\.attach|image\.detach|remote\..*(?:set|subscribe|create|rename|archive|branch)|session\.interrupt)$/.test(method));
    assert.deepEqual(forbidden, []);
    result.checks.push('rollback_old_worker_offline_index; old_and_new_hash_cache_retained; own_cache_clear_only; foreign_cache_unchanged; write_generation_0');

    // The UI's clear helper must cancel both active and waiting worker cache writers.
    // Hold a verified asset response so the cancellation happens during cache construction.
    fixture.state.indexRelease = null; fixture.state.staticRelease = combined; fixture.state.nextBuild = build;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/hermes-remote-web/')).update(); });
    await waitForOwnedWorkerState(page, 'waiting');
    await settings(page);
    await page.getByRole('button', { name: 'このアプリの暗号化保存を全て消去', exact: true }).click();
    const clearDialog = page.getByRole('dialog', { name: '暗号化保存を消去', exact: true });
    fixture.state.staticDelayMs = 1000;
    const initialRequests = fixture.state.staticRequests.length;
    const inFlightCache = workerMessage(page, 'waiting', 'CACHE_SHELL');
    for (let attempt = 0; attempt < 200 && fixture.state.staticRequests.length === initialRequests; attempt++) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
    }
    assert.ok(fixture.state.staticRequests.length > initialRequests, 'waiting cache construction must have begun');
    result.stage = 'owned_clear_cancels_waiting_cache_writer';
    await clearDialog.getByRole('button', { name: '暗号化保存を消去', exact: true }).click();
    await page.getByText('暗号化保存を消去しました。', { exact: true }).waitFor();
    assert.equal((await inFlightCache).ok, false, 'waiting cache writer must be cancelled, never resurrect an erased shell');
    fixture.state.staticDelayMs = 0;
    assert.deepEqual((await cacheKeys(page)).filter(name => name.startsWith('hermes-remote-web.static.v1.')), []);
    const cleared = await page.evaluate(async () => await new Promise((resolveContents, reject) => {
      const request = indexedDB.open('hermes-remote-web.encrypted.v1', 1);
      request.onerror = () => reject(new Error('DEMO own IDB unavailable'));
      request.onsuccess = () => {
        const database = request.result;
        const query = database.transaction('owned', 'readonly').objectStore('owned').get('contents');
        query.onerror = () => { database.close(); reject(new Error('DEMO own IDB read failed')); };
        query.onsuccess = () => { database.close(); resolveContents({ entries: query.result.entries.length, wrappedKey: query.result.key !== null }); };
      };
    }));
    assert.deepEqual(cleared, { entries: 0, wrappedKey: false });
    assert.equal(await page.evaluate(async () => (await (await caches.open('DEMO.other-app.cache')).match('/other-app/fixture')).text()), 'DEMO foreign content');
    assert.equal(navigations, 2); assert.equal(fixture.state.submissions, 0);
    assert.deepEqual(fixture.state.answers, []);
    assert.deepEqual(fixture.state.methods.filter(method => /^(?:prompt\.submit|image\.attach|image\.detach|remote\..*(?:set|subscribe|create|rename|archive|branch)|session\.interrupt)$/.test(method)), []);
    result.checks.push('UI_owned_clear_cancels_active_and_waiting_cache; ciphertext_wrapped_key_erased; foreign_cache_preserved; reload_0');
    result.stage = 'real_BroadcastChannel_logout_privacy_and_authenticated_revocation';
    result.logout = await logoutPrivacy(page, context, fixture, url);
    result.checks.push('logout_immediately_hides_all_controls_and_other_tab_draft; initiating_auth_RPC_retained_until_single_scoped_revoke; formal_auth_logout_after_revoke; foreign_cache_preserved');
    assert.equal(fixture.state.submissions, 0); assert.deepEqual(fixture.state.answers, []);
    assert.deepEqual(externalRequests, []);
    await context.close(); result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.error = error.message; result.errorStack = error.stack?.split('\n').slice(0, 7).join('\n'); process.exitCode = 1;
  } finally {
    closingBrowser = true;
    if (browser) await browser.close();
    await fixture.close();
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ engine: result.engine, viewport: width, status: result.status, stage: result.stage, checks: result.checks.length }));
  }
}
for (const engine of engines) for (const width of widths) await run(engine, width);
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, evidence: join(output, 'report.json') }, null, 2));
