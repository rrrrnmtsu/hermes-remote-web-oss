import type { RemoteState } from '../../../core/src/stores/remote';

const phases = new Set(['idle', 'https', 'auth', 'ticket', 'wss', 'gateway', 'rpc', 'connected', 'reconnecting', 'offline', 'reauth', 'unsupported', 'error', 'logged_out']);
const failures = new Set(['', 'auth_401', 'forbidden_403', 'http', 'network_or_tls', 'timeout', 'version_mismatch', 'websocket', 'rpc']);
const version = (value: string): string => value.match(/^v?(\d{1,4}(?:\.\d{1,4}){1,3})(?:[-+][A-Za-z0-9.]{1,32})?$/)?.[1] || 'unknown';

/** Explicit allowlist: never serialize the controller state, raw errors or navigator UA. */
export function safeDiagnosticReport(state: RemoteState, buildId: string) {
  const methods = new Set(state.featureMethods);
  return {
    schema: 'hermes_remote_web_support_diagnostics_v1',
    appBuild: /^remote-v2-[a-f0-9]{16}$/.test(buildId) ? buildId : 'unknown',
    serverVersion: version(state.targetVersion),
    connectionStage: phases.has(state.connection) ? state.connection : 'unknown',
    failedStage: phases.has(state.failedStage) ? state.failedStage : 'unknown',
    failureCategory: failures.has(state.failureKind) ? state.failureKind || 'none' : 'unknown',
    checks: {
      https: state.https === true,
      authenticated: state.authenticated === true,
      wss: state.wss === true,
      gatewayReady: state.gatewayReady === true,
      readRPC: state.readRpc === true,
      exclusiveSubmitDeclared: state.exclusiveSubmit === true,
    },
    capabilities: {
      extendedSessionReads: methods.has('remote.sessions.list'),
      modelCatalogRead: methods.has('remote.info.models'),
      modelWriteDeclared: methods.has('remote.session.model_set'),
      filesRead: methods.has('remote.files.read'),
      artifactsRead: methods.has('remote.artifacts.read'),
      imageTurnDeclared: state.imageTurnVersion === true,
      documentTurnDeclared: state.documentCapabilities?.version === 1,
      serverPolicyPermitsGeneration: state.generationAllowed === true,
    },
    acceptance: { providerGeneration: 'not_tested_by_diagnostics', physicalDevice: 'not_tested_by_diagnostics' },
  };
}

export function diagnosticText(state: RemoteState, buildId: string): string {
  return JSON.stringify(safeDiagnosticReport(state, buildId), null, 2);
}
