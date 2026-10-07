import { useLayoutEffect } from 'react';

interface ViewportBounds { width: number; height: number; top: number; left: number }
const VIEWPORT_PROPERTIES = ['--remote-width', '--remote-height', '--remote-top', '--remote-left', '--remote-layout-width', '--remote-layout-height'] as const;
const positive = (value: number | undefined, fallback: number): number => Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
const offset = (value: number | undefined): number => Number.isFinite(value) ? Math.max(0, Number(value)) : 0;

/** One browser-shell projection. Pinch zoom retains the pre-zoom layout bounds:
 * the browser owns magnification and panning; CSS must not reflow against each
 * shrinking/panning VisualViewport sample. Text enlargement is independent. */
export function observeRemoteViewport(browser: Window = window): () => void {
  const root = browser.document.documentElement;
  const previousProperties = VIEWPORT_PROPERTIES.map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)] as const);
  const previousKeyboard = root.dataset.remoteKeyboard, previousCompact = root.dataset.remoteCompact;
  const visual = browser.visualViewport;
  let frame: number | null = null, disposed = false;
  let layoutWidth = browser.innerWidth, unfocusedHeight = browser.innerHeight;
  let bounds: ViewportBounds | null = null;
  const update = (): void => {
    frame = null;
    if (disposed) return;
    const width = positive(browser.innerWidth, 320), height = positive(browser.innerHeight, 568);
    const zoomed = Math.abs(positive(visual?.scale, 1) - 1) > .05;
    const orientationChanged = width !== layoutWidth;
    if (orientationChanged) { layoutWidth = width; unfocusedHeight = height; }
    if (!zoomed) bounds = { width: positive(visual?.width, width), height: positive(visual?.height, height),
      top: offset(visual?.offsetTop), left: offset(visual?.offsetLeft) };
    else if (!bounds || orientationChanged) bounds = { width, height, top: 0, left: 0 };
    const active = browser.document.activeElement;
    const editing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
      && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(active.type);
    if (!editing && !zoomed) unfocusedHeight = Math.max(height, bounds.height);
    const keyboard = editing && !zoomed && Math.max(unfocusedHeight, height) - bounds.height > 100;
    for (const [name, value] of Object.entries({ '--remote-width': bounds.width, '--remote-height': bounds.height,
      '--remote-top': bounds.top, '--remote-left': bounds.left, '--remote-layout-width': width, '--remote-layout-height': height })) {
      const text = `${value}px`;
      if (root.style.getPropertyValue(name) !== text) root.style.setProperty(name, text);
    }
    const keyboardValue = keyboard ? 'true' : 'false', compactValue = bounds.height <= 360 ? 'true' : 'false';
    if (root.dataset.remoteKeyboard !== keyboardValue) root.dataset.remoteKeyboard = keyboardValue;
    if (root.dataset.remoteCompact !== compactValue) root.dataset.remoteCompact = compactValue;
  };
  const schedule = (): void => { if (!disposed && frame === null) frame = browser.requestAnimationFrame(update); };
  update();
  for (const event of ['resize', 'orientationchange']) browser.addEventListener(event, schedule);
  for (const event of ['resize', 'scroll']) visual?.addEventListener(event, schedule);
  for (const event of ['focusin', 'focusout']) browser.document.addEventListener(event, schedule);
  return () => {
    disposed = true;
    if (frame !== null) browser.cancelAnimationFrame(frame);
    for (const event of ['resize', 'orientationchange']) browser.removeEventListener(event, schedule);
    for (const event of ['resize', 'scroll']) visual?.removeEventListener(event, schedule);
    for (const event of ['focusin', 'focusout']) browser.document.removeEventListener(event, schedule);
    for (const [name, value, priority] of previousProperties) {
      if (value) root.style.setProperty(name, value, priority); else root.style.removeProperty(name);
    }
    if (previousKeyboard === undefined) delete root.dataset.remoteKeyboard; else root.dataset.remoteKeyboard = previousKeyboard;
    if (previousCompact === undefined) delete root.dataset.remoteCompact; else root.dataset.remoteCompact = previousCompact;
  };
}

export function useRemoteViewport(): void {
  useLayoutEffect(() => observeRemoteViewport(), []);
}
