import { isRecord, listAll, listFrom, objectFrom } from '../api.ts';
import { date, integer, optBool, optList, optStr, parse, priority, status } from '../args.ts';
import type { Parsed } from '../args.ts';
import { auditArgs } from '../audit.ts';
import { mutate } from '../context.ts';
import type { Ctx, Plan } from '../context.ts';
import { ApiError, UsageError } from '../errors.ts';
import { printJson, printMutation, printTaskBlock, printTasks, str } from '../format.ts';
import type { Row } from '../format.ts';
import { listEntities, resolveRef, resolveTaskId } from '../resolve.ts';

const MAX_LIMIT = 1000;

export function prepareTasks(argv: readonly string[]): Plan {
  const p = parse(
    argv,
    {
      status: { type: 'string' },
      area: { type: 'string' },
      project: { type: 'string' },
      'due-before': { type: 'string' },
      focus: { type: 'boolean' },
      all: { type: 'boolean' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
    },
    { min: 0, max: 0, usage: 'no positional arguments' },
  );
  const st = optStr(p, 'status');
  const statusFilter = st === undefined ? undefined : status(st);
  const dueBefore = optStr(p, 'due-before');
  if (dueBefore !== undefined) date('due-before', dueBefore);
  const lim = optStr(p, 'limit');
  const limit = lim === undefined ? undefined : integer('limit', lim, 1, MAX_LIMIT);
  const area = optStr(p, 'area');
  const project = optStr(p, 'project');

  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const clientSide = area !== undefined || project !== undefined || dueBefore !== undefined;
      const areaId = area === undefined ? undefined : await resolveRef(ctx, 'areas', area);
      const projectId = project === undefined ? undefined : await resolveRef(ctx, 'projects', project);
      const query = { status: statusFilter, all: optBool(p, 'all') ? 1 : undefined, isFocusedToday: optBool(p, 'focus') ? 'true' : undefined };
      if (!clientSide) {
        const res = await ctx.api.get('/tasks', { ...query, limit });
        if (optBool(p, 'json')) printJson(ctx.io, res.data);
        else printTasks(ctx.io, listFrom(res, 'tasks', 'GET', '/tasks'));
        return;
      }
      let tasks = await listAll(ctx.api, '/tasks', 'tasks', query);
      if (projectId !== undefined) tasks = tasks.filter((t) => t.projectId === projectId);
      if (areaId !== undefined) {
        // A task in a live project takes the project's area; its own areaId counts only without one.
        const projects = new Map((await listEntities(ctx, 'projects')).map((pr) => [str(pr, 'id'), pr]));
        tasks = tasks.filter((t) => {
          const pr = typeof t.projectId === 'string' ? projects.get(t.projectId) : undefined;
          return (pr === undefined ? t.areaId : pr.areaId) === areaId;
        });
      }
      if (dueBefore !== undefined) tasks = tasks.filter((t) => str(t, 'dueDate') !== '' && str(t, 'dueDate').slice(0, 10) < dueBefore);
      if (limit !== undefined) tasks = tasks.slice(0, limit);
      if (optBool(p, 'json')) printJson(ctx.io, { tasks });
      else printTasks(ctx.io, tasks);
    },
  };
}

export function prepareGet(argv: readonly string[]): Plan {
  const p = parse(argv, { json: { type: 'boolean' } }, { min: 1, max: 1, usage: 'mw get <id> [--json]' });
  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const id = await resolveTaskId(ctx, p.positionals[0] ?? '');
      const path = `/tasks/${encodeURIComponent(id)}`;
      const res = await ctx.api.get(path);
      if (optBool(p, 'json')) printJson(ctx.io, res.data);
      else printTaskBlock(ctx.io, objectFrom(res, 'task', 'GET', path));
    },
  };
}

const PROP_OPTIONS = {
  status: { type: 'string' },
  area: { type: 'string' },
  project: { type: 'string' },
  desc: { type: 'string' },
  tag: { type: 'string', multiple: true },
  context: { type: 'string', multiple: true },
  priority: { type: 'string' },
  json: { type: 'boolean' },
} as const;

// Fields shared by add and update; area/project names are resolved at run time.
function commonProps(p: Parsed): { props: Record<string, unknown>; area?: string; project?: string } {
  const props: Record<string, unknown> = {};
  const st = optStr(p, 'status');
  if (st !== undefined) props.status = status(st);
  const desc = optStr(p, 'desc');
  if (desc !== undefined) props.description = desc;
  const tags = optList(p, 'tag');
  if (tags !== undefined) props.tags = tags;
  const contexts = optList(p, 'context');
  if (contexts !== undefined) props.contexts = contexts;
  const pr = optStr(p, 'priority');
  if (pr !== undefined) props.priority = priority(pr);
  const out: { props: Record<string, unknown>; area?: string; project?: string } = { props };
  const area = optStr(p, 'area');
  const project = optStr(p, 'project');
  if (area !== undefined) out.area = area;
  if (project !== undefined) out.project = project;
  return out;
}

async function applyRefs(ctx: Ctx, props: Record<string, unknown>, area?: string, project?: string): Promise<void> {
  if (area !== undefined) props.areaId = await resolveRef(ctx, 'areas', area);
  if (project !== undefined) props.projectId = await resolveRef(ctx, 'projects', project);
}

