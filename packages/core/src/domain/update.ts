export type UpdateInstruction = {
  id: string;
  label: string;
  command?: string;
  steps: string[];
};

export type UpdateCheck = {
  ok: boolean;
  current: string;
  latest: string | null;
  source: string;
  updateAvailable: boolean;
  canApply: boolean;
  manualRequired: boolean;
  installMethod: string;
  checkedAt?: string;
  error?: string;
  message?: string;
  instructions: UpdateInstruction[];
};

function toInstruction(raw: unknown): UpdateInstruction {
  const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const instruction: UpdateInstruction = {
    id: String(item.id ?? ''),
    label: String(item.label ?? ''),
    steps: Array.isArray(item.steps) ? item.steps.map(String) : [],
  };
  if (typeof item.command === 'string') instruction.command = item.command;
  return instruction;
}

export function toUpdateCheck(raw: Record<string, unknown>): UpdateCheck {
  const update: UpdateCheck = {
    ok: raw.ok !== false,
    current: String(raw.current ?? '0.0.0'),
    latest: typeof raw.latest === 'string' ? raw.latest : null,
    source: String(raw.source ?? 'npm'),
    updateAvailable: raw.update_available === true,
    canApply: raw.can_apply === true,
    manualRequired: raw.manual_required === true,
    installMethod: String(raw.install_method ?? 'unknown'),
    instructions: Array.isArray(raw.instructions) ? raw.instructions.map(toInstruction) : [],
  };
  if (typeof raw.checked_at === 'string') update.checkedAt = raw.checked_at;
  if (typeof raw.error === 'string') update.error = raw.error;
  if (typeof raw.message === 'string') update.message = raw.message;
  return update;
}
