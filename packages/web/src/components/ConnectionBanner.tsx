import type { ConnectionState } from '@hermes-pwa/core';

interface ConnectionBannerProps {
  state: ConnectionState;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}

export function ConnectionBanner({ state, error, onRetry }: ConnectionBannerProps) {
  if (state === 'connected') return null;

  const isOffline = state === 'offline';
  const isReconnecting = state === 'reconnecting' || state === 'ticketing';

  if (!isOffline && !isReconnecting) return null;

  const title = isOffline ? 'Offline' : 'Reconnecting…';
  const message = error ?? (isOffline ? 'Check your connection and try again.' : 'Live updates disconnected.');
  const modifier = isOffline ? 'hm-warning-banner--error' : 'hm-warning-banner--warn';

  return (
    <div className={`hm-warning-banner ${modifier}`} role="status" aria-live="polite">
      <strong>{title}</strong>
      {' — '}
      {message}
      {onRetry && (
        <>
          {' '}
          <button
            type="button"
            className="hm-ghost"
            onClick={onRetry}
            style={{ marginLeft: 8, fontSize: 'inherit', minHeight: 'auto', padding: '2px 10px' }}
          >
            Retry now
          </button>
        </>
      )}
    </div>
  );
}
