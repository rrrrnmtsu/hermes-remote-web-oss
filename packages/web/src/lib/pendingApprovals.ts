import type { ActionItem, Approval } from '@hermes-pwa/core';

export function selectPendingApprovals(items: ActionItem[]): Approval[] {
  return items.filter((item): item is Approval => item.kind === 'approval' && item.status === 'needs_you');
}

export function pendingApprovalsForMessage(
  pendingApprovals: Approval[],
  index: number,
  messageCount: number,
): Approval[] | undefined {
  return index === messageCount - 1 ? pendingApprovals : undefined;
}
