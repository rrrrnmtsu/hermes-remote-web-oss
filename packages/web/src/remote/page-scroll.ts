import { useLayoutEffect, useRef } from 'react';

/** View positions are bounded, memory-only and owned by the current profile. */
export function usePageScroll(page: string, owner: string) {
  const main = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  const previousOwner = useRef(owner);
  useLayoutEffect(() => {
    if (previousOwner.current !== owner) { positions.current.clear(); previousOwner.current = owner; }
    if (main.current) main.current.scrollTop = positions.current.get(page) || 0;
  }, [page, owner]);
  const remember = (): void => {
    if (!main.current) return;
    positions.current.set(page, main.current.scrollTop);
    if (positions.current.size > 12) positions.current.delete(positions.current.keys().next().value!);
  };
  return { main, remember };
}
