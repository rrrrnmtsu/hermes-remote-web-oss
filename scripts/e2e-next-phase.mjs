import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';
import { installInteractionFixture } from './interactions-fixture.mjs';
import { installViewportFixture, visualViewport, settleFrames } from './layout-geometry.mjs';

// Built client and loopback WSS only. No provider, production credential or upload.
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option('phase') || 'after';
assert.ok(['before', 'after'].includes(phase));
const filter = option('engine');
assert.ok(!filter || ['webkit', 'chromium'].includes(filter));
const build = option('build') || readFileSync('releases/current-build.txt', 'utf8').trim();
assert.match(build, /^remote-v2-[a-f0-9]{16}$/);
const release = resolve('releases', build);
const output = resolve('output/next-phase-20261007', phase);
mkdirSync(output, { recursive: true });
const report = { schema: 'hermes_remote_web_next_phase_fixture_v1', build, phase, fixtureOnly: true,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  buildInputsSha256: JSON.parse(readFileSync(join(release, 'build.json'))).buildInputsSha256,
  physicalIPhone: 'NOT_RUN', softwareKeyboard: 'SIMULATED_VISUAL_VIEWPORT', production: 'NOT_RUN',
  providerCalls: 0, liveUploads: 0, results: [] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

for (const [engine, type] of [['webkit', webkit], ['chromium', chromium]]) {
  if (filter && engine !== filter) continue;
  const directory = join(output, engine); mkdirSync(directory, { recursive: true });
  const fixture = await startFixture({ releaseDirectory: release });
  const result = { engine, status: 'RUNNING', cases: [], layouts: [], screenshots: [], externalRequests: 0, pageErrors: 0 };
  report.results.push(result);
  const browser = await type.launch(engine === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  let context;
  const persist = () => writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, locale: 'ja-JP', reducedMotion: 'reduce',
      ignoreHTTPSErrors: true, acceptDownloads: true }); // localhost certificate only
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === fixture.origin || ['blob:', 'data:', 'about:'].includes(url.protocol)) return route.continue();
      result.externalRequests++; return route.abort('blockedbyclient');
    });
    await installViewportFixture(context);
    const witness = await installInteractionFixture(context, fixture);
    witness.generationAllowed = true; // Synthetic model selection only; prompt count must remain zero.
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', () => { result.pageErrors++; });
    const capture = async name => {
      await settleFrames(page, 3);
      const path = join(directory, `${name}-390x844.png`); await page.screenshot({ path });
      result.screenshots.push({ name, path, sha256: sha(readFileSync(path)), data: 'DEMO_ONLY' });
    };
    const check = async (name, action) => { await action(); result.cases.push(name); persist(); };
    const click = name => page.getByRole('button', { name, exact: true }).click();
    const menu = async name => {
      await click('会話メニュー');
      await page.getByRole('dialog', { name: '会話メニュー', exact: true }).getByRole('button', { name, exact: true }).click();
    };
    const openConversation = async () => {
      await page.goto(fixture.origin + '/hermes-remote-web/');
      await page.locator('[data-connection="connected"]').waitFor();
      await page.getByRole('region', { name: '過去の会話', exact: true }).locator('ul > li > button').first().click();
      await page.locator('#remote-input').waitFor();
    };
    await openConversation();
    await capture('conversation');
    const input = page.getByLabel('Hermesへのメッセージ');
    const draft = 'DEMO 添付を確認してから送信します。';
    await input.fill(draft);
    const documentInput = page.getByLabel('TXT・Markdown・CSV・PDFを1つ選択', { exact: true });
    await documentInput.setInputFiles({ name: 'DEMO-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('DEMO 端末内の資料\n' + '日本語の資料を確認します。'.repeat(400)) });
    await page.getByRole('region', { name: '選択した資料', exact: true }).waitFor();
    await capture('document-selected');
    await click('資料の詳細と上限');
    const documentDialog = page.getByRole('dialog', { name: phase === 'after' ? '資料の詳細' : '入力の補助', exact: true });
    await documentDialog.waitFor(); await capture('document-details');
    if (phase === 'after') {
      await check('document_preview_is_bounded_local_text_and_focused', async () => {
        const preview = documentDialog.getByLabel('選択した資料の端末内プレビュー', { exact: true });
        assert.equal((await preview.innerText()).length, 4000);
        assert.ok((await preview.innerText()).startsWith('DEMO 端末内の資料'));
        assert.equal(await documentDialog.getByRole('button', { name: '閉じる', exact: true }).evaluate(node => node === document.activeElement), true);
      });
      for (const [width, height, textSize, keyboard] of [[320, 640, 100, false], [390, 844, 100, true], [430, 932, 100, false], [320, 640, 200, false], [844, 390, 100, false]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}%`; }, textSize);
        await visualViewport(page, keyboard ? 320 : null, keyboard ? 80 : 0);
        await settleFrames(page, 3);
        const geometry = await documentDialog.evaluate(node => {
          const box = node.getBoundingClientRect(), close = node.querySelector('.remote-sheet-heading button').getBoundingClientRect(), vv = visualViewport;
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, closeWidth: close.width, closeHeight: close.height,
            closeTop: close.top, closeBottom: close.bottom, viewportTop: vv.offsetTop, viewportBottom: vv.offsetTop + vv.height,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert.ok(geometry.left >= -1 && geometry.right <= width + 1 && geometry.overflow <= 1);
        assert.ok(geometry.closeWidth >= 44 && geometry.closeHeight >= 44);
        assert.ok(geometry.closeTop >= geometry.viewportTop - 1 && geometry.closeBottom <= geometry.viewportBottom + 1);
        result.layouts.push({ width, height, textSize, keyboard: keyboard ? 'SIMULATED' : 'CLOSED', geometry });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); await visualViewport(page);
    }
    await documentDialog.getByRole('button', { name: '閉じる', exact: true }).click();
    await click('添付を外す');
    if (phase === 'after') await check('document_rejection_uses_document_label_without_submit', async () => {
      await documentInput.setInputFiles({ name: 'DEMO-invalid.md', mimeType: 'text/markdown', buffer: Buffer.from([0, 1, 2]) });
      await page.getByText('資料を追加できません', { exact: true }).waitFor();
      assert.equal(await input.inputValue(), draft);
      assert.equal(fixture.state.submissions, 0);
    });
    const imageName = readdirSync(join(release, 'assets')).find(name => /^image-turn-.*\.png$/.test(name)); assert.ok(imageName);
    await page.getByLabel('JPEGまたはPNGを1枚選択', { exact: true }).setInputFiles(join(release, 'assets', imageName));
    await page.getByRole('region', { name: '選択した画像', exact: true }).waitFor();
    await click('画像の詳細と注意を確認');
    const imageDialog = page.getByRole('dialog', { name: phase === 'after' ? '画像の詳細' : '入力の補助', exact: true });
    await imageDialog.waitFor(); await capture('image-details');
    if (phase === 'after') await check('image_details_and_cancel_do_not_upload_or_clear_draft', async () => {
      const image = imageDialog.getByAltText('選択した画像の端末内プレビュー', { exact: true });
      await image.waitFor(); await image.evaluate(node => node.decode());
      assert.equal(await image.evaluate(node => node.complete && node.naturalWidth > 0), true);
      await imageDialog.getByRole('button', { name: '添付を外す', exact: true }).click();
      assert.equal(await page.getByRole('region', { name: '選択した画像', exact: true }).count(), 0);
      assert.equal(await input.inputValue(), draft);
    });
    else { await imageDialog.getByRole('button', { name: '閉じる', exact: true }).click(); await click('画像の選択を取消'); }
    await input.fill('');

    await menu('成果物');
    const artifacts = page.getByRole('dialog', { name: 'この会話の成果物', exact: true });
    await artifacts.getByRole('button', { name: 'DEMO 正式成果物.md', exact: true }).click();
    await artifacts.getByRole('heading', { name: 'DEMO_ARTIFACT_ONLY', exact: true }).waitFor();
    await capture('artifact-preview');
    await artifacts.getByRole('button', { name: 'ファイルを保存', exact: true }).click();
    const confirm = artifacts.getByRole('group', { name: 'ファイル保存の確認', exact: true });
    await confirm.waitFor(); await capture('artifact-save-confirmation');
    if (phase === 'after') await check('save_confirmation_focus_and_cancel_restore', async () => {
      assert.equal(await confirm.getByRole('button', { name: '取消', exact: true }).evaluate(node => node === document.activeElement), true);
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await artifacts.getByRole('button', { name: 'ファイルを保存', exact: true }).evaluate(node => node === document.activeElement), true);
    });
    else await confirm.getByRole('button', { name: '取消', exact: true }).click();
    if (phase === 'after') await check('explicit_save_download_matches_fixed_snapshot', async () => {
      await artifacts.getByRole('button', { name: 'ファイルを保存', exact: true }).click();
      const pending = page.waitForEvent('download');
      await confirm.getByRole('button', { name: '保存を開始', exact: true }).click();
      const download = await pending; assert.equal(await download.failure(), null);
      const bytes = readFileSync(await download.path());
      assert.equal(sha(bytes), sha(Buffer.from('# DEMO_ARTIFACT_ONLY\n\n前のファイルと異なる正式合成果物です。')));
      assert.equal(await artifacts.getByRole('button', { name: 'ファイルを保存', exact: true }).evaluate(node => node === document.activeElement), true);
    });
    await artifacts.getByRole('button', { name: '閉じる', exact: true }).click();
    await menu('モデル・実行情報');
    const info = page.getByRole('dialog', { name: '会話の情報', exact: true });
    await info.getByLabel('次に使うモデル').waitFor().catch(async error => {
      result.failedSyntheticPanel = await info.innerText(); result.syntheticMethodsAtFailure = [...witness.methods]; throw error;
    }); await capture('session-models');
    if (phase === 'after') {
      await check('model_search_is_local_and_details_start_collapsed', async () => {
        const count = witness.methods.length;
        assert.equal(await info.locator('.remote-session-model-details').getAttribute('open'), null);
        await info.getByLabel('モデルを絞り込む', { exact: true }).fill('ALTERNATE');
        assert.equal(await info.getByLabel('次に使うモデル').locator('option').count(), 2);
        assert.equal(witness.methods.length, count);
      });
      await check('model_selection_requires_explicit_apply_with_one_scoped_write', async () => {
        const before = witness.writes.length;
        await info.getByLabel('次に使うモデル').selectOption('DEMO-alternate');
        assert.equal(witness.writes.length, before);
        await info.getByRole('button', { name: 'この会話へ適用', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.remote-session-model-current strong')?.textContent === 'DEMO-alternate');
        assert.deepEqual(witness.writes.slice(before), ['remote.session.model_set']);
        assert.equal(fixture.state.submissions, 0);
      });
      await info.getByLabel('モデルを絞り込む').fill('');
      await info.getByText('モデルの詳細（3件）', { exact: true }).click();
      await info.getByText('このモデルの出力・文脈上限が未確認のため変更できません', { exact: true }).waitFor();
      await info.getByText('モデルの詳細（3件）', { exact: true }).click();
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await capture('session-models-dark');
      await info.getByRole('button', { name: '閉じる', exact: true }).click();
      // A new browser connection receives an independently advertised read-only catalog.
      fixture.state.featureMethods = fixture.state.featureMethods.filter(method => method !== 'remote.session.model_set');
      await openConversation(); await menu('モデル・実行情報');
      await check('read_only_model_capability_has_reason_and_no_write', async () => {
        await info.getByText('このHermes版はモデル変更に未対応です。現在値の読み取りだけ利用できます。', { exact: true }).waitFor();
        assert.equal(await info.getByLabel('次に使うモデル').isDisabled(), true);
        assert.equal(await info.getByRole('button', { name: 'この会話へ適用', exact: true }).isDisabled(), true);
      });
      await capture('session-models-readonly');
      assert.equal(result.externalRequests, 0); assert.equal(result.pageErrors, 0);
      assert.equal(fixture.state.submissions, 0);
      assert.equal(fixture.state.methods.filter(method => /^(?:image\.(?:attach|detach)|file\.attach|pdf\.attach|remote\.document)/.test(method)).length, 0);
      assert.deepEqual(witness.writes, ['remote.session.model_set']);
      result.cases.push('zero_prompts_uploads_external_requests_and_page_errors');
    }
    result.status = phase === 'before' ? 'BASELINE_CAPTURED' : 'PASS';
    result.syntheticModelWrites = witness.writes.length;
  } catch (error) {
    result.status = 'FAIL'; result.error = { name: error.name, message: error.message }; persist(); throw error;
  } finally { await context?.close(); await browser.close(); await fixture.close(); persist(); }
}
console.log(JSON.stringify({ build, phase, results: report.results.map(result => ({ engine: result.engine, status: result.status, cases: result.cases.length, layouts: result.layouts.length, screenshots: result.screenshots.length })) }));
