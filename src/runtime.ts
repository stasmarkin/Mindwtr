import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type { Deps } from './main.ts';

export function realDeps(): Deps {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    home: os.homedir(),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    // execFile without a shell: service/account come from the config file and must not be interpreted.
    runSecurity: (service, account) =>
      execFileSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    fetch: globalThis.fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    appendFile: (p, data, opts) => fs.appendFileSync(p, data, opts),
  };
}
