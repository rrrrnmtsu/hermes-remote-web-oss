import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';

// Synthetic content and local transport only. The viewport is not a physical iPhone keyboard.
const phase = process.argv.includes('--before') ? 'before' : 'after';
const output = resolve('output/playwright/composer', phase);
mkdirSync(output, { recursive: true });
const report = { build: readFileSync('releases/current-build.txt', 'utf8').trim(), phase,
  fixtureOnly: true, iphone: 'NOT_RUN', keyboard: 'SIMULATED visualViewport', results: [] };
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const fixture = await startFixture();
  fixture.state.generationAllowed = false;
  fixture.state.generationReason = 'DEMO: 生成の認証と費用条件が未確認です。この画面では閲覧・下書きの編集を利用できます。';
  const browser = await engine.launch(name === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? {
    executablePath: resolve('scripts/run-webkit-local.sh'), env: { ...process.env, HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()) },
  } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    const native = window.visualViewport, visual = new EventTarget();
    Object.defineProperties(visual, { height: { get: () => window.__DEMO_keyboardHeight ?? native.height },
      width: { get: () => native.width }, scale: { get: () => native.scale }, offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 } });
    Object.defineProperty(window, 'visualViewport', { value: visual, configurable: true });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = { engine: name, version: browser.version(), layouts: [], cases: [], status: 'RUNNING' };
  report.results.push(result);
  try {
    await page.goto(fixture.origin + '/hermes-remote-web/');
    await page.locator('[data-connection="connected"]').waitFor();
    fixture.state.sessions.get('default').messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', row_id: index + 1,
      text: index % 2 ? 'DEMOの回答です。入力欄の見やすさと、会話を読みながら編集できることを確認します。' : 'DEMO: 日常の会話を見やすく整理してください。',
    }));
    await page.locator('.remote-session').click();
    const input = page.getByLabel('Hermesへのメッセージ');
    await input.waitFor();
    for (const variant of [{ width: 390, height: 844, keyboard: 430, text: 100, theme: 'dark' },
      { width: 320, height: 568, keyboard: 360, text: 100, theme: 'light' },
      { width: 430, height: 932, keyboard: 450, text: 100, theme: 'dark' },
      { width: 844, height: 390, keyboard: 280, text: 100, theme: 'light' },
      { width: 320, height: 568, keyboard: 360, text: 200, theme: 'dark' }]) {
      await page.setViewportSize({ width: variant.width, height: variant.height });
      await page.evaluate(value => { document.documentElement.dataset.theme = value.theme;
        document.documentElement.style.fontSize = value.text === 200 ? '32px' : '';
        window.__DEMO_keyboardHeight = value.keyboard; window.visualViewport.dispatchEvent(new Event('resize')); }, variant);
      await input.fill(''); await input.focus(); await settle(page);
      const layout = await page.evaluate(() => {
        const box = selector => { const node = document.querySelector(selector), rect = node.getBoundingClientRect(), css = getComputedStyle(node);
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: parseFloat(css.fontSize), outlineStyle: css.outlineStyle }; };
        return { composer: box('.remote-composer'), input: box('#remote-input'), send: box('.remote-send'),
          help: box('.remote-composer-help'), transcript: box('.remote-transcript'), dock: box('.remote-composer-dock'),
          pageOverflow: document.documentElement.scrollWidth > innerWidth, keyboardState: document.documentElement.dataset.remoteKeyboard };
      });
      result.layouts.push({ ...variant, ...layout });
      assert.equal(layout.pageOverflow, false); assert.ok(layout.input.font >= 16);
      assert.ok(layout.help.width >= 44 && layout.help.height >= 44);
      assert.ok(layout.send.width >= 48 && layout.send.height >= 48);
      assert.ok(layout.dock.y + layout.dock.height <= variant.keyboard + 1);
      assert.ok(layout.transcript.height >= 26, 'a real body line remains readable');
      if (phase === 'after' && variant.text === 100) {
        assert.ok(layout.composer.height <= 70, 'short input uses one compact row');
        assert.equal(layout.input.outlineStyle, 'none', 'focus treatment belongs to the rounded container');
        assert.ok(layout.input.width >= 120, 'icons do not crowd the text field');
      }
      if (variant.width === 390 || variant.text === 200) await page.screenshot({
        path: resolve(output, `${name}-${variant.width}-${variant.text}.png`), clip: { x: 0, y: 0, width: variant.width, height: variant.keyboard },
      });
      if (phase === 'after') {
        await input.fill('DEMO: 日本語の長文と改行を確認します。\n'.repeat(24)); await settle(page);
        const long = await input.evaluate(node => { const bounds = node.getBoundingClientRect(), css = getComputedStyle(node);
          const transcript = document.querySelector('.remote-transcript');
          return { height: bounds.height, width: bounds.width, composerWidth: node.closest('form').getBoundingClientRect().width,
            bottom: bounds.bottom, scroll: node.scrollHeight, scrollTop: node.scrollTop, line: parseFloat(css.lineHeight),
            padding: parseFloat(css.paddingTop) + parseFloat(css.paddingBottom), transcript: transcript.getBoundingClientRect().height }; });
        assert.ok(long.height >= 44 && long.height <= long.line * 6 + long.padding + 1);
        assert.ok(long.width >= long.composerWidth - 20, 'long input uses the full pill width');
        assert.ok(long.scroll > long.height && long.bottom <= variant.keyboard);
        assert.ok(long.scrollTop >= long.scroll - long.height - 2, 'typing at the end keeps the caret in the editor viewport');
        assert.ok(long.transcript >= 26, 'long editing preserves conversation space');
        result.layouts.at(-1).longDraft = long;
        if (variant.width === 390) await page.screenshot({ path: resolve(output, `${name}-long-draft.png`),
          clip: { x: 0, y: 0, width: variant.width, height: variant.keyboard } });
      }
    }
    assert.equal(fixture.state.submissions, 0);
    assert.equal(fixture.state.methods.some(method => ['prompt.submit', 'session.interrupt', 'approval.respond', 'session.create'].includes(method)), false);
    result.cases.push('matched_viewport_composer_geometry_read_only_no_writes');
    if (phase === 'after') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; window.__DEMO_keyboardHeight = 430;
        window.visualViewport.dispatchEvent(new Event('resize')); });
      await input.fill('DEMO 日本語の下書き\n改行を残す'); await input.focus(); await settle(page);
      await input.fill('DEMO 日本語の折り返しを確認。'.repeat(12)); await settle(page);
      assert.equal(await input.evaluate(node => node.closest('form').dataset.stacked), 'true');
      await input.fill('確認'); await settle(page);
      assert.ok((await page.locator('.remote-composer').boundingBox()).height <= 70);
      await input.fill('DEMO 日本語の下書き\n改行を残す'); await settle(page);
      assert.equal(await input.evaluate(node => { const box = node.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === node; }), true, 'textarea accepts real touch');
      await page.getByRole('button', { name: '送信できない理由を確認' }).click();
      const reason = page.getByRole('dialog', { name: '送信できない理由' });
      assert.ok((await reason.innerText()).includes(fixture.state.generationReason));
      await reason.getByRole('button', { name: '閉じる', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: '送信', exact: true }).isDisabled(), true);
      await input.evaluate(node => node.setSelectionRange(5, 5));
      await page.getByRole('button', { name: '入力の補助', exact: true }).click();
      await page.getByRole('button', { name: '入力欄を広げる', exact: true }).click();
      const expanded = page.getByRole('dialog', { name: '拡大入力' });
      const editor = expanded.getByRole('textbox');
      assert.equal(await editor.inputValue(), 'DEMO 日本語の下書き\n改行を残す');
      await editor.fill('DEMO 日本語の下書き\n改行を残す\n長文の編集');
      await expanded.getByRole('button', { name: '通常表示へ戻る', exact: true }).click();
      await settle(page);
      assert.equal(await input.inputValue(), 'DEMO 日本語の下書き\n改行を残す\n長文の編集');
      assert.equal(await input.evaluate(node => document.activeElement === node), true);
      await input.dispatchEvent('compositionstart'); await input.press('Enter');
      assert.equal(await page.getByRole('button', { name: '入力の補助', exact: true }).isDisabled(), true);
      await input.dispatchEvent('compositionend');
      await page.getByRole('button', { name: 'キーボードを閉じる' }).click();
      assert.equal(await input.evaluate(node => document.activeElement === node), false);
      assert.ok((await input.inputValue()).includes('改行を残す'));
      assert.equal(fixture.state.submissions, 0);
      assert.equal(fixture.state.methods.some(method => ['prompt.submit', 'session.interrupt', 'approval.respond', 'session.create'].includes(method)), false);
      result.cases.push('reason_dialog_retains_send_guard_expanded_editor_focus_draft_IME_keyboard_close_no_writes');
    }
    result.status = 'PASS'; assert.deepEqual(errors, []);
  } catch (error) { result.status = 'FAIL'; result.error = String(error); throw error; }
  finally { writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); await fixture.close(); }
}
console.log(JSON.stringify(report));
