import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';
import { focusTrap, installViewportFixture, settleFrames, visualViewport } from './layout-geometry.mjs';

const output = resolve('output/bot-overview'); mkdirSync(output, { recursive: true });
const report = { schema: 'hermes_remote_web_bot_overview_fixture_v1', build: readFileSync('releases/current-build.txt', 'utf8').trim(),
  fixtureOnly: true, physicalIPhone: 'NOT_RUN', liveBotSendReceive: 'NOT_RUN', providerCalls: 0, productionWrites: 0, results: [] };
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const fixture = await startFixture();
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  let context;
  const result = { engine: name, status: 'RUNNING', cases: [], layouts: [], screenshots: [] }; report.results.push(result);
  const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, locale: 'ja-JP', reducedMotion: 'reduce', ignoreHTTPSErrors: true }); // owned loopback TLS only
    let external = 0, reads = 0, mode = 'ready', releasePending, pendingStarted;
    let payload = { gateway_running: true, gateway_state: 'running', gateway_updated_at: '2026-10-07T00:00:00Z',
      gateway_platforms: { discord: { state: 'connected' }, telegram: { state: 'disconnected' }, slack: { state: 'disabled' } } };
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === fixture.origin || ['blob:', 'data:', 'about:'].includes(url.protocol)) return route.continue();
      external++; return route.abort('blockedbyclient');
    });
    await context.route(fixture.origin + '/api/status*', async route => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has('profile')) return route.continue();
      assert.equal(route.request().method(), 'GET'); assert.equal(url.searchParams.get('profile'), 'default'); reads++;
      if (mode === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'DEMO-secret-not-visible' }) });
      const captured = { version: 'DEMO-fixture-e8c97320', auth_required: true, ...structuredClone(payload) };
      if (mode === 'pending') { pendingStarted?.(); await new Promise(resolveRead => { releasePending = resolveRead; }); }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(captured) }).catch(() => undefined);
    });
    await installViewportFixture(context, { clipboard: false });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    const panel = () => page.getByRole('dialog', { name: 'ボットの状態', exact: true });
    const launch = () => page.getByRole('button', { name: 'ボットの状態を開く', exact: true });
    const open = async () => { await launch().click(); await panel().getByRole('region', { name: 'メッセージングGatewayの状態' }).waitFor(); };
    const close = async () => { await panel().getByRole('button', { name: '閉じる', exact: true }).click(); await panel().waitFor({ state: 'detached' }); };
    const check = async (label, action) => { await action(); result.cases.push({ name: label, status: 'PASS' }); save(); };
    await page.goto(fixture.origin + '/hermes-remote-web/'); await page.locator('[data-connection="connected"]').waitFor();
    const methodStart = fixture.state.methods.length;
    await page.getByRole('navigation', { name: '下部ナビゲーション' }).getByRole('button', { name: '設定', exact: true }).click();
    await check('explicit_open_one_read_filter_no_reads_or_operations_and_focus_return', async () => {
      assert.equal(reads, 0); await open(); assert.equal(reads, 1);
      const connections = () => panel().getByRole('list', { name: 'ボット接続状態' });
      assert.equal(await connections().getByText('Discord', { exact: true }).count(), 1);
      await panel().getByLabel('ボットを絞り込む').selectOption('attention'); assert.equal(reads, 1);
      assert.equal(await connections().getByText('Discord', { exact: true }).count(), 0); assert.equal(await connections().getByText('Telegram', { exact: true }).count(), 1);
      await panel().getByLabel('ボットを絞り込む').selectOption('all'); await close();
      assert.equal(await launch().evaluate(node => document.activeElement === node), true);
    });
    await check('failed_refresh_is_stale_sanitized_and_never_automatically_retried', async () => {
      await open(); mode = 'error'; const before = reads; await panel().getByRole('button', { name: '状態を再取得' }).click();
      await panel().getByRole('alert').waitFor(); assert.equal(reads, before + 1);
      assert.equal(await panel().getByText(/以前の取得結果を表示/).count(), 1); assert.ok(!(await panel().textContent()).includes('DEMO-secret'));
      await settleFrames(page); assert.equal(reads, before + 1); await close(); mode = 'ready';
    });
    await check('close_during_pending_read_reopen_and_late_reply_do_not_replace_new_status', async () => {
      await open(); mode = 'pending'; const started = new Promise(resolveRead => { pendingStarted = resolveRead; });
      await panel().getByRole('button', { name: '状態を再取得' }).click(); await started;
      assert.equal(await panel().getByRole('button', { name: '状態を再取得' }).isDisabled(), true); await close();
      mode = 'ready'; payload = { ...payload, gateway_running: false, gateway_state: 'stopped', gateway_platforms: {} };
      await open(); await panel().getByText('停止を報告', { exact: true }).waitFor(); releasePending(); await settleFrames(page);
      assert.equal(await panel().getByText('停止を報告', { exact: true }).count(), 1); assert.equal(await panel().getByText('Discord', { exact: true }).count(), 0);
      await close(); payload = { ...payload, gateway_running: true, gateway_state: 'running', gateway_platforms: { discord: { state: 'connected' }, telegram: { state: 'disconnected' } } };
    });
    await check('small_landscape_keyboard_200percent_light_dark_close_and_controls_remain_accessible', async () => {
      await open();
      for (const variant of [{ width: 320, height: 568, text: 100, keyboard: null, theme: 'light' },
        { width: 390, height: 844, text: 100, keyboard: 380, theme: 'dark' },
        { width: 430, height: 932, text: 100, keyboard: null, theme: 'light' },
        { width: 844, height: 390, text: 100, keyboard: 280, theme: 'dark' },
        { width: 320, height: 568, text: 200, keyboard: 360, theme: 'light' },
        { width: 844, height: 390, text: 200, keyboard: 280, theme: 'dark' }]) {
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await page.evaluate(v => { document.documentElement.style.fontSize = `${v.text}%`; document.documentElement.dataset.theme = v.theme; }, variant);
        await visualViewport(page, variant.keyboard); await settleFrames(page);
        const rect = await panel().boundingBox(); assert.ok(rect.x >= -1 && rect.x + rect.width <= variant.width + 1);
        assert.ok(rect.y >= -1 && rect.y + rect.height <= (variant.keyboard || variant.height) + 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const controls = await panel().locator('button, select').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
        assert.ok(controls.every(node => node.width >= 44 && node.height >= 44));
        assert.ok(await panel().getByLabel('ボットを絞り込む').evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 16);
        assert.deepEqual(await focusTrap(page, panel()), []);
        result.layouts.push({ ...variant, rect, controls });
        if (!variant.keyboard && variant.text === 100) { const file = join(output, `${name}-${variant.width}-${variant.theme}.png`); await page.screenshot({ path: file }); result.screenshots.push(file); }
      }
      await page.setViewportSize({ width: 390, height: 844 }); await visualViewport(page);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.dataset.theme = 'dark'; }); await close();
    });
    await check('quick_navigation_and_existing_composer_draft_are_preserved_without_sends', async () => {
      await page.getByRole('navigation', { name: '下部ナビゲーション' }).getByRole('button', { name: '会話', exact: true }).click();
      await page.locator('.remote-session-list > .remote-session').first().click();
      const input = page.getByLabel('Hermesへのメッセージ'); await input.fill('DEMO 日本語\n元の下書きを保持');
      const afterExplicitResume = fixture.state.methods.length;
      await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'クイックナビゲーション' }).getByRole('button', { name: 'ボットの状態', exact: true }).click();
      await panel().getByRole('region', { name: 'メッセージングGatewayの状態' }).waitFor(); await close();
      assert.equal(await input.inputValue(), 'DEMO 日本語\n元の下書きを保持');
      assert.ok(fixture.state.methods.slice(afterExplicitResume).every(method => !/^(prompt\.|session\.(create|resume|interrupt)|approval\.|clarify\.|image\.)/.test(method)));
    });
    assert.equal(fixture.state.submissions, 0); assert.equal(fixture.state.answers.length, 0); assert.equal(external, 0); assert.deepEqual(pageErrors, []);
    assert.ok(fixture.state.methods.slice(methodStart).every(method => !/^(prompt\.|session\.interrupt|approval\.|clarify\.|image\.|remote\.session\.model_set)/.test(method)));
    const keys = await page.evaluate(() => Object.keys(localStorage));
    assert.ok(keys.every(key => ['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.chat-font-size', 'hermes-remote-web.settings.signed-out'].includes(key)));
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    result.status = 'PASS'; result.reads = reads; result.operations = { prompt: 0, approval: 0, stop: 0, botWrites: 0, provider: 0, production: 0 };
  } catch (error) { result.status = 'FAIL'; result.error = String(error); process.exitCode = 1; }
  finally { await context?.close(); await browser.close(); await fixture.close(); save(); }
}
console.log(JSON.stringify(report));
