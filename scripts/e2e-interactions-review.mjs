import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { sameVisibleReturnFocus, profileReadReady } from './interactions-observation.mjs';
import { waitForReadOnlyObservation } from './worker-readiness.mjs';
import { startFixture } from './fixture-server.mjs';
import { installInteractionFixture, installSyntheticDeviceSpeech, DEMO_DRAFT } from './interactions-fixture.mjs';
import { installViewportFixture, settleFrames, readerAnchor, geometry, geometryFailures } from './layout-geometry.mjs';

// Real built UI; only loopback authentication/server responses are synthetic.
// This is not an actual Hermes handler/provider or physical-device acceptance.
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = realpathSync(resolve(dirname(new URL(import.meta.url).pathname), '..'));
const phase = argument('phase') || 'before';
const engineFilter = argument('engine');
const suite = argument('suite') || 'controls';
assert.ok(['controls','remaining','critical'].includes(suite));
assert.ok(['before', 'after'].includes(phase));
assert.ok(!engineFilter || ['chromium', 'webkit'].includes(engineFilter));
const suppliedAppHead = argument('candidate-source-head');
assert.ok(!suppliedAppHead || /^[a-f0-9]{40}$/.test(suppliedAppHead));
const build = readFileSync(join(root, 'releases/current-build.txt'), 'utf8').trim();
assert.match(build, /^remote-v2-[a-f0-9]{16}$/);
const release = realpathSync(argument('release') || join(root, 'releases', build));
assert.equal(basename(release), build);
assert.equal(release, realpathSync(join(root, 'releases', build)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['scripts/e2e-interactions-review.mjs', 'scripts/interactions-fixture.mjs', 'scripts/interactions-observation.mjs', 'scripts/layout-fixture.mjs', 'scripts/layout-geometry.mjs', 'scripts/fixture-server.mjs', 'scripts/worker-readiness.mjs'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(name => [name, hash(readFileSync(join(root, name)))]));
const releaseHashes = () => {
  const result = {};
  function visit(directory, prefix = '') {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      assert.ok(!item.isSymbolicLink());
      if (item.isDirectory()) visit(join(directory, item.name), `${prefix}${item.name}/`);
      else result[`${prefix}${item.name}`] = hash(readFileSync(join(directory, item.name)));
    }
  }
  visit(release); return result;
};
mkdirSync(join(root, 'output/playwright'), { recursive: true });
const output = mkdtempSync(join(root, `output/playwright/interactions-c-${phase}-`));
const metadata = JSON.parse(readFileSync(join(release, 'build.json')));
const report = {
  schema: 'hermes_remote_web_independent_interactions_v1', phase, suite, build,
  buildInputsSha256: metadata.buildInputsSha256,
  candidateSourceHead: suppliedAppHead || null, candidateSourceBinding: suppliedAppHead ? 'EXPLICIT_REFERENCE_REQUIRES_INDEPENDENT_PAYLOAD_INPUT_BINDING' : 'OWN_HARNESS_HEAD_IS_NOT_A_SUPPLIED_CANDIDATE_CLAIM',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim(),
  sourceBefore: sourceHashes(), releaseBefore: releaseHashes(),
  measurement: 'REAL_BUILT_UI_LOOPBACK_WSS_SYNTHETIC_FEATURE_RESPONSES',
  actualHermesHandler: 'NOT_RUN_IN_THIS_UI_FIXTURE', providerCalls: 0, paidGeneration: 0,
  productionMutation: 0, physicalIPhone: 'NOT_RUN', userConsent: 'SYNTHETIC_LOCAL_CONSENT_ONLY_REAL_DEVICE_NOT_EXERCISED',
  scenarios: [], results: [], status: 'RUNNING',
};
const persist = () => writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  if (engineFilter && engine !== engineFilter) continue;
  const directory = join(output, engine); mkdirSync(directory);
  const fixture = await startFixture({ releaseDirectory: release });
  let browser, context, page, witness;
  const result = { engine, status: 'RUNNING', actions: [], inventory: [], findings: [], warnings: 0, pageErrors: 0, cleanupFailures: [], screenshots: [] };
  report.results.push(result);
  let scenario = 'bootstrap';
  const buttons = () => page.evaluate(() => [...document.querySelectorAll('button, summary, [role="tab"], a[href]')]
    .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
    .map(node => ({ tag: node.tagName, role: node.getAttribute('role'),
      label: (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
      disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true',
      title: node.getAttribute('title') || '', describedBy: Boolean(node.getAttribute('aria-describedby')) })));
  const snapshot = async () => ({
    focus: await page.evaluate(() => ({ tag: document.activeElement?.tagName,
      label: (document.activeElement?.getAttribute('aria-label') || (document.activeElement?.tagName === 'BUTTON' ? document.activeElement?.innerText : '') || '').slice(0, 160), id: document.activeElement?.id || '',
      connected: Boolean(document.activeElement?.isConnected), visible: Boolean(document.activeElement?.getClientRects().length) && getComputedStyle(document.activeElement).visibility !== 'hidden', dialog: document.activeElement?.closest('dialog[open]')?.getAttribute('aria-label') || null })),
    dialogs: await page.locator('dialog[open]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))),
    menuCount: await page.locator('dialog[open][aria-label="会話メニュー"],dialog[open][aria-label="入力の補助"]').count(),
    alerts: await page.locator('[role="alert"]').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => node.textContent.length)),
    statusCount: await page.locator('[role="status"]').count(),
    draft: await page.locator('#remote-input').count() ? { sha256: hash(await page.locator('#remote-input').inputValue()), length: (await page.locator('#remote-input').inputValue()).length } : null,
    reader: await page.locator('.remote-transcript').count() ? await readerAnchor(page) : null,
    mainScroll: await page.locator('.remote-main').count() ? await page.locator('.remote-main').evaluate(node => node.scrollTop) : null,
    document: await page.evaluate(() => ({ x: scrollX, y: scrollY, overflowX: document.documentElement.scrollWidth - innerWidth })),
  });
  const scan = async () => { const controls = await buttons(); result.inventory.push({ scenario, controls }); return controls; };
  const capture = async label => { const path = join(directory, `${label}.png`); await page.screenshot({ path }); result.screenshots.push({ path, sha256: hash(readFileSync(path)), data: 'DEMO_SYNTHETIC_ONLY' }); };
  const finding = (id, rule, actual = {}) => result.findings.push({ id, scenario, rule, ...actual });
  const operation = async (id, action, expect) => {
    const before = await snapshot(); const methodOffset = fixture.state.methods.length; const featureOffset = witness.methods.length;
    const row = { id, scenario, before, status: 'RUNNING' }; result.actions.push(row);
    try {
      await action(row); await settleFrames(page, 4); row.after = await snapshot();
      row.rpcMethods = [...fixture.state.methods.slice(methodOffset), ...witness.methods.slice(featureOffset)];
      const issues = await expect(row.before, row.after, row);
      row.status = issues.length ? 'FAIL' : 'PASS'; row.issues = issues;
      for (const rule of issues) finding(id, rule);
    } catch (error) {
      row.status = 'FAIL'; row.errorCategory = error?.name || 'Error';
      finding(id, 'interaction_action_or_observation_failed', { errorCategory: row.errorCategory });
    } finally { witness.releaseAll(); await scan(); persist(); }
  };
  const workflow = async (name, action) => {
    if (suite === 'critical' && name !== 'I-SYNTHETIC_SEND_STOP_AND_REQUEST_RESPONSE') return;
    if (suite === 'controls' && name === 'I-SYNTHETIC_SEND_STOP_AND_REQUEST_RESPONSE') return;
    if (suite === 'remaining' && !['I-SIDEBAR_PROFILE_FILTER_AND_RECONNECT','I-SETTINGS_SCROLL_THEME_SYNTHETIC_STORAGE_CONNECTIONS_AND_PUSH','I-SYNTHETIC_SEND_STOP_AND_REQUEST_RESPONSE','I-MAIN_ACTIONS_DIAGNOSTICS_AND_SAFE_LOGOUT_CANCEL'].includes(name)) return;
    scenario = name; report.scenarios.push({ engine, name });
    try { await action(); } catch (error) { finding(name, 'workflow_precondition_failed', { errorCategory: error?.name || 'Error' }); }
    finally { persist(); }
  };
  const wait = (observation, label) => waitForReadOnlyObservation(observation, { label, timeoutMs: 5000 });
  const waitProfileReady = profile => wait(async () => profileReadReady(profile, await page.evaluate(() => {
    const select = document.querySelector('select[aria-label="登録profile"]');
    const list = document.querySelector('section[aria-label="過去の会話"]');
    const submit = list?.querySelector('button[type="submit"]');
    return { profile: select?.value, connection: document.querySelector('.remote-connection-chip [data-connection="connected"]') ? 'connected' : 'pending',
      listRendered: Boolean(list?.getClientRects().length), listLoading: !submit || Boolean(submit.disabled) };
  })), 'authoritative_profile_read_ready');
  const click = label => page.getByRole('button', { name: label, exact: true }).click();
  const menu = async label => { await click('会話メニュー'); await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name: label, exact: true }).click(); await settleFrames(page, 4); };
  const closeDialogs = async () => {
    for (const dialog of await page.locator('dialog[open]').all()) await dialog.press('Escape').catch(() => undefined);
    await settleFrames(page, 4);
  };
  const conversation = async () => {
    await closeDialogs();
    if (await page.locator('#remote-input').count()) return;
    await click('会話');
    const current = page.getByRole('button', { name: '開いている会話へ', exact: true });
    if (await current.count()) await current.click();
    else await page.getByRole('region', { name: '過去の会話', exact: true }).locator('ul > li > button').first().click();
    await page.locator('#remote-input').waitFor(); await settleFrames(page, 4);
  };
  const list = async () => {
    await closeDialogs();
    const back = page.getByRole('button', { name: '← 会話一覧', exact: true });
    if (await back.count()) await back.click();
    else { await click('会話'); if (await page.getByRole('button', { name: '← 会話一覧', exact: true }).count()) await click('← 会話一覧'); }
    await page.getByRole('region', { name: '過去の会話', exact: true }).waitFor();
    await settleFrames(page, 4);
  };
  try {
    const home = join(directory, 'browser-home'), xdg = join(directory, 'xdg'); mkdirSync(home); mkdirSync(xdg);
    const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, XDG_CACHE_HOME: xdg, XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '', HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) };
    const cert = new X509Certificate(readFileSync(join(root, 'output/playwright/tls/fixture-cert.pem')));
    const spki = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    browser = await type.launch({ env, timeout: 20000,
      ...(engine === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? { executablePath: join(root, 'scripts/run-webkit-local.sh') } : {}),
      ...(engine === 'chromium' ? { args: [`--ignore-certificate-errors-spki-list=${spki}`] } : {}) });
    result.version = browser.version();
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ja-JP', isMobile: true, hasTouch: true,
      ignoreHTTPSErrors: true, acceptDownloads: true, serviceWorkers: 'allow', colorScheme: 'light', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === fixture.origin || ['about:', 'blob:', 'data:'].includes(url.protocol)) return route.continue();
      finding('network_boundary', 'external_http_attempt'); return route.abort('blockedbyclient');
    });
    await installViewportFixture(context); await installSyntheticDeviceSpeech(context); witness = await installInteractionFixture(context, fixture); witness.generationAllowed = suite !== 'controls';
    await context.addInitScript(() => {
      const actions = []; const copies = { calls: 0, characters: [] };
      Object.defineProperty(window, '__DEMO_clipboard_counts', { value: copies });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copies.calls++; copies.characters.push(text.length); } } });
      Object.defineProperty(window, '__DEMO_ui_action_events', { value: actions });
      document.addEventListener('click', event => {
        const node = event.target?.closest?.('button,summary,a[href]'); if (!node || actions.length >= 4096) return;
        actions.push({ tag: node.tagName, label: (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').slice(0,160), surface: node.closest('dialog[aria-label],section[aria-label],nav[aria-label]')?.getAttribute('aria-label') || 'main', trusted: event.isTrusted, disabled: Boolean(node.disabled) });
      }, true);
    });
    page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', () => { result.pageErrors++; });
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) result.warnings++; });
    await page.goto(`${fixture.origin}/hermes-remote-web/`); await page.locator('[data-connection="connected"]').waitFor();
    await scan();
    await workflow('I-LIST_FILTERS_AND_NAV', async () => {
      await operation('list_query_input', () => page.getByLabel('タイトル', { exact: true }).fill('DEMO'), async () => await page.getByLabel('タイトル', { exact: true }).inputValue() === 'DEMO' ? [] : ['query_edit_no_visible_value']);
      await operation('list_explicit_search', () => click('条件を指定して取得'), async () => await page.getByRole('region', { name: '過去の会話', exact: true }).locator('ul > li').count() ? [] : ['search_has_no_visible_feedback']);
      await operation('open_saved_conversation', () => page.getByRole('region', { name: '過去の会話', exact: true }).locator('ul > li > button').first().click(), async () => await page.locator('#remote-input').count() ? [] : ['conversation_not_opened']);
      await page.locator('#remote-input').fill(DEMO_DRAFT); await capture('01-before-conversation');
      await operation('readonly_send_disabled_has_policy_reason', async row => { row.disabled = await page.getByRole('button', { name: '送信', exact: true }).isDisabled(); }, async (_before, _after, row) => row.disabled && await page.getByRole('status').filter({ hasText: 'DEMO この検修は実生成が未許可です。' }).count() === 1 ? [] : ['disabled_send_policy_reason_missing']);
    });
    await workflow('I-MENU_PANEL_CLOSE_FOCUS', async () => {
      await conversation();
      for (const [label, dialogLabel] of [['モデル・実行情報','会話の情報'], ['プロジェクトのファイル','登録projectのファイル'], ['成果物','この会話の成果物'], ['個人用定型文','個人用定型文']]) {
        const actualPrelaunchFocus = (await snapshot()).focus;
        await operation(`open_${dialogLabel}`, async () => {
          if (label === '個人用定型文') { await click('入力の補助'); await click(label); }
          else await menu(label);
        }, async () => await page.getByRole('dialog', { name: dialogLabel, exact: true }).count() ? [] : ['menu_action_no_panel']);
        const dialog = page.getByRole('dialog', { name: dialogLabel, exact: true });
        await operation(`close_${dialogLabel}`, () => dialog.getByRole('button', { name: '閉じる', exact: true }).click(), async (before, after) => [
          ...(after.dialogs.includes(dialogLabel) ? ['panel_did_not_close'] : []),
          ...(label === '個人用定型文' ? !sameVisibleReturnFocus(actualPrelaunchFocus, after.focus) ? ['panel_close_does_not_return_to_actual_prelaunch_focus'] : [] : after.focus.label !== '会話メニュー' || !after.focus.visible ? ['panel_close_does_not_return_to_visible_invoker'] : []),
          ...(after.menuCount ? ['closed_menu_remains_in_dom'] : []),
          ...(before.draft && after.draft?.sha256 !== before.draft.sha256 ? ['draft_changed_on_panel_close'] : []),
        ]);
      }
      await capture('02-after-menu-panel-close');
    });
    await workflow('I-COMPOSER_QUICK_EDITOR_SEARCH', async () => {
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT);
      await operation('open_composer_helper', () => click('入力の補助'), async () => await page.getByRole('button', { name: '入力欄を広げる', exact: true }).count() ? [] : ['composer_helper_no_response']);
      await operation('expand_shared_input', () => click('入力欄を広げる'), async () => await page.getByRole('dialog', { name: '拡大入力', exact: true }).count() ? [] : ['expanded_editor_not_opened']);
      await operation('expanded_input_guidance_disclosure', () => page.getByRole('dialog', { name: '拡大入力', exact: true }).getByText('入力の注意', { exact: true }).click(), async () => await page.getByRole('dialog', { name: '拡大入力', exact: true }).locator('details[open]').count() === 1 ? [] : ['expanded_editor_details_no_response']);
      await operation('close_shared_editor', () => click('通常表示へ戻る'), async (before, after) => [
        ...(after.dialogs.includes('拡大入力') ? ['editor_did_not_close'] : []),
        ...(after.focus.id !== 'remote-input' ? ['editor_focus_not_returned'] : []),
      ]);
      await operation('open_chat_search', () => menu('この会話を検索'), async () => await page.getByLabel('会話内の検索語').count() ? [] : ['search_not_opened']);
      await operation('type_chat_search', () => page.getByLabel('会話内の検索語').fill('合成会話'), async () => { await page.locator('mark[data-chat-hit]').first().waitFor(); return []; });
      await operation('search_next', () => click('次の一致'), async (_before, _after, row) => { row.active = await page.locator('.remote-search-navigation [role="status"]').innerText(); return row.active.startsWith('2 /') ? [] : ['search_next_did_not_advance_hit']; });
      await operation('search_previous', () => click('前の一致'), async (_before, _after, row) => { row.active = await page.locator('.remote-search-navigation [role="status"]').innerText(); return row.active.startsWith('1 /') ? [] : ['search_previous_did_not_restore_hit']; });
      await operation('search_clear', () => click('本文検索をクリア'), async () => await page.getByLabel('会話内の検索語').inputValue() === '' ? [] : ['query_not_cleared']);
      await operation('search_escape', () => page.getByLabel('会話内の検索語').press('Escape'), async () => await page.getByLabel('会話内の検索語').count() ? ['search_escape_has_no_close_feedback'] : []);
      if (await page.getByLabel('会話内の検索語').count()) await click('本文検索を閉じる');
    });
    await workflow('I-NAV_SETTINGS_RETURN', async () => {
      await list();
      await operation('settings_navigation', () => click('設定'), async () => await page.getByLabel('会話の文字サイズ', { exact: true }).count() ? [] : ['settings_navigation_no_response']);
      await operation('font_selection', () => page.getByLabel('会話の文字サイズ', { exact: true }).selectOption('17'), async () => await page.getByLabel('会話の文字サイズ', { exact: true }).inputValue() === '17' ? [] : ['font_setting_no_feedback']);
      await operation('font_reset', () => click('文字サイズを標準に戻す'), async () => await page.getByLabel('会話の文字サイズ', { exact: true }).inputValue() === '16' ? [] : ['font_reset_no_response']);
      await operation('conversation_navigation', () => click('会話'), async () => await page.getByRole('region', { name: '過去の会話', exact: true }).count() ? [] : ['conversation_navigation_no_response']);
      await operation('return_to_open_conversation', () => click('開いている会話へ'), async () => await page.locator('#remote-input').count() ? [] : ['active_conversation_not_reopened']);
      const metrics = await geometry(page, [{ selector: '#remote-input', label: 'input' }, { selector: '.remote-send', label: 'send' }]);
      const failures = geometryFailures(metrics, { input: true }); if (failures.length) finding('final_composer_targets', 'required_control_geometry_failed', { failures });
    });
    await workflow('I-INFORMATION_TABS_LOADING_ERROR_EMPTY_AND_MODEL', async () => {
      await conversation(); await page.locator('#remote-input').fill('');
      const info = page.getByRole('dialog', { name: '会話の情報', exact: true });
      await operation('information_open_once', () => menu('モデル・実行情報'), async (_before, _after, row) => {
        await info.getByLabel('次に使うモデル').waitFor();
        row.readCount = row.rpcMethods.filter(method => method === 'remote.info.models').length;
        return row.readCount === 1 ? [] : ['one_panel_open_sends_duplicate_model_reads'];
      });
      const refresh = info.getByRole('button', { name: '現在の情報を再取得', exact: true });
      witness.hold('remote.info.models');
      await operation('information_refresh_loading_double_click', async row => {
        await refresh.dblclick(); await info.getByText('情報を取得中…', { exact: true }).waitFor();
        row.loading = { buttonDisabled: await refresh.isDisabled(), ariaBusy: await info.getByRole('region', { name: '会話の情報の内容' }).getAttribute('aria-busy') };
        witness.release('remote.info.models'); await wait(() => refresh.isEnabled(), 'information_refresh_ack');
      }, async (_before, _after, row) => row.loading?.buttonDisabled && row.loading.ariaBusy === 'true' && row.rpcMethods.filter(method => method === 'remote.info.models').length === 1 ? [] : ['refresh_loading_or_double_click_guard_missing']);
      await operation('select_configured_model', () => info.getByLabel('次に使うモデル').selectOption('DEMO-alternate'), async () => await info.getByRole('button', { name: 'この会話へ適用' }).isEnabled() ? [] : ['selectable_model_apply_remains_disabled']);
      await operation('apply_model_single_write_readback', async () => {
        await info.getByRole('button', { name: 'この会話へ適用' }).click(); await wait(async () => await info.getByLabel('次に使うモデル').inputValue() === 'DEMO-alternate', 'model_readback');
      }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'remote.session.model_set').length === 1 && await info.getByRole('button', { name: 'この会話へ適用' }).isDisabled() ? [] : ['model_apply_no_exact_once_feedback']);
      await operation('disabled_model_has_reason', async row => {
        row.disabled = await info.getByLabel('次に使うモデル').locator('option[value="DEMO-disabled"]').isDisabled();
      }, async () => await info.getByText('このモデルの出力・文脈上限が未確認のため変更できません', { exact: true }).count() ? [] : ['disabled_model_reason_missing']);
      for (const [tab, content, method] of [['情報・利用量', '利用量・時間・費用', 'remote.info.snapshot'], ['Skills', 'Skills・コマンド', 'remote.info.commands'], ['予定・履歴', '定期ジョブの予定・履歴', 'remote.info.cron'], ['実行状況', '会話の実行・確認待ち', 'remote.info.activity']]) {
        await operation(`information_tab_${tab}`, async () => { const offset = witness.methods.length; await info.getByRole('button', { name: tab, exact: true }).click(); await info.getByRole('heading', { name: content, exact: true }).waitFor(); await wait(() => Promise.resolve(witness.methods.slice(offset).includes(method)), 'tab_read_dispatch'); await wait(() => refresh.isEnabled(), 'tab_ready'); }, async (_before, _after, row) => row.rpcMethods.includes(method) ? [] : ['tab_did_not_load_corresponding_read']);
        await operation(`information_refresh_${tab}`, async () => { await refresh.click(); await wait(() => refresh.isEnabled(), 'tab_refresh_ready'); }, async (_before, _after, row) => row.rpcMethods.includes(method) ? [] : ['refresh_missing_read']);
      }
      await info.getByRole('button', { name: 'Skills', exact: true }).click();
      await operation('skill_search_empty_feedback', async () => { await info.getByLabel('取得したcatalogを検索').fill('DEMO-NO-MATCH'); await info.getByText('この取得範囲に一致する項目はありません。', { exact: true }).waitFor(); }, async () => []);
      await info.getByLabel('取得したcatalogを検索').fill('DEMO Skill'); await info.getByRole('button', { name: '下書きへ挿入', exact: true }).waitFor();
      await operation('skill_insert_only_preserves_draft', async () => { await page.locator('#remote-input').evaluate(node => { node.setSelectionRange(node.value.length,node.value.length); }); await info.getByRole('button', { name: '下書きへ挿入', exact: true }).click(); }, async (before, after) => after.draft?.length > (before.draft?.length || 0) && fixture.state.submissions === 0 ? [] : ['skill_draft_insert_no_effect_or_auto_submit']);
      // The panel remains open after insertion in the baseline; close explicitly.
      if (await info.count()) await info.getByRole('button', { name: '閉じる', exact: true }).click();
      await menu('モデル・実行情報'); witness.fail('remote.info.models');
      await operation('information_error_visible', async () => { await info.getByRole('button', { name: '現在の情報を再取得', exact: true }).click(); await info.getByRole('alert').waitFor(); }, async () => await info.getByRole('alert').count() ? [] : ['read_error_has_no_visible_feedback']);
      witness.fail('remote.info.models', false);
      await operation('information_manual_error_recovery', async () => { await info.getByRole('button', { name: '現在の情報を再取得', exact: true }).click(); await wait(() => info.getByRole('button', { name: '現在の情報を再取得', exact: true }).isEnabled(), 'read_error_recovery'); }, async () => await info.getByRole('alert').count() ? ['manual_read_recovery_keeps_stale_error'] : []);
      await info.getByRole('button', { name: '実行状況', exact: true }).click();
      await operation('activity_open_current_conversation', () => info.getByRole('button', { name: 'この会話を開く', exact: true }).click(), async () => await page.locator('#remote-input').count() ? [] : ['activity_open_no_conversation_response']);
      await closeDialogs(); await capture('03-information-checked');
    });
    await workflow('I-FILES_ARTIFACTS_LOADING_SAVE_ERROR_EMPTY', async () => {
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT); await menu('プロジェクトのファイル');
      const files = page.getByRole('dialog', { name: '登録projectのファイル', exact: true });
      await operation('files_refresh_roots', async () => { await files.getByRole('button', { name: '登録先を再取得', exact: true }).click(); await files.getByRole('button', { name: 'DEMO 登録作業先 / DEMO-folder', exact: true }).waitFor(); }, async (_before, _after, row) => row.rpcMethods.includes('remote.files.roots') ? [] : ['root_refresh_missing_read']);
      await operation('files_open_root', () => files.getByRole('button', { name: 'DEMO 登録作業先 / DEMO-folder', exact: true }).click(), async () => { await files.getByRole('button', { name: 'DEMO-file.md', exact: true }).waitFor(); return []; });
      await operation('files_directory_navigation', () => files.getByRole('button', { name: 'フォルダー: DEMO-folder', exact: true }).click(), async () => { await files.getByRole('button', { name: 'DEMO-child.md', exact: true }).waitFor(); return []; });
      await operation('files_parent_navigation', () => files.getByRole('button', { name: '上のフォルダーへ', exact: true }).click(), async () => { await files.getByRole('button', { name: 'DEMO-file.md', exact: true }).waitFor(); return []; });
      await operation('files_refresh_listing', () => files.getByRole('button', { name: 'この一覧を再取得', exact: true }).click(), async (_before, _after, row) => row.rpcMethods.includes('remote.files.list') ? [] : ['list_refresh_missing_read']);
      await operation('files_disabled_entry_reason', async row => { row.disabled = await files.getByRole('button', { name: 'DEMO-too-large.md', exact: true }).isDisabled(); }, async () => await files.getByText(/1MiBの上限超過/).count() ? [] : ['disabled_file_has_no_capacity_reason']);
      witness.hold('remote.files.read');
      await operation('files_loading_double_click', async row => {
        await files.getByRole('button', { name: 'DEMO-file.md', exact: true }).dblclick(); await files.getByText('読み取り中…', { exact: true }).waitFor();
        row.during = { busy: await files.getByRole('region', { name: 'ファイルの一覧と内容' }).getAttribute('aria-busy'), sameRowEnabled: await files.getByRole('button', { name: 'DEMO-file.md', exact: true }).isEnabled() };
        witness.release('remote.files.read'); await files.getByRole('heading', { name: 'DEMO_FILE_ONLY', exact: true }).waitFor();
      }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'remote.files.read').length === 1 ? [] : ['repeated_file_open_sends_parallel_duplicate_reads']);
      const preview = files.getByRole('region', { name: 'ファイルの内容', exact: true });
      await operation('file_save_confirmation_cancel', async () => { await preview.getByRole('button', { name: 'ファイルを保存', exact: true }).click(); const confirm = preview.getByRole('group', { name: 'ファイル保存の確認', exact: true }); await confirm.getByRole('button', { name: '取消', exact: true }).click(); }, async () => await preview.getByRole('group', { name: 'ファイル保存の確認', exact: true }).count() ? ['file_save_cancel_did_not_close'] : []);
      await operation('file_explicit_download', async row => { await preview.getByRole('button', { name: 'ファイルを保存', exact: true }).click(); const pending = page.waitForEvent('download'); await preview.getByRole('group', { name: 'ファイル保存の確認', exact: true }).getByRole('button', { name: '保存を開始', exact: true }).click(); const download = await pending; row.downloadRequested = Boolean(download.suggestedFilename()); }, async (_before, _after, row) => row.downloadRequested && await preview.getByText(/ブラウザへ保存を依頼/).count() ? [] : ['file_explicit_save_has_no_download_feedback']);
      await operation('file_preview_back', () => preview.getByRole('button', { name: '一覧へ戻る', exact: true }).click(), async () => await files.getByRole('button', { name: 'DEMO-file.md', exact: true }).count() ? [] : ['preview_back_did_not_return_to_list']);
      witness.fail('remote.files.read');
      await operation('file_read_error_visible', async () => { await files.getByRole('button', { name: 'DEMO-file.md', exact: true }).click(); await files.getByRole('alert').waitFor(); }, async () => await files.getByRole('alert').count() ? [] : ['file_read_failure_silent']);
      witness.fail('remote.files.read', false); await files.getByRole('button', { name: 'この一覧を再取得', exact: true }).click();
      await files.getByRole('button', { name: '閉じる', exact: true }).click(); await menu('成果物');
      const artifacts = page.getByRole('dialog', { name: 'この会話の成果物', exact: true });
      await operation('artifact_refresh', () => artifacts.getByRole('button', { name: '成果物を再取得', exact: true }).click(), async (_before, _after, row) => row.rpcMethods.includes('remote.artifacts.list') ? [] : ['artifact_refresh_missing_read']);
      await operation('artifact_open_correct_content', async () => { await artifacts.getByRole('button', { name: 'DEMO 正式成果物.md', exact: true }).click(); await artifacts.getByRole('heading', { name: 'DEMO_ARTIFACT_ONLY', exact: true }).waitFor(); }, async () => await artifacts.getByText(/DEMO_FILE_ONLY/).count() ? ['previous_file_content_leaked_into_artifact'] : []);
      await artifacts.getByRole('button', { name: '一覧へ戻る', exact: true }).click(); witness.empty('remote.artifacts.list');
      await operation('artifact_empty_feedback', async () => { await artifacts.getByRole('button', { name: '成果物を再取得', exact: true }).click(); await artifacts.getByText(/取得した範囲に正式登録された成果物なし/).waitFor(); }, async () => []);
      witness.empty('remote.artifacts.list', false); await artifacts.getByRole('button', { name: '成果物を再取得', exact: true }).click();
      await capture('04-files-artifact-interactions'); await artifacts.getByRole('button', { name: '閉じる', exact: true }).click();
    });
    await workflow('I-PERSONAL_TEMPLATE_CRUD_AND_CONFIRMATION', async () => {
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT); await click('入力の補助'); await click('個人用定型文');
      const dialog = page.getByRole('dialog', { name: '個人用定型文', exact: true }); await dialog.getByRole('button', { name: 'DEMO 既存定型文を編集', exact: true }).waitFor();
      await operation('template_existing_delete_cancel', async () => { await dialog.getByRole('button', { name: 'DEMO 既存定型文を削除', exact: true }).click(); await page.getByRole('dialog', { name: '定型文の削除確認', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); }, async (_before, _after, row) => !row.rpcMethods.includes('remote.templates.remove') && await dialog.getByRole('button', { name: 'DEMO 既存定型文を編集', exact: true }).count() === 1 ? [] : ['existing_template_cancel_lost_row']);
      await operation('template_edit_existing', () => dialog.getByRole('button', { name: 'DEMO 既存定型文を編集', exact: true }).click(), async () => await dialog.getByLabel('名前', { exact: true }).inputValue() === 'DEMO 既存定型文' ? [] : ['template_editor_no_current_value']);
      await operation('template_cancel_edit', () => dialog.getByRole('button', { name: '編集を取り消す', exact: true }).click(), async () => await dialog.getByLabel('名前', { exact: true }).inputValue() === '' ? [] : ['template_edit_cancel_keeps_wrong_state']);
      await dialog.getByLabel('名前', { exact: true }).fill('DEMO C 新定型文'); await dialog.getByLabel('分類', { exact: true }).fill('DEMO'); await dialog.getByLabel('本文').fill('DEMO 新しい定型文の本文。');
      witness.hold('remote.templates.put');
      await operation('template_create_loading_single_write', async row => { await dialog.getByRole('button', { name: '定型文を保存', exact: true }).dblclick(); await dialog.getByText('保存結果を確認中…', { exact: true }).waitFor(); row.closeDisabled = await dialog.getByRole('button', { name: '閉じる', exact: true }).isDisabled(); witness.release('remote.templates.put'); await dialog.getByRole('button', { name: 'DEMO C 新定型文を編集', exact: true }).waitFor(); }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'remote.templates.put').length === 1 && row.closeDisabled ? [] : ['template_busy_or_duplicate_write_guard_missing']);
      await dialog.getByRole('button', { name: 'DEMO C 新定型文を編集', exact: true }).click(); await dialog.getByLabel('本文').fill('DEMO 編集後の定型文。');
      await operation('template_update_readback', async () => { await dialog.getByRole('button', { name: '定型文を保存', exact: true }).click(); await dialog.getByRole('heading', { name: '定型文を追加', exact: true }).waitFor(); }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'remote.templates.put').length === 1 ? [] : ['template_update_no_exact_write']);
      await operation('template_delete_confirmation_cancel', async () => { await dialog.getByRole('button', { name: 'DEMO C 新定型文を削除', exact: true }).click(); await page.getByRole('dialog', { name: '定型文の削除確認', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); }, async (_before, _after, row) => row.rpcMethods.includes('remote.templates.remove') || !await dialog.getByRole('button', { name: 'DEMO C 新定型文を削除', exact: true }).count() ? ['template_cancel_deleted_or_lost_row'] : []);
      await operation('template_delete_explicit', async () => { await dialog.getByRole('button', { name: 'DEMO C 新定型文を削除', exact: true }).click(); await page.getByRole('dialog', { name: '定型文の削除確認', exact: true }).getByRole('button', { name: 'この定型文を削除', exact: true }).click(); await wait(async () => !await dialog.getByRole('button', { name: 'DEMO C 新定型文を削除', exact: true }).count(), 'template_delete_readback'); }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'remote.templates.remove').length === 1 ? [] : ['explicit_template_delete_no_exact_write']);
      await operation('template_insert_memory_only', () => dialog.getByRole('button', { name: '下書きへ挿入', exact: true }).click(), async (before, after) => after.draft?.length > before.draft?.length && fixture.state.submissions === 0 ? [] : ['template_insert_lost_draft_or_no_effect']);
    });
    await workflow('I-MESSAGE_COPY_QUOTE_BRANCH_AND_DEVICE_SPEECH', async () => {
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT);
      const more = page.getByRole('button', { name: 'Hermesのメッセージ操作', exact: true }).last();
      await operation('code_copy_feedback', async row => { const offset = await page.evaluate(() => window.__DEMO_clipboard_counts.calls); await page.getByRole('button', { name: 'コードをコピー', exact: true }).last().click(); await settleFrames(page, 8); row.clipboardCalls = await page.evaluate(() => window.__DEMO_clipboard_counts.calls) - offset; row.feedbackSpanLengths = await page.locator('.remote-code-actions [role="status"]').evaluateAll(nodes => nodes.map(node => node.textContent.length)); }, async (_before, _after, row) => row.clipboardCalls === 1 && await page.locator('.remote-code-actions').getByText('コピーしました', { exact: true }).count() ? [] : ['code_copy_has_no_feedback']);
      await more.click(); const message = page.getByRole('dialog', { name: 'メッセージの操作', exact: true });
      await operation('message_copy_feedback', () => message.getByRole('button', { name: 'メッセージをコピー', exact: true }).click(), async () => await message.getByText('コピーしました', { exact: true }).count() ? [] : ['message_copy_has_no_feedback']);
      await operation('message_quote_open', () => message.getByRole('button', { name: '引用して質問', exact: true }).click(), async () => await page.getByRole('dialog', { name: '引用して質問', exact: true }).count() ? [] : ['quote_did_not_open']);
      await operation('quote_insert_draft_only', () => page.getByRole('dialog', { name: '引用して質問', exact: true }).getByRole('button', { name: '下書きへ挿入', exact: true }).click(), async (before, after) => after.draft?.length > before.draft?.length && after.focus.id === 'remote-input' && fixture.state.submissions === 0 ? [] : ['quote_insert_draft_or_focus_missing']);
      await more.click(); await message.getByRole('button', { name: '端末で読み上げ', exact: true }).click(); const speech = page.getByRole('dialog', { name: '端末で読み上げ', exact: true });
      await operation('device_speech_explicit_synthetic_start', () => speech.getByRole('button', { name: '端末で読み上げ', exact: true }).click(), async () => await speech.getByRole('button', { name: '読み上げを停止', exact: true }).isEnabled() ? [] : ['synthetic_tts_no_running_feedback']);
      await operation('device_speech_explicit_stop', () => speech.getByRole('button', { name: '読み上げを停止', exact: true }).click(), async () => await speech.getByRole('button', { name: '読み上げを停止', exact: true }).isDisabled() ? [] : ['synthetic_tts_stop_no_state_change']);
      await speech.getByRole('button', { name: '閉じる', exact: true }).click();
      for (const [target, choice] of [['Hermesのメッセージ操作', 'ここから分岐'], ['Hermesのメッセージ操作', '再生成用に分岐'], ['あなたのメッセージ操作', '編集して分岐']]) {
        await page.getByRole('button', { name: target, exact: true }).last().click(); await message.getByRole('button', { name: choice, exact: true }).click();
        const branch = page.getByRole('dialog', { name: '元の会話を残して分岐', exact: true });
        await operation(`branch_${choice}_draft_guard_and_cancel`, async row => { row.disabled = await branch.getByRole('button', { name: '分岐を作成して下書きを開く', exact: true }).isDisabled(); await branch.getByRole('button', { name: '取消', exact: true }).click(); }, async (_before, after, row) => row.disabled && !row.rpcMethods.includes('remote.session.branch_from_row') && after.draft?.length ? [] : ['branch_cancel_or_existing_draft_guard_missing']);
      }
      await click('入力の補助'); await click('音声入力・読み上げ'); const voice = page.getByRole('dialog', { name: '音声入力', exact: true });
      await operation('synthetic_voice_start', () => voice.getByRole('button', { name: '音声認識を開始', exact: true }).click(), async () => await voice.getByRole('button', { name: '録音を停止', exact: true }).isEnabled() ? [] : ['synthetic_recognition_no_listening_feedback']);
      await operation('synthetic_voice_stop_preview', async () => { await voice.getByRole('button', { name: '録音を停止', exact: true }).click(); await voice.getByLabel('認識結果を編集').waitFor(); await wait(() => voice.getByLabel('認識結果を編集').isEnabled(), 'recognition_final_preview'); }, async () => await voice.getByLabel('認識結果を編集').inputValue() === 'DEMO 合成音声の文章' ? [] : ['recognition_preview_not_fixed']);
      await voice.getByLabel('認識結果を編集').fill('DEMO 編集済み合成音声。');
      await operation('synthetic_voice_explicit_insert_only', () => voice.getByRole('button', { name: '文章を入力欄へ挿入', exact: true }).click(), async (before, after) => after.draft?.length > before.draft?.length && fixture.state.submissions === 0 ? [] : ['voice_insert_no_draft_effect_or_auto_submit']);
    });
    await workflow('I-QUICK_TEMPLATES_AND_LOCAL_ATTACHMENTS', async () => {
      await conversation();
      for (const name of ['要約', '判断', '手順', '調査のみ']) {
        await page.locator('#remote-input').fill(DEMO_DRAFT); await click('入力の補助');
        await operation(`fixed_quick_template_${name}`, () => page.locator('.remote-quick-text').filter({ hasText: name }).click(), async (before, after) => after.draft?.length > before.draft?.length && after.focus.id === 'remote-input' && !after.dialogs.includes('入力の補助') ? [] : ['quick_template_no_insert_close_focus']);
      }
      await page.locator('#remote-input').fill(DEMO_DRAFT); await click('入力の補助');
      await operation('composer_privacy_details_expand', () => page.getByText('画像の扱い', { exact: true }).click(), async () => await page.getByRole('dialog', { name: '入力の補助', exact: true }).locator('details[open]').count() ? [] : ['composer_details_no_expansion']);
      await operation('local_png_select_preview_only', async () => {
        const chooser = page.waitForEvent('filechooser'); await click('画像を追加'); await (await chooser).setFiles({ name: 'DEMO.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZsAAAAASUVORK5CYII=', 'base64') }); await page.getByRole('button', { name: '画像の選択を取消', exact: true }).waitFor();
      }, async (_before, _after, row) => row.rpcMethods.some(method => method === 'image.attach_bytes' || method === 'prompt.submit') ? ['local_selection_wrote_to_server'] : []);
      await operation('local_image_cancel_keeps_draft', () => click('画像の選択を取消'), async (before, after) => before.draft?.sha256 === after.draft?.sha256 && !await page.getByRole('button', { name: '画像の選択を取消', exact: true }).count() ? [] : ['image_cancel_lost_draft_or_attachment']);
      await click('入力の補助');
      await operation('local_document_select_preview_only', async () => {
        const chooser = page.waitForEvent('filechooser'); await click('資料を追加'); await (await chooser).setFiles({ name: 'DEMO.txt', mimeType: 'text/plain', buffer: Buffer.from('DEMO 端末内だけの資料です。') }); await page.getByRole('button', { name: '添付を外す', exact: true }).waitFor();
      }, async (_before, _after, row) => row.rpcMethods.includes('prompt.submit') ? ['local_document_selection_submitted'] : []);
      await operation('local_document_cancel_keeps_draft', () => click('添付を外す'), async (before, after) => before.draft?.sha256 === after.draft?.sha256 && !await page.getByRole('button', { name: '添付を外す', exact: true }).count() ? [] : ['document_cancel_lost_draft_or_attachment']);
      await capture('05-local-attachment-controls');
    });
    await workflow('I-ORGANIZE_PAGINATION_AND_PROJECT_CONFIRM', async () => {
      await conversation(); await page.locator('#remote-input').fill(''); await menu('名前・ピン・アーカイブ');
      const organize = page.getByRole('dialog', { name: '会話の整理', exact: true }); await wait(() => organize.getByRole('button', { name: 'ピン留め', exact: true }).isEnabled(), 'organization_metadata_ready');
      await organize.getByLabel('会話名', { exact: true }).fill('DEMO 検修後の会話名'); witness.hold('remote.session.organize');
      await operation('organization_name_loading_and_escape', async row => {
        await organize.getByRole('button', { name: '名前を保存', exact: true }).dblclick(); await organize.getByText('変更結果を確認中…', { exact: true }).waitFor();
        row.busy = await organize.getByRole('button', { name: '閉じる', exact: true }).isDisabled(); await organize.press('Escape'); row.keptWhileBusy = await organize.count();
        witness.release('remote.session.organize'); await wait(() => organize.getByRole('button', { name: '閉じる', exact: true }).isEnabled(), 'organization_name_ack');
      }, async (_before, _after, row) => row.busy && row.keptWhileBusy && row.rpcMethods.filter(method => method === 'remote.session.organize').length === 1 ? [] : ['organization_busy_escape_or_duplicate_write_guard']);
      for (const [label, next] of [['ピン留め','ピンを外す'],['ピンを外す','ピン留め'],['アーカイブ','アーカイブから復帰'],['アーカイブから復帰','アーカイブ']]) {
        await operation(`organization_${label}`, async () => { await organize.getByRole('button', { name: label, exact: true }).click(); await organize.getByRole('button', { name: next, exact: true }).waitFor(); }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'remote.session.organize').length === 1 ? [] : ['organization_change_no_exact_write']);
      }
      witness.fail('remote.session.organize'); await operation('organization_error_revalidate', async () => { await organize.getByRole('button', { name: 'ピン留め', exact: true }).click(); await organize.getByRole('alert').waitFor(); }, async () => await organize.getByRole('button', { name: '最新の状態を取得', exact: true }).count() ? [] : ['organization_error_no_manual_revalidate']);
      witness.fail('remote.session.organize', false); await operation('organization_manual_revalidate', async () => { await organize.getByRole('button', { name: '最新の状態を取得', exact: true }).click(); await wait(() => organize.getByRole('button', { name: 'ピン留め', exact: true }).isEnabled(), 'organization_revalidate'); }, async () => await organize.getByRole('alert').count() ? ['organization_revalidate_keeps_error'] : []);
      await organize.getByRole('button', { name: '閉じる', exact: true }).click(); await list(); const history = page.getByRole('region', { name: '過去の会話', exact: true });
      await operation('history_date_and_selection_controls', async row => { const offset = witness.methods.length; await history.getByLabel('開始日', { exact: true }).fill('2026-10-01'); await history.getByLabel('終了日', { exact: true }).fill('2026-10-07'); await history.getByLabel('project').selectOption('DEMO-plan'); await history.getByLabel('表示').selectOption('all'); row.readsBeforeExplicitSearch = witness.methods.slice(offset).filter(method => method === 'remote.sessions.list').length; }, async (_before, _after, row) => row.readsBeforeExplicitSearch === 0 && await history.getByLabel('表示').inputValue() === 'all' ? [] : ['filter_edit_auto_fetches_or_value_missing']);
      await operation('history_explicit_search_loading', async row => { witness.hold('remote.sessions.list'); await history.getByRole('button', { name: '条件を指定して取得', exact: true }).dblclick(); await history.getByText('取得中…', { exact: true }).waitFor(); row.disabled = await history.getByRole('button', { name: '条件を指定して取得', exact: true }).isDisabled(); witness.release('remote.sessions.list'); await wait(() => history.getByRole('button', { name: '条件を指定して取得', exact: true }).isEnabled(), 'history_search_ack'); }, async (_before, _after, row) => row.disabled && row.rpcMethods.filter(method => method === 'remote.sessions.list').length === 1 ? [] : ['history_loading_or_single_search_missing']);
      await operation('history_next_page', async () => { await history.getByRole('button', { name: '次の50件を取得', exact: true }).click(); await history.getByText('DEMO 第二ページ', { exact: false }).first().waitFor(); }, async () => await history.locator('ul>li').count() === 2 && !await history.getByRole('button', { name: '次の50件を取得', exact: true }).count() ? [] : ['pagination_no_append_or_stale_next_button']);
      await history.getByLabel('タイトル', { exact: true }).fill('DEMO-NO-MATCH'); await operation('history_no_results_feedback', async () => { await history.getByRole('button', { name: '条件を指定して取得', exact: true }).click(); await history.getByText('この取得範囲の会話はありません。', { exact: true }).waitFor(); }, async () => []);
      await history.getByLabel('タイトル', { exact: true }).fill(''); await history.getByRole('button', { name: '条件を指定して取得', exact: true }).click();
      await operation('history_row_organize_action', async () => { await history.getByRole('button', { name: 'DEMO 検修後の会話名を整理', exact: true }).click(); await organize.waitFor(); }, async () => await organize.getByLabel('会話名').inputValue() === 'DEMO 検修後の会話名' ? [] : ['history_row_organize_wrong_context']);
      await organize.getByRole('button', { name: '閉じる', exact: true }).click();
      await page.getByLabel('作業先').selectOption('DEMO-plan'); await operation('project_new_session_confirmation_cancel', async () => { await click('この作業先で新規会話'); await page.getByRole('dialog', { name: '新規会話の作業先', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); }, async (_before, _after, row) => row.rpcMethods.includes('remote.project.create_session') ? ['project_cancel_created_session'] : []);
      await operation('project_new_session_confirm_exact', async () => { await click('この作業先で新規会話'); await page.getByRole('dialog', { name: '新規会話の作業先', exact: true }).getByRole('button', { name: '確認して新規会話', exact: true }).click(); await page.locator('#remote-input').waitFor(); }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'remote.project.create_session').length === 1 && !row.rpcMethods.includes('prompt.submit') ? [] : ['project_create_no_exact_reply_or_auto_submit']);
    });
    await workflow('I-SIDEBAR_PROFILE_FILTER_AND_RECONNECT', async () => {
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT); await menu('セッションを選ぶ'); const sidebar = page.getByRole('dialog', { name: 'セッション管理', exact: true });
      await operation('sidebar_busy_new_session_guard', async row => { row.disabled = await sidebar.getByRole('button', { name: 'サイドバーから新規会話', exact: true }).isDisabled(); }, async (_before, _after, row) => row.disabled && await sidebar.getByRole('status').count() ? [] : ['sidebar_busy_guard_has_no_reason']);
      await operation('sidebar_project_refresh', () => sidebar.getByRole('button', { name: 'プロジェクトを再取得', exact: true }).click(), async (_before, _after, row) => row.rpcMethods.includes('projects.tree') ? [] : ['sidebar_refresh_no_request']);
      for (const label of await sidebar.locator('.remote-sidebar-projects button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))) {
        await operation(`sidebar_project_${label}`, async () => { await sidebar.getByRole('button', { name: label, exact: true }).click(); await wait(async () => await sidebar.locator('.remote-sidebar-content').getAttribute('data-project-status') !== 'loading', 'sidebar_project_read'); }, async (_before, _after, row) => row.rpcMethods.includes('projects.project_sessions') ? [] : ['project_click_no_scoped_read']);
      }
      await operation('sidebar_recent_filter', () => sidebar.getByRole('button', { name: /最近の会話/ }).click(), async () => await sidebar.getByRole('button', { name: /最近の会話/ }).getAttribute('aria-pressed') === 'true' ? [] : ['recent_filter_not_selected']);
      await sidebar.getByLabel('サイドバーの会話を検索', { exact: true }).fill('DEMO-NO-MATCH'); await operation('sidebar_search_empty', async () => { await sidebar.getByText('一致する会話はありません。', { exact: true }).waitFor(); }, async () => await sidebar.getByRole('region', { name: 'サイドバーのセッション一覧', exact: true }).locator('ul>li button').count() ? ['sidebar_search_keeps_unmatched_rows'] : []);
      await sidebar.getByLabel('サイドバーの会話を検索', { exact: true }).fill(''); await operation('sidebar_current_return', () => sidebar.getByRole('button', { name: '開いている会話を表示', exact: true }).click(), async () => !await sidebar.count() && await page.locator('#remote-input').inputValue() === DEMO_DRAFT ? [] : ['sidebar_current_return_lost_draft_or_not_closed']);
      await menu('セッションを選ぶ'); await operation('sidebar_explicit_close', () => sidebar.getByRole('button', { name: 'サイドバーを閉じる', exact: true }).click(), async () => !await sidebar.count() ? [] : ['sidebar_close_no_effect']);
      await page.locator('#remote-input').fill(''); await list();
      await operation('profile_switch_secondary', async () => { await page.getByLabel('登録profile', { exact: true }).selectOption('DEMO-secondary'); await waitProfileReady('DEMO-secondary'); }, async () => await page.getByRole('region', { name: '過去の会話', exact: true }).count() ? [] : ['profile_switch_no_list_response']);
      await operation('profile_restore_default', async () => { await page.getByLabel('登録profile', { exact: true }).selectOption('default'); await waitProfileReady('default'); }, async () => []);
      await click('設定'); await operation('reconnect_explicit_read_only', async () => { await click('再接続して同期'); await page.locator('[data-connection="connected"]').first().waitFor(); }, async (_before, _after, row) => row.rpcMethods.includes('session.events.since') || row.rpcMethods.includes('session.list') || row.rpcMethods.includes('remote.sessions.list') ? [] : ['reconnect_no_authoritative_read']);
    });
    await workflow('I-SETTINGS_SCROLL_THEME_SYNTHETIC_STORAGE_CONNECTIONS_AND_PUSH', async () => {
      await conversation(); await page.locator('#remote-input').fill(''); await list(); await wait(() => page.getByRole('region', { name: '過去の会話', exact: true }).getByRole('button', { name: '条件を指定して取得', exact: true }).isEnabled(), 'list_before_settings_ready'); const savedListScroll = await page.locator('.remote-main').evaluate(node => node.scrollTop); await click('設定');
      await operation('theme_dark_switch', () => page.getByLabel('表示テーマ').selectOption('dark'), async () => await page.locator('html').getAttribute('data-theme') === 'dark' ? [] : ['theme_choice_no_applied_feedback']);
      await operation('theme_light_restore', () => page.getByLabel('表示テーマ').selectOption('light'), async () => await page.locator('html').getAttribute('data-theme') === 'light' ? [] : ['theme_restore_no_applied_feedback']);
      await operation('settings_diagnostic_disclosure', () => page.getByText('アプリと接続の詳細', { exact: true }).click(), async () => await page.locator('.remote-diagnostic-details[open]').count() ? [] : ['settings_details_no_expansion']);
      const storage = page.getByRole('region', { name: '端末の暗号化保存', exact: true });
      await storage.getByLabel('端末保存のパスフレーズ', { exact: true }).fill('DEMO-interaction-passphrase-only');
      await operation('synthetic_storage_prepare_real_crypto', async () => { await storage.getByRole('button', { name: '暗号化保存を準備', exact: true }).click(); await storage.getByLabel('未送信下書きを暗号化して保持').waitFor(); }, async () => !await storage.getByLabel('未送信下書きを暗号化して保持').isChecked() && !await storage.getByLabel('選んだ履歴をオフラインで閲覧').isChecked() ? [] : ['storage_setup_auto_opted_in']);
      await operation('synthetic_history_explicit_opt_in', async () => { await storage.getByLabel('選んだ履歴をオフラインで閲覧').click(); await wait(() => storage.getByLabel('選んだ履歴をオフラインで閲覧').isChecked(), 'history_optin'); }, async () => await storage.getByRole('button', { name: '現在取得済みの履歴を端末へ保存', exact: true }).isEnabled() ? [] : ['history_optin_no_save_enabled']);
      await operation('synthetic_history_explicit_save', async () => { await storage.getByRole('button', { name: '現在取得済みの履歴を端末へ保存', exact: true }).click(); await storage.getByRole('button', { name: '保存履歴を閲覧', exact: true }).first().waitFor(); }, async () => await storage.getByRole('button', { name: '保存履歴を閲覧', exact: true }).count() ? [] : ['history_save_no_visible_entry']);
      await operation('synthetic_history_view_and_next_page', async row => { await storage.getByRole('button', { name: '保存履歴を閲覧', exact: true }).first().click(); const history = page.getByRole('dialog', { name: '端末に保存した履歴', exact: true }); await history.waitFor(); row.firstCount = await history.locator('.remote-message').count(); const more = history.getByRole('button', { name: '次の50発言を表示', exact: true }); if (await more.count()) { await more.click(); row.finalCount = await history.locator('.remote-message').count(); } await history.getByRole('button', { name: '閉じる', exact: true }).click(); }, async (_before, _after, row) => row.finalCount > row.firstCount ? [] : ['saved_history_pagination_no_effect']);
      await operation('synthetic_history_remove_owned', async () => { await storage.getByRole('button', { name: '履歴を消去', exact: true }).first().click(); await wait(async () => !await storage.getByRole('button', { name: '保存履歴を閲覧', exact: true }).count(), 'local_history_remove'); }, async () => []);
      await operation('synthetic_storage_lock', () => storage.getByRole('button', { name: '保存を施錠', exact: true }).click(), async () => await storage.getByRole('button', { name: '保存を解錠', exact: true }).count() ? [] : ['storage_lock_keeps_unlocked_controls']);
      await storage.getByLabel('端末保存のパスフレーズ', { exact: true }).fill('DEMO-interaction-passphrase-only'); await operation('synthetic_storage_unlock', async () => { await storage.getByRole('button', { name: '保存を解錠', exact: true }).click(); await storage.getByLabel('選んだ履歴をオフラインで閲覧').waitFor(); }, async () => await storage.getByLabel('選んだ履歴をオフラインで閲覧').isChecked() ? [] : ['storage_unlock_lost_enabled_state']);
      await operation('synthetic_storage_clear_cancel', async () => { await storage.getByRole('button', { name: 'このアプリの暗号化保存を全て消去', exact: true }).click(); await page.getByRole('dialog', { name: '暗号化保存を消去', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); }, async () => await storage.getByRole('button', { name: '保存を施錠', exact: true }).count() ? [] : ['local_clear_cancel_lost_keys']);
      await operation('synthetic_storage_clear_explicit_owned_namespace', async () => { await storage.getByRole('button', { name: 'このアプリの暗号化保存を全て消去', exact: true }).click(); await page.getByRole('dialog', { name: '暗号化保存を消去', exact: true }).getByRole('button', { name: '暗号化保存を消去', exact: true }).click(); await storage.getByRole('button', { name: '暗号化保存を準備', exact: true }).waitFor(); }, async () => await storage.getByRole('button', { name: '保存を施錠', exact: true }).count() ? ['local_clear_keeps_unlocked_secret_store'] : []);
      const connections = page.getByRole('region', { name: '別接続先', exact: true });
      await connections.getByLabel('HTTPS接続先', { exact: true }).fill(fixture.origin.replace(/:\d+$/, ':1')); await connections.getByLabel('表示名', { exact: true }).fill('DEMO 同ホスト禁止例'); await connections.getByLabel('自分が利用を許可された接続先です', { exact: true }).check();
      await operation('same_host_connection_refusal_visible', async () => { await connections.getByRole('button', { name: '接続先を登録', exact: true }).click(); await connections.getByRole('status').waitFor(); }, async () => await connections.getByRole('button', { name: '登録解除', exact: true }).count() ? ['same_host_endpoint_was_registered'] : []);
      await connections.getByLabel('HTTPS接続先', { exact: true }).fill('https://localhost:9443'); await connections.getByLabel('表示名', { exact: true }).fill('DEMO 独立ローカル候補');
      await operation('synthetic_connection_register_metadata_only', async () => { await connections.getByRole('button', { name: '接続先を登録', exact: true }).click(); await connections.getByRole('button', { name: '登録解除', exact: true }).waitFor(); }, async (_before, _after, row) => !row.rpcMethods.length ? [] : ['endpoint_registration_wrote_remote_state']);
      await operation('connection_navigation_confirmation_cancel', async () => { await connections.getByRole('button', { name: '別接続先を開く', exact: true }).click(); await page.getByRole('dialog', { name: '別接続先へ移動', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); }, async () => new URL(page.url()).origin === fixture.origin ? [] : ['connection_cancel_navigated']);
      await operation('connection_remove_metadata_only', async () => { await connections.getByRole('button', { name: '登録解除', exact: true }).click(); await wait(async () => !await connections.getByRole('button', { name: '登録解除', exact: true }).count(), 'connection_unregister'); }, async () => []);
      const notifications = page.getByRole('region', { name: 'この会話の通知', exact: true });
      await operation('notification_unsupported_explicit_reason', async row => { row.enableDisabled = await notifications.getByRole('button', { name: 'この会話の通知を有効にする', exact: true }).isDisabled(); row.disableDisabled = await notifications.getByRole('button', { name: 'この会話の通知を解除', exact: true }).isDisabled(); }, async (_before, _after, row) => row.enableDisabled && row.disableDisabled && await notifications.getByText(/通知を利用できません/).count() ? [] : ['unsupported_push_has_no_disabled_reason']);
      await operation('notification_status_refresh_read_only', async () => { const offset = witness.methods.length; await notifications.getByRole('button', { name: '登録状態を再取得', exact: true }).click(); await wait(async () => witness.methods.slice(offset).includes('remote.notifications.status') || await notifications.getByText('このブラウザ・接続先はWeb Pushに未対応です。', { exact: true }).count() === 1, 'notification_read_or_unsupported_witness'); await wait(() => notifications.getByRole('button', { name: '登録状態を再取得', exact: true }).isEnabled(), 'push_status_ready'); }, async (_before, _after, row) => (row.rpcMethods.includes('remote.notifications.status') || await notifications.getByText('このブラウザ・接続先はWeb Pushに未対応です。', { exact: true }).count() === 1) && !row.rpcMethods.some(method => /subscribe|detach|prompt/.test(method)) ? [] : ['push_refresh_not_read_only']);
      await page.locator('.remote-main').evaluate(node => { node.scrollTop = node.scrollHeight; });
      await operation('main_tab_scroll_not_carried_to_list', () => click('会話'), async (_before, after, row) => { row.expectedListScroll = savedListScroll; const maximum = await page.locator('.remote-main').evaluate(node => node.scrollHeight-node.clientHeight); return Math.abs(after.mainScroll-Math.min(savedListScroll,maximum))<=1 ? [] : ['main_page_scroll_memory_not_restored']; });
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT); await capture('06-final-before-composer');
    });
    await workflow('I-MARKDOWN_DOWNLOAD_AND_NATIVE_KEYBOARD', async () => {
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT);
      await operation('keyboard_dismiss_preserves_draft', async () => { await page.locator('#remote-input').focus(); await click('キーボードを閉じる'); }, async (before, after) => after.focus.id !== 'remote-input' && after.draft?.sha256 === before.draft?.sha256 ? [] : ['keyboard_dismiss_lost_draft_or_keeps_focus']);
      await menu('会話をMarkdownで保存'); const saving = page.getByRole('dialog', { name: '会話のMarkdown保存', exact: true });
      await operation('markdown_cancel_no_download_or_write', () => saving.getByRole('button', { name: 'キャンセル', exact: true }).click(), async (_before, after, row) => !after.dialogs.includes('会話のMarkdown保存') && !row.rpcMethods.length ? [] : ['markdown_cancel_did_not_close_or_wrote']);
      await menu('会話をMarkdownで保存');
      await operation('markdown_explicit_download', async row => { const pending = page.waitForEvent('download'); await saving.getByRole('button', { name: '確認してファイルを保存', exact: true }).click(); row.browserDownload = Boolean((await pending).suggestedFilename()); }, async (_before, _after, row) => row.browserDownload && await saving.getByRole('button', { name: '確認してファイルを保存', exact: true }).isDisabled() ? [] : ['markdown_download_no_feedback_or_allows_duplicate']);
      await saving.getByRole('button', { name: '閉じる', exact: true }).click();
      await menu('再同期'); await operation('conversation_resync_preserves_local_draft', async () => { await page.locator('[data-connection="connected"]').first().waitFor(); }, async () => await page.locator('#remote-input').inputValue() === DEMO_DRAFT ? [] : ['manual_sync_lost_draft']);
    });
    await workflow('I-SYNTHETIC_SEND_STOP_AND_REQUEST_RESPONSE', async () => {
      await conversation(); await page.locator('#remote-input').fill('DEMO hold synthetic UI only'); await wait(() => page.getByRole('button', { name: '送信', exact: true }).isEnabled(), 'synthetic_generation_policy_only');
      await operation('synthetic_prompt_explicit_once', async () => { await click('送信'); await page.locator('[data-execution="running"]').waitFor(); }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'prompt.submit').length === 1 ? [] : ['synthetic_submit_no_single_prompt']);
      await operation('stop_confirm_cancel', async () => { await menu('停止'); await page.getByRole('dialog', { name: '停止確認', exact: true }).getByRole('button', { name: '戻る', exact: true }).click(); }, async (_before, _after, row) => row.rpcMethods.includes('session.interrupt') ? ['stop_cancel_sent_interrupt'] : []);
      await operation('stop_explicit_ack', async () => { await menu('停止'); await page.getByRole('dialog', { name: '停止確認', exact: true }).getByRole('button', { name: '停止を要求', exact: true }).click(); await page.locator('[data-execution="stopped"]').waitFor(); }, async (_before, _after, row) => row.rpcMethods.filter(method => method === 'session.interrupt').length === 1 ? [] : ['explicit_stop_no_single_interrupt']);
      for (const [id, choice] of [[401, '今回だけ許可'], [402, '拒否']]) {
        const current = fixture.state.sessions.get('default'); const request = { id, method: 'approval', params: { session_id: current.live, request_id: `DEMO-approval-${id}`, command: 'echo DEMO fixture only', description: `DEMO 合成要求 ${id} だけ`, choices: ['once','deny'] } };
        fixture.state.open.set(`number:${id}`, request); for (const socket of fixture.state.sockets) socket.send(JSON.stringify({ jsonrpc: '2.0', ...request }));
        await page.getByRole('article', { name: 'この会話の確認要求', exact: true }).getByRole('button', { name: '確認する', exact: true }).click(); const card = page.getByRole('article', { name: '承認要求 default', exact: true }).filter({ has: page.getByText(`DEMO 合成要求 ${id} だけ`, { exact: true }) }); await card.waitFor();
        await operation(`approval_${choice}_confirmation_cancel`, async () => { await card.getByRole('button', { name: choice, exact: true }).click(); await page.getByRole('dialog', { name: '承認対象の確認', exact: true }).getByRole('button', { name: '戻る', exact: true }).click(); }, async () => fixture.state.open.has(`number:${id}`) ? [] : ['approval_cancel_resolved_request']);
        await operation(`approval_${choice}_explicit_response`, async row => { const before = fixture.state.answers.length; await card.getByRole('button', { name: choice, exact: true }).click(); await page.getByRole('dialog', { name: '承認対象の確認', exact: true }).getByRole('button', { name: '確認して回答', exact: true }).click(); await wait(() => Promise.resolve(fixture.state.answers.length === before + 1), 'synthetic_approval_ack'); row.answerCount = fixture.state.answers.length - before; }, async (_before, _after, row) => row.answerCount === 1 ? [] : ['explicit_response_not_once']);
        await list(); await conversation();
      }
      const current = fixture.state.sessions.get('default'); const clarify = { id: 'DEMO-clarify-interaction', method: 'clarify', params: { session_id: current.live, questions: [{ qid: 'q0', question: 'DEMO 選択', choices: ['DEMO 選択A','DEMO 選択B'], multi_select: true }, { qid: 'q1', question: 'DEMO 自由回答' }], answers: {} } };
      fixture.state.open.set('string:DEMO-clarify-interaction', clarify); for (const socket of fixture.state.sockets) socket.send(JSON.stringify({ jsonrpc: '2.0', ...clarify }));
      await page.getByRole('article', { name: 'この会話の確認要求', exact: true }).getByRole('button', { name: '確認する', exact: true }).click(); const card = page.getByRole('article', { name: '追加質問 default', exact: true }); await card.waitFor();
      await card.getByLabel('DEMO 選択A', { exact: true }).check(); await card.getByLabel('DEMO 選択B', { exact: true }).check(); await card.getByLabel('DEMO 自由回答 自由入力', { exact: true }).fill('DEMO UIだけの合成回答');
      await operation('clarify_explicit_response_once', async row => { const before = fixture.state.answers.length; await card.getByRole('button', { name: '回答を送信', exact: true }).click(); await wait(() => Promise.resolve(fixture.state.answers.length === before + 1), 'synthetic_clarify_ack'); row.answerCount = fixture.state.answers.length - before; }, async (_before, _after, row) => row.answerCount === 1 ? [] : ['clarify_response_not_once']);
      await list(); await conversation(); await page.locator('#remote-input').fill('DEMO after synthetic response');
      // Restore the ordinary no-generation profile policy through its actual read.
      witness.generationAllowed = false; await menu('再同期');
    });
    await workflow('I-MAIN_ACTIONS_DIAGNOSTICS_AND_SAFE_LOGOUT_CANCEL', async () => {
      await conversation(); await page.locator('#remote-input').fill(''); await list();
      await operation('global_sidebar_open_and_close', async () => { await click('セッションのサイドバーを開く'); const sidebar = page.getByRole('dialog', { name: 'セッション管理', exact: true }); await sidebar.getByRole('button', { name: 'サイドバーを閉じる', exact: true }).click(); }, async () => !await page.getByRole('dialog', { name: 'セッション管理', exact: true }).count() ? [] : ['global_sidebar_close_has_no_effect']);
      await operation('history_scope_disclosure', () => page.getByLabel('会話一覧の取得範囲', { exact: true }).click(), async () => await page.locator('.remote-profile-switch details[open]').count() === 1 ? [] : ['history_scope_details_no_response']);
      await operation('requests_navigation_empty_feedback', async () => { await page.getByRole('button', { name: /^確認待ち/ }).click(); await page.getByRole('heading', { name: '確認待ち', exact: true }).waitFor(); }, async () => await page.getByRole('heading', { name: 'この取得範囲に確認待ちはありません', exact: true }).count() === 1 ? [] : ['requests_empty_page_has_no_feedback']);
      const resync = page.getByRole('button', { name: '要求を再同期', exact: true });
      if (await resync.isEnabled()) await operation('requests_explicit_resync', () => resync.click(), async (_before, _after, row) => row.rpcMethods.includes('session.events.since') ? [] : ['request_resync_missing_read']);
      await list();
      await operation('header_connection_diagnostics_action', () => click('接続状態と診断'), async () => await page.getByRole('heading', { name: '設定・診断', exact: true }).count() === 1 ? [] : ['connection_chip_no_diagnostic_page']);
      await operation('settings_update_check_current_build_feedback', async () => { await click('更新を確認'); await page.getByText('このbuildは最新です。', { exact: true }).waitFor(); }, async () => []);
      await operation('settings_logout_confirmation_cancel', async () => { await click('ログアウト'); const confirm = page.getByRole('dialog', { name: 'ログアウト確認', exact: true }); await confirm.getByRole('button', { name: '戻る', exact: true }).click(); }, async (_before, _after, row) => fixture.state.auth && !row.rpcMethods.includes('remote.notifications.unsubscribe_all') ? [] : ['logout_cancel_released_auth_or_subscription']);
      await conversation(); await page.locator('#remote-input').fill(DEMO_DRAFT);
    });
    result.deviceSpeech = await page.evaluate(() => ({...window.__DEMO_device_counts}));
    result.nativeActionEvents = await page.evaluate(() => [...window.__DEMO_ui_action_events]);
    const actualLabels = new Set(result.nativeActionEvents.map(event => event.label));
    const discovered = [...new Map(result.inventory.flatMap(item => item.controls).map(item => [`${item.tag}:${item.label}`, item])).values()];
    result.coverage = { discoveredActionKinds: discovered.length, activatedKinds: discovered.filter(item => actualLabels.has(item.label)).length, pendingKinds: discovered.filter(item => !item.disabled && !actualLabels.has(item.label)), disabledKinds: discovered.filter(item => item.disabled && !actualLabels.has(item.label)), repeatedMessageRowPolicy: 'Both user and Hermes action kinds are exercised; repeated rows share the same component.' };
    result.fixture = { mainPromptSubmissions: fixture.state.submissions, mainApprovalAnswers: fixture.state.answers.length,
      syntheticFeatureWrites: witness.writes.length, syntheticRefusals: witness.rejected, outsideSockets: witness.outsideSockets };
    const explicitPromptActions = result.actions.filter(row => row.id === 'synthetic_prompt_explicit_once' && row.rpcMethods?.includes('prompt.submit'));
    const explicitAnswerActions = result.actions.filter(row => row.answerCount === 1);
    result.fixture.expectedSyntheticPromptActions = explicitPromptActions.length; result.fixture.expectedSyntheticAnswerActions = explicitAnswerActions.length;
    if (fixture.state.submissions !== explicitPromptActions.length || fixture.state.answers.length !== explicitAnswerActions.length || witness.outsideSockets) finding('privacy', 'unaccounted_synthetic_action_or_external_socket');
  } catch (error) { finding('bootstrap', 'fixture_or_browser_setup_failed', { errorCategory: error?.name || 'Error' }); }
  finally {
    for (const [label, resource] of [['context', context], ['browser', browser], ['fixture', fixture]]) {
      try { await resource?.close(); } catch { result.cleanupFailures.push(label); }
    }
    result.status = result.findings.length || result.warnings || result.pageErrors || result.cleanupFailures.length ? 'FAIL' : 'PASS';
    result.actionCount = result.actions.length; result.discoveredVisibleControlInstances = result.inventory.reduce((sum, row) => sum + row.controls.length, 0);
    persist();
  }
}
report.sourceAfter = sourceHashes(); report.releaseAfter = releaseHashes();
assert.deepEqual(report.sourceBefore, report.sourceAfter); assert.deepEqual(report.releaseBefore, report.releaseAfter);
report.status = report.results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL';
report.coverageStatus = report.results.every(result => result.coverage?.pendingKinds.length === 0) ? 'DISCOVERED_ENABLED_ACTION_KINDS_EXERCISED' : 'DISCOVERED_ENABLED_ACTION_KINDS_REMAIN_RECONCILIATION_REQUIRED';
persist();
console.log(JSON.stringify({ status: report.status, phase, build, output, reportSha256: hash(readFileSync(join(output, 'report.json'))),
  results: report.results.map(({ engine, status, actionCount, findings, warnings, pageErrors }) => ({ engine, status, actionCount, findings: findings.length, warnings, pageErrors })) }));
if (report.status !== 'PASS') process.exitCode = 1;
