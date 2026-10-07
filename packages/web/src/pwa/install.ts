export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: BeforeInstallPromptEvent | undefined;

export const INSTALL_PROMPT_CHANGED_EVENT = 'hermes-pwa-install-prompt-changed';

function notifyInstallPromptChanged(): void {
  window.dispatchEvent(new Event(INSTALL_PROMPT_CHANGED_EVENT));
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event as BeforeInstallPromptEvent;
  notifyInstallPromptChanged();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = undefined;
  notifyInstallPromptChanged();
});

export function canPromptInstall(): boolean {
  return Boolean(deferredPrompt);
}

export async function promptInstall(): Promise<InstallPromptOutcome> {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = undefined;
  notifyInstallPromptChanged();
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome;
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isAppleMobile && isSafari;
}

export function isSecurePwaContext(): boolean {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}
