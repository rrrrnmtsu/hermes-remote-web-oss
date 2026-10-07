/**
 * System / ops domain types.
 */

export interface SystemStats {
  version?: string | undefined;
  /** Gateway/dashboard process uptime, not host boot uptime. */
  uptimeSeconds?: number | undefined;
  /** Host boot uptime from the backend, shown separately when needed. */
  hostUptimeSeconds?: number | undefined;
  activeSessions?: number | undefined;
  pid?: number | undefined;
  cpuPercent?: number | undefined;
  memoryUsedMb?: number | undefined;
  memoryTotalMb?: number | undefined;
  memoryPercent?: number | undefined;
  diskUsedMb?: number | undefined;
  diskTotalMb?: number | undefined;
  diskFreeMb?: number | undefined;
  diskPercent?: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toSystemStats(raw: Record<string, unknown>): SystemStats {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const bytesToMb = (v: unknown) => {
    const n = num(v);
    return n === undefined ? undefined : n / 1024 / 1024;
  };
  const memory = isRecord(raw.memory) ? raw.memory : undefined;
  const disk = isRecord(raw.disk) ? raw.disk : undefined;
  const process = isRecord(raw.process) ? raw.process : undefined;
  const processCreateTime = num(process?.create_time ?? process?.createTime);
  const processUptimeSeconds = num(
    raw.process_uptime_seconds
      ?? raw.processUptimeSeconds
      ?? raw.gateway_uptime_seconds
      ?? raw.gatewayUptimeSeconds
      ?? process?.uptime_seconds
      ?? process?.uptimeSeconds,
  ) ?? (processCreateTime === undefined ? undefined : Math.max(0, Math.round(Date.now() / 1000 - processCreateTime)));
  const hostUptimeSeconds = num(raw.uptime_seconds ?? raw.uptimeSeconds ?? raw.host_uptime_seconds ?? raw.hostUptimeSeconds);

  return {
    version: str(raw.version ?? raw.agent_version ?? raw.agentVersion ?? raw.hermes_version ?? raw.hermesVersion),
    uptimeSeconds: processUptimeSeconds ?? num(raw.uptime),
    hostUptimeSeconds,
    activeSessions: num(raw.active_sessions ?? raw.activeSessions),
    pid: num(raw.pid ?? process?.pid),
    cpuPercent: num(raw.cpu_percent ?? raw.cpuPercent),
    memoryUsedMb: num(raw.memory_used_mb ?? raw.memoryUsedMb ?? raw.memory_used ?? raw.memory_mb) ?? bytesToMb(memory?.used),
    memoryTotalMb: num(raw.memory_total_mb ?? raw.memoryTotalMb ?? raw.memory_total) ?? bytesToMb(memory?.total),
    memoryPercent: num(raw.memory_percent ?? raw.memoryPercent ?? memory?.percent),
    diskUsedMb: num(raw.disk_used_mb ?? raw.diskUsedMb ?? raw.disk_used) ?? bytesToMb(disk?.used),
    diskTotalMb: num(raw.disk_total_mb ?? raw.diskTotalMb ?? raw.disk_total) ?? bytesToMb(disk?.total),
    diskFreeMb: num(raw.disk_free_mb ?? raw.diskFreeMb ?? raw.disk_free) ?? bytesToMb(disk?.free),
    diskPercent: num(raw.disk_percent ?? raw.diskPercent ?? disk?.percent),
  };
}

export interface Checkpoint {
  id: string;
  name: string;
  createdAt: number;
  sizeMb: number;
  kind?: string | undefined;
}

export interface OpsRunResult {
  ok?: boolean | undefined;
  status?: string | undefined;
  message?: string | undefined;
  name?: string | undefined;
  pid?: number | undefined;
}

export interface SystemActionStatus {
  name: string;
  running: boolean;
  exitCode?: number | null | undefined;
  pid?: number | null | undefined;
  lines: string[];
}

export function toOpsRunResult(raw: Record<string, unknown>): OpsRunResult {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    ok: typeof raw.ok === 'boolean' ? raw.ok : undefined,
    status: str(raw.status),
    message: str(raw.message),
    name: str(raw.name),
    pid: num(raw.pid),
  };
}

export function toActionStatus(raw: Record<string, unknown>): SystemActionStatus {
  const name = typeof raw.name === 'string' ? raw.name : '';
  const exitCode = typeof raw.exit_code === 'number'
    ? raw.exit_code
    : typeof raw.exitCode === 'number'
      ? raw.exitCode
      : raw.exit_code === null || raw.exitCode === null
        ? null
        : undefined;
  const pid = typeof raw.pid === 'number' ? raw.pid : raw.pid === null ? null : undefined;
  return {
    name,
    running: raw.running === true,
    exitCode,
    pid,
    lines: Array.isArray(raw.lines) ? raw.lines.map((line) => String(line)) : [],
  };
}

export function toCheckpoint(raw: Record<string, unknown>): Checkpoint {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const bytes = num(raw.bytes);
  return {
    id: String(raw.id ?? raw.session_id ?? raw.session ?? raw.name ?? ''),
    name: String(raw.name ?? raw.id ?? raw.session ?? 'Backup'),
    createdAt: num(raw.created_at ?? raw.createdAt) ?? Date.now(),
    sizeMb: num(raw.size_mb ?? raw.sizeMb) ?? (bytes === undefined ? 0 : bytes / 1024 / 1024),
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
  };
}
