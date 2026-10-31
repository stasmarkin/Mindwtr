#!/usr/bin/env node
import { runCli } from './main.ts';
import { realDeps } from './runtime.ts';

runCli(process.argv.slice(2), realDeps()).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`mw: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
