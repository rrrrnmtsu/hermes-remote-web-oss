import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';
import { installInteractionFixture } from './interactions-fixture.mjs';
import { focusTrap, installViewportFixture, readerAnchor, settleFrames, visualViewport } from './layout-geometry.mjs';

const output = resolve('output/quick-navigation'); mkdirSync(output, { recursive: true });
const report = { schema: 'hermes_remote_web_quick_navigation_fixture_v1',
  build: readFileSync('releases/current-build.txt', 'utf8').trim(), fixtureOnly: true,
  realBackend: 'NOT_RUN_UI_ONLY_CHANGE', realProvider: 'NOT_RUN', physicalIPhone: 'NOT_RUN', results: [] };

for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const fixture = await startFixture();
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  const result = { engine: name, version: browser.version(), status: 'RUNNING', cases: [], layouts: [], screenshots: [] };
  report.results.push(result);
  let context;
  const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, locale: 'ja-JP', reducedMotion: 'reduce', ignoreHTTPSErrors: true }); // owned localhost TLS only
    let external = 0;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === fixture.origin || ['blob:', 'data:', 'about:'].includes(url.protocol)) return route.continue();
      external++; return route.abort('blockedbyclient');
    });
    await installViewportFixture(context, { clipboard: false });
    const witness = await installInteractionFixture(context, fixture);
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const palette = () => page.getByRole('dialog', { name: 'クイックナビゲーション', exact: true });
    const search = () => palette().getByRole('searchbox', { name: '移動先を検索' });
    const shortcut = async () => { await page.keyboard.press('Control+k'); await palette().waitFor(); };
    const close = async () => { await palette().getByRole('button', { name: 'クイックナビゲーションを閉じる', exact: true }).click(); await palette().waitFor({ state: 'detached' }); };
    const capture = async label => {
      const path = join(output, `${name}-${label}.png`); await settleFrames(page); await page.screenshot({ path });
      result.screenshots.push(path);
    };
    const check = async (label, action) => { await action(); result.cases.push({ name: label, status: 'PASS', mode: 'SYNTHETIC_REAL_BROWSER' }); save(); };
    await page.goto(fixture.origin + '/hermes-remote-web/'); await page.locator('[data-connection="connected"]').waitFor();
    await page.getByRole('region', { name: '過去の会話', exact: true }).locator('ul > li > button').first().click();
    const input = page.getByLabel('Hermesへのメッセージ'); await input.waitFor();
    await input.fill('DEMO 日本語\n元の下書きを保持します。');
    await input.evaluate(node => { node.focus(); node.setSelectionRange(5, 8); });
    await page.locator('.remote-transcript').evaluate(node => { node.scrollTop = 200; node.dispatchEvent(new Event('scroll')); });
    const before = await readerAnchor(page);
    const methodStart = fixture.state.methods.length, featureStart = witness.methods.length;
    const writesStart = witness.writes.length, promptStart = fixture.state.submissions, answerStart = fixture.state.answers.length;
    const sessionStart = fixture.state.sessions.get('default').live;
    await check('shortcut_search_cancel_retains_input_selection_and_reading_anchor', async () => {
      await shortcut(); assert.equal(await search().evaluate(node => node === document.activeElement), true);
      await search().fill('DEMO-sensitive-query'); assert.equal(await palette().getByText('一致する移動先はありません。会話・設定などの名前で検索してください。').count(), 1);
      await search().fill('[.*]'); assert.equal(await palette().locator('.remote-menu-action').count(), 0);
      await palette().getByRole('button', { name: '移動先検索をクリア' }).click(); assert.equal(await search().inputValue(), '');
      await page.keyboard.press('Escape'); await palette().waitFor({ state: 'detached' });
      assert.equal(await input.evaluate(node => document.activeElement === node), true);
      assert.deepEqual(await input.evaluate(node => [node.selectionStart, node.selectionEnd]), [5, 8]);
      assert.equal(await input.inputValue(), 'DEMO 日本語\n元の下書きを保持します。');
      const after = await readerAnchor(page); assert.equal(after.message, before.message); assert.ok(Math.abs(after.relativeTop - before.relativeTop) < 2);
      await shortcut(); assert.equal(await search().inputValue(), ''); await capture('mobile-palette'); await close();
    });
    await check('IME_and_other_modal_ownership_never_execute_shortcut_or_enter', async () => {
      await input.evaluate(node => { node.focus(); node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
      await page.keyboard.press('Control+k'); assert.equal(await palette().count(), 0);
      await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))); await shortcut();
      await search().fill('settings');
      await search().evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await search().press('Enter'); assert.equal(await palette().count(), 1);
      await search().evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await close();
      await page.getByRole('button', { name: '会話メニュー', exact: true }).click(); await page.keyboard.press('Control+k');
      assert.equal(await palette().count(), 0); await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
    });
    await check('existing_read_panels_open_without_feature_writes_or_consent', async () => {
      for (const [destination, title] of [['個人用定型文', '個人用定型文'], ['Hermesの情報', '会話の情報'],
        ['この会話の成果物', 'この会話の成果物'], ['許可されたファイル', '登録projectのファイル']]) {
        result.currentReadDestination = destination; save();
        await shortcut(); await palette().getByRole('button', { name: destination, exact: true }).click();
        const panel = page.getByRole('dialog', { name: title, exact: true }); await panel.waitFor();
        await panel.getByRole('button', { name: '閉じる', exact: true }).click(); await panel.waitFor({ state: 'detached' });
        assert.equal(await input.inputValue(), 'DEMO 日本語\n元の下書きを保持します。');
      }
      delete result.currentReadDestination;
      assert.equal(witness.writes.length, writesStart);
    });
    await check('literal_filter_arrow_enter_navigation_and_page_scroll_recovery', async () => {
      await shortcut(); await search().fill('ＳＥＴＴＩＮＧＳ'); await search().press('ArrowDown');
      assert.equal(await palette().getByRole('button', { name: '設定・診断', exact: true }).evaluate(node => document.activeElement === node), true);
      await page.keyboard.press('Enter'); await page.getByRole('heading', { name: '設定・診断', exact: true }).waitFor(); await settleFrames(page);
      assert.equal(await page.getByRole('heading', { name: '設定・診断' }).evaluate(node => document.activeElement === node), true);
      await page.locator('main').evaluate(node => { node.scrollTop = 180; node.dispatchEvent(new Event('scroll')); });
      await page.getByRole('button', { name: 'クイックナビゲーション', exact: true }).click();
      // Native click may reveal the Settings launch button before the modal opens.
      // Preserve the actual pre-navigation reader position, not a previous synthetic offset.
      const settingsScroll = await page.locator('main').evaluate(node => node.scrollTop);
      await palette().getByRole('button', { name: '確認待ち', exact: true }).click(); await page.getByRole('heading', { name: '確認待ち', exact: true }).waitFor();
      await shortcut(); await palette().getByRole('button', { name: '設定・診断', exact: true }).click(); await settleFrames(page);
      assert.equal(await page.locator('main').evaluate(node => node.scrollTop), settingsScroll);
      await shortcut(); await palette().getByRole('button', { name: '開いている会話へ', exact: true }).click(); await input.waitFor();
      assert.equal(await input.inputValue(), 'DEMO 日本語\n元の下書きを保持します。');
    });
    await check('mobile_sidebar_launch_reuses_modal_return_chain', async () => {
      await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
      await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: 'セッションを選ぶ', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'セッション管理', exact: true });
      await drawer.getByRole('button', { name: 'クイックナビゲーション', exact: true }).click();
      assert.equal(await drawer.count(), 0); await close();
      assert.equal(await page.getByRole('button', { name: '会話メニュー', exact: true }).evaluate(node => document.activeElement === node), true);
    });
    await check('320_390_430_landscape_keyboard_200percent_themes_accessible_results', async () => {
      await shortcut();
      for (const variant of [{ width: 320, height: 568, text: 100, keyboard: null, theme: 'light' },
        { width: 390, height: 844, text: 100, keyboard: 380, theme: 'dark' },
        { width: 430, height: 932, text: 100, keyboard: null, theme: 'light' },
        { width: 844, height: 390, text: 100, keyboard: 280, theme: 'dark' },
        { width: 320, height: 568, text: 200, keyboard: 360, theme: 'light' },
        { width: 844, height: 390, text: 200, keyboard: 280, theme: 'dark' }]) {
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await page.evaluate(value => { document.documentElement.style.fontSize = `${value.text}%`; document.documentElement.dataset.theme = value.theme; }, variant);
        await visualViewport(page, variant.keyboard);
        const rect = await palette().boundingBox();
        assert.ok(rect.x >= -1 && rect.x + rect.width <= variant.width + 1);
        assert.ok(rect.y >= -1 && rect.y + rect.height <= (variant.keyboard || variant.height) + 1);
        assert.ok(await search().evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 16);
        const targets = await palette().getByRole('button').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
        assert.ok(targets.every(target => target.width >= 44 && target.height >= 44));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(await focusTrap(page, palette()), []);
        await search().focus(); await search().press('ArrowUp');
        const last = palette().getByRole('button', { name: '許可されたファイル', exact: true });
        assert.equal(await last.evaluate(node => document.activeElement === node), true);
        const visible = await last.evaluate(node => {
          const box = node.getBoundingClientRect(), dialog = node.closest('dialog').getBoundingClientRect(), list = node.closest('ul').getBoundingClientRect();
          const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          return { within: box.top >= Math.max(dialog.top, list.top) - 1 && box.bottom <= Math.min(dialog.bottom, list.bottom) + 1,
            hit: node.contains(document.elementFromPoint(center.x, center.y)) };
        });
        assert.ok(visible.within && visible.hit, JSON.stringify({ variant, visible }));
        result.layouts.push({ ...variant, rect, targets, lastAccessible: visible });
        await capture(`layout-${variant.width}-${variant.text}-${variant.theme}`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.dataset.theme = 'dark'; }); await visualViewport(page);
      await close(); await page.getByRole('complementary', { name: 'セッション管理' }).getByRole('button', { name: 'クイックナビゲーション', exact: true }).click();
      await search().fill('情報'); await capture('desktop-filter'); await close();
    });
    await check('palette_actions_have_zero_prompt_approval_interrupt_new_session_profile_model_write', async () => {
      assert.equal(fixture.state.submissions, promptStart); assert.equal(fixture.state.answers.length, answerStart);
      assert.equal(fixture.state.sessions.get('default').live, sessionStart); assert.equal(witness.writes.length, writesStart);
      assert.ok(fixture.state.methods.slice(methodStart).every(method => !/^(prompt\.|session\.(create|resume|interrupt)|approval\.|clarify\.|image\.|remote\.session\.model_set)/.test(method)));
      assert.ok(witness.methods.slice(featureStart).every(method => !['remote.session.organize', 'remote.templates.put', 'remote.templates.remove', 'remote.project.create_session', 'remote.session.branch_from_row'].includes(method)));
      const privacy = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.keys(sessionStorage), query: location.search + location.hash }));
      const allowed = new Set(['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.signed-out', 'hermes-remote-web.settings.chat-font-size']);
      assert.ok(privacy.local.every(([key, value]) => allowed.has(key) && !/DEMO|query|navigation/.test(value)));
      assert.deepEqual(privacy.session, []); assert.equal(privacy.query, ''); assert.equal(external, 0);
    });
    await check('auth_expiry_discards_open_palette_and_query', async () => {
      await shortcut(); await search().fill('DEMO-auth-private-query'); fixture.state.auth = false;
      for (const socket of fixture.state.sockets) socket.terminate();
      await page.getByRole('heading', { name: 'Hermesへ接続', exact: true }).waitFor(); assert.equal(await palette().count(), 0);
      assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('DEMO-auth-private-query'))), false);
    });
    assert.deepEqual(errors, []); result.status = 'PASS';
    result.writes = { prompt: fixture.state.submissions - promptStart, approval: fixture.state.answers.length - answerStart,
      features: witness.writes.length - writesStart, provider: 0, production: 0 };
  } catch (error) { result.status = 'FAIL'; result.error = String(error.message); throw error; }
  finally { save(); await context?.close(); await browser.close(); await fixture.close(); }
}
console.log(JSON.stringify(report));
