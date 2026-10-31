---
name: mindwtr
description: Read and manage tasks in the user's self-hosted Mindwtr (a GTD task manager) through the `mw` CLI. Use only when the user mentions Mindwtr, the `mw` command, or their GTD lists (inbox, next actions, waiting, someday) and areas/projects kept in it, for example "process my Mindwtr inbox" or "what is focused for today in Mindwtr".
---

# Mindwtr via `mw`

`mw` is a command-line client for the Mindwtr Cloud API. Always use it instead of calling the API by hand. Full flag reference with sample output: `reference/cli.md`.

## Data model

- Task statuses: `inbox` (unprocessed capture), `next` (ready to do), `waiting` (blocked on someone or something), `someday` (maybe later), `reference` (information, not actionable), `done`, `archived`.
- Focus of the day: `isFocusedToday` (set with `--focus` / `--no-focus`) marks tasks to do today, shown with a `*` in tables. It is separate from the due date.
- `dueDate` (`YYYY-MM-DD`) is a deadline. `startTime` (`--start`) is when the task becomes actionable; a future start hides a task from "do now" thinking, it is not a deadline. `reviewAt` is when to look at the task again.
- Areas are long-lived spheres of life or work; projects are outcomes with several tasks and can belong to an area; sections split a project. A task in a project belongs to the project's area, so `mw tasks --area X` includes those.
- Contexts (`@home`) say where or with what a task can be done; tags (`#topic`) are free-form labels. Both are sent exactly as typed, so include the `@` / `#` prefix if you want it.
- `description` is the only notes field. There are no separate comments.
- Ids are shown as 8-character prefixes in tables; commands accept a prefix of at least 4 characters when it is unambiguous. Use `--json` when you need full ids.
- Ids are for `mw` calls only: the Mindwtr apps show titles, never ids, so the user cannot see or use them. In messages to the user, name tasks by title (add the project or due date when titles repeat) and never show ids. When the user names a task, find its id with `mw search`; if several tasks match, ask which one by those details, not by id.

## Recipes

- Process the inbox: `mw tasks --status inbox`, then for each item decide: do it now (`mw complete <id>`), clarify it (`mw update <id> --status next --project "Name" --due 2026-03-01`), park it (`--status someday`), or drop it (`mw delete <id>`). Ask the user when the intent of an item is unclear.
- What is on today: `mw tasks --focus` for the starred list, plus `mw tasks --due-before <tomorrow>` for anything due today or overdue (`--due-before` is strictly before the date).
- Postpone to tomorrow: `mw update <id> --due <tomorrow>` (or `--start <tomorrow>` if the task simply should not appear before then); `--no-focus` takes it off today's list.
- Complete: `mw complete <id>`. Archive finished or obsolete items: `mw archive <id>`.
- Move to a project or area: `mw update <id> --project "Name"` / `--area "Name"`. Names are matched case-insensitively and exactly; an unknown or ambiguous name is an error that lists the candidates.
- Find something: `mw search "text"`.
- Capture: `mw add "Title" --desc "details"` lands in the inbox unless `--status` says otherwise.

## Exit codes

- 0 ok. 1 usage error: bad flag or value, unknown area/project name, ambiguous id. 2 API error: stderr has the method, path, HTTP status and server body. 3 configuration or authentication: no URL/token, or HTTP 401.
- `mw whoami` checks the configuration and access without printing the token.

## Safety

- Mutating commands: `add`, `update`, `complete`, `archive`, `delete`. `delete` is a soft delete on the server but still treat it as destructive: confirm with the user before deleting anything they did not explicitly ask to delete.
- `MW_DRY_RUN=1` makes mutating commands print the request they would send and exit 0 without sending it. Use it to preview a bulk change.
- `MW_AUDIT_LOG=<file>` appends one JSON line per executed mutating command (timestamp, command, arguments, task id, success or error). Dry runs are not logged.
- If the user did not mention Mindwtr or `mw` in this request, confirm before any mutation (`add`, `update`, `complete`, `archive`, `delete`): another task system may be meant.
- Never print, log or ask for the API token. Do not read the config file or the Keychain yourself.
- `update` is optimistic: it reads the task, then patches with `If-Match`, and retries once if the task changed in between. Exit 2 with status 412 means someone keeps editing the same task; re-read it and decide again.
