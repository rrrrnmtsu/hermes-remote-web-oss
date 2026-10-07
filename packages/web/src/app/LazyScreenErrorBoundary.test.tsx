import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { LazyScreenErrorBoundary } from './LazyScreenErrorBoundary';

function CrashingScreen(): JSX.Element {
  throw new Error('chunk load failed');
}

function mockLocationReload() {
  const reload = vi.fn();
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
  return reload;
}

describe('LazyScreenErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a reload fallback when a lazy screen import fails', () => {
    const reload = mockLocationReload();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <LazyScreenErrorBoundary>
        <CrashingScreen />
      </LazyScreenErrorBoundary>,
    );

    expect(screen.getByTestId('lazy-screen-error')).toBeInTheDocument();
    expect(screen.getByText('Screen failed to load')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