export function prepareAdd(argv: readonly string[]): Plan {
  const p = parse(
    argv,
    { ...PROP_OPTIONS, due: { type: 'string' }, start: { type: 'string' }, focus: { type: 'boolean' } },
    { min: 1, max: 1, usage: 'mw add "<title>" [flags]' },
  );
  const title = (p.positionals[0] ?? '').trim();
  if (title === '') throw new UsageError('title must not be empty');
  const { props, area, project } = commonProps(p);
  const due = optStr(p, 'due');
  if (due !== undefined) props.dueDate = date('due', due);
  const start = optStr(p, 'start');
  if (start !== undefined) props.startTime = date('start', start);
  if (optBool(p, 'focus')) props.isFocusedToday = true;

  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      await applyRefs(ctx, props, area, project);
      const res = await mutate(ctx, 'POST', '/tasks', { title, props });
      if (res === undefined) return;
      const task = objectFrom(res, 'task', 'POST', '/tasks');
      ctx.state.taskId = str(task, 'id');
      if (optBool(p, 'json')) printJson(ctx.io, res.data);
      else printMutation(ctx.io, 'added', task, '');
    },
  };
}

export function prepareUpdate(argv: readonly string[]): Plan {
  const p = parse(
    argv,
    {
      ...PROP_OPTIONS,
      title: { type: 'string' },
      due: { type: 'string' },
      'no-due': { type: 'boolean' },
      start: { type: 'string' },
      'no-start': { type: 'boolean' },
      focus: { type: 'boolean' },
      'no-focus': { type: 'boolean' },
      order: { type: 'string' },
    },
    { min: 1, max: 1, usage: 'mw update <id> [flags]' },
  );
  const conflict = (a: string, b: string): void => {
    if (p.values[a] !== undefined && p.values[b] !== undefined) throw new UsageError(`--${a} and --${b} cannot be used together`);
  };
  conflict('due', 'no-due');
  conflict('start', 'no-start');
  conflict('focus', 'no-focus');

  const { props, area, project } = commonProps(p);
  const title = optStr(p, 'title');
  if (title !== undefined) {
    if (title.trim() === '') throw new UsageError('--title must not be empty');
    props.title = title;
  }
  const due = optStr(p, 'due');
  if (due !== undefined) props.dueDate = date('due', due);
  if (optBool(p, 'no-due')) props.dueDate = null;
  const start = optStr(p, 'start');
  if (start !== undefined) props.startTime = date('start', start);
  if (optBool(p, 'no-start')) props.startTime = null;
  if (optBool(p, 'focus')) props.isFocusedToday = true;
  if (optBool(p, 'no-focus')) props.isFocusedToday = false;
  const order = optStr(p, 'order');
  if (order !== undefined) props.order = integer('order', order, 0);
  if (Object.keys(props).length === 0 && area === undefined && project === undefined) {
    throw new UsageError('nothing to update: pass at least one field flag (see mw help)');
  }

  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const id = await resolveTaskId(ctx, p.positionals[0] ?? '');
      ctx.state.taskId = id;
      await applyRefs(ctx, props, area, project);
      const path = `/tasks/${encodeURIComponent(id)}`;
      if (ctx.dryRun) {
        await mutate(ctx, 'PATCH', path, props);
        return;
      }
      // Optimistic locking: patch against the version we read; on 412 re-read once and retry
      // unless someone else changed a field we are about to write.
      let first: Row | undefined;
      for (let attempt = 0; ; attempt++) {
        const current = await ctx.api.get(path);
        const etag = current.headers.get('etag');
        const task = isRecord(current.data) && isRecord(current.data.task) ? current.data.task : {};
        if (first !== undefined) {
          const clash = Object.keys(props).filter((k) => JSON.stringify(first?.[k] ?? null) !== JSON.stringify(task[k] ?? null));
          if (clash.length > 0) {
            throw new ApiError('PATCH', path, 412, `conflict: ${clash.join(', ')} changed by another client since it was read; not retrying`);
          }
        }
        first ??= task;
        try {
          const res = await mutate(ctx, 'PATCH', path, props, etag === null ? undefined : { 'If-Match': etag });
          if (res === undefined) return;
          if (optBool(p, 'json')) printJson(ctx.io, res.data);
          else printMutation(ctx.io, 'updated', isRecord(res.data) && isRecord(res.data.task) ? res.data.task : undefined, id);
          return;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 412 || attempt > 0) throw e;
        }
      }
    },
  };
}

function prepareAction(argv: readonly string[], verb: string, method: 'POST' | 'DELETE', suffix: string, name: string): Plan {
  const p = parse(argv, { json: { type: 'boolean' } }, { min: 1, max: 1, usage: `mw ${name} <id> [--json]` });
  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const id = await resolveTaskId(ctx, p.positionals[0] ?? '');
      ctx.state.taskId = id;
      const res = await mutate(ctx, method, `/tasks/${encodeURIComponent(id)}${suffix}`);
      if (res === undefined) return;
      if (optBool(p, 'json')) printJson(ctx.io, res.data);
      else printMutation(ctx.io, verb, isRecord(res.data) && isRecord(res.data.task) ? (res.data.task as Row) : undefined, id);
    },
  };
}

export const prepareComplete = (argv: readonly string[]): Plan => prepareAction(argv, 'completed', 'POST', '/complete', 'complete');
export const prepareArchive = (argv: readonly string[]): Plan => prepareAction(argv, 'archived', 'POST', '/archive', 'archive');
export const prepareDelete = (argv: readonly string[]): Plan => prepareAction(argv, 'deleted', 'DELETE', '', 'delete');
