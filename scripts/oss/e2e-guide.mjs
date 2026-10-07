import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startFixture } from '../fixture-server.mjs';

const output = 'output/oss-guide'; mkdirSync(output, { recursive: true });
const report = { schema: 'hermes_remote_web_oss_setup_fixture_v1', build: readFileSync('releases/current-build.txt', 'utf8').trim(),
  syntheticOnly: true, liveProvider: 'NOT_RUN', physicalIPhone: 'NOT_RUN', engines: [] };
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const fixture = await startFixture();
  const local = name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1';
  const browser = await engine.launch({ ...(local ? { executablePath: resolve('scripts/run-webkit-local.sh'),
    env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) } } : {}) }).catch(async error => { await fixture.close(); throw error; });
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
    // TLS exception applies only to this owned localhost fixture, never production.
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await page.locator('.remote-connection-dot[data-connection="connected"]').first().waitFor();
    const writesBefore = fixture.state.submissions;
    await page.getByRole('button', { name: '設定', exact: true }).click();
    const guide = page.getByRole('region', { name: '導入と対応機能' });
    await guide.getByText('共有する診断の項目を確認').click();
    const text = await guide.getByLabel('サニタイズ診断テキスト').innerText();
    const diagnostic = JSON.parse(text);
    assert.equal(diagnostic.appBuild, report.build);
    assert.ok(!text.includes('DEMO') && !text.includes('https://') && !text.includes('profile') && !text.includes('session'));
    assert.equal(fixture.state.submissions, writesBefore);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await guide.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await guide.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.screenshot({ path: `${output}/${name}-setup-diagnostics.png` });
    fixture.state.sessions.get('default').messages = [
      { role: 'user', row_id: 1, text: 'DEMO 今日の確認事項を整理してください。' },
      { role: 'assistant', row_id: 2, text: 'DEMO 合成会話です。\n\n1. 内容を確認します。\n2. 必要な操作を明示的に選びます。\n\n```text\nDEMO: providerへの実通信はありません。\n```' },
    ];
    await page.getByRole('button', { name: '会話', exact: true }).click();
    await page.getByRole('button', { name: 'DEMO会話 default', exact: false }).click();
    await page.getByText('DEMO 合成会話です。', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/${name}-conversation.png` });
    assert.equal(fixture.state.submissions, writesBefore);
    assert.deepEqual(errors, []);
    report.engines.push({ engine: name, version: browser.version(), status: 'PASS', widths: [320, 390, 430],
      textScale: '200%', generation: 0, automaticCopy: 0, bodyStorage: 0 });
  } finally { await context?.close(); await browser.close(); await fixture.close(); }
}
writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
