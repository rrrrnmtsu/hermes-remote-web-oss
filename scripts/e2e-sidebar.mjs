import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startFixture } from './fixture-server.mjs';

// Sanitized localhost fixtures only. No real profiles, titles, prompts or screenshots.
mkdirSync('evidence', { recursive: true });
mkdirSync('output/sidebar', { recursive: true });
const report = { schema: 'hermes_remote_web_sidebar_browser_v1', build: readFileSync('releases/current-build.txt', 'utf8').trim(),
  targetHermes: 'DEMO-fixture-e8c97320', fixtureOnly: true, iphone: 'NOT_RUN', timestamp: new Date().toISOString(), results: [] };
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const delay = ms => new Promise(done => setTimeout(done, ms));
async function run(name, engine) {
  const fixture = await startFixture(); fixture.state.richNavigation = true;
  const local = name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1';
  const browser = await engine.launch(local ? { executablePath: resolve('scripts/run-webkit-local.sh'),
    env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) } } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true }); // localhost TLS only
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const result = { engine: name, version: browser.version(), status: 'RUNNING', cases: [], layouts: [] }; report.results.push(result);
  const pass = name => result.cases.push({ name, expected: 'assertions hold', observed: 'assertions passed', status: 'PASS', evidenceMode: 'fixture_real_browser' });
  const open = async () => {
    await page.getByRole('button', { name: 'セッションのサイドバーを開く' }).click();
    const drawer = page.getByRole('dialog', { name: 'セッション管理' });
    await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 計画' }).waitFor();
    return drawer;
  };
  try {
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await page.locator('[data-connection="connected"]').waitFor();
    assert.equal(await page.locator('.remote-session').count(), 4);
    assert.equal(fixture.state.methods.includes('projects.tree'), false);
    let drawer = await open();
    assert.equal(await drawer.getByLabel('サイドバーのprofile').inputValue(), 'default');
    assert.equal(await drawer.getByLabel('サーバー集計 2会話').innerText(), '2');
    assert.equal(await drawer.getByRole('button', { name: 'プロジェクトを選択: プロジェクトなし' }).count(), 1);
    assert.equal(await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 調査' }).innerText().then(text => text.includes('作業先から自動分類')), true);
    pass('mobile_drawer_auth_profile_and_real_project_projection');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'セッションのサイドバーを開く');
    pass('native_modal_focus_trap_escape_and_return_focus');

    drawer = await open();
    await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 計画' }).click();
    await drawer.getByRole('button', { name: 'セッションを開く: DEMO 日本語の計画' }).waitFor();
    assert.equal(await drawer.locator('.remote-sidebar-session').count(), 2);
    await drawer.getByLabel('サイドバーの会話を検索').fill(' 日本語 ');
    assert.equal(await drawer.locator('.remote-sidebar-session').count(), 1);
    assert.equal(await page.locator('.remote-session').count(), 1);
    pass('project_session_drill_in_and_shared_bounded_title_search');
    await drawer.getByLabel('サイドバーの会話を検索').fill('');
    await page.screenshot({ path: `output/sidebar/${name}-mobile-projects.png` });

    fixture.state.projectSessionsDelayMs = 500;
    await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 計画' }).click();
    fixture.state.projectSessionsDelayMs = 0;
    await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 調査' }).click();
    await drawer.getByRole('button', { name: 'セッションを開く: DEMO 調査メモ' }).waitFor();
    await delay(650);
    assert.equal(await drawer.locator('.remote-sidebar-session').count(), 1);
    assert.equal(await drawer.locator('.remote-sidebar-session strong').innerText(), 'DEMO 調査メモ');
    pass('late_previous_project_response_never_replaces_current_selection');
    await drawer.getByLabel('サイドバーのprofile').selectOption('DEMO-secondary');
    await drawer.getByRole('button', { name: 'セッションを開く: DEMO会話 DEMO-secondary', exact: true }).waitFor();
    assert.equal(await drawer.getByLabel('サイドバーのprofile').inputValue(), 'DEMO-secondary');
    assert.equal(await page.locator('.remote-project-context').count(), 0);
    pass('profile_switch_clears_old_project_filter_and_reloads_current_scope');
    await drawer.getByLabel('サイドバーのprofile').selectOption('default');
    await drawer.getByRole('button', { name: 'セッションを開く: DEMO会話 default', exact: true }).waitFor();
    await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 計画' }).click();
    await drawer.getByRole('button', { name: 'セッションを開く: DEMO会話 default', exact: true }).click();
    await page.getByLabel('Hermesへのメッセージ').waitFor();
    assert.equal(fixture.state.methods.filter(method => method === 'session.resume').length, 1);
    assert.equal(fixture.state.submissions, 0);
    pass('project_durable_session_resume_uses_existing_no_prompt_flow');

    await page.getByLabel('Hermesへのメッセージ').fill('DEMO 下書きはこのページだけ');
    await page.getByRole('button', { name: '会話メニュー', exact: true }).click();
    await page.getByRole('button', { name: 'セッションを選ぶ', exact: true }).click();
    drawer = page.getByRole('dialog', { name: 'セッション管理' });
    assert.equal(await drawer.getByLabel('サイドバーのprofile').isDisabled(), true);
    assert.equal(await drawer.getByRole('button', { name: 'サイドバーから新規会話' }).isDisabled(), true);
    await drawer.getByRole('button', { name: 'プロジェクトを選択: DEMO 調査' }).click();
    await drawer.getByRole('button', { name: 'セッションを開く: DEMO 調査メモ' }).waitFor();
    assert.equal(await drawer.getByRole('button', { name: 'セッションを開く: DEMO 調査メモ' }).isDisabled(), true);
    await drawer.getByRole('button', { name: '開いている会話を表示' }).click();
    assert.equal(await page.getByLabel('Hermesへのメッセージ').inputValue(), 'DEMO 下書きはこのページだけ');
    assert.equal(fixture.state.methods.filter(method => method === 'session.resume').length, 1);
    pass('draft_safe_project_browsing_current_return_and_zero_automatic_resume_or_send');

    await page.getByRole('button', { name: '← 会話一覧', exact: true }).click();
    assert.equal(await page.getByLabel('選択中のプロジェクト').innerText().then(text => text.includes('profileの既定の作業先')), true);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.getByRole('complementary', { name: 'セッション管理' }).waitFor(); await settle(page);
    const desktop = page.getByRole('complementary', { name: 'セッション管理' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await desktop.getByLabel('サイドバーのprofile').isDisabled(), true);
    await page.screenshot({ path: `output/sidebar/${name}-desktop-projects.png` });
    const desktopBounds = await page.locator('.remote-sidebar').boundingBox(), appBounds = await page.locator('.remote-app').boundingBox();
    assert.ok(desktopBounds.x + desktopBounds.width <= appBounds.x + 1);
    assert.ok(appBounds.x + appBounds.width <= 1201);
    pass('persistent_desktop_sidebar_coexists_with_current_scope_without_overlap');

    for (const [width, height, font] of [[320, 568, 16], [390, 844, 32], [844, 390, 16], [760, 1024, 16]]) {
      await page.setViewportSize({ width, height }); await settle(page);
      await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px`; }, font);
      drawer = await open(); await settle(page);
      const bounds = await drawer.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1);
      assert.equal(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      const targets = await drawer.locator('button:not(:disabled), select, input').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).map(node => node.getBoundingClientRect().height));
      assert.ok(targets.every(height => height >= 43.9));
      result.layouts.push({ width, height, font, status: 'PASS', evidenceMode: 'fixture_real_browser' });
      await drawer.getByRole('button', { name: 'サイドバーを閉じる' }).click();
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
    await page.setViewportSize({ width: 390, height: 844 });
    pass('drawer_small_portrait_landscape_tablet_200_percent_text_and_44px_targets');

    const methods = fixture.state.methods;
    assert.equal(methods.some(method => /^projects\.(create|update|delete|set_active|record|discover)|kanban|config\.set|prompt\.submit/.test(method)), false);
    pass('project_navigation_has_no_management_write_or_llm_submission');
    await page.evaluate(async () => {
      localStorage.setItem('other-app.sidebar-test', 'preserve');
      await (await caches.open('other-app.sidebar-test')).put('/other-app-fixture', new Response('preserve'));
    });
    const storage = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    assert.equal(/DEMO|durable|project|下書き/.test(storage), false);
    pass('project_titles_ids_and_drafts_never_enter_persistent_web_storage');
    await page.getByRole('button', { name: '開いている会話へ', exact: true }).click();
    await page.getByLabel('Hermesへのメッセージ').fill('');
    await page.getByRole('button', { name: '← 会話一覧', exact: true }).click();
    fixture.state.failProjects = true;
    await page.getByRole('button', { name: 'セッションのサイドバーを開く' }).click();
    drawer = page.getByRole('dialog', { name: 'セッション管理' });
    await drawer.getByText('このHermes版はプロジェクト一覧に未対応です。最近の会話を利用できます。', { exact: true }).waitFor();
    await drawer.getByRole('button', { name: '最近の会話', exact: false }).click();
    await drawer.getByRole('button', { name: '一覧で表示', exact: false }).click();
    assert.equal(await page.locator('[data-connection="connected"]').count(), 1);
    pass('unsupported_project_rpc_does_not_break_authenticated_chat');
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウトを実行', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'ログアウト' }).first().waitFor();
    assert.equal(await page.getByText('DEMO 計画', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('other-app.sidebar-test')), 'preserve');
    assert.equal(await page.evaluate(() => caches.has('other-app.sidebar-test')), true);
    pass('logout_erases_navigation_memory_preserves_other_app_storage_and_cache');
    assert.deepEqual(errors, []);
    pass('zero_browser_errors'); result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.error = error instanceof Error ? error.message : String(error); throw error;
  } finally {
    await context.close(); await browser.close(); await fixture.close();
    writeFileSync('evidence/sidebar-browser.json', JSON.stringify(report, null, 2) + '\n');
  }
}
const requested = process.argv.find(arg => arg.startsWith('--engine='))?.split('=')[1];
assert.ok(!requested || ['webkit', 'chromium'].includes(requested));
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) if (!requested || requested === name) await run(name, engine);
console.log(JSON.stringify(report, null, 2));
