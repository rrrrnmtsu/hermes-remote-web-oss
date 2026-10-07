import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionBanner } from './ConnectionBanner';

describe('ConnectionBanner', () => {
  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionBanner state="connected" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows reconnecting banner with retry', () => {
    const onRetry = vi.fn();
    render(<ConnectionBanner state="reconnecting" error="Live updates disconnected." onRetry={onRetry} />);
    expect(screen.getByText(/Reconnecting/i)).toBeInTheDocument();
    expect(screen.getByText(/Live updates/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry now/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows offline banner with retry', () => {
    const onRetry = vi.fn();
    render(<ConnectionBanner state="offline" error="Network offline." onRetry={onRetry} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/Network offline/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry now/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
