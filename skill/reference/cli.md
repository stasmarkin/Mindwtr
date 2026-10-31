# mw reference

Global behaviour: output is a compact table or key: value block by default; `--json` prints the API response body as received (pretty-printed). Errors go to stderr as `mw: <message>`.

Environment: `MW_URL`, `MW_TOKEN`, `MW_CONFIG` (alternative config file path), `MW_DRY_RUN=1`, `MW_AUDIT_LOG=<file>`.

Allowed values. Status: `inbox next waiting someday reference done archived`. Priority: `low medium high urgent`. Dates: `YYYY-MM-DD`.

## Reading

### mw tasks

`mw tasks [--status <s>] [--area <name|id>] [--project <name|id>] [--due-before YYYY-MM-DD] [--focus] [--all] [--limit N] [--json]`

- `--status`, `--all` (include done tasks), `--focus` (only tasks focused for today) and `--limit` (1..1000) are server-side. Without `--status` and `--all` the server default applies.
- `--area`, `--project`, `--due-before` are applied client-side after fetching up to 1000 tasks; `--limit` then applies to the filtered list. `--area` also matches tasks that sit in a project of that area. `--due-before` is strictly before the date and excludes tasks without a due date.
- `--json` with client-side filters prints `{"tasks": [...]}` with the filtered tasks.

```
$ mw tasks --status next --limit 3
ID        STATUS  DUE         TITLE
3f9a1c2e  next    2026-03-01  * Pay the electricity bill
b71d09aa  next                Call the dentist
c0ffee12  next    2026-03-14  Renew passport
```

`*` marks tasks focused for today.

### mw get

`mw get <id> [--json]`

```
$ mw get 3f9a1c2e
title:    Pay the electricity bill
id:       3f9a1c2e-5b7d-4c1e-9a30-2f6e0d8b1a44
status:   next
area:     0c4b...
due:      2026-03-01
priority: high
tags:     #bills
contexts: @online
focus:    yes
description:
Account 12345, use the card.
```

Empty fields are omitted. `<id>` may be a unique prefix of at least 4 characters (resolved by listing all tasks). `--area`, `--project` and `sections` also accept a unique id prefix of 4+ characters.

### mw areas, mw projects, mw sections, mw search

```
mw areas [--json]
mw projects [--json]
mw sections <project name|id> [--json]
mw search "<query>" [--json]
```

```
$ mw projects
ID        NAME        STATUS
5d2e8f01  Renovation  active

$ mw search renovation
ID        STATUS  DUE         TITLE
a1b2c3d4  next    2026-04-01  Choose paint

projects
ID        NAME        STATUS
5d2e8f01  Renovation  active
```

### mw whoami

```
$ mw whoami
url:    https://mindwtr.example.com/…
token:  keychain tech.example.mindwtr/cloud_token
access: ok
```

Shows the host only and where the token came from (`env MW_TOKEN`, `config file`, or `keychain <service>/<account>`), then performs one authenticated read. The token itself is never printed.

## Writing

All mutating commands print `<verb> <id8> <title>` on success, or the raw response with `--json`.

### mw add

`mw add "<title>" [--status s] [--area X] [--project X] [--due D] [--start D] [--desc T] [--tag t]... [--context c]... [--priority p] [--focus] [--json]`

Sends `POST /tasks` with `{"title": ..., "props": {...}}` containing only the flags you passed. `--tag` and `--context` repeat and are sent as given (no prefix is added). Title must be non-empty; put a `--` before a title that starts with `-`.

```
$ mw add "Buy milk" --context @errands --due 2026-03-02
added 7e1f3a90 Buy milk
```

### mw update

`mw update <id> [--title T] [--status s] [--area X] [--project X] [--due D|--no-due] [--start D|--no-start] [--desc T] [--tag t]... [--context c]... [--priority p] [--focus|--no-focus] [--order N] [--json]`

- `--no-due` / `--no-start` clear the field. `--focus` / `--no-focus` set `isFocusedToday`. `--tag` / `--context` replace the whole list. Combining a flag with its `--no-` counterpart, or passing no change at all, is a usage error.
- Reads the task first and patches with `If-Match: <ETag>`; on HTTP 412 it re-reads and retries once, a second 412 is an API error (exit 2). If the server sends no ETag the patch is unconditional.

```
$ mw update 7e1f3a90 --status next --project Renovation --no-focus
updated 7e1f3a90 Buy milk
```

### mw complete, mw archive, mw delete

`mw complete <id> [--json]`, `mw archive <id> [--json]`, `mw delete <id> [--json]`

```
$ mw complete 7e1f3a90
completed 7e1f3a90 Buy milk
```

## Configuration

`~/.config/mw/config.json` (or the file named by `MW_CONFIG`):

```json
{ "url": "https://mindwtr.example.com/v1", "token": "..." }
```

or, instead of `token`, a macOS Keychain item: `{ "url": "...", "keychain": { "service": "my.service", "account": "my-account" } }`.

`MW_URL` and `MW_TOKEN` override the file. Token order: `MW_TOKEN`, then `token` in the file, then Keychain.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | usage error (bad flag/value, unknown or ambiguous area/project/id) |
| 2 | API error; stderr: `mw: <METHOD> <path> -> <status>` and the response body as is |
| 3 | configuration or authentication error (missing URL/token, HTTP 401) |

## Limits

Each `mw` process throttles itself to 100 requests per minute (the server allows 120; processes do not coordinate), and every request times out after 30 s. On HTTP 429 `mw` waits for `Retry-After` seconds (2 s if absent, at most 60 s) and retries once.
