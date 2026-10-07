import assert from 'node:assert/strict';
import { waitForReadOnlyObservation } from './worker-readiness.mjs';

/** UI-only measurements; no layout writes, network or application state edits. */
export async function geometry(page, targets = []) {
  return page.evaluate(selectors => {
    const visual = window.visualViewport;
    const viewport = { left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0,
      width: visual?.width || innerWidth, height: visual?.height || innerHeight, scale: visual?.scale || 1 };
    viewport.right = viewport.left + viewport.width; viewport.bottom = viewport.top + viewport.height;
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right,
      bottom: r.bottom, width: r.width, height: r.height }; };
    const measure = (node, label) => {
      const r = rect(node), style = getComputedStyle(node);
      const visible = Boolean(node.getClientRects().length) && style.visibility !== 'hidden'
        && style.display !== 'none' && Number(style.opacity) > 0;
      let clip = { ...viewport };
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        // Root overflow is propagated to the viewport. Native modal top-layer
        // children escape clipping by the modal's ordinary DOM ancestors.
        if (parent === document.body || parent === document.documentElement) break;
        const css = getComputedStyle(parent), bounds = rect(parent);
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, bounds.left); clip.right = Math.min(clip.right, bounds.right); }
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, bounds.top); clip.bottom = Math.min(clip.bottom, bounds.bottom); }
        if (parent instanceof HTMLDialogElement && parent.matches(':modal')) break;
      }
      const point = { x: Math.max(r.left, clip.left) + Math.max(0, Math.min(r.right, clip.right) - Math.max(r.left, clip.left)) / 2,
        y: Math.max(r.top, clip.top) + Math.max(0, Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top)) / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      const text = node.tagName === 'TEXTAREA' || node.tagName === 'INPUT';
      const number = value => parseFloat(value) || 0;
      const verticalChrome = number(style.paddingTop) + number(style.paddingBottom) + number(style.borderTopWidth) + number(style.borderBottomWidth);
      return { label, tag: node.tagName, rect: r, visible, fullyInViewport: r.left >= viewport.left - 1 && r.top >= viewport.top - 1
        && r.right <= viewport.right + 1 && r.bottom <= viewport.bottom + 1,
        unclipped: r.left >= clip.left - 1 && r.top >= clip.top - 1 && r.right <= clip.right + 1 && r.bottom <= clip.bottom + 1,
        hit: hit === node || Boolean(hit && node.contains(hit)), disabled: Boolean(node.disabled),
        fontSize: parseFloat(style.fontSize), lineHeight: style.lineHeight, minWidth: style.minWidth, minHeight: style.minHeight,
        padding: style.padding, margin: style.margin, boxSizing: style.boxSizing, clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        contentBoxHeight: Math.max(0, r.height - verticalChrome),
        visibleContentBoxHeight: Math.max(0, Math.min(r.bottom - number(style.paddingBottom) - number(style.borderBottomWidth), clip.bottom)
          - Math.max(r.top + number(style.paddingTop) + number(style.borderTopWidth), clip.top)),
        ...(text ? { selectionStart: node.selectionStart, selectionEnd: node.selectionEnd, valueLength: node.value.length } : {}) };
    };
    const matches = selectors.map(({ selector, label }) => {
      const nodes = [...document.querySelectorAll(selector)];
      return { selector, label, matchCount: nodes.length, controls: nodes.map((node, index) => measure(node, `${label}:${index}`)) };
    });
    const controls = matches.flatMap(match => match.controls);
    const root = getComputedStyle(document.documentElement);
    return { viewport, layoutViewport: { width: innerWidth, height: innerHeight }, documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      variables: Object.fromEntries(['--remote-height', '--remote-top', '--remote-viewport-height', '--remote-viewport-top'].map(name => [name, root.getPropertyValue(name).trim()])),
      activeTag: document.activeElement?.tagName, activeLabel: document.activeElement?.getAttribute('aria-label') || '',
      openDialogs: [...document.querySelectorAll('dialog[open]')].map(node => ({ label: node.getAttribute('aria-label'), rect: rect(node), containsFocus: node.contains(document.activeElement) })),
      targets: matches.map(({ selector, label, matchCount }) => ({ selector, label, matchCount })), controls };
  }, targets);
}

/** Room for a body line AND actual unclipped text. Never return message text. */
export async function readableTranscript(page) {
  const value = await geometry(page, [{ selector: '.remote-transcript', label: 'transcript' }]);
  const lineHeight = await page.locator('.remote-transcript').evaluate(root => {
    const node = root.querySelector('.remote-message-content') || root;
    const style = getComputedStyle(node);
    return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
  });
  const body = value.controls[0];
  const spaceReadable = Boolean(body && body.visible && body.hit && body.visibleContentBoxHeight + 1 >= lineHeight);
  const glyph = await visibleTranscriptText(page);
  return { value, minimumLineHeight: lineHeight, spaceReadable, glyph,
    readable: spaceReadable && glyph.readable };
}

