import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';

// DEMO-only browser cache and rollback test. The deployed Serve route is never changed.
const actualCandidate = process.argv.includes('--actual-candidate');
const uiCandidate = process.argv.includes('--ui-candidate');
assert.ok(!(actualCandidate && uiCandidate), 'Choose one candidate basis');
const newBuild = readFileSync('releases/current-build.txt', 'utf8').trim();
const asset = release => readFileSync(join(release, 'index.html'), 'utf8').match(/src="(\/hermes-remote-web\/assets\/[^"?]+\.js)"/)?.[1];
const localPath = path => path.slice('/hermes-remote-web/'.length);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let oldBuild;
let oldRelease;
let newRelease;
if (uiCandidate) {
  const candidate = JSON.parse(readFileSync(resolve('output/ui-candidate', newBuild, 'candidate.json'), 'utf8'));
  assert.equal(candidate.build, newBuild);
  assert.equal(candidate.deployment, 'NOT_EXECUTED');
  assert.equal(candidate.coreTreeUnchanged, true);
  assert.match(candidate.baselineBuild, /^remote-v2-[a-f0-9]{16}$/);
  oldBuild = candidate.baselineBuild;
  oldRelease = resolve('releases', oldBuild);
  newRelease = candidate.site;
} else if (actualCandidate) {
  const candidateDirectory = readFileSync('output/deployment/current-candidate.txt', 'utf8').trim();
  const candidate = JSON.parse(readFileSync(join(candidateDirectory, 'candidate.json'), 'utf8'));
  assert.equal(candidate.build, newBuild);
  assert.equal(candidate.mode, 'upgrade');
  oldBuild = candidate.previousBuild;
  oldRelease = candidate.previousSite;
  newRelease = candidate.site;
} else {
  // CI creates both generations from one fixed source; no past local release is required.
  mkdirSync('output/playwright', { recursive: true });
  const fixtureRoot = mkdtempSync(resolve('output/playwright/update-cache-'));
  oldBuild = 'remote-v2-0000000000000000';
  oldRelease = join(fixtureRoot, 'old');
  newRelease = join(fixtureRoot, 'combined');
  const source = resolve('releases', newBuild);
  cpSync(source, oldRelease, { recursive: true });
  cpSync(source, newRelease, { recursive: true });
  const currentJs = asset(source);
  assert.ok(currentJs);
  const sourceJs = readFileSync(join(source, localPath(currentJs)), 'utf8');
  assert.ok(sourceJs.includes(newBuild));
  const oldJsSource = sourceJs.replaceAll(newBuild, oldBuild);
  const simulatedOldJs = `/hermes-remote-web/assets/index-${hash(oldJsSource).slice(0, 8)}.js`;
  writeFileSync(join(oldRelease, localPath(simulatedOldJs)), oldJsSource);
  writeFileSync(join(newRelease, localPath(simulatedOldJs)), oldJsSource);
  writeFileSync(join(oldRelease, 'index.html'), readFileSync(join(source, 'index.html'), 'utf8').replace(currentJs, simulatedOldJs));
  writeFileSync(join(oldRelease, 'build.json'), JSON.stringify({ buildId: oldBuild }) + '\n');
}
const oldJs = asset(oldRelease);
const newJs = asset(newRelease);
assert.ok(oldJs && newJs && oldJs !== newJs);
assert.equal(hash(readFileSync(join(oldRelease, localPath(oldJs)))), hash(readFileSync(join(newRelease, localPath(oldJs)))));

const report = { schema: 'hermes_remote_web_update_cache_browser_v1', observedAt: new Date().toISOString(),
  build: newBuild, oldBuild, targetHermesCommit: 'e8c97320ac8691d4de92af49f98459f9ef9ddb08',
  fixtureOnly: true, candidateMode: uiCandidate ? 'rebuilt_fixed_baseline_and_local_ui_candidate_not_production_backup'
    : actualCandidate ? 'existing_release_and_prepared_candidate' : 'synthetic_prior_release_same_source',
  deployedRouteChanged: false, iphoneSafari: 'NOT_RUN', cases: [] };

// Support both the previously deployed UI and the chat-focused candidate.
async function settings(page) {
  if (await page.getByRole('button', { name: '会話メニュー', exact: true }).count()) {
    await page.getByRole('button', { name: '← 会話一覧', exact: true }).click();
  }
  await page.getByRole('button', { name: '設定', exact: true }).click();
}
async function conversation(page) {
  await page.getByRole('button', { name: '会話', exact: true }).click();
  const current = page.getByRole('button', { name: '開いている会話へ', exact: true });
  if (await current.count()) await current.click();
}
async function pending(page, open = false) {
  if (await page.getByRole('button', { name: '会話メニュー', exact: true }).count()) {
    await page.locator('.remote-action-required').waitFor();
    if (open) {
      await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
      await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: '確認待ち (1)', exact: true }).click();
    }
  } else {
    const button = page.getByRole('button', { name: '確認待ち (1)', exact: true });
    await button.waitFor(); if (open) await button.click();
  }
}

