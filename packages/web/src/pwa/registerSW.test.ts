import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerServiceWorker } from './registerSW';

describe('registerServiceWorker', () => {
  let originalNavigator: Navigator;
  let controllerChangeHandler: (() => void) | undefined;

  function mockServiceWorkerContainer(options: { controller?: object | null; update?: () => Promise<void> } = {}) {
    const update = options.update ?? vi.fn().mockResolvedValue(undefined);
    const serviceWorker = {
      controller: options.controller ?? null,
      register: vi.fn().mockResolvedValue({ scope: '/app/', update }),
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'controllerchange') controllerChangeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        serviceWorker,
      },
      writable: true,
      configurable: true,
    });
    return serviceWorker;
  }

  function mockLocationReload() {
    const reload = vi.fn();
    Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
    return reload;
  }

  beforeEach(() => {
    originalNavigator = globalThis.navigator as Navigator;
    controllerChangeHandler = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, writable: true, configurable: true });
  });

  it('returns unsupported when serviceWorker is not in navigator', async () => {
    const navWithoutSw = { ...originalNavigator };
    delete (navWithoutSw as Record<string, unknown>).serviceWorker;
    Object.defineProperty(globalThis, 'navigator', {
      value: navWithoutSw,
      writable: true,
      configurable: true,
    });
    const state = await registerServiceWorker();
    expect(state.status).toBe('unsupported');
  });

  it('returns ready with scope on successful registration', async () => {
    mockServiceWorkerContainer();
    const state = await registerServiceWorker();
    expect(state.status).toBe('ready');
    expect(state.scope).toBe('/app/');
  });

  it('does not prompt for reload on first service worker install', async () => {
    const serviceWorker = mockServiceWorkerContainer({ controller: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await registerServiceWorker();

    expect(serviceWorker.addEventListener).not.toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('prompts and reloads when an updated service worker takes control', async () => {
    mockServiceWorkerContainer({ controller: {} });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const reload = mockLocationReload();

    await registerServiceWorker();
    controllerChangeHandler?.();
    controllerChangeHandler?.();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the current page when the user declines the service worker reload prompt', async () => {
    mockServiceWorkerContainer({ controller: {} });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const reload = mockLocationReload();

    await registerServiceWorker();
    controllerChangeHandler?.();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('silently checks for service worker updates on startup, focus and visible return', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const mockRegistration = { scope: '/app/', update };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        serviceWorker: {
          register: vi.fn().mockResolvedValue(mockRegistration),
        },
      },
      writable: true,
      configurable: true,
    });

    await registerServiceWorker();
    expect(update).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('keeps registration ready when update checks fail', async () => {
    const mockRegistration = { scope: '/app/', update: vi.fn().mockRejectedValue(new Error('network')) };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        serviceWorker: {
          register: vi.fn().mockResolvedValue(mockRegistration),
        },
      },
      writable: true,
      configurable: true,
    });

    const state = await registerServiceWorker();
    expect(state.status).toBe('ready');
    expect(state.scope).toBe('/app/');
  });

  it('returns failed with error message on registration failure', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        serviceWorker: {
          register: vi.fn().mockRejectedValue(new Error('SecurityError')),
        },
      },
      writable: true,
      configurable: true,
    });
    const state = await registerServiceWorker();
    expect(state.status).toBe('failed');
    expect(state.error).toBe('SecurityError');
  });

  it('returns failed with string error when thrown value is not an Error', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...originalNavigator,
        serviceWorker: {
          register: vi.fn().mockRejectedValue('plain string'),
        },
      },
      writable: true,
      configurable: true,
    });
    const state = await registerServiceWorker();
    expect(state.status).toBe('failed');
    expect(state.error).toBe('plain string');
  });
});
