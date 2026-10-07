import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startFixture } from './fixture-server.mjs';

mkdirSync('evidence', { recursive: true });
const report = { schema: 'hermes_remote_web_daily_ui_v1', build: readFileSync('releases/current-build.txt', 'utf8').trim(),
  fixtureOnly: true, iphoneSafari: 'NOT_RUN', homeScreen: 'NOT_RUN', keyboard: 'SIMULATED visualViewport; hardware keys automated', results: [] };
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function menu(page, label) {
  await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
  await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: label, exact: true }).click();
}
async function toSettings(page) {
  await page.getByRole('button', { name: '← 会話一覧', exact: true }).click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
}
async function returnChat(page) {
  await page.getByRole('button', { name: '会話', exact: true }).click();
  await page.getByRole('button', { name: '開いている会話へ', exact: true }).click();
}
const position = page => page.locator('.remote-transcript').evaluate(node => {
  const edge = node.getBoundingClientRect().top;
  const visible = [...node.querySelectorAll('[data-message-id]')].find(message => message.getBoundingClientRect().bottom > edge + 1);
  const rect = visible?.getBoundingClientRect();
  return { id: visible?.dataset.messageId, fraction: rect?.height ? (edge - rect.top) / rect.height : 0,
    top: node.scrollTop, bottom: node.scrollHeight - node.scrollTop - node.clientHeight };
});
async function run(name, engine) {
  const fixture = await startFixture(); const directory = `output/playwright/daily-ui/features/${name}`;
  mkdirSync(directory, { recursive: true });
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    ignoreHTTPSErrors: true, acceptDownloads: true }); // self-signed localhost fixture only
  await context.route('**/*', route => route.request().url().startsWith(fixture.origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const native = window.visualViewport; const viewport = new EventTarget();
    Object.defineProperties(viewport, { height: { get: () => window.__DEMO_visualHeight ?? native.height }, width: { get: () => native.width },
      offsetTop: { get: () => native.offsetTop }, scale: { get: () => native.scale } });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__DEMO_copied = value; } } });
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    window.__DEMO_created = 0; window.__DEMO_revoked = 0;
    URL.createObjectURL = blob => { window.__DEMO_created++; return create(blob); };
    URL.revokeObjectURL = url => { window.__DEMO_revoked++; revoke(url); };
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const result = { engine: name, version: browser.version(), status: 'RUNNING', cases: [], screenshots: [], layouts: [] }; report.results.push(result);
  const capture = async label => { await settle(page); const path = `${directory}/${label}.png`; await page.screenshot({ path }); result.screenshots.push(path); };
  try {
    await page.goto(fixture.origin + '/hermes-remote-web/'); await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
    const item = fixture.state.sessions.get('default');
    item.messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', row_id: i + 1,
      text: `DEMO ${i + 1} 日本語の本文\n\n${'読み込み済みの合成会話だけを検索します。'.repeat(5)}\n\n${i === 7 ? '## 日本語 **検索**\n\n[a.*](https://example.invalid)\n\n```text\na.* 日本語\n```\n<script>window.__DEMO_xss=1</script>\n[危険](javascript:alert(1))' : ''}` }));
    await page.getByRole('button', { name: '新規会話', exact: true }).click();
    const input = page.getByLabel('Hermesへのメッセージ'); await input.waitFor(); const transcript = page.locator('.remote-transcript');
    assert.equal(await page.locator('.remote-message-assistant').first().evaluate(node => getComputedStyle(node).fontSize), '16px');
    assert.equal(await page.locator('.remote-message-assistant').first().evaluate(node => getComputedStyle(node).lineHeight), '25.6px');
    assert.equal(await page.locator('pre').evaluate(node => getComputedStyle(node).fontSize), '13px');
    assert.equal(await page.locator('.remote-heading-copy > strong').evaluate(node => getComputedStyle(node).fontSize), '16px');
    await transcript.evaluate(node => { const message = node.querySelectorAll('[data-message-id]')[7]; node.scrollTop += message.getBoundingClientRect().top - node.getBoundingClientRect().top + 40; });
    await settle(page); const before = await position(page);
    await toSettings(page); await page.getByLabel('会話の文字サイズ', { exact: true }).selectOption('17');
    await page.getByLabel('会話の文字サイズのプレビュー', { exact: true }).scrollIntoViewIfNeeded(); await capture('font-settings');
    await returnChat(page); await settle(page); const after = await position(page);
    assert.equal(after.id, before.id); assert.ok(Math.abs(after.fraction - before.fraction) < .04, JSON.stringify({ before, after }));
    assert.equal(await page.locator('.remote-message-assistant').first().evaluate(node => getComputedStyle(node).fontSize), '17px');
    await transcript.evaluate(node => { node.scrollTop = node.scrollHeight; }); await settle(page);
    await toSettings(page); await page.getByLabel('会話の文字サイズ', { exact: true }).selectOption('15'); await returnChat(page); await settle(page);
    assert.ok((await position(page)).bottom < 3); assert.equal(await input.evaluate(node => getComputedStyle(node).fontSize), '16px');
    await toSettings(page); await page.reload(); await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
    await page.getByRole('button', { name: '設定', exact: true }).click(); assert.equal(await page.getByLabel('会話の文字サイズ', { exact: true }).inputValue(), '15');
    await page.getByRole('button', { name: '文字サイズを標準に戻す' }).click();
    await page.evaluate(() => localStorage.setItem('hermes-remote-web.settings.chat-font-size', 'calc(1px)'));
    await page.reload(); await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
    await page.getByRole('button', { name: '設定', exact: true }).click(); assert.equal(await page.getByLabel('会話の文字サイズ', { exact: true }).inputValue(), '16');
    await page.getByRole('button', { name: '会話', exact: true }).click(); await page.locator('.remote-session').first().click(); await input.waitFor();
    result.cases.push('font_defaults_sizes_reload_invalid_reset_inputs_code_header'); result.cases.push('font_preserves_history_message_fraction_and_bottom');

    const methodStart = fixture.state.methods.length; const answersStart = fixture.state.answers.length;
    let controlSyncs = 0;
    const sync = async () => { controlSyncs++; await menu(page, '再同期'); };
    await menu(page, 'この会話を検索'); const query = page.getByLabel('会話内の検索語');
    await query.fill('DEMO nonexistent'); await page.getByText('0 / 0件', { exact: true }).waitFor();
    await query.fill('日本語 検索'); await page.locator('mark').first().waitFor(); assert.equal(await page.locator('mark[data-chat-hit="0"]').count(), 2);
    await query.fill('a.*'); await page.locator('mark[data-chat-hit="1"]').waitFor(); const codeBefore = await page.locator('pre').textContent();
    await page.getByRole('button', { name: 'コードをコピー' }).click(); assert.equal(await page.evaluate(() => window.__DEMO_copied), codeBefore);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0); assert.equal(await page.evaluate(() => window.__DEMO_xss), undefined);
    await query.fill('日本語'); await page.locator('mark[data-chat-hit="0"]').first().waitFor(); await page.getByRole('button', { name: '次の一致' }).click(); await capture('conversation-search');
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; }); await settle(page);
      const height = await transcript.evaluate(node => node.clientHeight);
      assert.ok(height > 40, `Search must leave a readable transcript at 200%: ${JSON.stringify({ viewport, height })}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await capture(`search-${viewport.width}-200`);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
    const searchBefore = await position(page); item.messages.push({ role: 'assistant', row_id: 21, text: '日本語 DEMO 新着。' });
    await sync(); await page.waitForFunction(() => document.querySelector('.remote-message:last-of-type')?.textContent.includes('DEMO 新着'));
    await settle(page); assert.ok(Math.abs((await position(page)).top - searchBefore.top) < 2);
    assert.equal(await page.getByRole('button', { name: '新着を表示' }).count(), 0);
    await page.getByRole('button', { name: '本文検索をクリア' }).click(); assert.equal(await query.inputValue(), ''); await page.getByRole('button', { name: '本文検索を閉じる' }).click();
    result.cases.push('Japanese_literal_cross_inline_zero_results_safe_marks_copy_new_arrival_preserves_scroll');

    await input.fill('DEMO 前\n後');
    await input.evaluate(node => { node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    assert.equal(await page.getByRole('button', { name: '入力の補助' }).isDisabled(), true); await input.press('Enter'); assert.equal(fixture.state.submissions, 0);
    await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))); await input.fill('DEMO 前\n後');
    await input.evaluate(node => { node.setSelectionRange(7, 7); node.dispatchEvent(new Event('select', { bubbles: true })); });
    await page.getByRole('button', { name: '入力の補助', exact: true }).click(); await capture('quick-texts'); await page.getByRole('button', { name: /^要約/ }).click();
    assert.equal(await input.inputValue(), 'DEMO 前\n要点を3つにまとめてください。後');
    const insertedCaret = 7 + '要点を3つにまとめてください。'.length;
    await page.waitForFunction(expected => {
      const node = document.getElementById('remote-input');
      return document.activeElement === node && node.selectionStart === expected && node.selectionEnd === expected;
    }, insertedCaret);
    assert.equal(await input.evaluate(node => node.selectionStart), insertedCaret);
    const normalSelection = await input.evaluate(node => [node.selectionStart, node.selectionEnd]);
    await page.getByRole('button', { name: '入力の補助', exact: true }).click(); await page.getByRole('button', { name: '入力欄を広げる', exact: true }).click();
    const editor = page.getByLabel('拡大したメッセージ入力'); const dialog = page.getByRole('dialog', { name: '拡大入力', exact: true });
    await editor.waitFor(); assert.equal(await input.count(), 0); assert.equal(await dialog.getByRole('button').count(), 1);
    assert.deepEqual(await editor.evaluate(node => [node.selectionStart, node.selectionEnd]), normalSelection);
    await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('DEMO edit'); const draft = await editor.inputValue(); assert.ok(draft.includes('\nDEMO edit'));
    await editor.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))); await editor.press('Escape'); assert.equal(await dialog.count(), 1);
    assert.equal(await page.getByRole('button', { name: '通常表示へ戻る' }).isDisabled(), true);
    await editor.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await editor.press('Tab'); assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog[open]'))), true); await capture('expanded-input');
    for (const variant of [{ width: 320, height: 568, keyboard: 360, text: 100 }, { width: 390, height: 844, keyboard: 420, text: 100 },
      { width: 430, height: 932, keyboard: 500, text: 100 }, { width: 844, height: 390, keyboard: 280, text: 100 },
      { width: 320, height: 568, keyboard: 360, text: 200 }, { width: 844, height: 390, keyboard: 300, text: 200 }]) {
      await page.setViewportSize({ width: variant.width, height: variant.height });
      await page.evaluate(value => { document.documentElement.style.fontSize = value.text === 200 ? '32px' : ''; window.__DEMO_visualHeight = value.keyboard; window.visualViewport.dispatchEvent(new Event('resize')); }, variant);
      await editor.focus(); await settle(page); const bounds = await dialog.boundingBox();
      assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= variant.keyboard + 1, JSON.stringify({ variant, bounds }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.ok(await editor.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 16);
      const targets = await dialog.getByRole('button').evaluateAll(nodes => nodes.map(node => ({ w: node.getBoundingClientRect().width, h: node.getBoundingClientRect().height })));
      assert.ok(targets.every(target => target.w >= 44 && target.h >= 44)); result.layouts.push({ ...variant, bounds }); await capture(`expanded-${variant.width}-${variant.text}-keyboard`);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; delete window.__DEMO_visualHeight; window.visualViewport.dispatchEvent(new Event('resize')); });
    await page.setViewportSize({ width: 390, height: 844 }); await editor.press('Escape'); await input.waitFor(); assert.equal(await input.inputValue(), draft);
    await page.waitForFunction(() => document.activeElement?.id === 'remote-input'); assert.equal(fixture.state.submissions, 0);
    result.cases.push('templates_caret_keep_draft_zero_send_expanded_shared_IME_escape_focus'); result.cases.push('editor_viewport_320_390_430_landscape_200_percent_keyboard');

    await menu(page, '会話をMarkdownで保存'); await capture('markdown-confirmation'); assert.equal(await page.evaluate(() => window.__DEMO_created), 0);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click(); assert.equal(await page.evaluate(() => window.__DEMO_created), 0);
    await menu(page, '会話をMarkdownで保存'); const count = item.messages.length; item.messages.push({ role: 'assistant', row_id: 22, text: 'DEMO after frozen export' });
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '確認してファイルを保存', exact: true }).click();
    const download = await downloadPromise; const saved = `${directory}/export-DEMO.md`; await download.saveAs(saved); const markdown = readFileSync(saved, 'utf8');
    assert.ok(markdown.includes(`発言数: ${count}`)); assert.ok(markdown.includes('```text\na.* 日本語\n```')); assert.ok(markdown.includes('現在取得済みの会話')); assert.ok(!markdown.includes('DEMO after frozen export'));
    for (const excluded of [item.live, item.durable, fixture.origin]) assert.ok(!markdown.includes(excluded)); assert.match(download.suggestedFilename(), /^hermes-chat-\d{8}-\d{4}\.md$/);
    await page.getByRole('button', { name: '閉じる', exact: true }).click(); assert.equal(await page.evaluate(() => window.__DEMO_revoked), 1);
    item.running = true; await sync(); await page.waitForFunction(() => document.querySelector('.remote-chat-state')?.dataset.execution === 'running');
    await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '会話をMarkdownで保存', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '閉じる', exact: true }).click(); item.running = false; await sync();
    await page.waitForFunction(() => document.querySelector('.remote-chat-state')?.dataset.execution === 'idle');
    assert.equal(fixture.state.submissions, 0); assert.equal(fixture.state.answers.length, answersStart);
    const prohibited = /^(prompt\.submit|session\.(create|resume|interrupt)|approval\.|clarify\.|profile.*(?:set|write|activate))/;
    assert.ok(fixture.state.methods.slice(methodStart).every(method => !prohibited.test(method)));
    assert.equal(fixture.state.methods.slice(methodStart).filter(method => method === 'session.activate').length, controlSyncs,
      'Only deliberate existing resync controls may activate a snapshot; new UI actions issue zero RPC');
    result.cases.push('Markdown_explicit_cancel_no_Blob_UTF8_frozen_exclusions_running_disabled_revoke'); result.cases.push('local_UI_actions_zero_write_RPC');

    await input.fill(''); item.messages = [{ role: 'assistant', row_id: 1, text: '日本語 '.repeat(250) }]; await menu(page, '再同期');
    await menu(page, 'この会話を検索'); await query.fill('日本語'); await page.getByText('1 / 200件', { exact: true }).waitFor();
    assert.ok((await page.locator('.remote-chat-search').innerText()).includes('範囲打切り')); await capture('search-bounded');
    item.messages = [{ role: 'assistant', row_id: 1, text: `\`\`\`text\n${Array.from({ length: 300 }, (_, i) => i === 250 ? 'DEMO hidden code match' : `DEMO line ${i}`).join('\n')}\n\`\`\`` }];
    await menu(page, '再同期'); await query.fill('DEMO hidden code match'); await page.getByText('1 / 1件', { exact: true }).waitFor();
    await page.getByRole('button', { name: '次の一致' }).click();
    const revealed = await page.locator('pre').evaluate(node => { const mark = node.querySelector('mark'); const a = node.getBoundingClientRect(); const b = mark.getBoundingClientRect();
      return { scroll: node.scrollTop, visible: b.top >= a.top && b.bottom <= a.bottom, documentTop: window.scrollY }; });
    assert.ok(revealed.scroll > 0 && revealed.visible); assert.equal(revealed.documentTop, 0); await capture('search-long-code');
    result.cases.push('explicit_search_reveals_nested_code_match_without_page_scroll');
    await page.getByRole('button', { name: '入力の補助', exact: true }).click(); await page.getByRole('button', { name: '入力欄を広げる', exact: true }).click(); await editor.fill('DEMO private editor draft');
    fixture.state.auth = false; for (const socket of fixture.state.sockets) socket.terminate();
    await page.getByRole('heading', { name: 'Hermesへ接続', exact: true }).waitFor(); assert.equal(await dialog.count(), 0); assert.equal(await query.count(), 0);
    const privacy = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.keys(sessionStorage), url: location.search + location.hash }));
    const allowed = new Set(['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.signed-out', 'hermes-remote-web.settings.chat-font-size']);
    assert.ok(privacy.local.every(([key]) => allowed.has(key))); assert.ok(privacy.local.every(([, value]) => !/DEMO|日本語|live-|durable/.test(value)));
    assert.deepEqual(privacy.session, []); assert.equal(privacy.url, ''); result.cases.push('search_cap_auth_scope_discard_no_sensitive_storage_or_URL');
    assert.deepEqual(errors, []); result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.error = error.message; throw error; }
  finally { writeFileSync('evidence/daily-ui-browser.json', JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close(); await fixture.close(); }
}
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) await run(name, engine);
console.log(JSON.stringify(report, null, 2));
