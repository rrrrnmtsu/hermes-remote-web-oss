import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { startFixture } from './fixture-server.mjs';
import { installFeatureFixture, seedSession } from './layout-fixture.mjs';
import { settleFrames } from './layout-geometry.mjs';
import { requireDateFixtureRelease, finalDateStatus } from './date-fixture-guards.mjs';

// Native date widgets and the production client stay real. All server data and
// authentication are synthetic and limited to this owned loopback fixture.
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = arg('phase') || 'after';
assert.ok(['before', 'after'].includes(phase));
const requestedEngine = arg('engine');
assert.ok(!requestedEngine || ['chromium', 'webkit'].includes(requestedEngine));
const sample = arg('sample');
assert.ok(!sample || sample === '390-200');
const longProject = arg('long-project') === '1';
const selectedBuild = readFileSync(join(root, 'releases/current-build.txt'), 'utf8').trim();
const explicitRelease = arg('release');
const release = realpathSync(explicitRelease || join(root, 'releases', selectedBuild));
const manifest = JSON.parse(readFileSync(join(release, 'build.json'), 'utf8'));
requireDateFixtureRelease({ root, phase, selectedBuild, release, explicitRelease: Boolean(explicitRelease), manifestBuild: manifest.buildId });
mkdirSync(join(root, 'output/playwright'), { recursive: true });
const output = mkdtempSync(join(root, `output/playwright/date-fields-${phase}-`));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schema: 1, phase, build: manifest.buildId, inputsSha256: manifest.buildInputsSha256,
  appHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceCssSha256: sha(readFileSync(join(root, 'packages/web/src/remote/ConversationTools.css'))),
  measurement: 'REAL_CHROMIUM_AND_WEBKIT_NATIVE_DATE_SYNTHETIC_LOOPBACK_UI',
  diagnosticSample: sample || null, longProject, userPhotoCopied: false, physicalIPhone: 'NOT_RUN', production: 0, providerCalls: 0, credentials: 0, engines: [] };
const viewports = [{ width: 320, height: 568 }, { width: 390, height: 844 },
  { width: 430, height: 932 }, { width: 844, height: 390 }];
const writes = ['prompt.submit', 'image.attach_bytes', 'image.detach', 'session.interrupt', 'approval.respond',
  'remote.session.organize', 'remote.session.branch_from_row', 'remote.templates.put', 'remote.templates.remove', 'remote.project.create_session'];
