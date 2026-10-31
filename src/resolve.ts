import { listAll } from './api.ts';
import type { Ctx } from './context.ts';
import { nameOf, oneLine, str } from './format.ts';
import { UsageError } from './errors.ts';

type Kind = 'areas' | 'projects';

const MAX_LISTED = 10;
// UUIDs are 36 chars; anything shorter is treated as a prefix, like the 8-char ids printed in tables.
const FULL_ID_LENGTH = 36;
const MIN_PREFIX = 4;

export function listEntities(ctx: Ctx, kind: Kind): Promise<Record<string, unknown>[]> {
  let p = ctx.cache.get(kind);
  if (p === undefined) {
    p = listAll(ctx.api, `/${kind}`, kind).then((items) => items.filter((o) => str(o, 'deletedAt') === ''));
    ctx.cache.set(kind, p);
  }
  return p;
}

export async function resolveRef(ctx: Ctx, kind: Kind, value: string): Promise<string> {
  const singular = kind.slice(0, -1);
  const items = await listEntities(ctx, kind);
  const byId = items.find((o) => str(o, 'id') === value);
  if (byId !== undefined) return value;
  const wanted = value.trim().toLowerCase();
  const matches = items.filter((o) => nameOf(o).toLowerCase() === wanted);
  if (matches.length === 1) return str(matches[0] ?? {}, 'id');
  if (matches.length > 1) {
    const list = matches.map((o) => `  ${str(o, 'id')}  ${nameOf(o)}`).join('\n');
    throw new UsageError(`${singular} "${value}" is ambiguous, use one of these ids:\n${list}`);
  }
  if (value.length >= MIN_PREFIX) {
    const p = value.toLowerCase();
    const byPrefix = items.filter((o) => str(o, 'id').toLowerCase().startsWith(p));
    if (byPrefix.length === 1) return str(byPrefix[0] ?? {}, 'id');
    if (byPrefix.length > 1) {
      const list = byPrefix.slice(0, MAX_LISTED).map((o) => `  ${str(o, 'id')}  ${nameOf(o)}`).join('\n');
      throw new UsageError(`${singular} id prefix "${value}" is ambiguous, candidates:\n${list}`);
    }
  }
  const names = items.slice(0, MAX_LISTED).map((o) => `"${nameOf(o)}"`);
  const more = items.length > MAX_LISTED ? `, ... (${items.length - MAX_LISTED} more)` : '';
  throw new UsageError(
    `no ${singular} named "${value}"${items.length === 0 ? `; there are no ${kind}` : `; available: ${names.join(', ')}${more}`}`,
  );
}

export async function resolveTaskId(ctx: Ctx, value: string): Promise<string> {
  if (value.length >= FULL_ID_LENGTH) return value;
  if (value.length < MIN_PREFIX) throw new UsageError(`task id prefix "${value}" is too short, use at least ${MIN_PREFIX} characters`);
  const prefix = value.toLowerCase();
  // The whole set, not one page: a unique match on page 1 may have a twin on page 2.
  const tasks = await listAll(ctx.api, '/tasks', 'tasks', { all: 1 });
  const exact = tasks.find((t) => str(t, 'id') === value);
  if (exact !== undefined) return value;
  const matches = tasks.filter((t) => str(t, 'id').toLowerCase().startsWith(prefix));
  if (matches.length === 1) return str(matches[0] ?? {}, 'id');
  if (matches.length === 0) throw new UsageError(`no task with id or id prefix "${value}"`);
  const list = matches.slice(0, MAX_LISTED).map((t) => `  ${str(t, 'id')}  ${oneLine(str(t, 'title'))}`).join('\n');
  throw new UsageError(`id prefix "${value}" is ambiguous, candidates:\n${list}`);
}
