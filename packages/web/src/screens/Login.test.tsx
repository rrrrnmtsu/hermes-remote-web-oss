import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Login } from './Login';

describe('Login', () => {
  const mockLogin = vi.fn();
  const mockStore = {
    state: 'login',
    error: undefined,
    init: vi.fn(),
    login: mockLogin,
    bindTransport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form', () => {
    render(<Login store={mockStore as unknown as import('@hermes-pwa/core').ConnectionStore} error={undefined} />);
    expect(screen.getByText('Sign in to Hermes')).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeInTheDocument();
  });

  it('shows error banner when error prop is provided', () => {
    render(<Login store={mockStore as unknown as import('@hermes-pwa/core').ConnectionStore} error="Bad creds" />);
    expect(screen.getByText('Bad creds')).toBeInTheDocument();
  });

  it('calls store.login on submit with username and password', async () => {
    render(<Login store={mockStore as unknown as import('@hermes-pwa/core').ConnectionStore} error={undefined} />);

    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('basic', 'alice', 'secret');
    });
  });

  it('keeps the password form for parsed password-supported providers', () => {
    const passwordStore = {
      ...mockStore,
      authProviders: [{ name: 'password-local', displayName: 'Password', supportsPassword: true }],
    };

    render(<Login store={passwordStore as unknown as import('@hermes-pwa/core').ConnectionStore} error={undefined} />);

    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
  });

  it('shows an unsupported state and does not call basic login for oauth-only providers', () => {
    const oauthStore = {
      ...mockStore,
      status: { authRequired: true, authProviders: ['oauth'] },
      authProviders: [{ name: 'oauth', displayName: 'OAuth', supportsPassword: false }],
    };

    render(<Login store={oauthStore as unknown as import('@hermes-pwa/core').ConnectionStore} error={undefined} />);

    expect(screen.getByText(/does not support password sign-in/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Username/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign in/i })).not.toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('does not submit when fields are empty', async () => {
    render(<Login store={mockStore as unknown as import('@hermes-pwa/core').ConnectionStore} error={undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('shows loading state while submitting', async () => {
    mockLogin.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<Login store={mockStore as unknown as import('@hermes-pwa/core').ConnectionStore} error={undefined} />);

    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Signing in/i })).toBeDisabled();
    });
  });
});
