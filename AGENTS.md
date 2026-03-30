# AGENTS.md

## Purpose

MCP server connecting AI assistants to [Tyme](https://www.tyme-app.com/) (macOS time tracking app) via AppleScript/JXA.

## Tech Stack

- **Runtime**: Bun (TypeScript, no build step)
- **Protocol**: MCP SDK (`@modelcontextprotocol/sdk`)
- **Validation**: Zod
- **OS Integration**: `osascript` (AppleScript + JXA)

## Architecture

```
src/
  index.ts          — Server bootstrap, tool registration
  applescript.ts    — execAppleScript(), execJXA(), sanitize(), formatSuccess(), formatError()
  tools/
    timer.ts        — start_timer, stop_timer, get_running_timers
    categories.ts   — list_categories
    projects.ts     — list/create/update/delete project
    tasks.ts        — list/detail/selected/create/update/delete task
    subtasks.ts     — list_subtasks
    records.ts      — search/detail/create/update/delete record
    reports.ts      — daily/range summary
```

## Key Constraints

### JXA Property Names

All JXA property/method names are **lowercase** — not camelCase:
- `p.categoryid()` not `p.categoryID()`
- `app.gettaskwithid(id)` not `app.GetTaskWithID(id)`
- `app.trackedtaskids()` not `app.trackedTaskIDs()`

AppleScript commands keep original casing: `StartTrackerForTaskID`, `StopTrackerForTaskID`

### Security

All user inputs MUST pass through `sanitize()` before interpolation into scripts. This prevents AppleScript/JXA injection via quotes, newlines, and control characters.

### Read vs Write Pattern

- **Read** (list/get/search): JXA → returns JSON via `JSON.stringify()`
- **Write** (create): AppleScript `make new` → parse ID from reference string
- **Write** (update): JXA → handles dates via `new Date()`
- **Write** (delete): AppleScript → iterate and delete

### JXA Object Creation

Do NOT use `push()` for creating Tyme objects — the returned array index is unreliable for retrieving the new object's ID. Use AppleScript `make new` which returns a reference string containing the ID:

```
task id <UUID> of project id <UUID>
```

Parse the ID with regex: `ref.match(/task id ([^\s]+)/)`

`create_record` uses a two-step pattern: AppleScript `make new` (to create the record and get its ID) + JXA (to set dates via property assignment). JXA `app.make()` cannot pass `Date` objects in `withProperties` (-1700 error).

### MCP Tool Helpers

All tool handlers use `formatSuccess()` and `formatError()` from `applescript.ts` to avoid boilerplate. Do not manually construct `{ content: [{ type: "text", text }] }` objects.

## Commands

```bash
bun install          # Install dependencies
bun run start        # Start MCP server
bun run dev          # Start with watch mode
```

## Git Conventions

- Commit messages: English, [Conventional Commits](https://www.conventionalcommits.org/)
- Branch naming: `feature/*`, `fix/*`, `docs/*`, `chore/*`
- No direct commits to `main`

## Publishing

Published to npm as `tyme-mcp`. Users install via `bunx tyme-mcp`.

- `bin` field in `package.json` points to `src/index.ts` (with `#!/usr/bin/env bun` shebang)
- `files` field limits published contents to `src/`
- Bump `version` in `package.json` before `npm publish --access public`
