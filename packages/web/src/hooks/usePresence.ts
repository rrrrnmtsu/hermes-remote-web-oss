import { useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

interface Presence {
  mounted: boolean;
  leaving: boolean;
}

export function usePresence(open: boolean, duration = 220): Presence {
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<Presence>({ mounted: open, leaving: false });

  const finish = useCallback(() => {
    setState({ mounted: false, leaving: false });
  }, []);

  useEffect(() => {
    if (open) {
      setState({ mounted: true, leaving: false });
      return;
    }

    if (!state.mounted) return;

    if (reducedMotion) {
      finish();
      return;
    }

    setState((s) => ({ ...s, leaving: true }));
    const timer = setTimeout(finish, duration);
    return () => clearTimeout(timer);
  }, [open, reducedMotion, duration, state.mounted, finish]);

  return state;
}
