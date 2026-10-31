# mw

Zero-dependency TypeScript CLI for the self-hosted Mindwtr Cloud API, plus a Claude Code skill. Open source (MIT): code, docs and skill are in English and contain nothing specific to one user.

## Layout

- `src/cli.ts` — entry (shebang only); `src/main.ts` — `runCli(argv, deps)`: dispatch, config, audit, exit codes. All I/O (fetch, clock, sleep, fs, Keychain runner, stdout/stderr) comes in through `Deps`, so tests need no monkeypatching.
- `src/api.ts` (HTTP client, token bucket, 429 retry), `src/config.ts`, `src/resolve.ts` (area/project names, task id prefixes), `src/format.ts`, `src/audit.ts`, `src/args.ts`, `src/commands/*.ts` (each `prepareX(argv)` validates flags and returns a `Plan`).
- `skill/` — `SKILL.md` + `reference/cli.md`, symlinked to `~/.claude/skills/mindwtr` by `make install`. Keep it in sync with the CLI.
- `src/test/harness.ts` — fake fetch/clock for tests; excluded from the build.

## Commands

- `pnpm install`, `pnpm typecheck`, `pnpm test` (`node --test` runs `.ts` directly), `pnpm build` (tsc to `dist/`, chmod +x).
- `make build|test|typecheck|install|uninstall`; `DRY_RUN=1` or `make -n` for a dry run. Agents must not run a real `make install`.
- `MW_LIVE=1` / `MW_LIVE_WRITE=1` enable `src/live.test.ts` against a real server.

## Conventions

- Node >= 25, ESM, strict TS, erasable syntax only (no `enum`, `namespace`, parameter properties), imports with `.ts` extensions. No runtime dependencies.
- Exit codes: 1 usage (`UsageError`), 2 API (`ApiError`), 3 config/auth (`ConfigError`, `AuthError`, HTTP 401).
- Never print, log, or write the token anywhere, not even a prefix. Tests never call the `security` binary or the network.
- Mutations go through `mutate()` in `src/context.ts` so `MW_DRY_RUN` is honoured in one place.
