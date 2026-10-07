import { makeHttp } from '../../../core/src/transport/http';
import { ProfileGateway } from '../../../core/src/transport/remote-gateway';
import { RemoteController, type RemoteOptions } from '../../../core/src/stores/remote';

export const APP_PATH = '/hermes-remote-web/';
export const SETTINGS_PREFIX = 'hermes-remote-web.settings.';
/** Page-lifetime nonce only; prevents a new channel in this page from logging itself out early. */
export const remoteAuthSender = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export type ChatFontSize = 15 | 16 | 17;
export const CHAT_FONT_REM: Record<ChatFontSize, string> = { 15: '0.9375rem', 16: '1rem', 17: '1.0625rem' };

/** Only these three non-sensitive display values may cross the storage boundary. */
export function readChatFontSize(): ChatFontSize {
  const value = readSetting('chat-font-size');
  if (value !== null && !['15', '16', '17'].includes(value)) {
    try { localStorage.setItem(`${SETTINGS_PREFIX}chat-font-size`, '16'); } catch { /* Still use the safe default. */ }
  }
  return value === '15' ? 15 : value === '17' ? 17 : 16;
}
export function saveChatFontSize(value: unknown): ChatFontSize {
  const size = value === 15 || value === 17 ? value : 16;
  try { localStorage.setItem(`${SETTINGS_PREFIX}chat-font-size`, String(size)); return size; }
  catch { return 16; }
}

export function readSetting(name: string): string | null {
  try { return localStorage.getItem(SETTINGS_PREFIX + name); } catch { return null; }
}
export function writeSetting(name: string, value: string): void {
  try { localStorage.setItem(SETTINGS_PREFIX + name, value); } catch { /* Storage is optional. */ }
}

export function browserRemoteOptions(): RemoteOptions { return {
  http: makeHttp('', undefined, window.location.origin || `${window.location.protocol}//${window.location.hostname}`),
  origin: window.location.origin || `${window.location.protocol}//${window.location.hostname}`,
  secure: window.location.protocol === 'https:',
  makeGateway: profile => new ProfileGateway(profile, (url, ticket) => {
    if (!ticket) throw new Error('A fresh single-use ticket is required');
    return new WebSocket(url, ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]);
  }),
  withOperationLock: async action => {
    if (!navigator.locks) return undefined;
    return navigator.locks.request('hermes-remote-web.operation', { mode: 'exclusive', ifAvailable: true },
      async lock => lock ? action() : undefined);
  },
  onLocalLogout: () => writeSetting('signed-out', 'yes'),
}; }
export const remoteController = new RemoteController(browserRemoteOptions());

/** No API/auth response cache and no service worker in this first regular-Web release. */
export async function availableBuild(): Promise<string | null> {
  try {
    const response = await fetch(`${APP_PATH}build.json`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('buildId' in data) || typeof data.buildId !== 'string') return null;
    return data.buildId;
  } catch { return null; }
}
