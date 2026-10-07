import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from './TaskCard';

describe('TaskCard', () => {
  it('renders title and assignee', () => {
    render(<TaskCard task={{ id: 't-1', title: 'Fix bug', status: 'in_progress', assignee: 'alice', createdAt: 1 }} onClick={vi.fn()} />);
    expect(screen.getByText('Fix bug')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
  });

  it('calls onClick', () => {
    const onClick = vi.fn();
    render(<TaskCard task={{ id: 't-1', title: 'Fix bug', status: 'in_progress', createdAt: 1 }} onClick={onClick} />);
    fireEvent.click(screen.getByLabelText(/Fix bug/i));
    expect(onClick).toHaveBeenCalledWith('t-1');
  });

  it('renders without assignee', () => {
    render(<TaskCard task={{ id: 't-1', title: 'No assignee', status: 'backlog', createdAt: 1 }} onClick={vi.fn()} />);
    expect(screen.getByText('No assignee')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('renders priority badge and comment count', () => {
    render(
      <TaskCard
        task={{ id: 't-1', title: 'Prioritized', status: 'todo', priority: 7, commentCount: 3, createdAt: 1 }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText('P7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
