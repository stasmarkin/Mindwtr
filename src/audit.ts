export type AuditEntry = {
  ts: string;
  cmd: string;
  args: Record<string, unknown>;
  taskId: string | null;
  ok: boolean;
  error?: string;
};

const MAX_DESC = 200;

// Long descriptions would bloat the log (and may hold private notes); keep only their size.
export function auditArgs(values: Record<string, unknown>, positionals: readonly string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    args[k] = k === 'desc' && typeof v === 'string' && v.length > MAX_DESC ? `<${v.length} chars>` : v;
  }
  if (positionals.length > 0) args._ = [...positionals];
  return args;
}

// The log holds task ids and flag values: owner-only when we create it; existing files are left alone.
export function writeAudit(
  path: string,
  appendFile: (path: string, data: string, opts: { flag: string; mode: number }) => void,
  entry: AuditEntry,
): void {
  appendFile(path, `${JSON.stringify(entry)}\n`, { flag: 'a', mode: 0o600 });
}
