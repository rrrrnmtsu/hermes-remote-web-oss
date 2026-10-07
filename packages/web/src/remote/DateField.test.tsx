import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { DateField } from './DateField';

afterEach(cleanup);
describe('one native date field', () => {
  it('keeps a single labeled native picker and clears its controlled value on explicit click', () => {
    const changed = vi.fn();
    function Harness() {
      const [value, setValue] = useState('2026-10-04');
      return <DateField label="開始日" value={value} onChange={(next, bad) => { changed(next, bad); setValue(next); }} />;
    }
    const view = render(<Harness />);
    const input = screen.getByLabelText('開始日');
    expect(view.container.querySelectorAll('input')).toHaveLength(1);
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveAttribute('min', '0001-01-01'); expect(input).toHaveAttribute('max', '9999-12-31');
    fireEvent.click(screen.getByRole('button', { name: '開始日をクリア' }));
    expect(changed).toHaveBeenCalledWith('', false); expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: '開始日をクリア' })).toBeDisabled();
  });

  it('reports a native partial invalid value and allows it to be explicitly cleared', () => {
    const changed = vi.fn();
    const view = render(<DateField label="終了日" value="" onChange={changed} />);
    const input = screen.getByLabelText('終了日');
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.change(input, { target: { value: '2026-10-04' } });
    expect(changed).toHaveBeenLastCalledWith('2026-10-04', true);
    view.rerender(<DateField label="終了日" value="" invalid onChange={changed} />);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: '終了日をクリア' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '終了日をクリア' }));
    expect(changed).toHaveBeenLastCalledWith('', false);
  });

  it('uses distinct labels and native hosts for the two endpoints without opening a picker on render', () => {
    const changed = vi.fn();
    const view = render(<><DateField label="開始日" value="" onChange={changed} /><DateField label="終了日" value="" onChange={changed} /></>);
    const from = screen.getByLabelText('開始日'), to = screen.getByLabelText('終了日');
    expect(from.id).not.toBe(to.id); expect(view.container.querySelectorAll('input[type="date"]')).toHaveLength(2);
    expect(changed).not.toHaveBeenCalled(); expect(document.activeElement).not.toBe(from);
    expect(document.activeElement).not.toBe(to);
  });

  it('allows a partial native edit to be cleared even before it has a nonempty date value', () => {
    function Harness() {
      const [bad, setBad] = useState(false);
      return <DateField label="開始日" value="" invalid={bad} onChange={(_value, invalid) => setBad(invalid)} />;
    }
    render(<Harness />); const input = screen.getByLabelText('開始日');
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.input(input, { target: { value: '' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: '開始日をクリア' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '開始日をクリア' }));
    expect(input).not.toHaveAttribute('aria-invalid');
  });
});
