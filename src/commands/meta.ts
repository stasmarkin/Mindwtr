import { listFrom, optionalListFrom } from '../api.ts';
import { optBool, parse } from '../args.ts';
import { auditArgs } from '../audit.ts';
import type { Plan } from '../context.ts';
import { printJson, printNamed, printTasks, str } from '../format.ts';
import type { Row } from '../format.ts';
import { resolveRef } from '../resolve.ts';

// Tombstones must never look like live data.
const live = (items: Row[]): Row[] => items.filter((o) => str(o, 'deletedAt') === '');

function prepareList(argv: readonly string[], kind: 'areas' | 'projects'): Plan {
  const p = parse(argv, { json: { type: 'boolean' } }, { min: 0, max: 0, usage: `mw ${kind} [--json]` });
  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const res = await ctx.api.get(`/${kind}`);
      if (optBool(p, 'json')) printJson(ctx.io, res.data);
      else printNamed(ctx.io, live(listFrom(res, kind, 'GET', `/${kind}`)), { status: kind === 'projects', empty: `no ${kind}` });
    },
  };
}

export const prepareAreas = (argv: readonly string[]): Plan => prepareList(argv, 'areas');
export const prepareProjects = (argv: readonly string[]): Plan => prepareList(argv, 'projects');

export function prepareSections(argv: readonly string[]): Plan {
  const p = parse(argv, { json: { type: 'boolean' } }, { min: 1, max: 1, usage: 'mw sections <projectId> [--json]' });
  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const projectId = await resolveRef(ctx, 'projects', p.positionals[0] ?? '');
      const res = await ctx.api.get('/sections', { projectId });
      if (optBool(p, 'json')) printJson(ctx.io, res.data);
      else printNamed(ctx.io, live(listFrom(res, 'sections', 'GET', '/sections')), { empty: 'no sections' });
    },
  };
}

export function prepareSearch(argv: readonly string[]): Plan {
  const p = parse(argv, { json: { type: 'boolean' } }, { min: 1, max: 1, usage: 'mw search "<query>" [--json]' });
  const query = (p.positionals[0] ?? '').trim();
  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const res = await ctx.api.get('/search', { query });
      if (optBool(p, 'json')) {
        printJson(ctx.io, res.data);
        return;
      }
      printTasks(ctx.io, listFrom(res, 'tasks', 'GET', '/search'));
      const projects = optionalListFrom(res, 'projects');
      if (projects.length > 0) {
        ctx.io.stdout.write('\nprojects\n');
        printNamed(ctx.io, projects, { status: true, empty: '' });
      }
    },
  };
}
