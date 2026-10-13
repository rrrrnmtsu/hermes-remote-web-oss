import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyPhase = 'idle' | 'pending' | 'success' | 'error';

/** Explicit clipboard writes only; feedback is scoped, bounded and memory-only. */
export function useCopyFeedback(scope = '') {
  const [phase, setPhase] = useState<CopyPhase>('idle');
  const mounted = useRef(false);
  const busy = useRef(false);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const invalidate = useCallback(() => {
    revision.current++;
    clearTimeout(timer.current);
  }, []);
  const reset = useCallback(() => {
    invalidate();
    // Closing a menu cannot cancel the OS clipboard operation. Keep its lock
    // until settlement, but never show its completion in a reopened scope.
    setPhase(busy.current ? 'pending' : 'idle');
  }, [invalidate]);
  useEffect(() => {
    mounted.current = true;
    reset();
    return () => { mounted.current = false; invalidate(); };
  }, [scope, reset, invalidate]);
  const copy = useCallback(async (text: string) => {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    const token = ++revision.current;
    clearTimeout(timer.current);
    setPhase('pending');
    let result: CopyPhase = 'success';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(text);
    } catch { result = 'error'; }
    finally { busy.current = false; }
    if (!mounted.current) return;
    if (token !== revision.current) { setPhase('idle'); return; }
    setPhase(result);
    if (result === 'success') timer.current = setTimeout(() => {
      if (mounted.current && token === revision.current) setPhase('idle');
    }, 2200);
  }, []);
  const feedback = phase === 'pending' ? 'コピー中…' : phase === 'success' ? 'コピーしました'
    : phase === 'error' ? 'コピーできません。本文を選択してください。' : '';
  return { phase, feedback, copy, reset };
}
