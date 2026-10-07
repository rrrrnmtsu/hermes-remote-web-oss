import { describe, it, expect } from 'vitest';
import { toActionItem } from './activity';

describe('toActionItem', () => {
  it('maps approval', () => {
    const item = toActionItem({
      id: 'a-1',
      kind: 'approval',
      status: 'needs_you',
      title: 'Deploy',
      summary: 'Deploy to prod',
      high_impact: true,
      visibility: 'public',
      created_at: 123,
    });
    expect(item.id).toBe('a-1');
    expect(item.kind).toBe('approval');
    expect(item.title).toBe('Deploy');
    expect(item.summary).toBe('Deploy to prod');
    expect((item as import('./activity').Approval).highImpact).toBe(true);
    expect((item as import('./activity').Approval).visibility).toBe('public');
    expect(item.createdAt).toBe(123);
  });

  it('maps clarify', () => {
    const item = toActionItem({
      id: 'c-1',
      kind: 'clarify',
      status: 'needs_you',
      title: 'Clarify',
      question: 'Which env?',
    });
    expect(item.kind).toBe('clarify');
    expect((item as import('./activity').Clarify).question).toBe('Which env?');
  });

  it('defaults missing fields', () => {
    const item = toActionItem({});
    expect(item.id).toBe('');
    expect(item.kind).toBe('system');
    expect(item.status).toBe('needs_you');
    expect(item.title).toBe('Untitled');
    expect(item.summary).toBeUndefined();
    expect(item.createdAt).toBeGreaterThan(0);
  });
});
