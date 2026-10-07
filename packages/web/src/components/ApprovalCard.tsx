import type { Approval } from '@hermes-pwa/core';
import { Icon } from './Icon';

interface ApprovalCardProps {
  item: Approval;
  onApprove(id: string): void;
  onReject(id: string): void;
}

export function ApprovalCard({ item, onApprove, onReject }: ApprovalCardProps) {
  const isHighImpact = item.highImpact;
  const riskLabel = isHighImpact ? 'HIGH RISK' : 'LOW RISK';
  const riskColor = isHighImpact ? 'var(--hm-color-danger-strong)' : 'var(--hm-color-success-strong)';
  const riskBg = isHighImpact ? 'var(--hm-color-danger-bg)' : 'var(--hm-color-success-bg)';

  return (
    <div className="hm-approval-card" data-testid="approval-card">
      <div className="hm-approval-card__header">
        <span className="hm-approval-card__shield" aria-hidden="true">
          <Icon name="shield" size={16} />
        </span>
        <span className="hm-approval-card__tool">{item.title}</span>
        <span
          className="hm-approval-card__risk"
          style={{ background: riskBg, color: riskColor }}
        >
          {riskLabel}
        </span>
      </div>

      <div className="hm-approval-card__body">
        {item.session && (
          <div className="hm-approval-card__session">{item.session}</div>
        )}
        {item.summary && (
          <div className="hm-approval-card__cmd">{item.summary}</div>
        )}
        <div className="hm-approval-card__actions">
          <button
            type="button"
            className="hm-approval-card__approve"
            onClick={() => onApprove(item.id)}
            aria-label="Approve"
          >
            Approve
          </button>
          <button
            type="button"
            className="hm-approval-card__deny"
            onClick={() => onReject(item.id)}
            aria-label="Deny"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
