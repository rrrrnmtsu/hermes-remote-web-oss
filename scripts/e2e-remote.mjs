import { webkit, chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startFixture } from './fixture-server.mjs';
import { dirname, resolve } from 'node:path';

mkdirSync('output/playwright', { recursive: true }); mkdirSync('evidence', { recursive: true });
const report = { schema: 'hermes_remote_web_browser_fixture_v1', build: readFileSync('releases/current-build.txt', 'utf8').trim(),
  timestamp: new Date().toISOString(), fixtureOnly: true, iphoneSafari: 'NOT_RUN', homeScreenDevice: 'NOT_RUN', results: [] };

async function connected(page) {
  await page.locator('.remote-connection-dot[data-connection="connected"]').first().waitFor();
}
async function synchronize(page) {
  await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
  await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: '再同期', exact: true }).click();
}
async function showRequests(page) {
  await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
  await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: /^確認待ち/ }).click();
}

async function run(name, engine) {
  const fixture = await startFixture();
  const localWebkit = name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1';
  const browser = await engine.launch({ headless: !(localWebkit && process.env.HERMES_TEST_WEBKIT_PORT === 'gtk'), timeout: 20000, ...(localWebkit ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {}) }).catch(async error => {
    // A failed launch still owns its already-started loopback listener.
    await fixture.close();
    throw error;
  });
  let context;
  const errors = [];
  const result = { engine: name, engineVersion: browser.version(), cases: [], status: 'RUNNING' };
  report.results.push(result);
  try {
    const strict = await browser.newContext({ ignoreHTTPSErrors: false });
    const strictPage = await strict.newPage();
    let tlsRejected = false;
    let tlsFailure = 'navigation unexpectedly succeeded';
    try { await strictPage.goto(fixture.origin + '/hermes-remote-web/', { timeout: 10000 }); } catch (error) {
      tlsRejected = /cert|SSL|TLS/i.test(error.message);
      tlsFailure = error.message.replaceAll(fixture.origin, 'https://DEMO-fixture.invalid');
    }
    await strict.close(); assert.equal(tlsRejected, true, `Strict localhost TLS rejection: ${tlsFailure}`);
    result.cases.push('invalid_TLS_rejected_without_exception');
    // Complete strict TLS verification before creating any certificate-exempt context.
    // WebKit network-process context initialization must not race these opposing policies.
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
    // The exception is restricted to this self-signed localhost fixture. Live probes verify TLS.
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await connected(page);
    result.cases.push('HTTPS_auth_WSS_ready_read_RPC');
    await page.getByLabel('登録profile').selectOption('DEMO-secondary');
    await page.getByRole('button', { name: 'DEMO会話 DEMO-secondary', exact: false }).waitFor();
    await page.getByLabel('登録profile').selectOption('default');
    await page.getByRole('button', { name: 'DEMO会話 default', exact: false }).waitFor();
    result.cases.push('registered_profile_switch_scoped_session_list');
    await page.evaluate(async () => {
      localStorage.setItem('other-app.example', 'DEMO-preserve');
      await caches.open('other-app.cache');
    });
    await page.getByRole('button', { name: '新規会話', exact: true }).click();
    const input = page.getByLabel('Hermesへのメッセージ'); await input.waitFor();
    await input.fill('DEMO 日本語'); await input.press('Enter');
    assert.equal(fixture.state.submissions, 0);
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByText('DEMO 日本語の回答です。', { exact: true }).waitFor();
    assert.equal(fixture.state.submissions, 1); result.cases.push('Japanese_explicit_send_stream_tool_activity');
    const widthOK = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(widthOK, true);
    await page.setViewportSize({ width: 844, height: 390 }); await input.waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await input.focus(); await input.fill('DEMO keyboard draft');
    const composer = await input.boundingBox(); assert.ok(composer && composer.y + composer.height <= 568);
    await page.screenshot({ path: `output/playwright/${name}-mobile.png`, fullPage: false });
    result.cases.push('small_viewport_orientation_focused_composer');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const largeInput = await input.boundingBox(); assert.ok(largeInput && largeInput.y >= 0 && largeInput.y + largeInput.height <= 844);
    await page.screenshot({ path: `output/playwright/${name}-large-text.png`, fullPage: false });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    result.cases.push('text_200_percent_no_horizontal_overflow_composer_visible');
    fixture.state.sessions.get('default').messages = Array.from({ length: 80 }, (_, index) => ({ role: 'assistant', text: `DEMO 長い会話 ${index}\n\nDEMO 読み取り中の位置を維持します。`, row_id: index + 1 }));
    await synchronize(page);
    await page.getByText('DEMO 長い会話 0', { exact: true }).waitFor();
    await page.locator('.remote-transcript').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await input.fill('DEMO long'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('button', { name: '新着を表示', exact: true }).waitFor();
    assert.ok(await page.locator('.remote-transcript').evaluate(element => element.scrollTop < 10));
    await page.getByRole('button', { name: '新着を表示', exact: true }).click();
    await page.getByText('DEMO 長いコードの回答', { exact: true }).waitFor();
    // The paragraph can become observable before its following code block is
    // laid out. Observe the complete fixture and its local overflow before
    // checking either layout or the untrusted Markdown rendered after it.
    await page.waitForFunction(expected => Array.from(document.querySelectorAll('.remote-transcript .remote-code-block pre'))
      .some(element => element.textContent === expected && element.scrollWidth > element.clientWidth),
    'DEMO code '.repeat(300) + '\n', { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__DEMO_xss), undefined);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator('.remote-transcript img').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok(await page.locator('.remote-transcript pre').evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth)));
    result.cases.push('long_history_new_content_no_forced_scroll_safe_HTML_URL_local_code_overflow');
    await input.fill('DEMO approval'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.locator('.remote-action-required').waitFor();
    await showRequests(page);
    await page.getByRole('button', { name: '今回だけ許可', exact: true }).click();
    await page.getByRole('dialog', { name: '承認対象の確認' }).waitFor();
    assert.ok(!(await page.getByRole('button', { name: 'always', exact: true }).count()));
    await page.getByRole('button', { name: '確認して回答', exact: true }).click();
    await page.getByText('解決済み', { exact: false }).waitFor();
    assert.equal(fixture.state.answers[0].response.choice, 'once'); result.cases.push('numeric_server_ID_approval_once_cancel_restore');
    await page.getByRole('button', { name: '会話', exact: true }).click();
    await input.fill('DEMO clarify'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await showRequests(page);
    await page.getByText('受理済み: accepted', { exact: true }).waitFor();
    await page.getByRole('checkbox', { name: 'A', exact: true }).check(); await page.getByRole('checkbox', { name: 'B', exact: true }).check();
    await page.getByLabel('DEMO 自由回答 自由入力').fill('DEMO 日本語の回答');
    await page.getByRole('button', { name: '回答を送信', exact: true }).click();
    await page.getByRole('button', { name: '確認待ち', exact: true }).waitFor();
    assert.deepEqual(fixture.state.answers[1].response.answers, { q0: 'accepted', q1: '["A","B"]', q2: 'DEMO 日本語の回答' });
    result.cases.push('clarify_multiple_choice_free_text_accepted_answer_restoration');
    await page.getByRole('button', { name: '会話', exact: true }).click();
    await input.fill('DEMO unsupported'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await showRequests(page);
    await page.getByText('未対応の要求', { exact: true }).waitFor();
    await page.getByText('このWebでは対応できないため、正式なunsupportedエラーを返しました。', { exact: true }).waitFor();
    assert.equal(fixture.state.answers[2].response.code, -32601); assert.equal(fixture.state.open.size, 0);
    result.cases.push('unsupported_server_request_explicit_error_no_infinite_wait');
    await page.getByRole('button', { name: '会話', exact: true }).click();
    await input.fill('DEMO hold'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('button', { name: '停止', exact: true }).waitFor();
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.getByRole('button', { name: '停止を要求', exact: true }).click();
    await page.getByText('停止要求中', { exact: true }).waitFor();
    await page.getByText('停止を確認', { exact: true }).waitFor();
    result.cases.push('stop_requested_before_authoritative_stop_completion');
    const secondTab = await context.newPage();
    await secondTab.goto(fixture.origin + '/hermes-remote-web/');
    await connected(secondTab);
    await secondTab.evaluate(() => new Promise(resolve => {
      void navigator.locks.request('hermes-remote-web.operation', { mode: 'exclusive' }, async () => {
        resolve(true); await new Promise(release => { window.__DEMO_release_lock = release; });
      });
    }));
    const beforeLock = fixture.state.submissions;
    await input.fill('DEMO contested draft'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '別タブが操作中' }).waitFor();
    assert.equal(fixture.state.submissions, beforeLock); assert.equal(await input.inputValue(), 'DEMO contested draft');
    await secondTab.evaluate(() => window.__DEMO_release_lock()); await secondTab.close();
    result.cases.push('multiple_tabs_respect_operation_lock_zero_contested_submits');
    fixture.state.epoch = 'DEMO-epoch-2'; fixture.state.truncated = true;
    const beforeReconnect = fixture.state.ticketSequence;
    await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('.remote-activity-strip').getByRole('status').filter({ hasText: 'オフライン' }).waitFor();
    await context.setOffline(false);
    await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
    await connected(page);
    await page.getByText('同期情報が変わりました', { exact: false }).click();
    await page.getByText(/イベントの保持範囲|サーバー世代/).first().waitFor();
    assert.equal(fixture.state.ticketSequence, beforeReconnect + 1);
    assert.equal(await input.inputValue(), 'DEMO contested draft'); fixture.state.truncated = false;
    result.cases.push('offline_online_single_reconnect_epoch_truncation_snapshot_restoration');
    await input.fill('DEMO lose ack'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '送信結果不明' }).waitFor();
    const submissions = fixture.state.submissions;
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await connected(page);
    await page.getByText('DEMO 切断後に保存した結果', { exact: true }).waitFor();
    assert.equal(fixture.state.submissions, submissions); assert.equal(await page.getByRole('button', { name: '送信', exact: true }).isDisabled(), true);
    result.cases.push('ACK_loss_page_return_resync_zero_automatic_resends');
    await page.getByRole('button', { name: '← 会話一覧', exact: true }).click();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    fixture.state.nextBuild = 'DEMO-new-build';
    await page.getByRole('button', { name: '更新を確認', exact: true }).click();
    await page.getByText(/更新あり · DEMO-new-build/).waitFor();
    assert.equal(await page.getByRole('button', { name: '操作と下書きがない状態で更新', exact: true }).isDisabled(), true);
    assert.equal(fixture.state.submissions, submissions); result.cases.push('pending_draft_unknown_delivery_blocks_reload');
    const privacy = await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cache: await caches.keys(),
      registrations: (await navigator.serviceWorker.getRegistrations()).length, other: localStorage.getItem('other-app.example') }));
    const allowedSettings = ['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.signed-out', 'hermes-remote-web.settings.chat-font-size'];
    assert.deepEqual(privacy.session, []); assert.ok(privacy.local.every(key => key === 'other-app.example' || allowedSettings.includes(key)));
    assert.deepEqual(privacy.cache, ['other-app.cache']); assert.equal(privacy.registrations, 0); result.cases.push('no_sensitive_storage_no_SW_other_app_cache_preserved');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウトを実行', exact: true }).click();
    await page.reload();
    assert.equal(await page.getByRole('button', { name: '新規会話', exact: true }).isDisabled(), true);
    const after = await page.evaluate(async () => ({ other: localStorage.getItem('other-app.example'), cache: await caches.keys() }));
    assert.equal(after.other, 'DEMO-preserve'); assert.deepEqual(after.cache, ['other-app.cache']);
    result.cases.push('logout_hides_memory_no_automatic_cookie_relogin_other_cache_preserved');
    assert.deepEqual(errors, []);
    const permittedMethods = ['client.capabilities', 'gateway.capabilities', 'gateway.ping', 'ping', 'session.list', 'session.create', 'session.resume', 'session.activate', 'session.events.since', 'prompt.submit', 'session.interrupt', 'remote.app.capabilities'];
    assert.ok(fixture.state.methods.every(method => permittedMethods.includes(method)), `Unapproved RPC method: ${fixture.state.methods.find(method => !permittedMethods.includes(method)) || 'none'}`);
    result.cases.push('no_admin_write_or_notification_methods_capability_read_allowed');
    fixture.state.auth = true; fixture.state.forceWsFailure = true;
    const failureContext = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    const failurePage = await failureContext.newPage();
    await failurePage.goto(fixture.origin + '/hermes-remote-web/');
    await failurePage.getByRole('status').filter({ hasText: '接続エラー' }).waitFor();
    assert.equal(await failurePage.getByRole('button', { name: '新規会話', exact: true }).isDisabled(), true);
    await failureContext.close(); fixture.state.forceWsFailure = false;
    result.cases.push('HTTP_success_WS_rejection_is_not_connected');
    const revokedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
    const revokedPage = await revokedContext.newPage();
    await revokedPage.goto(fixture.origin + '/hermes-remote-web/');
    await connected(revokedPage);
    await revokedPage.getByRole('button', { name: '新規会話', exact: true }).click();
    await revokedPage.getByLabel('Hermesへのメッセージ').fill('DEMO revoked draft');
    fixture.state.auth = false;
    await synchronize(revokedPage);
    await revokedPage.getByRole('status').filter({ hasText: '再認証が必要' }).waitFor();
    assert.equal(await revokedPage.getByText('DEMO revoked draft').count(), 0);
    assert.equal(await revokedPage.getByRole('button', { name: '新規会話', exact: true }).isDisabled(), true);
    await revokedContext.close(); result.cases.push('auth_revocation_clears_scope_draft_and_requires_explicit_reauthentication');
    result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.error = error.message; process.exitCode = 1; }
  finally { await context?.close(); await browser.close(); await fixture.close(); }
}
try { await run('webkit', webkit); await run('chromium', chromium); }
catch (error) { report.launchError = error.message; process.exitCode = 1; }
writeFileSync('evidence/browser-fixture.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