/** Native non-whitespace Range/style/hit geometry. Not a full paint-occlusion
 * witness (for example pointer-events:none overlays). Never return text. */
export async function visibleTranscriptText(page) {
  return page.locator('.remote-transcript').evaluate(root => {
    const bounds = root.getBoundingClientRect(), style = getComputedStyle(root);
    const viewport = window.visualViewport;
    const clip = {
      top: Math.max(bounds.top + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0), viewport?.offsetTop || 0),
      bottom: Math.min(bounds.bottom - (parseFloat(style.paddingBottom) || 0) - (parseFloat(style.borderBottomWidth) || 0), (viewport?.offsetTop || 0) + (viewport?.height || innerHeight)),
      left: Math.max(bounds.left + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0), viewport?.offsetLeft || 0),
      right: Math.min(bounds.right - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderRightWidth) || 0), (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth)),
    };
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) {
        return { clip, targetCount: 0, nodes: 0, rectangles: 0, fullyVisibleLines: 0, partialLines: 0,
          readable: false, truncated: false, samples: [], noTextOrMessageIdsRecorded: true };
      }
      if (ancestor === document.body || ancestor === document.documentElement) continue;
      if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowY)) {
        clip.top = Math.max(clip.top, box.top + (parseFloat(css.borderTopWidth) || 0));
        clip.bottom = Math.min(clip.bottom, box.bottom - (parseFloat(css.borderBottomWidth) || 0));
      }
      if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowX)) {
        clip.left = Math.max(clip.left, box.left + (parseFloat(css.borderLeftWidth) || 0));
        clip.right = Math.min(clip.right, box.right - (parseFloat(css.borderRightWidth) || 0));
      }
    }
    let nodes = 0, textRuns = 0, rectangles = 0, fullyVisibleLines = 0, partialLines = 0;
    const samples = [];
    const targets = [...root.querySelectorAll('.remote-message-content, .remote-message-body > details > summary, .remote-tool-activity > summary, .remote-chat-empty > h1, .remote-chat-empty > p')];
    for (const target of targets) {
      const targetBox = target.getBoundingClientRect();
      if (targetBox.bottom <= clip.top || targetBox.top >= clip.bottom || targetBox.right <= clip.left || targetBox.left >= clip.right) continue;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT); let text;
      while ((text = walker.nextNode())) {
        if (++nodes > 512) break;
        if (!text.textContent.trim() || text.parentElement?.closest('button,[aria-hidden="true"]')) continue;
        let visibleClip = { ...clip }, hidden = false;
        for (let ancestor = text.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
          if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) { hidden = true; break; }
          if (ancestor === root) break;
          if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowY)) {
            visibleClip.top = Math.max(visibleClip.top, box.top + (parseFloat(css.borderTopWidth) || 0));
            visibleClip.bottom = Math.min(visibleClip.bottom, box.bottom - (parseFloat(css.borderBottomWidth) || 0));
          }
          if (['auto', 'scroll', 'hidden', 'clip'].includes(css.overflowX)) {
            visibleClip.left = Math.max(visibleClip.left, box.left + (parseFloat(css.borderLeftWidth) || 0));
            visibleClip.right = Math.min(visibleClip.right, box.right - (parseFloat(css.borderRightWidth) || 0));
          }
        }
        if (hidden) continue;
        const textStyle = getComputedStyle(text.parentElement);
        const transparentInk = value => value === 'transparent'
          || /^rgba\([^)]*,\s*0(?:\.0*)?%?\s*\)$/.test(value)
          || /\/\s*0(?:\.0*)?%?\s*\)$/.test(value);
        if (transparentInk(textStyle.color) || transparentInk(textStyle.getPropertyValue('-webkit-text-fill-color'))) continue;
        const range = document.createRange(), words = /\S+/gu;
        const halfCharacter = Math.max(1, (parseFloat(textStyle.fontSize) || 16) / 2);
        // A full-node Range includes empty preformatted rows. Restrict geometry
        // to actual non-whitespace runs without recording their contents.
        let word;
        while ((word = words.exec(text.textContent))) {
          if (++textRuns > 4096) break;
          range.setStart(text, word.index); range.setEnd(text, word.index + word[0].length);
          for (const box of range.getClientRects()) {
            if (++rectangles > 4096) break;
            const vertical = Math.max(0, Math.min(box.bottom, visibleClip.bottom) - Math.max(box.top, visibleClip.top));
            const horizontal = Math.max(0, Math.min(box.right, visibleClip.right) - Math.max(box.left, visibleClip.left));
            const full = box.height > 0 && vertical + 1 >= box.height && horizontal >= Math.min(box.width, halfCharacter);
            const y = Math.max(box.top, visibleClip.top) + vertical / 2, x = Math.max(box.left, visibleClip.left) + horizontal / 2;
            const hits = vertical > 0 && horizontal > 0 ? document.elementsFromPoint(x, y) : [];
            const hitNode = hits[0], parent = text.parentElement;
            const hit = Boolean(hitNode && (hitNode === parent || hitNode.contains(parent)));
            if (vertical > 0 && horizontal > 0 && hit) partialLines++;
            if (full && hit) fullyVisibleLines++;
            if (samples.length < 16 && vertical > 0) samples.push({ tag: target.tagName, top: box.top, bottom: box.bottom, height: box.height, visibleHeight: vertical, full, hit });
          }
          if (rectangles > 4096) break;
        }
        range.detach();
        if (textRuns > 4096 || rectangles > 4096) break;
      }
      if (nodes > 512 || textRuns > 4096 || rectangles > 4096) break;
    }
    return { clip, targetCount: targets.length, nodes, textRuns, rectangles, fullyVisibleLines, partialLines,
      readable: fullyVisibleLines > 0, truncated: nodes > 512 || textRuns > 4096 || rectangles > 4096, samples,
      measurement: 'NATIVE_NON_WHITESPACE_RANGE_STYLE_AND_HIT_GEOMETRY',
      countMeaning: 'NON_WHITESPACE_RANGE_RECTANGLES_NOT_UNIQUE_TEXT_LINES',
      fullPaintOcclusionWitness: false,
      noTextOrMessageIdsRecorded: true };
  });
}

