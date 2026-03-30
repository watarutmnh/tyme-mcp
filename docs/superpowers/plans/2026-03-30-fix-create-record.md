# Fix create_record -1700 Error — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `create_record` tool so it can create time records with dates without -1700 type conversion error.

**Architecture:** Two-step approach — AppleScript `make new taskRecord` (without dates) to create the record and obtain its ID, then JXA to set dates on the created record using the proven `update_record` pattern.

**Tech Stack:** TypeScript, AppleScript, JXA, osascript

---

### Task 1: Rewrite `create_record` handler

**Files:**
- Modify: `src/tools/records.ts:113-138`

- [ ] **Step 1: Replace the `create_record` handler**

Replace the current JXA-only implementation (lines 113-138 in `src/tools/records.ts`) with the two-step approach. The full replacement for the `create_record` tool registration:

```typescript
  server.tool(
    "create_record",
    "Create a new time record for a task",
    {
      taskId: z.string().describe("Task ID to add the record to"),
      timeStart: z.string().describe("Start time (ISO 8601)"),
      timeEnd: z.string().describe("End time (ISO 8601)"),
      note: z.string().optional().describe("Note for the record"),
    },
    async (params) => {
      // Step 1: AppleScript make new taskRecord (without dates — JXA make can't handle Date objects)
      const props = params.note !== undefined
        ? `with properties {note:"${sanitize(params.note)}"}`
        : "";
      const createScript = `tell application "Tyme"
  set tsk to first task whose id is "${sanitize(params.taskId)}"
  set newRec to (make new taskRecord at end of taskRecords of tsk ${props})
end tell`;

      try {
        const ref = await execAppleScript(createScript);
        // Parse ID from "task record id <UUID> of task id <UUID> of project id <UUID>"
        const match = ref.match(/task record id ([^\s]+)/);
        const newId = match ? match[1] : ref;

        // Step 2: JXA to set dates (same pattern as update_record)
        const dateScript = `
const app = Application("Tyme");
app.getrecordwithid("${sanitize(newId)}");
const rec = app.lastfetchedtaskrecord;
rec.timestart = new Date("${sanitize(params.timeStart)}");
rec.timeend = new Date("${sanitize(params.timeEnd)}");
JSON.stringify({ id: "${sanitize(newId)}" });
`;
        await execJXA(dateScript);
        return formatSuccess(JSON.stringify({ id: newId }));
      } catch (error) {
        return formatError(error);
      }
    },
  );
```

Key design decisions:
- `props` handles optional `note` — when undefined, `with properties` is omitted entirely
- ID parsed from AppleScript reference string using `task record id` prefix (same pattern as `create_task` uses `task id`)
- Date setting uses `app.getrecordwithid()` → `app.lastfetchedtaskrecord` → property assignment, identical to `update_record`

- [ ] **Step 2: Verify the code compiles**

Run: `cd /Users/cdgrph/dev/tyme-mcp && bun run start`

Expected: Server starts without errors (Ctrl+C to stop). No TypeScript compilation errors.

- [ ] **Step 3: Manual test — create a record**

Using the MCP tool, call `create_record` with:
```json
{
  "taskId": "<a valid task ID from list_tasks>",
  "timeStart": "2026-03-30T01:30:00.000Z",
  "timeEnd": "2026-03-30T02:00:00.000Z",
  "note": "test record"
}
```

Expected: Returns `{ "id": "<UUID>" }` without error.

Then verify with `get_record_detail` using the returned ID — confirm `timeStart`, `timeEnd`, and `note` are correct.

- [ ] **Step 4: Manual test — create a record without note**

Call `create_record` without the `note` parameter:
```json
{
  "taskId": "<same task ID>",
  "timeStart": "2026-03-30T02:00:00.000Z",
  "timeEnd": "2026-03-30T02:30:00.000Z"
}
```

Expected: Returns `{ "id": "<UUID>" }` without error. The `note` field should be empty/default.

- [ ] **Step 5: Commit**

```bash
git checkout -b fix/create-record-type-error
git add src/tools/records.ts
git commit -m "fix: resolve create_record -1700 type conversion error

Use two-step approach: AppleScript make new (without dates) + JXA
date update. JXA app.make() cannot pass Date objects in withProperties.

Closes #1"
```

---

### Task 2: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md:62`

- [ ] **Step 1: Update the JXA creation pattern note**

In `AGENTS.md`, replace line 62:

```
Exception: `create_record` uses JXA `app.make()` because AppleScript cannot parse ISO 8601 dates.
```

With:

```
`create_record` uses a two-step pattern: AppleScript `make new` (to create the record and get its ID) + JXA (to set dates via property assignment). JXA `app.make()` cannot pass `Date` objects in `withProperties` (-1700 error).
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md with create_record two-step pattern"
```
