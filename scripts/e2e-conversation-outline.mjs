import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';

const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11);
const output = resolve('output/playwright/conversation-outline', baseline ? 'before' : 'after');
mkdirSync(output, { recursive: true });
const report = { fixtureOnly: true, iphone: 'NOT_RUN', keyboard: 'SIMULATED', results: [] };
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  let previous = '', stable = 0;
  for (let frame = 0; frame < 120; frame++) {
    await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
    const node = document.querySelector('.remote-transcript'), form = document.querySelector('.remote-composer');
    const signature = [node.clientWidth, node.clientHeight, node.scrollHeight, node.scrollTop, form.offsetHeight].join(':');
    stable = signature === previous ? stable + 1 : 0; previous = signature;
    if (stable >= 5) return;
  }
  throw new Error('DEMO reading geometry did not settle');
});
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const fixture = await startFixture(baseline ? { releaseDirectory: resolve(baseline) } : {});
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    ignoreHTTPSErrors: true, colorScheme: 'dark' }); // Owned loopback fixture only.
  await context.route('**/*', route => route.request().url().startsWith(fixture.origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const native = visualViewport, visual = new EventTarget();
    Object.defineProperties(visual, { height: { get: () => window.__DEMO_height ?? native.height }, width: { get: () => native.width },
      scale: { get: () => native.scale }, offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 } });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__DEMO_copy = text; } } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.name));
  const row = { engine: name, checks: [] }; report.results.push(row);
  const capture = async filename => {
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open]')].every(node => getComputedStyle(node).opacity === '1'));
    await page.screenshot({ path: resolve(output, filename) });
  };
  try {
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await page.locator('[data-connection="connected"]').waitFor();
    const item = fixture.state.sessions.get('default');
    item.messages = Array.from({ length: 16 }, (_, i) => ({ row_id: i + 1, role: i % 2 ? 'assistant' : 'user',
      text: i % 2 ? `## DEMO 回答${i + 1}\n\n${'合成データによる確認です。'.repeat(12)}\n\n### 確認方法\n\n対象を確認してから操作します。${i === 1 ? '\n\n```text\n# コード内の見出し\n日本語\n```\n\n[危険](javascript:alert(1))\n<script>window.__DEMO_xss=1</script>' : ''}`
        : `DEMO 質問${i + 1}：確認する手順を教えてください。` }));
    await page.locator('.remote-session').click();
    const input = page.getByLabel('Hermesへのメッセージ'), transcript = page.locator('.remote-transcript');
    await input.fill('DEMO 消えない下書き\n質問を追記');
    await settle(page);
    await transcript.dispatchEvent('wheel', { deltaY: -500 });
    await transcript.evaluate(node => { node.scrollTop = node.scrollHeight / 2; node.dispatchEvent(new Event('scroll')); });
    await settle(page);
    const beforeTop = await transcript.evaluate(node => node.scrollTop), pageTop = await page.evaluate(() => scrollY);
    const methods = fixture.state.methods.length;
    const menu = page.getByRole('button', { name: '会話メニュー', exact: true });
    const open = async () => { await menu.click(); await page.getByRole('button', { name: 'この会話の目次', exact: true }).click(); };
    const dialog = page.getByRole('dialog', { name: 'この会話の目次', exact: true });
    await capture(`${name}-chat.png`);
    if (baseline) {
      await menu.click(); await capture(`${name}-menu.png`);
      row.checks.push('matched synthetic conversation baseline');
    } else {
      await open(); assert.equal(await dialog.locator('li').count(), 24);
      await capture(`${name}-outline.png`);
      assert.equal(await dialog.getByText('コード内の見出し', { exact: true }).count(), 0);
      const emit = (type, payload) => {
        const event = { type, session_id: item.live, seq: ++item.seq, payload }; item.events.push(event);
        for (const ws of fixture.state.sockets) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: event }));
      };
      emit('message.start', {}); emit('message.delta', { text: '## DEMO 新着見出し\n\n新着の合成回答です。' });
      await page.locator('.remote-transcript').getByText('DEMO 新着見出し', { exact: true }).waitFor();
      assert.equal(await dialog.locator('li').count(), 24);
      assert.ok(Math.abs(await transcript.evaluate(node => node.scrollTop) - beforeTop) < 2);
      await dialog.getByRole('button', { name: 'Hermes · 見出し3 確認方法', exact: true }).first().click();
      await page.locator('.remote-outline-target').waitFor(); await settle(page);
      const jumped = await transcript.evaluate(node => { const target = node.querySelector('.remote-outline-target');
        return { top: node.scrollTop, targetTop: target.getBoundingClientRect().top - node.getBoundingClientRect().top,
          focused: document.activeElement === target }; });
      assert.ok(jumped.top < beforeTop - 100); assert.ok(Math.abs(jumped.targetTop - 24) < 2); assert.equal(jumped.focused, true);
      assert.equal(await page.evaluate(() => scrollY), pageTop);
      assert.equal(await input.inputValue(), 'DEMO 消えない下書き\n質問を追記');
      await capture(`${name}-jump.png`);
      emit('message.delta', { text: '\n\n追加の合成テキスト。' }); await settle(page);
      assert.ok(Math.abs(await transcript.evaluate(node => node.scrollTop) - jumped.top) < 2);
      await menu.click(); await page.getByRole('button', { name: '移動前の位置へ戻る', exact: true }).click(); await settle(page);
      assert.ok(Math.abs(await transcript.evaluate(node => node.scrollTop) - beforeTop) < 2);
      assert.equal(await menu.evaluate(node => document.activeElement === node), true);
      row.checks.push('frozen outline, streamed arrival without tail jump, exact heading jump, transcript-only scroll and return anchor');
      await menu.click(); await page.getByRole('button', { name: 'この会話を検索', exact: true }).click();
      const query = page.getByLabel('会話内の検索語'); await query.fill('確認方法'); await page.locator('mark').first().waitFor();
      const searchTop = await transcript.evaluate(node => node.scrollTop);
      await open(); await page.keyboard.press('Escape'); await settle(page);
      assert.equal(await query.inputValue(), '確認方法');
      assert.ok(Math.abs(await transcript.evaluate(node => node.scrollTop) - searchTop) < 2);
      await open(); await dialog.getByRole('button', { name: 'Hermes · 見出し3 確認方法', exact: true }).first().click();
      await page.locator('.remote-outline-target').waitFor();
      assert.equal(await page.locator('.remote-outline-target mark').textContent(), '確認方法');
      await page.getByRole('button', { name: '本文検索を閉じる', exact: true }).click();
      await page.getByRole('button', { name: 'コードをコピー', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__DEMO_copy), '# コード内の見出し\n日本語\n');
      assert.equal(await page.locator('a[href^="javascript:"]').count(), 0); assert.equal(await page.evaluate(() => window.__DEMO_xss), undefined);
      row.checks.push('search highlight, code copy and Markdown safety preserved');
      for (const variant of [{ width: 320, height: 568, font: 16, theme: 'light' }, { width: 430, height: 932, font: 16, theme: 'dark' },
        { width: 844, height: 390, font: 16, theme: 'light' }, { width: 320, height: 568, font: 32, theme: 'dark' },
        { width: 390, height: 844, font: 16, theme: 'dark', keyboard: 390 }]) {
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await page.evaluate(v => { document.documentElement.style.fontSize = `${v.font}px`; document.documentElement.dataset.theme = v.theme;
          window.__DEMO_height = v.keyboard; visualViewport.dispatchEvent(new Event('resize')); }, variant);
        await settle(page); await open();
        const geometry = await dialog.evaluate(node => { const box = node.getBoundingClientRect();
          return { overflow: node.scrollWidth > node.clientWidth + 1, bottom: box.bottom,
            hits: [...node.querySelectorAll('button')].every(button => { const b = button.getBoundingClientRect(); return b.width >= 44 && b.height >= 44; }) }; });
        assert.equal(geometry.overflow, false); assert.equal(geometry.hits, true); assert.ok(geometry.bottom <= (variant.keyboard ?? variant.height) + 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.keyboard.press('Tab'); await page.keyboard.press('End');
        const closeVisible = await dialog.getByRole('button', { name: '閉じる', exact: true }).evaluate(button => {
          const box = button.getBoundingClientRect(), container = button.closest('dialog').getBoundingClientRect();
          return box.top >= container.top && box.bottom <= container.bottom;
        });
        assert.equal(closeVisible, true, 'the close action stays visible after outline keyboard navigation');
        await page.keyboard.press('Home');
        const targetVisible = await dialog.evaluate(node => document.activeElement.getBoundingClientRect().top
          >= node.querySelector('.remote-sheet-heading').getBoundingClientRect().bottom);
        assert.equal(targetVisible, true, 'keyboard navigation reveals the target below the sticky heading');
        await capture(`${name}-outline-${variant.width}-${variant.font}${variant.keyboard ? '-keyboard' : ''}.png`);
        await page.keyboard.press('Escape');
        assert.equal(await menu.evaluate(node => document.activeElement === node), true);
      }
      row.checks.push('320/390/430, landscape, 200 percent, simulated keyboard, light/dark, 44px controls and focus return');
      const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
      assert.deepEqual(stored.session, []);
      assert.ok(stored.local.every(key => ['hermes-remote-web.settings.theme', 'hermes-remote-web.settings.signed-out', 'hermes-remote-web.settings.chat-font-size'].includes(key)));
      assert.deepEqual(fixture.state.methods.slice(methods), []);
      row.checks.push('zero added RPC/read fetch/write, zero content storage');
    }
    assert.equal(fixture.state.submissions, 0); assert.equal(fixture.state.answers.length, 0); assert.deepEqual(errors, []); row.status = 'PASS';
  } finally { await context.close(); await browser.close(); await fixture.close(); }
}
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
