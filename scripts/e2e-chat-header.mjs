import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';

const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
const output = resolve('output/playwright/chat-header', baseline ? 'before' : 'after');
mkdirSync(output, { recursive: true });
const report = { fixtureOnly: true, iphone: 'NOT_RUN', keyboard: 'SIMULATED', results: [] };
// A reading-position assertion must start after the previous viewport/font
// transition and the application's coalesced allocation frames have settled.
const settleReadingLayout = page => page.evaluate(async () => {
  await document.fonts.ready;
  let previous = '', stable = 0;
  for (let frame = 0; frame < 120; frame++) {
    await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
    const node = document.querySelector('.remote-transcript');
    const form = document.querySelector('.remote-composer');
    const signature = [node.clientWidth, node.clientHeight, node.scrollHeight, node.scrollTop, form.offsetHeight].join(':');
    stable = signature === previous ? stable + 1 : 0; previous = signature;
    if (stable >= 5) return;
  }
  throw new Error('Reading layout did not settle');
});
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const fixture = await startFixture(baseline ? { releaseDirectory: resolve(baseline) } : {});
  fixture.state.nextBuild = 'DEMO-header-update';
  fixture.state.generationAllowed = false;
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    const native = visualViewport, visual = new EventTarget();
    Object.defineProperties(visual, { height: { get: () => window.__DEMO_height ?? native.height },
      width: { get: () => native.width }, scale: { get: () => native.scale }, offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 } });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.name));
  const row = { engine: name, build: JSON.parse(readFileSync(resolve(baseline || `releases/${readFileSync('releases/current-build.txt', 'utf8').trim()}`, 'build.json'))).buildId, layouts: [] };
  report.results.push(row);
  try {
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await page.locator('[data-connection="connected"]').waitFor();
    fixture.state.sessions.get('default').messages = Array.from({ length: 20 }, (_, i) => ({ row_id: i + 1, role: i % 2 ? 'assistant' : 'user',
      text: i % 2 ? 'DEMO 会話を読みながら短い文章を編集します。更新のお知らせは必要なときに確認できます。' : 'DEMO 入力中も会話を読みやすくしてください。' }));
    await page.locator('.remote-session').click();
    const input = page.getByLabel('Hermesへのメッセージ');
    await input.fill('DEMO 下書き');
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    for (const variant of [{ width: 390, height: 844, visual: 430, font: 16, theme: 'dark' },
      { width: 320, height: 568, visual: 360, font: 16, theme: 'light' },
      { width: 430, height: 932, visual: 450, font: 16, theme: 'dark' },
      { width: 844, height: 390, visual: 280, font: 16, theme: 'light' },
      { width: 320, height: 568, visual: 360, font: 32, theme: 'dark' }]) {
      await page.setViewportSize({ width: variant.width, height: variant.height });
      await page.evaluate(v => { window.__DEMO_height = v.visual; document.documentElement.dataset.theme = v.theme;
        document.documentElement.style.fontSize = `${v.font}px`; visualViewport.dispatchEvent(new Event('resize')); }, variant);
      await input.focus();
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const geometry = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { heading: box('.remote-chat-heading'), notices: box('.remote-notices'), transcript: box('.remote-transcript'),
          menu: box('.remote-chat-menu-trigger, .remote-chat-heading > button:last-child'), dock: box('.remote-composer-dock'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      row.layouts.push({ ...variant, ...geometry });
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.menu.width >= 44 && geometry.menu.height >= 44);
      if (!baseline) {
        assert.equal(geometry.notices.height, 0, 'optional update occupies no transcript space');
        if (variant.font === 16) assert.ok(geometry.heading.height <= 44, 'keyboard header remains compact');
        assert.ok(geometry.transcript.height >= 26);
        assert.ok(geometry.dock.bottom <= variant.visual + 1);
      }
      if (variant.width === 390) await page.screenshot({ path: resolve(output, `${name}-keyboard.png`), clip: { x: 0, y: 0, width: 390, height: 430 } });
    }
    if (!baseline) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; window.__DEMO_height = 430; visualViewport.dispatchEvent(new Event('resize')); });
      const menu = page.getByRole('button', { name: '会話メニュー', exact: true });
      assert.equal(await menu.getAttribute('aria-describedby'), 'remote-update-status');
      const transcript = page.locator('.remote-transcript');
      await settleReadingLayout(page);
      await transcript.dispatchEvent('wheel', { deltaY: -100 });
      await transcript.evaluate(node => { node.scrollTop = 100; node.dispatchEvent(new Event('scroll')); });
      await settleReadingLayout(page);
      const beforeTop = await transcript.evaluate(node => node.scrollTop);
      assert.ok(Math.abs(beforeTop - 100) <= 2, 'reading starts at the selected position');
      await menu.click();
      await page.getByRole('button', { name: 'アプリの更新を確認', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'アプリの更新', exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('button', { name: '操作と下書きがない状態で更新' }).isDisabled(), true);
      await page.screenshot({ path: resolve(output, `${name}-update-dialog.png`), clip: { x: 0, y: 0, width: 390, height: 430 } });
      await page.getByRole('button', { name: '会話に戻る', exact: true }).click();
      assert.equal(await input.inputValue(), 'DEMO 下書き');
      assert.equal(await menu.evaluate(node => document.activeElement === node), true, 'return focus to menu');
      await settleReadingLayout(page);
      const afterTop = await transcript.evaluate(node => node.scrollTop);
      row.readingPosition = { before: beforeTop, after: afterTop };
      assert.ok(Math.abs(afterTop - beforeTop) <= 2, `preserve reading position: ${beforeTop} -> ${afterTop}`);
      await input.fill('');
      await menu.click(); await page.getByRole('button', { name: 'アプリの更新を確認', exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: '操作と下書きがない状態で更新' }).isEnabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 0);
    }
    assert.equal(fixture.state.submissions, 0);
    assert.equal(fixture.state.methods.some(method => ['prompt.submit', 'session.interrupt', 'approval.respond', 'session.create'].includes(method)), false);
    assert.deepEqual(errors, []); row.status = 'PASS';
  } finally { await context.close(); await browser.close(); await fixture.close(); }
}
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