/** Visible message identity/fraction only; no conversation text is returned. */
export async function readerAnchor(page) {
  return page.locator('.remote-transcript').evaluate(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const top = rect.top + (parseFloat(style.paddingTop) || 0), bottom = rect.bottom - (parseFloat(style.paddingBottom) || 0);
    const article = [...node.querySelectorAll('[data-message-id]')].find(item => {
      const r = item.getBoundingClientRect(); return r.bottom > top && r.top < bottom;
    });
    if (!article) return null;
    const r = article.getBoundingClientRect();
    return { message: article.getAttribute('data-message-id'), fraction: Math.max(0, (top - r.top) / r.height),
      relativeTop: r.top - top, height: r.height, scrollTop: node.scrollTop };
  });
}

export function geometryFailures(value, { touch = 44, input = false, required = true } = {}) {
  const errors = [];
  if (value.overflowX > 1) errors.push({ rule: 'document_horizontal_overflow', actual: value.overflowX, limit: 1 });
  if (required && !value.controls.length) errors.push({ rule: 'required_control_missing' });
  // A remaining control must not hide the disappearance of another required
  // selector. A selector may deliberately address several action buttons.
  if (required && Array.isArray(value.targets)) for (const target of value.targets) {
    if (!Number.isInteger(target.matchCount) || target.matchCount < 1) errors.push({
      rule: 'required_selector_missing', label: target.label, selector: target.selector, matchCount: target.matchCount,
    });
  }
  for (const control of value.controls) {
    if (!control.visible) errors.push({ rule: 'control_hidden', label: control.label });
    if (!control.fullyInViewport) errors.push({ rule: 'control_outside_visual_viewport', label: control.label, rect: control.rect });
    if (!control.unclipped) errors.push({ rule: 'control_clipped', label: control.label });
    if (!control.hit) errors.push({ rule: 'control_covered', label: control.label });
    if (control.rect.width + .01 < touch || control.rect.height + .01 < touch) errors.push({ rule: 'touch_target', label: control.label, actual: control.rect, minimum: touch });
    if (input && control.tag === 'TEXTAREA' && control.fontSize < 16) errors.push({ rule: 'input_below_16px', label: control.label, actual: control.fontSize });
  }
  return errors;
}

export async function settleFrames(page, count = 3) {
  await page.evaluate(total => new Promise(done => { let remaining = total; const step = () => --remaining <= 0 ? done() : requestAnimationFrame(step); requestAnimationFrame(step); }), count);
}

