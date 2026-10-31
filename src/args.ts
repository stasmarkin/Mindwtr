import { parseArgs } from 'node:util';
import { PRIORITIES, STATUSES } from './context.ts';
import { UsageError } from './errors.ts';

export type OptionSpec = Record<string, { type: 'string' | 'boolean'; multiple?: boolean }>;
export type Parsed = { values: Record<string, unknown>; positionals: string[] };

export function parse(argv: readonly string[], options: OptionSpec, positionals: { min: number; max: number; usage: string }): Parsed {
  let r: { values: Record<string, unknown>; positionals: string[] };
  try {
    r = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (e) {
    if (e instanceof TypeError) throw new UsageError(e.message);
    throw e;
  }
  if (r.positionals.length < positionals.min || r.positionals.length > positionals.max) {
    throw new UsageError(`expected ${positionals.usage}`);
  }
  return r;
}

export function optStr(p: Parsed, k: string): string | undefined {
  const v = p.values[k];
  return typeof v === 'string' ? v : undefined;
}

export function optBool(p: Parsed, k: string): boolean {
  return p.values[k] === true;
}

export function optList(p: Parsed, k: string): string[] | undefined {
  const v = p.values[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

export function oneOf<T extends string>(flag: string, v: string, allowed: readonly T[]): T {
  const hit = allowed.find((a) => a === v);
  if (hit === undefined) throw new UsageError(`--${flag}: "${v}" is not valid, expected one of ${allowed.join('|')}`);
  return hit;
}

export const status = (v: string) => oneOf('status', v, STATUSES);
export const priority = (v: string) => oneOf('priority', v, PRIORITIES);

export function date(flag: string, v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m === null ? undefined : new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (m === null || d === undefined || d.toISOString().slice(0, 10) !== v) {
    throw new UsageError(`--${flag}: "${v}" is not a valid date, expected YYYY-MM-DD`);
  }
  return v;
}

export function integer(flag: string, v: string, min: number, max?: number): number {
  const n = Number(v);
  if (!/^-?\d+$/.test(v) || n < min || (max !== undefined && n > max)) {
    throw new UsageError(`--${flag}: "${v}" is not valid, expected an integer${max === undefined ? ` >= ${min}` : ` in ${min}..${max}`}`);
  }
  return n;
}
