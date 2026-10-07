import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeRemoteViewport } from './viewport';

let viewport: EventTarget & { width: number; height: number; offsetTop: number; offsetLeft: number; scale: number };
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
let dispose: (() => void) | undefined;
let originalWidth: number, originalHeight: number;
const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
beforeEach(() => {
  originalWidth = window.innerWidth; originalHeight = window.innerHeight;
  Object.defineProperties(window, { innerWidth: { configurable: true, value: 390 }, innerHeight: { configurable: true, value: 844 } });
  viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  frames = new Map(); nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => {
  dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  Object.defineProperties(window, { innerWidth: { configurable: true, value: originalWidth }, innerHeight: { configurable: true, value: originalHeight } });
});

describe('one remote viewport projection', () => {
  it('coalesces a resize/scroll burst and writes only changed dimensions', () => {
    dispose = observeRemoteViewport();
    const write = vi.spyOn(document.documentElement.style, 'setProperty');
    for (let i = 0; i < 20; i++) { viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); }
    expect(frames.size).toBe(1); expect(write).not.toHaveBeenCalled(); flush(); expect(write).not.toHaveBeenCalled();
    Object.assign(viewport, { height: 280, offsetTop: 80 });
    viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
    expect(write).not.toHaveBeenCalled(); flush();
    expect(write.mock.calls).toEqual([['--remote-height', '280px'], ['--remote-top', '80px']]);
    expect(document.documentElement.dataset.remoteCompact).toBe('true');
  });

  it('retains pre-zoom layout bounds instead of following pinch panning/sizing', () => {
    const input = document.createElement('textarea'); document.body.append(input); input.focus();
    Object.assign(viewport, { height: 280, offsetTop: 80 }); dispose = observeRemoteViewport();
    expect(document.documentElement.dataset.remoteKeyboard).toBe('true');
    Object.assign(viewport, { scale: 2, width: 195, height: 140, offsetTop: 150, offsetLeft: 70 });
    viewport.dispatchEvent(new Event('scroll')); flush();
    expect(document.documentElement.style.getPropertyValue('--remote-width')).toBe('390px');
    expect(document.documentElement.style.getPropertyValue('--remote-height')).toBe('280px');
    expect(document.documentElement.style.getPropertyValue('--remote-top')).toBe('80px');
    expect(document.documentElement.style.getPropertyValue('--remote-left')).toBe('0px');
    expect(document.documentElement.dataset.remoteKeyboard).toBe('false');
  });

  it('separates focus and browser chrome from a large editing viewport reduction', () => {
    dispose = observeRemoteViewport();
    const input = document.createElement('textarea'); document.body.append(input); input.focus(); flush();
    expect(document.documentElement.dataset.remoteKeyboard).toBe('false');
    Object.assign(viewport, { height: 800 }); viewport.dispatchEvent(new Event('resize')); flush();
    expect(document.documentElement.dataset.remoteKeyboard).toBe('false');
    Object.assign(viewport, { height: 360 }); viewport.dispatchEvent(new Event('resize')); flush();
    expect(document.documentElement.dataset.remoteKeyboard).toBe('true');
    input.blur(); flush(); expect(document.documentElement.dataset.remoteKeyboard).toBe('false');
  });

  it('cancels late frames and restores only its owned previous CSS/dataset values', () => {
    const root = document.documentElement;
    root.style.setProperty('--remote-height', '700px'); root.style.setProperty('--foreign-app-test', 'DEMO-preserve');
    root.dataset.remoteKeyboard = 'DEMO-previous';
    dispose = observeRemoteViewport();
    viewport.height = 280; viewport.dispatchEvent(new Event('resize'));
    const late = [...frames.values()][0]!; dispose(); dispose = undefined;
    expect(frames.size).toBe(0);
    late(0);
    expect(root.style.getPropertyValue('--remote-height')).toBe('700px');
    expect(root.style.getPropertyValue('--foreign-app-test')).toBe('DEMO-preserve');
    expect(root.dataset.remoteKeyboard).toBe('DEMO-previous');
    root.style.removeProperty('--remote-height'); root.style.removeProperty('--foreign-app-test'); delete root.dataset.remoteKeyboard;
  });

  it('uses layout fallbacks and never publishes invalid/non-positive sizes', () => {
    Object.assign(viewport, { height: Number.NaN, width: -1, offsetTop: -30, offsetLeft: Number.NaN, scale: 0 });
    dispose = observeRemoteViewport();
    expect(document.documentElement.style.getPropertyValue('--remote-height')).toBe('844px');
    expect(document.documentElement.style.getPropertyValue('--remote-width')).toBe('390px');
    expect(document.documentElement.style.getPropertyValue('--remote-top')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--remote-left')).toBe('0px');
  });
});
