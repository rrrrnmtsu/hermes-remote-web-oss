import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canPromptInstall, promptInstall, isStandalone, isIosSafari, isSecurePwaContext } from './install';

describe('PWA install utilities', () => {
  let originalNavigator: Navigator;
  let originalLocation: Location;

  function makeBeforeInstallPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
    const event = new Event('beforeinstallprompt') as Event & {
      preventDefault: ReturnType<typeof vi.fn>;
      prompt: ReturnType<typeof vi.fn>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    };
    Object.defineProperty(event, 'preventDefault', { value: vi.fn(), writable: true });
    Object.defineProperty(event, 'prompt', { value: vi.fn().mockResolvedValue(undefined), writable: true });
    Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome }), writable: true });
    return event;
  }

  beforeEach(() => {
    originalNavigator = globalThis.navigator as Navigator;
    originalLocation = globalThis.location as Location;
    window.dispatchEvent(new Event('appinstalled'));
  });

  afterEach(() => {
    window.dispatchEvent(new Event('appinstalled'));
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, writable: true, configurable: true });
    Object.defineProperty(globalThis, 'location', { value: originalLocation, writable: true, configurable: true });
  });

  describe('canPromptInstall', () => {
    it('tracks beforeinstallprompt event state', () => {
      expect(canPromptInstall()).toBe(false);

      const event = makeBeforeInstallPromptEvent();
      window.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(canPromptInstall()).toBe(true);
    });
  });

  describe('promptInstall', () => {
    it('returns unavailable when no prompt exists', async () => {
      await expect(promptInstall()).resolves.toBe('unavailable');
    });

    it('prompts once and clears the deferred install prompt', async () => {
      const event = makeBeforeInstallPromptEvent('accepted');
      window.dispatchEvent(event);

      await expect(promptInstall()).resolves.toBe('accepted');

      expect(event.prompt).toHaveBeenCalledTimes(1);
      expect(canPromptInstall()).toBe(false);
    });
  });

  describe('isStandalone', () => {
    it('returns false in default browser mode', () => {
      expect(isStandalone()).toBe(false);
    });

    it('returns true when display-mode is standalone', () => {
      const mql = { matches: true };
      vi.spyOn(window, 'matchMedia').mockReturnValue(mql as MediaQueryList);
      expect(isStandalone()).toBe(true);
    });

    it('detects iOS standalone navigator.standalone', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...originalNavigator, standalone: true },
        writable: true,
        configurable: true,
      });
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
      expect(isStandalone()).toBe(true);
    });
  });

  describe('isIosSafari', () => {
    it('returns false for Linux Chrome', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/120', platform: 'Linux x86_64', maxTouchPoints: 0 },
        writable: true,
        configurable: true,
      });
      expect(isIosSafari()).toBe(false);
    });

    it('returns true for iPhone Safari', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          platform: 'iPhone',
          maxTouchPoints: 5,
        },
        writable: true,
        configurable: true,
      });
      expect(isIosSafari()).toBe(true);
    });

    it('returns false for iPhone Chrome', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
          platform: 'iPhone',
          maxTouchPoints: 5,
        },
        writable: true,
        configurable: true,
      });
      expect(isIosSafari()).toBe(false);
    });

    it('detects iPad Pro as Apple mobile', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        },
        writable: true,
        configurable: true,
      });
      expect(isIosSafari()).toBe(true);
    });
  });

  describe('isSecurePwaContext', () => {
    it('returns true for HTTPS', () => {
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'https:', hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'isSecureContext', { value: true, writable: true, configurable: true });
      expect(isSecurePwaContext()).toBe(true);
    });

    it('returns true for localhost regardless of protocol', () => {
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'http:', hostname: 'localhost' },
        writable: true,
        configurable: true,
      });
      expect(isSecurePwaContext()).toBe(true);
    });

    it('returns true for 127.0.0.1', () => {
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'http:', hostname: '127.0.0.1' },
        writable: true,
        configurable: true,
      });
      expect(isSecurePwaContext()).toBe(true);
    });

    it('returns false for insecure non-localhost origin', () => {
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'http:', hostname: '192.168.1.10' },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'isSecureContext', { value: false, writable: true, configurable: true });
      expect(isSecurePwaContext()).toBe(false);
    });
  });
});
