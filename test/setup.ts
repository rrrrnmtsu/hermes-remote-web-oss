import '@testing-library/jest-dom/vitest';

// Minimal window.navigator mock for PWA tests
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
    platform: 'Linux x86_64',
    maxTouchPoints: 0,
    serviceWorker: undefined,
    share: undefined,
    standalone: undefined,
  },
  writable: true,
  configurable: true,
});

// matchMedia mock
Object.defineProperty(globalThis.window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// location mock helpers
Object.defineProperty(globalThis.window, 'location', {
  writable: true,
  configurable: true,
  value: {
    protocol: 'https:',
    hostname: 'example.com',
    pathname: '/',
    search: '',
    hash: '',
    href: 'https://example.com/',
  },
});

// EventTarget for service worker events
globalThis.EventTarget = globalThis.EventTarget ?? class EventTarget {
  private _listeners: Record<string, EventListener[]> = {};
  addEventListener(type: string, listener: EventListener) {
    (this._listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: string, listener: EventListener) {
    this._listeners[type] = (this._listeners[type] ?? []).filter((l) => l !== listener);
  }
  dispatchEvent(event: Event) {
    (this._listeners[event.type] ?? []).forEach((l) => l(event));
    return true;
  }
};
