import { parse } from '../args.ts';
import { auditArgs } from '../audit.ts';
import { displayUrl } from '../config.ts';
import type { Plan } from '../context.ts';

export function prepareWhoami(argv: readonly string[]): Plan {
  const p = parse(argv, {}, { min: 0, max: 0, usage: 'mw whoami' });
  return {
    args: auditArgs(p.values, p.positionals),
    run: async (ctx) => {
      const c = ctx.cfg;
      ctx.io.stdout.write(`url:    ${displayUrl(c.url)}\ntoken:  ${c.tokenSource}\n`);
      // /areas is the cheapest authenticated read.
      await ctx.api.get('/areas', { limit: 1 });
      ctx.io.stdout.write('access: ok\n');
    },
  };
}
