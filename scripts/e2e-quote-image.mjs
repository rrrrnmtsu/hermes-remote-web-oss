import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startFixture } from './fixture-server.mjs';

const build = readFileSync('releases/current-build.txt', 'utf8').trim();
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
const report = { schema: 'hermes_quote_image_browser_v1', build, fixtureOnly: true, iphone: 'NOT_RUN', liveImageUpload: 'NOT_RUN', imageAnalysis: 'NOT_RUN',
  imagePrerequisites: 'Atomic prompt image contract is simulated here; candidate integration is tested separately against real Python gateway', results: [] };
const messages = () => [
  { role: 'user', row_id: 1, text: 'DEMO 日本語で資料の確認方法を教えてください。' },
  { role: 'assistant', row_id: 2, text: '## DEMO 資料の確認\n\n日本語の引用対象です。\n改行を保持します。\n\n```text\nDEMO code\nline 2\n```\n[不正URL](javascript:alert(1))\n<script>window.__DEMO_xss=1</script>' },
];
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function open(fixture, page) {
  await page.goto(fixture.origin + '/hermes-remote-web/'); await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor();
  fixture.state.sessions.get('default').messages = messages(); await page.getByRole('button', { name: '新規会話', exact: true }).click();
  await page.getByLabel('Hermesへのメッセージ').waitFor();
}
async function menu(page, item) {
  await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
  await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: item, exact: true }).click();
}
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const result = { engine: name, status: 'RUNNING', cases: [], screenshots: [], layouts: [] }; report.results.push(result);
  const directory = `output/playwright/quote-image/${name}`; mkdirSync(directory, { recursive: true });
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1'
    ? { executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) } } : {});
  result.version = browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true }); // Self-signed localhost only.
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    const native = window.visualViewport, viewport = new EventTarget();
    Object.defineProperties(viewport, { height: { get: () => window.__DEMO_visualHeight ?? native.height }, width: { get: () => native.width }, offsetTop: { get: () => native.offsetTop }, scale: { get: () => native.scale } });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    window.__DEMO_created = 0; window.__DEMO_revoked = 0;
    URL.createObjectURL = blob => { window.__DEMO_created++; return create(blob); };
    URL.revokeObjectURL = url => { window.__DEMO_revoked++; revoke(url); };
  });
  let fixture;
  const capture = async label => { const path = `${directory}/${label}.png`; await page.screenshot({ path }); result.screenshots.push(path); };
  try {
    if (baseline) {
      fixture = await startFixture({ releaseDirectory: resolve('releases', baseline) }); fixture.state.nextBuild = baseline;
      await open(fixture, page); await capture('before-conversation');
      await page.getByRole('button', { name: 'Hermesのメッセージ操作', exact: true }).click(); await capture('before-message-menu');
      await page.goto('about:blank'); await fixture.close(); fixture = null;
    }
    fixture = await startFixture(); fixture.state.nextBuild = build;
    await open(fixture, page); await capture('after-conversation');
    await page.getByRole('button', { name: 'Hermesのメッセージ操作', exact: true }).click(); await capture('after-message-menu-initial');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    const media = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e9f2ff'; ctx.fillRect(0, 0, 240, 160);
      ctx.fillStyle = '#2860ab'; ctx.fillRect(24, 70, 38, 60); ctx.fillRect(90, 42, 38, 88); ctx.fillRect(156, 20, 38, 110);
      ctx.fillStyle = '#13243c'; ctx.font = '16px sans-serif'; ctx.fillText('DEMO synthetic chart', 16, 150);
      return { png: canvas.toDataURL('image/png').split(',')[1], jpg: canvas.toDataURL('image/jpeg').split(',')[1] };
    });
    for (const [ext, bytes] of Object.entries(media)) writeFileSync(`${directory}/DEMO-chart.${ext}`, Buffer.from(bytes, 'base64'));
    const input = page.getByLabel('Hermesへのメッセージ'); await input.fill('DEMO 元の下書きを残します。');
    await input.evaluate(node => { node.setSelectionRange(5, 7); node.dispatchEvent(new Event('select', { bubbles: true })); });
    await menu(page, 'この会話を検索'); await page.getByLabel('会話内の検索語').fill('日本語'); await page.locator('mark').first().waitFor();
    await page.locator('.remote-message-assistant mark').evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    const messageMenu = page.getByRole('button', { name: 'Hermesのメッセージ操作', exact: true });
    await messageMenu.dispatchEvent('pointerdown'); await page.evaluate(() => getSelection().removeAllRanges()); await messageMenu.evaluate(node => node.click()); await capture('after-message-menu');
    await page.getByRole('button', { name: '引用して質問', exact: true }).click(); await capture('quote-selection-confirmation');
    assert.equal(await page.locator('.remote-quote-preview').innerText(), '日本語');
    await page.getByRole('button', { name: '下書きへ挿入', exact: true }).click(); await settle(page);
    assert.ok((await input.inputValue()).includes('> 日本語')); assert.ok((await input.inputValue()).endsWith('元の下書きを残します。'));
    assert.ok(await input.evaluate(node => node.value.slice(0, node.selectionStart).endsWith('この部分について：'))); await capture('quote-draft');
    assert.equal(fixture.state.submissions, 0); assert.ok(!fixture.state.methods.some(method => /^(image\.|prompt\.|approval\.|session\.interrupt)/.test(method)));
    await page.getByRole('button', { name: '本文検索を閉じる' }).click();
    await page.getByRole('button', { name: '入力の補助', exact: true }).click(); await page.getByRole('button', { name: '入力欄を広げる', exact: true }).click();
    const editor = page.getByLabel('拡大したメッセージ入力'); const draft = await editor.inputValue();
    await editor.dispatchEvent('compositionstart'); await editor.press('Enter'); assert.equal(fixture.state.submissions, 0);
    await editor.dispatchEvent('compositionend'); await page.getByRole('button', { name: '通常表示へ戻る', exact: true }).click(); assert.ok(draft.includes('元の下書き'));
    result.cases.push('quote_search_mark_selection_loss_draft_caret_zero_write_IME_editor');
    await input.fill(''); fixture.state.sessions.get('default').messages = [{ role: 'assistant', row_id: 2, text: 'あ'.repeat(9000) }]; await menu(page, '再同期');
    await messageMenu.click(); await page.getByRole('button', { name: '引用して質問', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '先頭8,000文字' }).waitFor();
    assert.equal(Array.from(await page.locator('.remote-quote-preview').innerText()).length, 8000); await capture('quote-limit-confirmation'); await page.getByRole('button', { name: '閉じる', exact: true }).click();
    result.cases.push('quote_displayed_body_8000_limit_explicit_confirmation');
    fixture.state.sessions.get('default').messages = messages(); await menu(page, '再同期');
    await page.getByRole('button', { name: '入力の補助', exact: true }).click(); await capture('input-help-image'); await page.getByRole('button', { name: '閉じる', exact: true }).click();
    const file = page.getByLabel('JPEGまたはPNGを1枚選択'); await file.setInputFiles(`${directory}/DEMO-chart.png`);
    await page.getByRole('region', { name: '選択した画像', exact: true }).waitFor(); await capture('image-local-preview');
    await input.fill('DEMO この図の説明'); assert.equal(await page.getByRole('button', { name: '送信', exact: true }).isDisabled(), true);
    assert.equal(fixture.state.submissions, 0); assert.ok(!fixture.state.methods.some(method => method.startsWith('image.')));
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 320, height: 480 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) for (const text of [100, 200]) {
        await page.evaluate(({ theme, text }) => { document.documentElement.dataset.theme = theme; document.documentElement.style.fontSize = text === 200 ? '32px' : ''; }, { theme, text }); await settle(page);
        const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, transcript: document.querySelector('.remote-transcript').clientHeight,
          input: parseFloat(getComputedStyle(document.querySelector('#remote-input')).fontSize), send: document.querySelector('.remote-send').getBoundingClientRect().height }));
        assert.equal(layout.overflow, false); assert.ok(layout.input >= 16 && layout.send >= 48); assert.ok(layout.transcript >= 40, JSON.stringify({ viewport, text, ...layout })); result.layouts.push({ viewport, theme, text, ...layout });
        await capture(`image-${viewport.width}x${viewport.height}-${theme}-${text}`);
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.dataset.theme = 'light'; window.__DEMO_visualHeight = 440; visualViewport.dispatchEvent(new Event('resize')); });
    await page.setViewportSize({ width: 390, height: 844 }); await input.focus(); await settle(page); await capture('image-keyboard-simulated');
    await page.evaluate(() => { window.__DEMO_visualHeight = undefined; visualViewport.dispatchEvent(new Event('resize')); });
    await input.fill(''); fixture.state.nextBuild = 'DEMO-next-build';
    const priorIndexReads = fixture.state.staticRequests.filter(path => path === 'index.html').length;
    await page.getByRole('button', { name: '← 会話一覧', exact: true }).click(); await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '更新を確認', exact: true }).click();
    await page.getByText('更新あり · DEMO-next-build', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '操作と下書きがない状態で更新', exact: true }).isDisabled(), true);
    assert.equal(fixture.state.staticRequests.filter(path => path === 'index.html').length, priorIndexReads);
    await page.getByRole('button', { name: '会話', exact: true }).click(); await page.getByRole('button', { name: '開いている会話へ', exact: true }).click();
    await page.getByRole('button', { name: '画像の選択を取消' }).click();
    await file.setInputFiles(`${directory}/DEMO-chart.jpg`); await page.getByRole('region', { name: '選択した画像' }).waitFor(); await page.getByRole('button', { name: '画像の選択を取消' }).click();
    await page.waitForFunction(() => window.__DEMO_created === window.__DEMO_revoked);
    await file.setInputFiles({ name: 'DEMO-fake.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${directory}/DEMO-chart.png`) }); await page.getByRole('alert').filter({ hasText: '一致しません' }).waitFor();
    await file.setInputFiles({ name: 'DEMO-broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }); await page.getByRole('alert').filter({ hasText: 'JPEG/PNGではありません' }).waitFor();
    assert.ok(!fixture.state.methods.some(method => method.startsWith('image.'))); assert.equal(fixture.state.submissions, 0);
    result.cases.push('PNG_JPEG_preview_cancel_no_write_spoof_broken_bytes_production_send_blocked'); result.cases.push('layouts_320_390_430_landscape_200_percent_keyboard');
    result.cases.push('selected_image_empty_draft_blocks_update_no_reload_and_Blob_release');
    await file.setInputFiles(`${directory}/DEMO-chart.png`); await page.getByRole('region', { name: '選択した画像' }).waitFor();
    fixture.state.auth = false; for (const socket of fixture.state.sockets) socket.terminate();
    await page.getByRole('heading', { name: 'Hermesへ接続', exact: true }).waitFor();
    await page.waitForFunction(() => window.__DEMO_created === window.__DEMO_revoked);
    result.cases.push('auth_loss_discards_local_preview_bytes_and_releases_Blob');
    console.log(`${name}: local quote/image cases complete`);
    await page.goto('about:blank'); await fixture.close(); fixture = await startFixture({ releaseDirectory: resolve('output/image-fixture'), imageTurn: true }); fixture.state.nextBuild = 'DEMO-image-fixture';
    await open(fixture, page); const item = fixture.state.sessions.get('default');
    await file.setInputFiles(`${directory}/DEMO-chart.png`); await page.getByRole('region', { name: '選択した画像' }).waitFor(); await input.fill('DEMO 合成画像を確認');
    await page.getByRole('button', { name: '送信', exact: true }).click(); await page.getByText('DEMO 日本語の回答です。', { exact: true }).waitFor();
    assert.deepEqual(fixture.state.methods.filter(method => method === 'image.attach_bytes' || method === 'prompt.submit'), ['prompt.submit']);
    assert.equal(item.images.length, 0); await capture('DEMO-image-accepted');
    fixture.state.imagePromptMode = 'reject'; await file.setInputFiles(`${directory}/DEMO-chart.png`); await page.getByRole('region', { name: '選択した画像' }).waitFor();
    await input.fill('DEMO 本文拒否試験'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByText('画像と本文は拒否されました。', { exact: false }).waitFor(); await capture('DEMO-image-text-refused');
    await page.getByRole('button', { name: '画像の選択を取消' }).click(); assert.equal(item.images.length, 0); assert.equal(await input.inputValue(), 'DEMO 本文拒否試験');
    fixture.state.imagePromptMode = 'unknown';
    await file.setInputFiles(`${directory}/DEMO-chart.png`); await page.getByRole('region', { name: '選択した画像' }).waitFor(); await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('status').filter({ hasText: /^画像と本文の送信結果不明 · 自動再送しません$/ }).waitFor(); await capture('DEMO-image-text-unknown');
    const prompts = fixture.state.methods.filter(method => method === 'prompt.submit').length; await page.waitForTimeout(1400);
    assert.equal(fixture.state.methods.filter(method => method === 'prompt.submit').length, prompts);
    assert.equal(fixture.state.methods.filter(method => /^image\.(attach|detach)/.test(method)).length, 0);
    await page.reload(); await page.getByRole('status').filter({ hasText: '接続・同期済み' }).waitFor(); await page.locator('.remote-session').first().click();
    assert.equal(item.images.length, 0); assert.equal(await input.inputValue(), '');
    result.cases.push('DEMO_atomic_image_and_text_refusal_local_cancel_preserves_draft');
    result.cases.push('DEMO_ACK_unknown_no_auto_retry_no_pending_image_after_page_discard');
    const storage = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.keys(sessionStorage), url: location.search + location.hash }));
    assert.ok(storage.local.every(([key, value]) => ['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.signed-out', 'hermes-remote-web.settings.chat-font-size'].includes(key) && !/DEMO|base64|image/.test(value)));
    assert.deepEqual(storage.session, []); assert.equal(storage.url, ''); assert.equal(await page.evaluate(() => window.__DEMO_xss), undefined); assert.deepEqual(errors, []);
    result.cases.push('no_sensitive_storage_URL_XSS_or_console_errors'); result.status = 'PASS';
    console.log(`${name}: all quote/image cases complete`);
  } catch (error) { result.status = 'FAIL'; result.error = error.message; await capture('failure'); throw error; }
  finally { mkdirSync('evidence', { recursive: true }); writeFileSync('evidence/quote-image-browser.json', JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close(); await fixture?.close(); }
}
console.log(JSON.stringify({ build, results: report.results.map(({ engine, status, cases, screenshots }) => ({ engine, status, cases: cases.length, screenshots: screenshots.length })) }, null, 2));
