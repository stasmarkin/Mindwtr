import type { Api } from './api.ts';
import type { ResolvedConfig } from './config.ts';
import type { Io } from './format.ts';

export const STATUSES = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type Ctx = {
  api: Api;
  io: Io;
  cfg: ResolvedConfig;
  dryRun: boolean;
  // Set by a mutating command as soon as the target task is known, for the audit log.
  state: { taskId?: string };
  cache: Map<string, Promise<Record<string, unknown>[]>>;
};

// Mutations go through here so MW_DRY_RUN is honoured in exactly one place.
export async function mutate(
  ctx: Ctx,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  if (ctx.dryRun) {
    ctx.io.stdout.write(`${method} ${path}\n${body === undefined ? '' : `${JSON.stringify(body, null, 2)}\n`}`);
    return undefined;
  }
  return ctx.api.request(method, path, { ...(body === undefined ? {} : { body }), ...(headers === undefined ? {} : { headers }) });
}

// A parsed command: validated up front (usage errors never reach the network), executed later.
export type Plan = {
  args: Record<string, unknown>;
  run: (ctx: Ctx) => Promise<void>;
};
