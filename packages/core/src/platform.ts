/**
 * Platform abstraction -- implemented by each shell (web, Capacitor, RN).
 * Core depends on this interface, never on an implementation.
 */
export interface Platform {
  /** Returns true if the platform can trigger an install prompt. */
  canInstall(): boolean;

  /** Triggers the platform install prompt. */
  promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'>;

  /** Returns true if the app is running in standalone/display-mode. */
  isStandalone(): boolean;

  /** Shares content via the platform share sheet. */
  share(data: { title?: string; url?: string; text?: string }): Promise<void>;
}
