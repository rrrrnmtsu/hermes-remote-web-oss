import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalCard } from './ApprovalCard';

describe('ApprovalCard', () => {
  it('renders tool name and command', () => {
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'shell.exec', summary: 'git commit', highImpact: false, visibility: 'private', createdAt: 1 }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(screen.getByText('shell.exec')).toBeInTheDocument();
    expect(screen.getByText('git commit')).toBeInTheDocument();
  });

  it('shows low risk badge by default', () => {
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'shell.exec', summary: 'git commit', highImpact: false, visibility: 'private', createdAt: 1 }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(screen.getByText('LOW RISK')).toBeInTheDocument();
  });

  it('shows high risk badge for high-impact items', () => {
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'fs.write', summary: 'write secrets', highImpact: true, visibility: 'private', createdAt: 1 }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(screen.getByText('HIGH RISK')).toBeInTheDocument();
  });

  it('approves on click', () => {
    const onApprove = vi.fn();
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', highImpact: false, visibility: 'private', createdAt: 1 }}
        onApprove={onApprove}
        onReject={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(onApprove).toHaveBeenCalledWith('a-1');
  });

  it('denies on click', () => {
    const onReject = vi.fn();
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', highImpact: false, visibility: 'private', createdAt: 1 }}
        onApprove={vi.fn()}
        onReject={onReject}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Deny/i }));
    expect(onReject).toHaveBeenCalledWith('a-1');
  });
});
