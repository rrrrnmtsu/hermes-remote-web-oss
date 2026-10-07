import { describe, it, expect } from 'vitest';
import { toAgentProfile } from './agent';

describe('toAgentProfile', () => {
  it('maps fields', () => {
    const p = toAgentProfile({ id: 'p-1', name: 'Coder', model: 'gpt-4', provider: 'openai', status: 'busy', description: 'Code writer' });
    expect(p.id).toBe('p-1');
    expect(p.name).toBe('Coder');
    expect(p.model).toBe('gpt-4');
    expect(p.provider).toBe('openai');
    expect(p.status).toBe('busy');
    expect(p.description).toBe('Code writer');
  });

  it('defaults missing fields', () => {
    const p = toAgentProfile({});
    expect(p.id).toBe('');
    expect(p.name).toBe('Unknown');
    expect(p.model).toBeUndefined();
    expect(p.provider).toBeUndefined();
    expect(p.status).toBe('offline');
    expect(p.description).toBeUndefined();
  });
});