function get(origin, path) {
  const url = new URL(path, origin);
  assert.equal(url.hostname, '127.0.0.1');
  return new Promise((resolveResult, reject) => {
    // The certificate exception is restricted to this self-signed localhost fixture.
    const req = request(url, { rejectUnauthorized: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolveResult({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(10000, () => req.destroy(new Error('fixture request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function run(engineName, engine) {
  const fixture = await startFixture({ releaseDirectory: oldRelease, staticCacheControl: 'public, max-age=86400' });
  fixture.state.nextBuild = oldBuild;
  const localWebkit = engineName === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1';
  let browser;
  const result = { engine: engineName, status: 'RUNNING', checks: [], cacheWarmIndexHits: null };
  report.cases.push(result);
  try {
    browser = await engine.launch({ headless: !(localWebkit && process.env.HERMES_TEST_WEBKIT_PORT === 'gtk'),
      timeout: 20000, ...(localWebkit ? { executablePath: resolve('scripts/run-webkit-local.sh'),
        env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) } } : {}) });
    result.engineVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const url = fixture.origin + '/hermes-remote-web/';
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
    assert.equal(await page.locator('script[type="module"]').getAttribute('src'), oldJs);
    const firstHits = fixture.state.staticRequests.filter(path => path === 'index.html').length;
    await page.goto('about:blank');
    await page.goto(url);
    await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
    assert.equal(await page.locator('script[type="module"]').getAttribute('src'), oldJs);
    result.cacheWarmIndexHits = { first: firstHits, second: fixture.state.staticRequests.filter(path => path === 'index.html').length };
    result.cacheWarmStatus = result.cacheWarmIndexHits.second === firstHits ? 'PASS' : 'INCONCLUSIVE';
    result.checks.push(result.cacheWarmStatus === 'PASS' ? 'old_index_and_JS_loaded_from_warm_browser_cache'
      : 'old_index_and_JS_loaded_but_browser_revalidated_index');

    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.getByRole('button', { name: '新規会話', exact: true }).click();
    const input = page.getByLabel('Hermesへのメッセージ');
    await input.fill('DEMO 更新中の下書き');
    fixture.state.staticRelease = newRelease;
    fixture.state.nextBuild = newBuild;
    await settings(page);
    await page.getByRole('button', { name: '更新を確認', exact: true }).click();
    await page.getByText(`更新あり · ${newBuild}`).waitFor();
    assert.equal(await page.getByRole('button', { name: '操作と下書きがない状態で更新' }).isDisabled(), true);
    assert.equal(navigations, 0);
    result.checks.push('no_forced_reload_with_draft');

    await conversation(page);
    await input.fill('DEMO hold');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('button', { name: '停止', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '操作と下書きがない状態で更新' }).isDisabled(), true);
    assert.equal(navigations, 0);
    result.checks.push('no_forced_reload_while_running');
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.getByRole('button', { name: '停止を要求', exact: true }).click();
    await page.getByText(/^停止を確認(?: · default)?$/).waitFor();

    await input.fill('DEMO approval');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await pending(page);
    assert.equal(await page.getByRole('button', { name: '操作と下書きがない状態で更新' }).isDisabled(), true);
    assert.equal(navigations, 0);
    result.checks.push('no_forced_reload_with_pending_approval');
    await pending(page, true);
    await page.getByRole('button', { name: '拒否', exact: true }).click();
    await page.getByRole('button', { name: '確認して回答', exact: true }).click();
    await page.getByRole('button', { name: '確認待ち', exact: true }).waitFor();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    const updateButton = page.getByRole('button', { name: '操作と下書きがない状態で更新' });
    await updateButton.waitFor();
    assert.equal(await updateButton.isEnabled(), true);
    await updateButton.click();
    await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
    assert.equal(await page.locator('script[type="module"]').getAttribute('src'), newJs,
      'explicit update did not load the new index and JS');
    assert.equal(navigations, 1);
    result.checks.push('explicit_update_loaded_new_index_and_hashed_JS');

    const retainedOld = await get(fixture.origin, oldJs);
    const currentNew = await get(fixture.origin, newJs);
    assert.equal(retainedOld.status, 200);
    assert.equal(currentNew.status, 200);
    assert.equal(hash(retainedOld.body), hash(readFileSync(join(oldRelease, localPath(oldJs)))));
    assert.equal(hash(currentNew.body), hash(readFileSync(join(newRelease, localPath(newJs)))));
    result.checks.push('old_and_new_hash_assets_available_after_update');

    // Simulate rollback of the shell while serving both hashed asset generations.
    fixture.state.indexRelease = oldRelease;
    fixture.state.nextBuild = oldBuild;
    const rollbackPage = await context.newPage();
    await rollbackPage.goto(`${url}?rollback=${oldBuild}`);
    await rollbackPage.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
    assert.equal(await rollbackPage.locator('script[type="module"]').getAttribute('src'), oldJs);
    assert.equal((await get(fixture.origin, oldJs)).status, 200);
    assert.equal((await get(fixture.origin, newJs)).status, 200);
    result.checks.push('rollback_old_index_with_both_hashed_asset_generations_retained');
    await context.close();
    result.updateStatus = 'PASS';
    result.status = result.cacheWarmStatus === 'PASS' ? 'PASS' : 'INCONCLUSIVE';
  } catch (error) {
    result.status = 'FAIL';
    result.error = error.message;
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await fixture.close();
  }
}

await run('webkit', webkit);
await run('chromium', chromium);
if (report.cases.find(item => item.engine === 'webkit')?.cacheWarmStatus !== 'PASS') process.exitCode = 1;
mkdirSync('evidence', { recursive: true });
writeFileSync(uiCandidate ? 'evidence/update-cache-browser-ui-candidate.json'
  : actualCandidate ? 'evidence/update-cache-browser-actual.json' : 'evidence/update-cache-browser-synthetic.json',
  JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
