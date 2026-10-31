import { Api } from './api.ts';
import { writeAudit } from './audit.ts';
import { loadConfig } from './config.ts';
import type { ConfigDeps } from './config.ts';
import type { Ctx, Plan } from './context.ts';
import { exitCodeFor, UsageError } from './errors.ts';
import type { Io } from './format.ts';
import { prepareAreas, prepareProjects, prepareSearch, prepareSections } from './commands/meta.ts';
import { prepareAdd, prepareArchive, prepareComplete, prepareDelete, prepareGet, prepareTasks, prepareUpdate } from './commands/tasks.ts';
import { prepareWhoami } from './commands/whoami.ts';

export type Deps = Io &
  ConfigDeps & {
    fetch: typeof fetch;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    appendFile: (path: string, data: string, opts: { flag: string; mode: number }) => void;
  };

type Entry = { mutating: boolean; prepare: (argv: readonly string[]) => Plan };

const COMMANDS: Record<string, Entry> = {
  tasks: { mutating: false, prepare: prepareTasks },
  get: { mutating: false, prepare: prepareGet },
  add: { mutating: true, prepare: prepareAdd },
  update: { mutating: true, prepare: prepareUpdate },
  complete: { mutating: true, prepare: prepareComplete },
  archive: { mutating: true, prepare: prepareArchive },
  delete: { mutating: true, prepare: prepareDelete },
  areas: { mutating: false, prepare: prepareAreas },
  projects: { mutating: false, prepare: prepareProjects },
  sections: { mutating: false, prepare: prepareSections },
  search: { mutating: false, prepare: prepareSearch },
  whoami: { mutating: false, prepare: prepareWhoami },
};

export const USAGE = `usage: mw <command> [flags]

  mw tasks [--status s] [--area X] [--project X] [--due-before D] [--focus] [--all] [--limit N] [--json]
  mw get <id> [--json]
  mw add "<title>" [--status s] [--area X] [--project X] [--due D] [--start D] [--desc T]
         [--tag t]... [--context c]... [--priority p] [--focus] [--json]
  mw update <id> [--title T] [--status s] [--area X] [--project X] [--due D|--no-due] [--start D|--no-start]
         [--desc T] [--tag t]... [--context c]... [--priority p] [--focus|--no-focus] [--order N] [--json]
  mw complete <id>   mw archive <id>   mw delete <id>
  mw areas [--json]  mw projects [--json]  mw sections <project> [--json]
  mw search "<query>" [--json]
  mw whoami

statuses: inbox next waiting someday reference done archived
priorities: low medium high urgent
env: MW_URL MW_TOKEN MW_CONFIG MW_DRY_RUN=1 MW_AUDIT_LOG=<file>
exit codes: 0 ok, 1 usage, 2 API error, 3 config/auth
`;

export async function runCli(argv: readonly string[], deps: Deps): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined) {
    deps.stderr.write(USAGE);
    return 1;
  }
  if (name === 'help' || name === '--help' || name === '-h') {
    deps.stdout.write(USAGE);
    return 0;
  }

  const state: Ctx['state'] = {};
  let entry: Entry | undefined;
  let plan: Plan | undefined;
  const dryRun = ['1', 'true'].includes(deps.env.MW_DRY_RUN ?? '');
  const auditPath = deps.env.MW_AUDIT_LOG?.trim() || undefined;
  let code = 0;
  let failure: unknown;
  try {
    entry = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (entry === undefined) throw new UsageError(`unknown command "${name}" (try: mw help)`);
    plan = entry.prepare(rest);
    const cfg = loadConfig(deps);
    const api = new Api({ baseUrl: cfg.url, token: cfg.token, fetch: deps.fetch, now: deps.now, sleep: deps.sleep });
    const ctx: Ctx = { api, io: deps, cfg, dryRun: entry.mutating && dryRun, state, cache: new Map() };
    await plan.run(ctx);
  } catch (e) {
    failure = e;
    code = exitCodeFor(e);
    deps.stderr.write(`mw: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  // Only commands that got past argument parsing are audited; dry runs never touch the log.
  if (entry?.mutating && plan !== undefined && auditPath !== undefined && !dryRun) {
    try {
      writeAudit(auditPath, deps.appendFile, {
        ts: new Date(deps.now()).toISOString(),
        cmd: name,
        args: plan.args,
        taskId: state.taskId ?? null,
        ok: failure === undefined,
        ...(failure === undefined ? {} : { error: failure instanceof Error ? failure.message : String(failure) }),
      });
    } catch (e) {
      deps.stderr.write(`mw: warning: cannot write audit log: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  return code;
}
