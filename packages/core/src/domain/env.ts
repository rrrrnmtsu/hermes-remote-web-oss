/**
 * Environment variable domain types.
 */

export interface EnvVar {
  key: string;
  value: string;
  sensitive: boolean;
}

export function toEnvVar(raw: Record<string, unknown>): EnvVar {
  return {
    key: String(raw.key ?? raw.name ?? ''),
    value: String(raw.value ?? raw.default ?? ''),
    sensitive: raw.sensitive === true || raw.secret === true,
  };
}
