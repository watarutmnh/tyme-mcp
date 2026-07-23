# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-23

### Added

- Category management: `create_category`, `update_category`, `delete_category`
- Subtask management: `create_subtask`, `update_subtask`, `delete_subtask`
  (`completed` and `dueDate` are not settable through Tyme's scripting API and
  are therefore not exposed; `fixedRate`/`fixedQuantity` only take effect for
  subtasks of fixed-type tasks)
- `get_project_detail` — dueDate, completedDate, rounding settings and category
  are now readable
- Mileage support: `mileageKilometerRate` on tasks, `mileageDistance` on
  records (only effective for mileage-type tasks)
- `create_record` can attach records to subtasks via the optional `subtaskId`
- `update_project` gains `categoryId`, `roundingMethod`, `roundingMinutes`
- MCP tool annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`) and
  server `instructions`
- Unit tests (`bun test`, runs in CI) and a 63-check E2E smoke suite against
  real Tyme (`bun run smoke`, local only)
- CI workflow: typecheck + tests on every pull request; npm provenance on
  publish

### Fixed

- Date-range boundaries: date-only inputs are now interpreted in the server's
  local timezone and `endDate` is inclusive (end of day). Previously UTC
  parsing silently dropped records — in UTC+9, 00:00–09:00 of the start day
  and most of the end day were excluded from searches and reports
- Invalid calendar dates (e.g. `2026-02-30`) are rejected instead of silently
  rolling over to a different day
- `create_project`/`create_task` accepted `dueDate` but silently discarded it —
  now actually set. `startDate` was removed from task tools (not writable
  through Tyme's scripting API despite the sdef declaring it `rw`)
- `delete_project` reported success for nonexistent project IDs
- `start_timer`/`stop_timer` misreported unknown task IDs as "already
  running"/"no running timer"; timer state is now determined via
  `trackedTaskIDs` before acting
- Unknown record IDs now return "Record not found" instead of raw AppleScript
  `-1728` errors; cross-call races on Tyme's app-global `lastFetchedTaskRecord`
  eliminated by serializing osascript execution
- `get_daily_summary` no longer summarizes the wrong day in negative UTC
  offsets and no longer crashes when a record's task has been deleted; project
  lookups are now O(projects + records) instead of O(records × projects)
- `get_task_records` now returns `mileageTraveledDistance`/`mileageTraveledDuration`,
  matching `get_record_detail`
- MCP handshake advertised a stale server version (now single-sourced from
  package.json)
- Type error under `noUncheckedIndexedAccess`; publishing is now gated by
  typecheck

### Changed

- Empty-string date parameters now raise `Invalid date` instead of being
  silently ignored
- Timer tools rewritten in JXA with explicit three-state semantics
  (not found / started / already running)

## [0.1.1] - 2026-03-30

### Fixed

- `create_record`: resolved the `-1700` type conversion error with a two-step
  create pattern (AppleScript `make new` + JXA date assignment); corrected
  task lookup and ID parsing
- `delete_task`/`delete_record`: count-before-delete so nonexistent IDs report
  "not found" (Tyme's `whose` filter silently succeeds on non-matching IDs);
  timeout and DRY improvements

### Added

- GitHub Actions workflow for npm auto-publish on tag push

## [0.1.0] - 2026-03-27

### Added

- Initial release: 22 MCP tools covering timers, categories, projects, tasks,
  subtasks, time records and reports, bridged to Tyme via AppleScript/JXA

[Unreleased]: https://github.com/watarutmnh/tyme-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/watarutmnh/tyme-mcp/releases/tag/v0.2.0
