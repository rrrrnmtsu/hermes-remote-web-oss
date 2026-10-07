import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './BottomSheet';

describe('BottomSheet', () => {
  it('renders as a modal dialog labelled by its title', () => {
    render(
      <BottomSheet title="Model" onClose={vi.fn()}>
        <button type="button">Save</button>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Model' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape when closing is enabled', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet title="New task" onClose={onClose}>
        <button type="button">Create</button>
      </BottomSheet>,
    );

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New task' }), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the sheet', () => {
    render(
      <BottomSheet title="Focus trap" onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </BottomSheet>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    first.focus();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Focus trap' }), { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Focus trap' }), { key: 'Tab' });
    expect(first).toHaveFocus();
  });
});
