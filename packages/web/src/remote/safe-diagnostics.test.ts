import { describe, expect, it } from 'vitest';
import { RemoteController } from '../../../core/src/stores/remote';
import type { Http } from '../../../core/src/transport/http';
import { diagnosticText, safeDiagnosticReport } from './safe-diagnostics';

function state() {
  const http: Http = Object.assign(async <T,>() => ({} as T), { setProfile: () => undefined });
  return new RemoteController({ http, origin: 'https://demo.invalid', secure: true,
    makeGateway: () => { throw new Error('never_connect'); }, withOperationLock: async action => action() }).store.getState();
}

describe('allowlisted support diagnostics', () => {
  it('contains only known booleans and validated version/build/stage fields', () => {
    const input = { ...state(), targetVersion: '0.21.5+5337.ge8c9732', connection: 'connected' as const,
      featureMethods: ['remote.info.models', 'remote.session.model_set', 'remote.files.read', 'DEMO-secret-method'], generationAllowed: true };
    const report = safeDiagnosticReport(input, 'remote-v2-0123456789abcdef');
    expect(report.appBuild).toBe('remote-v2-0123456789abcdef');
    expect(report.serverVersion).toBe('0.21.5');
    expect(report.capabilities.modelCatalogRead).toBe(true);
    expect(report.capabilities.serverPolicyPermitsGeneration).toBe(true);
    expect(report.acceptance.providerGeneration).toBe('not_tested_by_diagnostics');
  });
  it('never exports origin, raw errors, identifiers, names, drafts, requests or attachment bytes', () => {
    const input = { ...state(), profile: 'DEMO-private-profile', principalId: 'DEMO-private-owner', draft: 'DEMO-private-draft',
      diagnostic: 'DEMO-ticket-in-error', generationReason: 'DEMO-private-provider-detail',
      durableId: 'DEMO-private-durable', liveId: 'DEMO-private-live', lineageId: 'DEMO-private-lineage',
      messages: [{ id: 'DEMO-private-row', role: 'assistant', text: 'DEMO-private-body' }],
      extraCredential: 'DEMO-not-a-real-secret', featureMethods: ['DEMO-private-method'] };
    const text = diagnosticText(input, 'remote-v2-0123456789abcdef');
    expect(text).not.toContain('DEMO-'); expect(text).not.toContain('profile');
    expect(text).not.toContain('origin'); expect(text).not.toContain('lineage');
    expect(Object.keys(JSON.parse(text))).toEqual(['schema', 'appBuild', 'serverVersion', 'connectionStage', 'failedStage', 'failureCategory', 'checks', 'capabilities', 'acceptance']);
  });
  it('refuses arbitrary build and version strings instead of redacting them with guesses', () => {
    const report = safeDiagnosticReport({ ...state(), targetVersion: '0.21.5 https://DEMO-private.invalid/DEMO-ticket' }, 'DEMO-ticket-build');
    expect(report.serverVersion).toBe('unknown'); expect(report.appBuild).toBe('unknown');
    expect(JSON.stringify(report)).not.toContain('DEMO');
  });
  it('drops arbitrary version metadata even when it has valid semver characters', () => {
    const report = safeDiagnosticReport({ ...state(), targetVersion: '0.21.5+DEMOprivateToken' }, 'remote-v2-0123456789abcdef');
    expect(report.serverVersion).toBe('0.21.5'); expect(JSON.stringify(report)).not.toContain('DEMO');
  });
});
