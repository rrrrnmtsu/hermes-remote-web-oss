import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopyFeedback } from './use-copy-feedback';

function clipboard() {
  let resolve!: () => void;
  let reject!: () => void;
  const writeText = vi.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error('DEMO denied')); }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return { writeText, resolve: () => resolve(), reject: () => reject() };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('explicit scoped clipboard feedback', () => {
  it('deduplicates pending taps, confirms settlement and expires success without another write', async () => {
    const port = clipboard(), { result } = renderHook(() => useCopyFeedback());
    expect(port.writeText).not.toHaveBeenCalled();
    act(() => { void result.current.copy('DEMO 日本語\nline'); void result.current.copy('DEMO duplicate'); });
    expect(result.current.phase).toBe('pending'); expect(port.writeText).toHaveBeenCalledTimes(1);
    expect(port.writeText).toHaveBeenCalledWith('DEMO 日本語\nline');
    await act(async () => port.resolve()); expect(result.current.phase).toBe('success');
    act(() => vi.advanceTimersByTime(2199)); expect(result.current.phase).toBe('success');
    act(() => vi.advanceTimersByTime(1)); expect(result.current.phase).toBe('idle');
    expect(port.writeText).toHaveBeenCalledTimes(1);
  });
  it('keeps failure visible and retries only on explicit action', async () => {
    const port = clipboard(), { result } = renderHook(() => useCopyFeedback());
    act(() => { void result.current.copy('DEMO'); }); await act(async () => port.reject());
    act(() => vi.advanceTimersByTime(10000)); expect(result.current.phase).toBe('error');
    expect(port.writeText).toHaveBeenCalledTimes(1);
    act(() => { void result.current.copy('DEMO retry'); }); await act(async () => port.resolve());
    expect(result.current.phase).toBe('success'); expect(port.writeText).toHaveBeenCalledTimes(2);
  });
  it.each(['reset', 'scope'] as const)('invalidates late feedback after %s while retaining the OS write lock', async change => {
    const port = clipboard(), hook = renderHook(({ scope }) => useCopyFeedback(scope), { initialProps: { scope: 'DEMO-one' } });
    act(() => { void hook.result.current.copy('DEMO'); });
    if (change === 'reset') act(() => hook.result.current.reset()); else hook.rerender({ scope: 'DEMO-two' });
    act(() => { void hook.result.current.copy('DEMO suppressed'); });
    expect(port.writeText).toHaveBeenCalledTimes(1);
    await act(async () => port.resolve()); expect(hook.result.current.phase).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    act(() => { void hook.result.current.copy('DEMO new'); }); await act(async () => port.resolve());
    expect(hook.result.current.phase).toBe('success'); expect(port.writeText).toHaveBeenCalledTimes(2);
  });
  it('clears success timers on unmount and never schedules feedback after late settlement', async () => {
    const port = clipboard(), first = renderHook(() => useCopyFeedback());
    act(() => { void first.result.current.copy('DEMO'); }); first.unmount();
    await act(async () => port.resolve()); expect(vi.getTimerCount()).toBe(0);
    const second = renderHook(() => useCopyFeedback());
    act(() => { void second.result.current.copy('DEMO'); }); await act(async () => port.resolve());
    expect(vi.getTimerCount()).toBe(1); second.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['unavailable', 'throws'])('reports %s clipboard access without an unhandled rejection', async mode => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : { writeText() { throw new Error('DEMO'); } } });
    const { result } = renderHook(() => useCopyFeedback());
    await act(async () => result.current.copy('DEMO')); expect(result.current.phase).toBe('error');
    act(() => result.current.reset()); expect(result.current.phase).toBe('idle');
  });
});
