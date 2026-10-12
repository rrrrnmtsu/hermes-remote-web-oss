import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';
import { focusTrap, installViewportFixture, settleFrames, visualViewport } from './layout-geometry.mjs';
import { waitForReadOnlyObservation } from './worker-readiness.mjs';

// Owned loopback DEMO data only; no provider, production profile or bot message is used.
const output = resolve('output/bot-conversations'); mkdirSync(output, { recursive: true });
const report = { schema: 'hermes_remote_web_bot_conversations_fixture_v1',
  build: readFileSync('releases/current-build.txt', 'utf8').trim(), fixtureOnly: true,
  physicalIPhone: 'NOT_RUN', liveBotRead: 'NOT_RUN', providerCalls: 0, productionWrites: 0, results: [] };
const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const ownedRows = (profile, projectId = '') => Array.from({ length: 230 }, (_, i) => ({
  session_id: `DEMO-owned-${profile}-${projectId || 'all'}-${i}`,
  title: i === 0 ? 'DEMO 日本語 [.*] <script>通常テキスト</script>' : `DEMO ${i % 2 ? 'Telegram' : 'Discord'} 履歴${String(i).padStart(3, '0')}`,
  pinned: i === 1, archived: false, version: '0.DEMO', started_at: 1791800000 - i, parent_session_id: null,
}));
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const fixture = await startFixture(); fixture.state.richNavigation = true; fixture.state.featureMethods = ['remote.sessions.list'];
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  let context;
  const result = { engine: name, version: browser.version(), status: 'RUNNING', cases: [], layouts: [], screenshots: [] }; report.results.push(result);
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      locale: 'ja-JP', reducedMotion: 'reduce', ignoreHTTPSErrors: true }); // Owned loopback TLS only.
    let external = 0, mode = 'ready', currentProject = '', releasePending, notifyPending;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === fixture.origin || ['blob:', 'data:', 'about:'].includes(url.protocol)) return route.continue();
      external++; return route.abort('blockedbyclient');
    });
    await context.route(fixture.origin + '/api/status*', route => {
      if (!new URL(route.request().url()).searchParams.has('profile')) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ gateway_running: false, gateway_state: 'stopped', gateway_platforms: {} }) });
    });
    await installViewportFixture(context, { clipboard: false });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const dialog = () => page.getByRole('dialog', { name: 'ボットの状態', exact: true });
    const history = () => dialog().getByRole('region', { name: '取得済みのボット会話' });
    const launch = () => page.getByRole('button', { name: 'ボットの状態を開く', exact: true });
    const close = async () => { await dialog().getByRole('button', { name: '閉じる', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); };
    const open = async () => { await launch().click(); await dialog().getByText('停止を報告', { exact: true }).waitFor(); };
    const readFirst = async () => { await history().getByRole('button', { name: '会話一覧を取得', exact: true }).click(); await history().getByText(/保存会話50件を取得済み/).waitFor(); };
    const check = async (label, action) => { await action(); result.cases.push({ name: label, status: 'PASS', evidenceMode: 'synthetic_fixture_real_browser' }); save(); };
    await page.goto(fixture.origin + '/hermes-remote-web/'); await page.locator('[data-connection="connected"]').waitFor();
    // After boot, replace only the existing read RPC replies with bounded synthetic pages.
    const readFixture = async (method, params) => {
      assert.ok(!('source' in params) && !('offset' in params) && !('title' in params) && !('include_hidden' in params));
      if (method === 'session.list') {
        assert.equal(params.limit, 200); assert.deepEqual(Object.keys(params).sort(), ['limit', 'profile']);
        if (mode === 'fail-index') throw new Error('DEMO-source-unavailable');
        const sources = ownedRows(params.profile, currentProject).slice(0, 196).map((row, i) => ({ id: row.session_id,
          source: i === 3 ? null : i % 2 ? 'telegram' : 'discord', ...(i === 5 ? { profile: 'DEMO-foreign-profile' } : {}),
          title: 'DEMO-RAW-NOT-FOR-UI', preview: 'DEMO-RAW-NOT-FOR-UI' }));
        sources[4] = { id: 'DEMO-alias', resolved_id: sources[4].id, source: 'discord', title: 'DEMO-RAW-NOT-FOR-UI' };
        sources.push({ id: 'DEMO-another-owner', source: 'discord', title: 'DEMO-RAW-NOT-FOR-UI' },
          { id: sources[6].id, source: 'telegram' }, { id: 'DEMO-unrelated', source: 'discord' }, { id: 'DEMO-unrelated-2', source: 'telegram' });
        return { sessions: sources };
      }
      assert.equal(method, 'remote.sessions.list'); assert.equal(params.limit, 50);
      const offset = params.cursor ? Number(params.cursor.match(/^DEMO-cursor-(\d+)$/)?.[1]) : 0;
      assert.ok(Number.isInteger(offset) && offset >= 0 && offset <= 200);
      const rows = ownedRows(params.profile, params.project_id || '');
      const data = { sessions: rows.slice(offset, offset + 50), next_cursor: offset + 50 < rows.length ? `DEMO-cursor-${offset + 50}` : null,
        order: 'created_desc', scope: 'owned_profile_sessions', limit: 50, snapshot_time: 1791900000 };
      if (mode === 'pending') { notifyPending?.(); await new Promise(done => { releasePending = done; }); }
      return data;
    };
    fixture.state.botConversationRead = readFixture;
    await page.getByRole('navigation', { name: '下部ナビゲーション' }).getByRole('button', { name: '設定', exact: true }).click();
    await check('no_history_fetch_on_open_or_filters_and_owned_exact_ID_join', async () => {
      await open(); assert.equal(fixture.state.botConversationRequests.length, 0);
      await history().getByRole('searchbox').fill('[.*]'); assert.equal(fixture.state.botConversationRequests.length, 0);
      await readFirst(); assert.equal(fixture.state.botConversationRequests.length, 2);
      assert.equal(await history().getByRole('button', { name: 'この会話を開く' }).count(), 1);
      assert.ok((await history().textContent()).includes('DEMO 日本語 [.*] <script>通常テキスト</script>'));
      assert.ok(!(await history().textContent()).includes('DEMO-RAW-NOT-FOR-UI')); assert.equal(await history().locator('script').count(), 0);
      await history().getByText(/4件のボット種別/).waitFor();
      await history().getByRole('button', { name: '会話タイトル検索をクリア' }).click();
      await history().getByLabel('会話のボットを選ぶ').selectOption('telegram');
      await history().getByText('DEMO Telegram 履歴001', { exact: true }).waitFor();
      assert.equal(fixture.state.botConversationRequests.length, 2); assert.ok(await history().getByRole('button', { name: 'この会話を開く' }).count() > 1);
      await history().getByLabel('会話のボットを選ぶ').selectOption('');
    });
    await check('explicit_bounded_pages_preserve_reader_scroll_and_never_auto_fetch', async () => {
      const body = dialog().locator('.remote-tools-dialog-body');
      await body.evaluate(node => { node.scrollTop = 140; }); const before = await body.evaluate(node => node.scrollTop);
      await history().getByRole('button', { name: '次の50件を取得' }).evaluate(node => node.click());
      await history().getByText(/保存会話100件を取得済み/).waitFor();
      assert.ok(Math.abs(await body.evaluate(node => node.scrollTop) - before) <= 2, 'append must retain the reader position');
      for (const count of [150, 200]) { await history().getByRole('button', { name: '次の50件を取得' }).click(); await history().getByText(new RegExp(`保存会話${count}件を取得済み`)).waitFor(); }
      assert.equal(fixture.state.botConversationRequests.length, 8); assert.equal(await history().getByRole('button', { name: '次の50件を取得' }).isDisabled(), true);
      await history().getByText(/最大4ページの取得上限/).waitFor(); await settleFrames(page); assert.equal(fixture.state.botConversationRequests.length, 8);
    });
    await check('failed_page_retains_stale_readonly_range_then_explicit_refresh_recovers', async () => {
      mode = 'fail-index'; const before = fixture.state.botConversationRequests.length;
      await history().getByRole('button', { name: '会話一覧を最初から再取得' }).click(); await history().getByRole('alert').waitFor();
      assert.equal(fixture.state.botConversationRequests.length, before + 2); assert.equal(await history().getByRole('button', { name: 'この会話を開く' }).first().isDisabled(), true);
      assert.ok(!(await history().textContent()).includes('DEMO-source-unavailable')); await settleFrames(page); assert.equal(fixture.state.botConversationRequests.length, before + 2);
      mode = 'ready'; await history().getByRole('button', { name: '会話一覧を最初から再取得' }).click(); await history().getByText(/保存会話50件を取得済み/).waitFor();
    });
    await check('small_landscape_keyboard_200percent_light_dark_and_focus', async () => {
      for (const variant of [{ width: 320, height: 568, text: 100, keyboard: null, theme: 'light' },
        { width: 390, height: 844, text: 100, keyboard: 380, theme: 'dark' },
        { width: 430, height: 932, text: 100, keyboard: null, theme: 'light' },
        { width: 844, height: 390, text: 100, keyboard: 280, theme: 'dark' },
        { width: 320, height: 568, text: 200, keyboard: 360, theme: 'light' },
        { width: 844, height: 390, text: 200, keyboard: 280, theme: 'dark' }]) {
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await page.evaluate(v => { document.documentElement.style.fontSize = `${v.text}%`; document.documentElement.dataset.theme = v.theme; }, variant);
        await visualViewport(page, variant.keyboard); await settleFrames(page);
        const rect = await dialog().boundingBox(); assert.ok(rect.x >= -1 && rect.x + rect.width <= variant.width + 1);
        assert.ok(rect.y >= -1 && rect.y + rect.height <= (variant.keyboard || variant.height) + 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const sizes = await dialog().locator('button, input, select').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height, font: parseFloat(getComputedStyle(node).fontSize), input: ['INPUT', 'SELECT'].includes(node.tagName) })));
        assert.ok(sizes.every(node => node.width >= 44 && node.height >= 44)); assert.ok(sizes.filter(node => node.input).every(node => node.font >= 16));
        assert.deepEqual(await focusTrap(page, dialog()), []); result.layouts.push({ ...variant, rect, sizes });
        if (!variant.keyboard && variant.text === 100) { await dialog().locator('.remote-tools-dialog-body').evaluate(node => {
          const section = node.querySelector('.remote-bot-history');
          node.scrollTop += section.getBoundingClientRect().top - node.getBoundingClientRect().top;
        });
          const file = join(output, `${name}-${variant.width}-${variant.theme}.png`); await page.screenshot({ path: file }); result.screenshots.push(file); }
      }
      await page.setViewportSize({ width: 390, height: 844 }); await visualViewport(page);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.documentElement.dataset.theme = 'dark'; });
    });
    await check('close_during_read_reopen_and_late_reply_do_not_restore_old_rows_or_search', async () => {
      await history().getByRole('searchbox').fill('DEMO 以前の検索'); mode = 'pending';
      const started = new Promise(done => { notifyPending = done; });
      await history().getByRole('button', { name: '会話一覧を最初から再取得' }).click(); await started; await close();
      mode = 'ready'; await open(); assert.equal(await history().getByRole('searchbox').inputValue(), '');
      releasePending(); await settleFrames(page); assert.equal(await history().getByText(/保存会話50件を取得済み/).count(), 0);
      await close(); assert.equal(await launch().evaluate(node => document.activeElement === node), true);
    });
    await check('registered_project_and_profile_read_scopes_are_explicit_and_not_reused', async () => {
      await page.getByRole('button', { name: 'セッションのサイドバーを開く' }).click();
      const drawer = page.getByRole('dialog', { name: 'セッション管理' });
      await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 計画' }).click();
      await drawer.getByRole('button', { name: 'セッションを開く: DEMO 日本語の計画' }).waitFor();
      await drawer.getByRole('button', { name: 'サイドバーを閉じる' }).click(); currentProject = 'DEMO-plan';
      await page.getByRole('navigation', { name: '下部ナビゲーション' }).getByRole('button', { name: '設定', exact: true }).click();
      await open(); await history().getByText(/取得対象: default \/ DEMO 計画/).waitFor(); await readFirst();
      assert.deepEqual(fixture.state.botConversationRequests.at(-2), { method: 'remote.sessions.list', params: { profile: 'default', limit: 50, project_id: 'DEMO-plan' } });
      await close(); fixture.state.botConversationRead = null;
      await page.getByRole('button', { name: 'セッションのサイドバーを開く' }).click(); await drawer.getByLabel('サイドバーのprofile').selectOption('DEMO-secondary');
      await drawer.getByRole('button', { name: 'セッションを開く: DEMO会話 DEMO-secondary', exact: true }).waitFor();
      await drawer.getByRole('button', { name: 'サイドバーを閉じる' }).click(); currentProject = '';
      await page.getByRole('navigation', { name: '下部ナビゲーション' }).getByRole('button', { name: '設定', exact: true }).click();
      await open(); assert.equal(await history().getByText(/保存会話50件を取得済み/).count(), 0); await close();
      await page.getByRole('button', { name: 'セッションのサイドバーを開く' }).click(); await drawer.getByLabel('サイドバーのprofile').selectOption('default');
      await drawer.getByRole('button', { name: 'セッションを開く: DEMO会話 default', exact: true }).waitFor();
      await drawer.getByRole('button', { name: 'サイドバーを閉じる' }).click(); fixture.state.botConversationRead = readFixture;
    });
    await check('composer_draft_is_preserved_and_blocks_bot_navigation_without_operations', async () => {
      await page.getByRole('navigation', { name: '下部ナビゲーション' }).getByRole('button', { name: '会話', exact: true }).click();
      await page.getByRole('region', { name: '過去の会話' }).locator('li > button').first().click();
      const input = page.getByLabel('Hermesへのメッセージ'); await input.fill('DEMO 元の下書き\n日本語の続き');
      const before = fixture.state.methods.length;
      await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'クイックナビゲーション' }).getByRole('button', { name: 'ボットの状態', exact: true }).click();
      await dialog().waitFor(); await readFirst(); assert.equal(await history().getByRole('button', { name: 'この会話を開く' }).first().isDisabled(), true);
      await close(); assert.equal(await input.inputValue(), 'DEMO 元の下書き\n日本語の続き');
      assert.ok(fixture.state.methods.slice(before).every(method => !/^(prompt\.|session\.(create|resume|interrupt)|approval\.|clarify\.|image\.)/.test(method)));
      await input.fill('');
    });
    await check('explicit_bot_row_open_uses_existing_resume_once_and_no_implicit_send', async () => {
      await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'クイックナビゲーション' }).getByRole('button', { name: 'ボットの状態', exact: true }).click();
      await dialog().waitFor(); await readFirst(); const before = fixture.state.methods.filter(method => method === 'session.resume').length;
      const targets = [];
      for (const socket of fixture.state.sockets) socket.on('message', bytes => {
        for (const line of String(bytes).split('\n').filter(Boolean)) { const frame = JSON.parse(line);
          if (frame.method === 'session.resume') targets.push({ profile: frame.params.profile, session_id: frame.params.session_id }); }
      });
      await history().getByRole('button', { name: 'この会話を開く' }).nth(1).click(); await dialog().waitFor({ state: 'detached' });
      await waitForReadOnlyObservation(() => Promise.resolve(targets.length === 1), { timeoutMs: 3000, intervalMs: 50, label: 'explicit_canonical_resume' });
      await page.getByLabel('Hermesへのメッセージ').waitFor(); assert.equal(fixture.state.methods.filter(method => method === 'session.resume').length, before + 1);
      assert.deepEqual(targets, [{ profile: 'default', session_id: 'DEMO-owned-default-all-1' }]); result.explicitResumeTarget = targets[0];
    });
    assert.equal(external, 0); assert.deepEqual(errors, []); assert.equal(fixture.state.submissions, 0); assert.deepEqual(fixture.state.answers, []);
    assert.ok(fixture.state.methods.every(method => !/^(prompt\.|session\.interrupt|approval\.|clarify\.|image\.|remote\.session\.model_set)/.test(method)));
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    assert.ok((await page.evaluate(() => Object.keys(localStorage))).every(key => ['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.chat-font-size', 'hermes-remote-web.settings.signed-out'].includes(key)));
    result.status = 'PASS'; result.readRequests = fixture.state.botConversationRequests.length;
    result.operations = { prompt: 0, approval: 0, stop: 0, botWrites: 0, provider: 0, production: 0 };
  } catch (error) { result.status = 'FAIL'; result.error = String(error); process.exitCode = 1; }
  finally { await context?.close(); await browser.close(); await fixture.close(); save(); }
}
console.log(JSON.stringify(report));
