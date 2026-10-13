import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';

const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11);
const output = resolve('output/playwright/micro-interactions', baseline ? 'before' : 'after');
mkdirSync(output, { recursive: true });
const report = { fixtureOnly: true, iphone: 'NOT_RUN', results: [] };
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const fixture = await startFixture(baseline ? { releaseDirectory: resolve(baseline) } : {});
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, reducedMotion: 'no-preference' });
  await context.addInitScript(() => {
    window.__copyCount = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText(text) { window.__copyCount++; window.__copiedText = text; return new Promise((resolveCopy, rejectCopy) => {
        window.__copyResolve = resolveCopy; window.__copyReject = () => rejectCopy(new Error('DEMO denied'));
      }); },
    } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.name));
  const row = { engine: name, checks: [] }; report.results.push(row);
  try {
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await page.locator('[data-connection="connected"]').waitFor();
    fixture.state.sessions.get('default').messages = [
      { row_id: 1, role: 'user', text: 'DEMO このコードを確認してください。' },
      { row_id: 2, role: 'assistant', text: 'DEMO 日本語と改行をそのままコピーできます。\n\n```js\nconst message = "こんにちは";\nconsole.log(message);\n```\n\nコピーは明示操作で行います。' },
    ];
    await page.locator('.remote-session').click();
    const input = page.getByLabel('Hermesへのメッセージ'); await input.fill('DEMO 消えない下書き');
    const code = page.getByRole('button', { name: 'コードをコピー', exact: true });
    await code.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(output, `${name}-chat.png`) });
    await code.click();
    if (baseline) {
      await page.screenshot({ path: resolve(output, `${name}-copy-pending.png`) });
      await page.evaluate(() => window.__copyResolve());
    } else {
      assert.equal(await code.getAttribute('aria-busy'), 'true');
      assert.equal(await code.getAttribute('aria-disabled'), 'true');
      // A real aria-disabled button remains focusable. Dispatch repeated pointer
      // events too, so deduplication is exercised rather than hidden by Playwright.
      await code.dispatchEvent('click'); await code.dispatchEvent('click');
      assert.equal(await page.evaluate(() => window.__copyCount), 1);
      assert.equal(await page.evaluate(() => window.__copiedText), 'const message = "こんにちは";\nconsole.log(message);\n');
      const before = await code.boundingBox();
      await page.screenshot({ path: resolve(output, `${name}-copy-pending.png`) });
      await page.evaluate(() => window.__copyResolve());
      await page.getByText('コピーしました', { exact: true }).waitFor();
      const after = await code.boundingBox();
      assert.ok(Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1);
      await page.waitForFunction(() => [...document.querySelectorAll('.remote-copy-feedback[data-state="success"]')].every(node => getComputedStyle(node).opacity === '1'));
      await page.screenshot({ path: resolve(output, `${name}-copy-success.png`) });
      await page.getByText('コピーしました', { exact: true }).waitFor({ state: 'hidden' });
      row.checks.push('clipboard pending/confirmed/bounded success, deduplication, stable hit target and exact code');
      await code.click(); await page.evaluate(() => window.__copyReject());
      await page.getByText('コピーできません。本文を選択してください。', { exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, `${name}-copy-error.png`) });
      row.checks.push('explicit failure without retry');
      const trigger = page.getByRole('button', { name: 'Hermesのメッセージ操作', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'メッセージの操作', exact: true });
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      const styles = await dialog.evaluate(node => ({ animation: getComputedStyle(node).animationName,
        duration: getComputedStyle(node).animationDuration, transform: getComputedStyle(node).transform }));
      assert.equal(styles.animation, 'remote-reveal'); assert.equal(styles.transform, 'none');
      assert.ok(parseFloat(styles.duration) <= 0.16);
      const copy = dialog.getByRole('button', { name: 'メッセージをコピー', exact: true });
      await copy.click(); await page.keyboard.press('Escape');
      await trigger.click(); await copy.dispatchEvent('click');
      assert.equal(await page.evaluate(() => window.__copyCount), 3);
      await page.evaluate(() => window.__copyResolve());
      await page.waitForFunction(() => document.querySelector('[aria-label="メッセージをコピー"]')?.dataset.copyState === 'idle');
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
      assert.equal(await input.inputValue(), 'DEMO 消えない下書き');
      row.checks.push('stale completion rejected after dismiss/reopen; draft and focus preserved');
      await page.emulateMedia({ reducedMotion: 'reduce' }); await trigger.click();
      assert.equal(await dialog.evaluate(node => getComputedStyle(node).animationName), 'none');
      assert.equal(await dialog.evaluate(node => getComputedStyle(node, '::backdrop').animationName), 'none');
      await copy.click();
      assert.equal(await copy.locator('svg').evaluate(node => getComputedStyle(node).animationName), 'none');
      await page.evaluate(() => window.__copyResolve()); await page.keyboard.press('Escape');
      row.checks.push('reduced motion: dialog, backdrop and progress; immediate dismiss');
      for (const variant of [{ width: 320, height: 568, font: 16, theme: 'light' },
        { width: 430, height: 932, font: 16, theme: 'dark' },
        { width: 844, height: 390, font: 16, theme: 'light' },
        { width: 320, height: 568, font: 32, theme: 'dark' }]) {
        await page.setViewportSize({ width: variant.width, height: variant.height });
        await page.evaluate(v => { document.documentElement.style.fontSize = `${v.font}px`; document.documentElement.dataset.theme = v.theme; }, variant);
        await trigger.click();
        const geometry = await dialog.evaluate(node => { const buttons = [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect());
          return { overflow: node.scrollWidth > node.clientWidth + 1, hits: buttons.every(box => box.width >= 44 && box.height >= 44) }; });
        assert.equal(geometry.overflow, false); assert.equal(geometry.hits, true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: resolve(output, `${name}-menu-${variant.width}-${variant.font}.png`) });
        await page.keyboard.press('Escape');
      }
      row.checks.push('320/390/430, landscape, light/dark, 200 percent text; no horizontal overflow, 44px controls');
    }
    assert.equal(fixture.state.submissions, 0);
    assert.equal(fixture.state.methods.some(method => ['prompt.submit', 'session.interrupt', 'approval.respond', 'session.create'].includes(method)), false);
    assert.deepEqual(errors, []); row.status = 'PASS';
  } finally { await context.close(); await browser.close(); await fixture.close(); }
}
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