for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  if (requestedEngine && requestedEngine !== engine) continue;
  const directory = join(output, engine); mkdirSync(directory);
  const home = join(directory, 'browser-home'), xdg = join(directory, 'xdg'); mkdirSync(home); mkdirSync(xdg);
  const fixture = await startFixture({ releaseDirectory: release }); seedSession(fixture);
  const result = { engine, version: '', status: 'RUNNING', cases: [], failures: [], screenshots: [], pageErrors: 0, warnings: 0,
    promptCount: 0, writeCount: 0, automaticSearchCount: 0 };
  report.engines.push(result);
  let browser, context;
  try {
    const cert = new X509Certificate(readFileSync(join(root, 'output/playwright/tls/fixture-cert.pem')));
    const spki = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, XDG_CACHE_HOME: xdg, XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg,
      HERMES_HOME: join(directory, 'HERMES_HOME'), HERMES_TEST_WEBKIT_DIR: dirname(webkit.executablePath()),
      HERMES_TEST_WEBKIT_PORT: process.env.HERMES_TEST_WEBKIT_PORT || 'wpe', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '' };
    mkdirSync(env.HERMES_HOME);
    browser = await browserType.launch({ env, timeout: 20000,
      ...(engine === 'webkit' && process.env.HERMES_TEST_LOCAL_WEBKIT === '1' ? { executablePath: join(root, 'scripts/run-webkit-local.sh') } : {}),
      ...(engine === 'chromium' ? { args: [`--ignore-certificate-errors-spki-list=${spki}`] } : {}) });
    result.version = browser.version();
    context = await browser.newContext({ viewport: viewports[1], locale: 'ja-JP', timezoneId: 'Asia/Tokyo', isMobile: true, hasTouch: true,
      ignoreHTTPSErrors: true, serviceWorkers: 'block', acceptDownloads: false, reducedMotion: 'reduce' });
    // The TLS exception applies only to this self-signed loopback fixture.
    await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    // A long registered name is returned through the fixture's real projects
    // response; native widgets and React props are left unchanged.
    const featureContext = longProject ? { routeWebSocket: (pattern, handler) => context.routeWebSocket(pattern, actual => {
      const projectIds = new Set();
      const patched = new Proxy(actual, { get(target, key) {
        if (key === 'onMessage') return callback => target.onMessage(message => {
          for (const line of String(message).split('\n').filter(Boolean)) {
            const frame = JSON.parse(line);
            if (frame.method === 'projects.tree') projectIds.add(`${typeof frame.id}:${frame.id}`);
          }
          callback(message);
        });
        if (key === 'connectToServer') return () => {
          const server = target.connectToServer();
          return new Proxy(server, { get(upstream, name) {
            if (name === 'onMessage') return callback => upstream.onMessage(message => {
              const lines = String(message).split('\n').filter(Boolean).map(line => {
                const frame = JSON.parse(line);
                if (projectIds.delete(`${typeof frame.id}:${frame.id}`) && frame.result?.projects) {
                  frame.result.projects = frame.result.projects.map(project => project.id === 'DEMO-plan'
                    ? { ...project, label: 'DEMO 日本語の非常に長い登録プロジェクト名 ' + '長い名前'.repeat(30) } : project);
                }
                return JSON.stringify(frame);
              });
              callback(lines.join('\n'));
            });
            const value = Reflect.get(upstream, name); return typeof value === 'function' ? value.bind(upstream) : value;
          } });
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
      handler(patched);
    }) } : context;
    const witness = await installFeatureFixture(featureContext, fixture);
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', () => result.pageErrors++);
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) result.warnings++; });
    await page.goto(`${fixture.origin}/hermes-remote-web/`, { waitUntil: 'domcontentloaded' });
    const history = page.getByRole('region', { name: '過去の会話', exact: true });
    await history.getByLabel('開始日', { exact: true }).waitFor();
    await history.getByRole('button', { name: 'DEMO 保存会話を整理', exact: true }).waitFor();
    if (longProject) {
      const projectSelect = history.locator('form select').first();
      await projectSelect.selectOption('DEMO-plan');
      assert.equal(await projectSelect.inputValue(), 'DEMO-plan');
      assert.ok((await projectSelect.locator('option:checked').textContent()).length > 100);
    }
    const searchReads = () => witness.methods.filter(method => method === 'remote.sessions.list').length;
    const initialReads = searchReads();
    for (const viewport of viewports) for (const font of [16, 32]) for (const filled of [false, true]) for (const colorScheme of ['light', 'dark']) {
      if (sample && (viewport.width !== 390 || font !== 32 || filled || colorScheme !== 'dark')) continue;
      await page.setViewportSize(viewport); await page.emulateMedia({ colorScheme });
      await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px`; }, font);
      await history.getByLabel('開始日', { exact: true }).fill(filled ? '2026-10-04' : '');
      await history.getByLabel('終了日', { exact: true }).fill(filled ? '2026-10-06' : '');
      await settleFrames(page, 4);
      const fields = await history.locator('.remote-conversation-fields').evaluate(node => {
        const rect = item => { const r = item.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const style = item => { const s = getComputedStyle(item); return { display: s.display, width: s.width, minWidth: s.minWidth, maxWidth: s.maxWidth,
          flexBasis: s.flexBasis, gridTemplateColumns: s.gridTemplateColumns, boxSizing: s.boxSizing, fontSize: s.fontSize, minHeight: s.minHeight, contain: s.contain }; };
        const inputs = [...node.querySelectorAll('input[type="date"]')];
        return { viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth,
          historyWidth: node.closest('.remote-conversation-tools').clientWidth, historyScrollWidth: node.closest('.remote-conversation-tools').scrollWidth,
          container: rect(node), containerStyle: style(node), nativeDateTypes: inputs.map(input => input.type),
          projectValue: node.closest('form').querySelector('select').value,
          formControls: [...node.closest('form').querySelectorAll('input,select')].map((input, index) => ({ index, tag: input.tagName, type: input.type,
            rect: rect(input), style: style(input), clientWidth: input.clientWidth, scrollWidth: input.scrollWidth, label: rect(input.parentElement), labelStyle: style(input.parentElement) })),
          overflowDescendants: [...node.closest('.remote-conversation-tools').querySelectorAll('*')].filter(item => item.getBoundingClientRect().right > node.closest('.remote-conversation-tools').getBoundingClientRect().right + 1)
            .map(item => ({ tag: item.tagName, className: item.getAttribute('class') || '', rect: rect(item), style: style(item) })),
          scrollOverflowDescendants: [...node.closest('.remote-conversation-tools').querySelectorAll('*')].filter(item => item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1)
            .map(item => ({ tag: item.tagName, className: item.getAttribute('class') || '', rect: rect(item), clientWidth: item.clientWidth, scrollWidth: item.scrollWidth,
              whiteSpace: getComputedStyle(item).whiteSpace, overflowWrap: getComputedStyle(item).overflowWrap, overflow: getComputedStyle(item).overflow, style: style(item) })),
          overflowingTextBoxes: [...node.closest('.remote-conversation-tools').querySelectorAll('label')].flatMap(label => [...label.childNodes].filter(item => item.nodeType === Node.TEXT_NODE).map(item => {
            const range = document.createRange(); range.selectNodeContents(item); const r = range.getBoundingClientRect();
            return { left: r.left, right: r.right, width: r.width, label: rect(label), labelStyle: style(label) };
          })).filter(item => item.right > item.label.right + 1),
          values: inputs.map(input => input.value), controls: inputs.map(input => ({ rect: rect(input), style: style(input), label: rect(input.parentElement), labelStyle: style(input.parentElement) })) };
      });
      const failures = [];
      if (fields.pageWidth > viewport.width + 1 || fields.historyScrollWidth > fields.historyWidth + 1) failures.push('horizontal_overflow');
      if (JSON.stringify(fields.nativeDateTypes) !== JSON.stringify(['date', 'date'])) failures.push('native_date_type_lost');
      if (JSON.stringify(fields.values) !== JSON.stringify(filled ? ['2026-10-04', '2026-10-06'] : ['', ''])) failures.push('native_date_value_lost');
      if (fields.projectValue !== (longProject ? 'DEMO-plan' : '')) failures.push('native_project_value_lost');
      for (const control of fields.controls) {
        if (control.rect.left < fields.container.left - 1 || control.rect.right > fields.container.right + 1
          || control.rect.right > control.label.right + 1) failures.push('date_outside_column');
        if (control.rect.width < 44 || control.rect.height < 44 || parseFloat(control.style.fontSize) < 16) failures.push('date_touch_or_font_too_small');
      }
      const row = { viewport, font, filled, colorScheme, status: failures.length ? 'FAIL' : 'PASS', fields, failures };
      result.cases.push(row); result.failures.push(...failures.map(rule => ({ viewport, font, filled, colorScheme, rule })));
      if (viewport.width === 390 && colorScheme === 'dark' && !filled) {
        await history.getByLabel('開始日', { exact: true }).scrollIntoViewIfNeeded(); await settleFrames(page, 4);
        const file = join(directory, `date-fields-390-${font}px.png`);
        await page.screenshot({ path: file }); result.screenshots.push({ path: file, sha256: sha(readFileSync(file)) });
        if (longProject) {
          const projectSelect = history.locator('form select').first();
          await projectSelect.scrollIntoViewIfNeeded(); await settleFrames(page, 4);
          const projectFile = join(directory, `project-native-long-390-${font}px.png`);
          await page.screenshot({ path: projectFile }); result.screenshots.push({ path: projectFile, sha256: sha(readFileSync(projectFile)) });
          await projectSelect.selectOption('DEMO-research'); assert.equal(await projectSelect.inputValue(), 'DEMO-research');
          await projectSelect.selectOption('DEMO-plan'); assert.equal(await projectSelect.inputValue(), 'DEMO-plan');
        }
      }
    }
    result.automaticSearchCount = searchReads() - initialReads;
    result.promptCount = fixture.state.submissions;
    result.writeCount = witness.methods.filter(method => writes.includes(method)).length + fixture.state.methods.filter(method => writes.includes(method)).length;
    assert.equal(result.automaticSearchCount, 0); assert.equal(result.promptCount, 0); assert.equal(result.writeCount, 0);
    assert.equal(witness.blockedWrites, 0); assert.equal(witness.outsideSockets, 0);
    assert.equal(result.pageErrors, 0); assert.equal(result.warnings, 0);
    result.status = result.failures.length ? 'FAIL' : 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.failure = { category: 'owned_native_date_probe_failed', detail: String(error.message).slice(0, 500) };
  } finally {
    result.cleanupErrors = [];
    for (const [name, close] of [['context', () => context?.close()], ['browser', () => browser?.close()], ['fixture', () => fixture.close()]]) {
      try { await close(); } catch { result.cleanupErrors.push(name); }
    }
    result.status = finalDateStatus(result);
  }
}
report.status = report.engines.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL';
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: report.status, phase, build: report.build, report: join(output, 'report.json'),
  engines: report.engines.map(({ engine, status, cases, failures }) => ({ engine, status, cases: cases.length, failures: failures.length })) }));
if (phase === 'after' && report.status !== 'PASS') process.exitCode = 1;
