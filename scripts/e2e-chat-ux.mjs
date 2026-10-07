import { webkit, chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startFixture } from './fixture-server.mjs';

mkdirSync('evidence', { recursive: true });
mkdirSync('output/chat-ux', { recursive: true });
const requestedEngine = process.argv.find(arg => arg.startsWith('--engine='))?.split('=')[1];
assert.ok(!requestedEngine || ['webkit', 'chromium'].includes(requestedEngine));
const report = { schema: 'hermes_remote_web_chat_ux_v1', build: readFileSync('releases/current-build.txt', 'utf8').trim(),
  fixtureOnly: true, iphone: 'NOT_RUN', softwareKeyboard: 'SIMULATED visualViewport (not iPhone keyboard)', timestamp: new Date().toISOString(), results: [] };
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function sync(page) {
  await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
  await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: '再同期', exact: true }).click();
}
async function keyboard(page, height) {
  await page.evaluate(value => { window.__DEMO_visualHeight = value; window.visualViewport.dispatchEvent(new Event('resize')); }, height);
  await settle(page);
}
function contrast(a, b) {
  const luminance = hex => {
    const parts = hex.trim().replace('#', '');
    const expanded = parts.length === 3 ? parts.split('').map(x => x + x).join('') : parts;
    const rgb = [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

async function run(name, engine) {
  const fixture = await startFixture();
  const localWebkit = name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1';
  const browser = await engine.launch({ ...(localWebkit ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, ignoreHTTPSErrors: true }); // localhost fixture TLS only
  await context.addInitScript(() => {
    const native = window.visualViewport;
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { get: () => window.__DEMO_visualHeight ?? native.height },
      width: { get: () => native.width }, offsetTop: { get: () => native.offsetTop }, scale: { get: () => native.scale },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__DEMO_copied = text; } } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const result = { engine: name, version: browser.version(), status: 'RUNNING', cases: [], layouts: [], contrast: [] };
  report.results.push(result);
  try {
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await page.locator('[data-connection="connected"]').waitFor();
    assert.equal(await page.locator('.remote-session strong').innerText(), 'DEMO会話 default');
    assert.equal(await page.locator('.remote-session .remote-meta').innerText(), '保存された会話を再開');
    assert.equal(await page.locator('.remote-profile-switch details').evaluate(node => node.open), false);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const placeholder = await page.getByLabel('会話を検索').evaluate(node => ({ color: getComputedStyle(node, '::placeholder').color,
        opacity: getComputedStyle(node, '::placeholder').opacity, expected: getComputedStyle(node.parentElement).color }));
      assert.equal(placeholder.color, placeholder.expected); assert.equal(placeholder.opacity, '1');
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    assert.ok((await page.getByLabel('登録profile').boundingBox()).y < (await page.getByLabel('会話を検索').boundingBox()).y);
    await page.getByLabel('会話を検索').fill(' DEFAULT ');
    assert.equal(await page.locator('.remote-session').count(), 1);
    await page.getByLabel('会話を検索').fill('DEMO no match');
    await page.getByRole('heading', { name: '一致する会話がありません' }).waitFor();
    assert.equal(await page.locator('.remote-session').count(), 0);
    await page.getByRole('button', { name: '検索をクリア', exact: true }).first().click();
    assert.equal(await page.getByLabel('会話を検索').inputValue(), '');
    assert.equal(await page.locator('.remote-session').count(), 1);
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; }); await settle(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const nav = await page.getByRole('navigation').boundingBox();
      assert.ok(nav.y >= 0 && nav.y + nav.height <= viewport.height);
      const targets = await page.locator('.remote-nav button, .remote-new-conversation, .remote-profile-switch select').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
      assert.ok(targets.every(target => target.width >= 44 && target.height >= 44));
      await page.getByRole('button', { name: '設定', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('.remote-main').evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
      await page.getByRole('button', { name: '会話', exact: true }).click();
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
    result.cases.push('list_settings_320_landscape_200_percent_scroll_nav_and_touch_targets');
    await page.getByRole('button', { name: '接続状態と診断' }).click();
    assert.equal(await page.getByRole('list', { name: '接続確認の段階' }).getByText('確認済み', { exact: true }).count(), 5);
    assert.equal(await page.locator('.remote-diagnostic-details').evaluate(node => node.open), false);
    await page.getByRole('button', { name: '会話', exact: true }).click();
    result.cases.push('conversation_list_new_search_recent_profile_no_session_source');
    result.cases.push('profile_before_search_trim_case_clear_empty_result_visible_status_grouped_diagnostics');
    fixture.state.sessions.get('default').messages = [];
    await page.getByRole('button', { name: '新規会話', exact: true }).click();
    const input = page.getByLabel('Hermesへのメッセージ'); await input.waitFor();
    const header = page.getByLabel('会話ヘッダー');
    const headerSize = await header.boundingBox();
    assert.ok(headerSize.height >= 52 && headerSize.height <= 60);
    assert.equal(await header.getByRole('button').count(), 2);
    assert.ok(!(await header.innerText()).includes('接続・同期済み'));
    assert.ok(!(await header.locator('.remote-chat-state').innerText()).includes('default'));
    assert.equal(await page.getByRole('navigation').count(), 0);
    await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '会話メニュー', exact: true });
    assert.equal(await menu.getByRole('button', { name: '停止', exact: true }).count(), 0);
    await menu.locator('summary').click();
    assert.ok((await menu.innerText()).includes('DEMO-live-default'));
    await menu.getByRole('button', { name: '閉じる', exact: true }).click();
    result.cases.push('56px_header_primary_controls_only_details_in_menu_no_chat_nav');
    await input.fill('DEMO protected draft');
    await page.getByRole('button', { name: '← 会話一覧' }).click();
    assert.equal(await page.getByRole('button', { name: '新規会話' }).isDisabled(), true);
    assert.equal(await page.getByLabel('登録profile').isDisabled(), true);
    await page.getByText(/開いている会話に下書きがあります/).waitFor();
    await page.getByRole('button', { name: '開いている会話へ', exact: true }).click();
    assert.equal(await input.inputValue(), 'DEMO protected draft');
    assert.equal(fixture.state.submissions, 0);
    await input.fill('');
    result.cases.push('protected_draft_explained_switch_disabled_return_current_preserves_input');
    const shortHeight = (await input.boundingBox()).height;
    await input.fill('DEMO\n2行\n3行');
    assert.ok((await input.boundingBox()).height > shortHeight);
    await input.fill('DEMO\n'.repeat(30));
    const longHeight = (await input.boundingBox()).height;
    const style = await input.evaluate(node => ({ font: parseFloat(getComputedStyle(node).fontSize), line: parseFloat(getComputedStyle(node).lineHeight), overflow: getComputedStyle(node).overflowY, scrollHeight: node.scrollHeight }));
    assert.ok(style.font >= 16 && longHeight <= style.line * 6 + 12 && style.scrollHeight > longHeight);
    assert.equal(style.overflow, 'auto');
    await input.fill(''); assert.equal((await input.boundingBox()).height, shortHeight);
    const send = page.getByRole('button', { name: '送信', exact: true });
    const sendSize = await send.boundingBox(); assert.ok(sendSize.width >= 48 && sendSize.height >= 48);
    assert.equal(await send.isDisabled(), true);
    await input.fill('DEMO keyboard draft');
    await page.getByRole('button', { name: 'キーボードを閉じる' }).click();
    assert.equal(await input.evaluate(node => document.activeElement === node), false);
    assert.equal(await input.inputValue(), 'DEMO keyboard draft');
    assert.equal(fixture.state.submissions, 0);
    assert.equal(await page.getByRole('button', { name: 'キーボードを閉じる' }).count(), 0);
    await input.focus();
    await input.press('Tab');
    const dismiss = page.getByRole('button', { name: 'キーボードを閉じる' });
    assert.equal(await dismiss.evaluate(node => document.activeElement === node), true);
    await dismiss.press('Enter');
    assert.equal(await input.inputValue(), 'DEMO keyboard draft');
    assert.equal(fixture.state.submissions, 0);
    result.cases.push('one_to_six_line_composer_internal_scroll_48px_send_no_fake_attachment');
    result.cases.push('keyboard_dismiss_preserves_draft_without_submit');
    await input.fill('DEMO 日本語'); await input.focus();
    await input.dispatchEvent('compositionstart'); await input.press('Enter'); await send.click();
    assert.equal(fixture.state.submissions, 0);
    await input.dispatchEvent('compositionend'); await input.press('Enter');
    assert.equal(fixture.state.submissions, 0);
    await send.dispatchEvent('pointerdown');
    assert.equal(await input.evaluate(node => document.activeElement === node), true);
    await page.evaluate(() => { const button = document.querySelector('.remote-send'); button.click(); button.click(); });
    await page.getByText('DEMO 日本語の回答です。', { exact: true }).waitFor();
    assert.equal(fixture.state.submissions, 1);
    assert.equal(await input.evaluate(node => document.activeElement === node), true);
    result.cases.push('IME_enter_no_submit_explicit_double_tap_single_submit_focus_preserved');
    const user = page.getByRole('article', { name: 'あなたのメッセージ' });
    const assistant = page.getByRole('article', { name: 'Hermesのメッセージ' });
    const transcriptWidth = (await page.locator('.remote-transcript').boundingBox()).width;
    assert.ok((await user.boundingBox()).width <= transcriptWidth * .85);
    assert.equal(await assistant.evaluate(node => getComputedStyle(node).borderTopWidth), '0px');
    assert.equal(await page.getByRole('button', { name: 'メッセージをコピー', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Hermesのメッセージ操作' }).click();
    await page.getByRole('button', { name: 'メッセージをコピー', exact: true }).click();
    await page.getByText('コピーしました', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__DEMO_copied), 'DEMO 日本語の回答です。');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    assert.equal(await page.locator('.remote-tool-activity').evaluate(node => node.open), false);
    await page.locator('.remote-tool-activity > summary').click();
    await page.locator('.remote-tool-activity details > summary').click();
    await page.getByText('DEMO completed', { exact: true }).waitFor();
    await page.locator('.remote-tool-activity > summary').click();
    result.cases.push('semantic_bubbles_borderless_assistant_on_demand_copy_tools_collapsed');

    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await settle(page);
      for (const scale of [1, 2]) {
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, 16 * scale);
        await settle(page);
        assert.ok(await input.evaluate(node => node.clientHeight >= parseFloat(getComputedStyle(node).lineHeight) + 8), 'A text-only resize must not clip a single line');
        // Text resizing also resizes the composer through the same window event as orientation.
        await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await settle(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const composer = await page.locator('.remote-composer').boundingBox();
        assert.ok(composer.y >= 0 && composer.y + composer.height <= viewport.height);
        const targets = await page.locator('.remote-chat-heading button, .remote-composer button').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
        assert.ok(targets.every(target => target.width >= 44 && target.height >= 44));
        result.layouts.push({ ...viewport, textPercent: scale * 100, status: 'PASS' });
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
    for (const theme of ['light', 'dark']) {
      const colors = await page.evaluate(value => {
        document.documentElement.dataset.theme = value;
        const css = getComputedStyle(document.documentElement);
        return Object.fromEntries(['text', 'muted', 'bg', 'surface', 'bubble', 'accent', 'on-accent', 'warning', 'warning-text', 'critical', 'critical-text'].map(key => [key, css.getPropertyValue(`--remote-${key}`)]));
      }, theme);
      for (const [foreground, background] of [['text', 'bg'], ['muted', 'bg'], ['muted', 'surface'], ['text', 'bubble'], ['on-accent', 'accent'], ['warning-text', 'warning'], ['critical-text', 'critical']]) {
        const ratio = contrast(colors[foreground], colors[background]); assert.ok(ratio >= 4.5, `${theme} ${foreground}/${background}: ${ratio}`);
        result.contrast.push({ theme, foreground, background, ratio: Number(ratio.toFixed(2)) });
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    result.cases.push('320_390_430_landscape_200_percent_touch_targets_light_dark_AA_text');

    const session = fixture.state.sessions.get('default');
    session.messages = Array.from({ length: 80 }, (_, index) => ({ role: 'assistant', text: `DEMO 履歴 ${index}\n\n読む位置を維持します。`, row_id: index + 1 }));
    await sync(page); await page.getByText('DEMO 履歴 0', { exact: true }).waitFor();
    await page.locator('.remote-transcript').evaluate(node => { node.scrollTop = 200; node.dispatchEvent(new Event('scroll')); });
    await input.focus(); await keyboard(page, 480);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.remoteKeyboard), 'true');
    let composer = await page.locator('.remote-composer').boundingBox(); assert.ok(composer.y + composer.height <= 480);
    await input.fill('DEMO\n'.repeat(5)); await settle(page);
    assert.ok(Math.abs(await page.locator('.remote-transcript').evaluate(node => node.scrollTop) - 200) < 2);
    await keyboard(page, null); await page.setViewportSize({ width: 844, height: 390 }); await settle(page);
    assert.ok(Math.abs(await page.locator('.remote-transcript').evaluate(node => node.scrollTop) - 200) < 2);
    await page.setViewportSize({ width: 390, height: 844 }); await input.fill('DEMO long');
    await send.click(); await page.getByRole('button', { name: '新着を表示' }).waitFor();
    assert.ok(Math.abs(await page.locator('.remote-transcript').evaluate(node => node.scrollTop) - 200) < 2);
    const newButton = page.getByRole('button', { name: '新着を表示' });
    assert.equal(await newButton.evaluate(node => getComputedStyle(node).position), 'absolute');
    await newButton.click(); await page.getByText('DEMO 長いコードの回答', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'コードをコピー' }).click();
    assert.equal(await page.evaluate(() => window.__DEMO_copied), 'DEMO code '.repeat(300) + '\n');
    result.cases.push('history_position_keyboard_autogrow_orientation_stream_floating_new_local_code_copy');

    await input.fill('DEMO approval'); await send.click();
    const inline = page.getByRole('article', { name: 'この会話の確認要求' }); await inline.waitFor();
    assert.ok((await inline.innerText()).includes('コマンド実行の承認'));
    await inline.getByRole('button', { name: '確認する' }).click();
    await page.getByRole('button', { name: '今回だけ許可', exact: true }).click();
    await page.getByRole('button', { name: '確認して回答', exact: true }).click();
    await page.getByText(/解決済み/).waitFor();
    assert.equal(fixture.state.answers[0].response.choice, 'once');
    await page.getByRole('button', { name: '会話へ戻る', exact: true }).click();
    await inline.waitFor({ state: 'hidden' });
    assert.equal(await inline.count(), 0);
    await input.fill('DEMO clarify'); await send.click(); await inline.waitFor();
    await inline.getByRole('button', { name: '確認する' }).click();
    const clarify = page.getByLabel('DEMO 自由回答 自由入力'); await clarify.focus(); await keyboard(page, 480);
    assert.equal(await page.getByRole('navigation').isVisible(), false);
    await keyboard(page, null); await clarify.fill('DEMO 回答');
    await page.getByRole('button', { name: '回答を送信', exact: true }).click();
    await page.getByText(/解決済み/).last().waitFor();
    await page.getByRole('button', { name: '会話へ戻る', exact: true }).click();
    await inline.waitFor({ state: 'hidden' });
    assert.equal(await inline.count(), 0);
    assert.equal(fixture.state.answers.length, 2);
    assert.equal(fixture.state.answers[1].method, 'clarify');
    assert.equal(fixture.state.open.size, 0);
    result.cases.push('real_scoped_inline_approval_clarify_CTA_existing_confirmation_cancel_resolution_nav_hidden_keyboard');
    await input.fill('DEMO hold'); await send.click();
    await page.locator('.remote-activity-strip').getByRole('button', { name: '停止', exact: true }).click();
    await page.getByRole('dialog', { name: '停止確認' }).waitFor();
    assert.equal(fixture.state.methods.filter(method => method === 'session.interrupt').length, 0);
    await page.getByRole('button', { name: '停止を要求', exact: true }).click();
    await page.getByText('停止要求中', { exact: true }).waitFor();
    await page.getByText('停止を確認', { exact: true }).waitFor();
    result.cases.push('stop_action_confirm_requested_then_server_confirmed');
    await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('.remote-activity-strip').getByText('オフライン', { exact: true }).waitFor();
    await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.locator('.remote-chat-heading [data-connection="connected"]').waitFor();
    await input.fill('DEMO lose ack'); await send.click();
    await page.getByRole('alert').filter({ hasText: '送信結果不明' }).waitFor();
    const submissions = fixture.state.submissions;
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await page.locator('.remote-chat-heading [data-connection="connected"]').waitFor();
    assert.equal(fixture.state.submissions, submissions); assert.equal(await send.isDisabled(), true);
    result.cases.push('offline_recover_delivery_unknown_critical_no_automatic_resend');
    assert.deepEqual(errors, []);
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.error = error.stack; process.exitCode = 1;
    await page.screenshot({ path: `output/chat-ux/${name}-failure.png` }).catch(() => undefined);
  } finally { await context.close(); await browser.close(); await fixture.close(); }
}
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  if (!requestedEngine || requestedEngine === name) await run(name, engine);
}
writeFileSync(`evidence/chat-ux${requestedEngine ? `-${requestedEngine}` : ''}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