/** Finite frame samples detect oscillation rather than declaring rAF itself a fix. */
export async function sampleFrames(page, selectors, count = 24) {
  assert.ok(count > 0 && count <= 120);
  return page.evaluate(({ selectors, count }) => new Promise(done => {
    const frames = [];
    const step = () => {
      frames.push(selectors.map(selector => {
        const node = document.querySelector(selector); if (!node) return null;
        const r = node.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height, scrollTop: node.scrollTop };
      }));
      if (frames.length === count) done(frames); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { selectors, count });
}

export function stableTail(frames, length = 8) {
  const tail = frames.slice(-length);
  return tail.length === length && tail.every(frame => JSON.stringify(frame) === JSON.stringify(tail[0]));
}

export async function installViewportFixture(context, { clipboard = true } = {}) {
  assert.equal(typeof clipboard, 'boolean');
  await context.addInitScript(({ clipboard }) => {
    const native = visualViewport;
    const viewport = new EventTarget();
    const state = { height: null, width: null, top: 0, left: 0, scale: 1 };
    Object.defineProperties(viewport, {
      height: { get: () => state.height ?? native?.height ?? innerHeight },
      width: { get: () => state.width ?? native?.width ?? innerWidth },
      offsetTop: { get: () => state.top }, offsetLeft: { get: () => state.left }, scale: { get: () => state.scale },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.__DEMO_uiuxViewport = state;
    if (clipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } });
  }, { clipboard });
}

export async function visualViewport(page, height = null, top = 0, scale = 1) {
  await page.evaluate(value => { Object.assign(window.__DEMO_uiuxViewport, value); visualViewport.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('scroll')); }, { height, top, scale });
  await settleFrames(page);
}

export async function focusTrap(page, dialog) {
  const before = await dialog.evaluate(node => node.contains(document.activeElement));
  const errors = [];
  if (!before) errors.push('initial_focus_outside');
  await dialog.evaluate(node => {
    const controls = [...node.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')]
      .filter(item => item.getClientRects().length && !item.closest('[hidden],[inert]'));
    controls.at(-1)?.focus({ preventScroll: true });
  });
  await page.keyboard.press('Tab');
  if (!await dialog.evaluate(node => node.contains(document.activeElement))) errors.push('tab_escaped');
  await page.keyboard.press('Shift+Tab');
  if (!await dialog.evaluate(node => node.contains(document.activeElement))) errors.push('reverse_tab_escaped');
  return errors;
}

/** Real keyboard traversal and scrolling, with no synthetic scroll fallback. */
export async function keyboardScrollBody(page, body, close, maximumTabs = 16) {
  assert.ok(Number.isInteger(maximumTabs) && maximumTabs > 0 && maximumTabs <= 32);
  const result = { status: 'FAIL', tabs: 0, before: await body.evaluate(node => ({ tabIndex: node.tabIndex, role: node.getAttribute('role'),
    height: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop })),
    documentBefore: await page.evaluate(() => ({ x: scrollX, y: scrollY })) };
  try {
    assert.equal(result.before.tabIndex, 0, 'Body must be an actual tab stop');
    assert.equal(result.before.role, 'region', 'Body must have a named region');
    await close.focus();
    while (!await body.evaluate(node => node === document.activeElement) && result.tabs < maximumTabs) {
      await page.keyboard.press('Tab'); result.tabs++;
    }
    assert.ok(await body.evaluate(node => node === document.activeElement), 'Tab must reach the body itself');
    await page.keyboard.press('End');
    await waitForReadOnlyObservation(() => body.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1),
      { timeoutMs: 3000, intervalMs: 50, label: 'keyboard_body_end' });
    result.end = await body.evaluate(node => ({ scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }));
    if (result.end.scrollTop > 1) {
      result.endFrames = await settledScroll(body);
      await page.keyboard.press('ArrowUp');
      await waitForReadOnlyObservation(() => body.evaluate((node, top) => node.scrollTop < top - 1, result.end.scrollTop),
        { timeoutMs: 3000, intervalMs: 50, label: 'keyboard_body_arrow_up' });
      result.arrowUp = await body.evaluate(node => ({ scrollTop: node.scrollTop }));
      // A first changed pixel proves movement, not completion of the native
      // ArrowUp animation. Keep every End assertion, but serialize real keys.
      result.arrowFrames = await settledScroll(body);
      await page.keyboard.press('End');
      await waitForReadOnlyObservation(() => body.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1),
        { timeoutMs: 3000, intervalMs: 50, label: 'keyboard_body_return_end' });
    }
    result.documentAfter = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    assert.deepEqual(result.documentAfter, result.documentBefore, 'Only the dialog body may scroll');
    result.status = 'PASS';
  } catch (error) { result.error = String(error.message).slice(0, 800); }
  return result;
}

async function settledScroll(body) {
  const frames = await body.evaluate(node => new Promise((done, reject) => {
    const rows = []; let frame = 0, stopped = false;
    const timer = setTimeout(() => { stopped = true; cancelAnimationFrame(frame); reject(new Error('Native scroll frame observation expired')); }, 3000);
    const step = () => {
      if(stopped)return;
      rows.push({ scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight });
      if (rows.length === 32) { stopped = true; clearTimeout(timer); done(rows); } else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }));
  assert.ok(stableTail(frames), 'Native scroll must finish before the next key');
  return frames;
}
