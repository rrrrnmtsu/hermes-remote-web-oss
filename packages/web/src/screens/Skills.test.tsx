import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Skills } from './Skills';

const makeRest = (overrides = {}) =>
  ({
    skillsList: vi.fn().mockResolvedValue([
      {
        id: 'skill-1',
        name: 'File Search',
        description: 'Search across the codebase',
        tag: 'core',
        enabled: true,
        icon: 'search',
      },
      {
        id: 'skill-2',
        name: 'Deploy Plugin',
        description: 'Trigger deployment pipelines',
        tag: 'guarded',
        enabled: true,
      },
      {
        id: 'skill-3',
        name: 'Custom Reporter',
        tag: 'ops',
        enabled: false,
      },
    ]),
    ...overrides,
  }) as unknown as import('@hermes-pwa/core').RestClient;

describe('Skills', () => {
  it('renders skills after loading', async () => {
    render(<Skills rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('skill-row')).toHaveLength(3));
    expect(screen.getByText('File Search')).toBeInTheDocument();
    expect(screen.getByText('Deploy Plugin')).toBeInTheDocument();
    expect(screen.getByText('Custom Reporter')).toBeInTheDocument();
  });

  it('shows uppercase tags', async () => {
    render(<Skills rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('skill-row')).toHaveLength(3));
    expect(screen.getByText('CORE')).toBeInTheDocument();
    expect(screen.getByText('GUARDED')).toBeInTheDocument();
    expect(screen.getByText('OPS')).toBeInTheDocument();
  });

  it('shows empty state when no skills', async () => {
    const rest = makeRest({ skillsList: vi.fn().mockResolvedValue([]) });
    render(<Skills rest={rest} />);
    await waitFor(() => expect(screen.getByText(/No skills available/i)).toBeInTheDocument());
  });

  it('shows error state', async () => {
    const rest = makeRest({ skillsList: vi.fn().mockRejectedValue(new Error('skills failed')) });
    render(<Skills rest={rest} />);
    await waitFor(() => expect(screen.getByText(/skills failed/i)).toBeInTheDocument());
  });
});
