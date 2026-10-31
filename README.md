# mw

A small command-line client for the [Mindwtr](https://docs.mindwtr.app) Cloud API (self-hosted). List, create, update, complete and delete tasks, and browse areas, projects and sections, from a terminal or an AI agent. Zero runtime dependencies; Node.js 25 or newer.

## Install

```sh
git clone <this repo> && cd mw
make install
```

`make install` runs `pnpm install` and `pnpm build`, then creates two symlinks: `~/.local/bin/mw` pointing at `dist/cli.js`, and `~/.claude/skills/mindwtr` pointing at `skill/` (a skill for Claude Code, see below). Override the locations with `PREFIX` (default `~/.local`) and `SKILLS_DIR` (default `~/.claude/skills`). `DRY_RUN=1 make install` (or `make -n install`) only prints what would happen. `make uninstall` removes those symlinks, and only if they point into this checkout.

Without installing: `pnpm install && pnpm build && node dist/cli.js whoami`.

## Configure

Create `~/.config/mw/config.json`:

```json
{ "url": "https://mindwtr.example.com/v1", "token": "your-api-token" }
```

On macOS you can keep the token in the Keychain instead; `mw` runs `security find-generic-password -s <service> -a <account> -w`:

```json
{ "url": "https://mindwtr.example.com/v1", "keychain": { "service": "my.service", "account": "mindwtr" } }
```

Environment overrides: `MW_URL`, `MW_TOKEN`, `MW_CONFIG` (path of another config file). The token is taken from `MW_TOKEN`, then the file's `token`, then the Keychain. The token is never printed; `mw whoami` shows the host and where the token came from, and checks access.

## Usage

```sh
mw tasks --status inbox
mw tasks --project Renovation --due-before 2026-04-01 --json
mw add "Call the dentist" --status next --context @phone --due 2026-03-05
mw update 3f9a1c2e --project Renovation --focus
mw complete 3f9a1c2e
mw search "passport"
```

Every command and flag is listed in [`skill/reference/cli.md`](skill/reference/cli.md) or `mw help`. `--area` and `--project` accept a name (case-insensitive, exact) or an id; ambiguous or unknown names are an error that lists candidates. Ids in tables are 8-character prefixes and are accepted as long as they are unambiguous.

Exit codes: 0 ok, 1 usage error, 2 API error (stderr has method, path, status and body), 3 configuration or authentication error.

### Safety switches

- `MW_DRY_RUN=1`: `add`, `update`, `complete`, `archive` and `delete` print `<METHOD> <path>` and the JSON body and exit 0 without changing anything. Reads still happen (name resolution), so the output shows real ids. Dry runs do not write the audit log.
- `MW_AUDIT_LOG=/path/to/file`: each executed mutating command appends one JSON line `{ts, cmd, args, taskId, ok, error?}`. Descriptions longer than 200 characters are replaced by their length. If the log cannot be written, `mw` warns on stderr and keeps the command's own exit code.

### Concurrency and rate limits

Mindwtr Cloud 1.2.8+ returns a strong `ETag` on `GET /tasks/:id`. `mw update` reads the task, sends the tag as `If-Match` with the `PATCH`, and on `412 Precondition Failed` re-reads and retries once; a second 412 is an API error. If a server returns no ETag the patch is sent unconditionally.

Each `mw` process limits itself client-side to 100 requests per minute (token bucket) to stay under the server's 120; separate processes do not coordinate. Every request has a 30 s timeout. On HTTP 429 `mw` waits for `Retry-After` (2 s if missing) and retries once.

## Claude Code skill

`skill/` is a ready-to-use skill (`SKILL.md` plus a CLI reference) that teaches an agent the Mindwtr data model and common GTD recipes. `make install` links it into `~/.claude/skills/mindwtr`.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test      # no network, no Keychain access
```

Optional smoke tests against a real server (they use your real configuration): `MW_LIVE=1 pnpm test` runs read-only checks; `MW_LIVE_WRITE=1 pnpm test` additionally creates one task titled `mw smoke <timestamp>`, reads and updates it, and always deletes it.

## License

MIT. Mindwtr itself is AGPL-3.0; `mw` only talks to its public REST API.
