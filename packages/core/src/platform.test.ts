import { describe, it, expect } from 'vitest';
import type { Platform } from './platform';

describe('Platform interface', () => {
  it('can be implemented by a web shell', () => {
    const webPlatform: Platform = {
      canInstall: () => true,
      promptInstall: async () => 'accepted',
      isStandalone: () => false,
      share: async () => undefined,
    };

    expect(webPlatform.canInstall()).toBe(true);
    expect(webPlatform.isStandalone()).toBe(false);
  });

  it('can be implemented by a native shell', async () => {
    const nativePlatform: Platform = {
      canInstall: () => false,
      promptInstall: async () => 'unavailable',
      isStandalone: () => true,
      share: async () => undefined,
    };

    expect(nativePlatform.canInstall()).toBe(false);
    await expect(nativePlatform.promptInstall()).resolves.toBe('unavailable');
  });

  it('share accepts partial data', () => {
    const platform: Platform = {
      canInstall: () => false,
      promptInstall: async () => 'unavailable',
      isStandalone: () => true,
      share: async (data) => {
        expect(data).toBeDefined();
      },
    };

    return platform.share({ title: 'Hello' });
  });
});
