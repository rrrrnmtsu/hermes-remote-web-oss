import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClarifyCard } from './ClarifyCard';

describe('ClarifyCard', () => {
  it('renders question and title', () => {
    render(
      <ClarifyCard
        item={{ id: 'c-1', kind: 'clarify', status: 'needs_you', title: 'Clarify', question: 'Which env?', createdAt: 1 }}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByText('Clarify')).toBeInTheDocument();
    expect(screen.getByText('Which env?')).toBeInTheDocument();
  });

  it('sends answer', () => {
    const onRespond = vi.fn();
    render(
      <ClarifyCard
        item={{ id: 'c-1', kind: 'clarify', status: 'needs_you', title: 'Clarify', question: 'Which env?', createdAt: 1 }}
        onRespond={onRespond}
      />
    );
    fireEvent.change(screen.getByLabelText(/Your answer/i), { target: { value: 'prod' } });
    fireEvent.click(screen.getByRole('button', { name: /Send answer/i }));
    expect(onRespond).toHaveBeenCalledWith('c-1', 'prod');
  });

  it('disabled send when answer is empty', () => {
    render(
      <ClarifyCard
        item={{ id: 'c-1', kind: 'clarify', status: 'needs_you', title: 'Clarify', question: 'Which env?', createdAt: 1 }}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Send answer/i })).toBeDisabled();
  });
});
