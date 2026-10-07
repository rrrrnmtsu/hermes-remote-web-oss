import { setTimeout as delay } from 'node:timers/promises';

/** Await read-only observations; never retry registration, activation or an RPC. */
export async function waitForReadOnlyObservation(observe, { timeoutMs = 20_000, intervalMs = 100, label = 'worker_state' } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('Invalid observation bound');
  let stopped = false; let timer; let observations = 0;
  const started = performance.now();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Read-only observation timed out: ${label}`)), timeoutMs);
  });
  const polling = (async () => {
    while (!stopped) {
      observations++;
      // Playwright waitForFunction tests an async predicate's Promise for truthiness.
      // Await here so an asynchronously resolved false cannot satisfy readiness.
      const ready = await observe();
      if (ready === true) return { observations, elapsedMs: Math.round(performance.now() - started) };
      if (!stopped) await delay(intervalMs);
    }
    throw new Error(`Read-only observation stopped: ${label}`);
  })();
  try { return await Promise.race([polling, timeout]); }
  finally { stopped = true; clearTimeout(timer); }
}

/** Check only this app's exact registration; false/unknown states stay failures. */
export async function waitForOwnedWorkerState(page, expected, options = {}) {
  if (!['registered', 'waiting'].includes(expected)) throw new Error('Invalid worker observation state');
  return await waitForReadOnlyObservation(() => page.evaluate(async state => {
    const scope = `${location.origin}/hermes-remote-web/`;
    const registration = (await navigator.serviceWorker.getRegistrations()).find(item => item.scope === scope);
    return state === 'registered' ? Boolean(registration) : Boolean(registration?.waiting && registration.waiting.state === 'installed');
  }, expected), { ...options, label: `owned_worker_${expected}` });
}
