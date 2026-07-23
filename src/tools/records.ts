import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";
import { parseDateInput } from "../dates.ts";

const RECORD_TIMEOUT = 30_000;

function buildRecordFetchJXA(recordId: string): string {
  return `
const app = Application("Tyme");
if (!app.getrecordwithid("${sanitize(recordId)}")) {
  throw new Error("Record not found: ${sanitize(recordId)}");
}
const r = app.lastfetchedtaskrecord;
JSON.stringify({
  id: r.id(),
  recordType: r.recordtype(),
  timeStart: r.timestart().toISOString(),
  timeEnd: r.timeend().toISOString(),
  duration: r.timedduration(),
  costs: r.costs(),
  note: r.note(),
  billed: r.billed(),
  paid: r.paid(),
  taskId: r.relatedtaskid(),
  projectId: r.relatedprojectid(),
  categoryId: r.relatedcategoryid(),
  subtaskId: r.relatedsubtaskid(),
  userEmail: r.useremail(),
  mileageTraveledDistance: r.mileagetraveleddistance(),
});
`;
}

export function registerRecordTools(server: McpServer) {
  server.tool(
    "get_task_records",
    "Search time records in Tyme by date range and optional filters. Date-only values are interpreted in the server's local timezone; endDate is inclusive (end of day). Uses N+1 fetch pattern internally — use limit to control performance.",
    {
      startDate: z.string().describe("Start date (ISO 8601, e.g. 2026-03-01). Date-only values are interpreted in the server's local timezone."),
      endDate: z.string().describe("End date (ISO 8601, e.g. 2026-03-31). Date-only values are interpreted in the server's local timezone and are inclusive (end of day)."),
      projectId: z.string().optional().describe("Filter by project ID"),
      taskId: z.string().optional().describe("Filter by task ID"),
      categoryId: z.string().optional().describe("Filter by category ID"),
      type: z.enum(["timed", "mileage", "fixed"]).optional().describe("Filter by record type"),
      onlyBillable: z.boolean().optional().describe("Only return billable records"),
      userEmail: z.string().optional().describe("Filter by user email"),
      limit: z.number().finite().optional().default(100).describe("Max records to return (default: 100)"),
    },
    async (params) => {
      try {
        const start = parseDateInput(params.startDate);
        const end = parseDateInput(params.endDate, { endOfDay: true });

        // Single JXA script to avoid N+1 osascript calls
        const script = `
const app = Application("Tyme");
const start = new Date("${start.toISOString()}");
const end = new Date("${end.toISOString()}");
app.gettaskrecordids({
  startdate: start,
  enddate: end,
  ${params.projectId ? `projectid: "${sanitize(params.projectId)}",` : ""}
  ${params.taskId ? `taskid: "${sanitize(params.taskId)}",` : ""}
  ${params.categoryId ? `categoryid: "${sanitize(params.categoryId)}",` : ""}
  ${params.type ? `type: "${sanitize(params.type)}",` : ""}
  ${params.onlyBillable !== undefined ? `onlybillable: ${params.onlyBillable},` : ""}
  ${params.userEmail ? `useremail: "${sanitize(params.userEmail)}",` : ""}
});
const ids = app.fetchedtaskrecordids();
const limit = ${params.limit};
const records = [];
for (let i = 0; i < Math.min(ids.length, limit); i++) {
  if (!app.getrecordwithid(ids[i])) continue;
  const r = app.lastfetchedtaskrecord;
  records.push({
    id: r.id(),
    recordType: r.recordtype(),
    timeStart: r.timestart().toISOString(),
    timeEnd: r.timeend().toISOString(),
    duration: r.timedduration(),
    costs: r.costs(),
    note: r.note(),
    billed: r.billed(),
    paid: r.paid(),
    taskId: r.relatedtaskid(),
    projectId: r.relatedprojectid(),
    categoryId: r.relatedcategoryid(),
    subtaskId: r.relatedsubtaskid(),
    userEmail: r.useremail(),
  });
}
JSON.stringify({ total: ids.length, returned: records.length, records: records });
`;
        const result = await execJXA(script, RECORD_TIMEOUT);
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "get_record_detail",
    "Get detailed information about a specific time record",
    {
      recordId: z.string().describe("Record ID"),
    },
    async ({ recordId }) => {
      try {
        const result = await execJXA(buildRecordFetchJXA(recordId));
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

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
      try {
        const timeStart = parseDateInput(params.timeStart);
        const timeEnd = parseDateInput(params.timeEnd);

        // Step 1: AppleScript make new taskRecord (without dates — JXA make can't handle Date objects)
        // Must iterate projects/tasks because AppleScript can't find tasks by ID at top level
        const props = params.note !== undefined
          ? `with properties {note:"${sanitize(params.note)}"}`
          : "";
        const createScript = `tell application "Tyme"
  repeat with proj in projects
    repeat with tsk in tasks of proj
      if id of tsk is "${sanitize(params.taskId)}" then
        return (make new taskRecord at end of taskRecords of tsk ${props})
      end if
    end repeat
  end repeat
  error "Task not found"
end tell`;

        const ref = await execAppleScript(createScript, RECORD_TIMEOUT);
        // Parse ID from "taskRecord id <UUID> of task id <UUID> of project id <UUID>"
        const newId = ref.match(/taskRecord id ([^\s]+)/)?.[1];
        if (!newId) {
          throw new Error(`Failed to parse record ID from: ${ref}`);
        }

        // Step 2: JXA to set dates (same pattern as update_record)
        const dateScript = `
const app = Application("Tyme");
if (!app.getrecordwithid("${sanitize(newId)}")) {
  throw new Error("Record not found: ${sanitize(newId)}");
}
const rec = app.lastfetchedtaskrecord;
rec.timestart = new Date("${timeStart.toISOString()}");
rec.timeend = new Date("${timeEnd.toISOString()}");
`;
        try {
          await execJXA(dateScript, RECORD_TIMEOUT);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return formatError(
            new Error(`Record created with id ${newId}, but setting dates failed: ${message}`),
          );
        }
        return formatSuccess(JSON.stringify({ id: newId }));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "update_record",
    "Update an existing time record",
    {
      recordId: z.string().describe("Record ID to update"),
      timeStart: z.string().optional().describe("New start time (ISO 8601)"),
      timeEnd: z.string().optional().describe("New end time (ISO 8601)"),
      note: z.string().optional().describe("New note"),
      billed: z.boolean().optional().describe("Mark as billed"),
      paid: z.boolean().optional().describe("Mark as paid"),
    },
    async (params) => {
      try {
        // Use JXA to handle ISO 8601 date parsing correctly
        const updates: string[] = [];
        if (params.timeStart !== undefined) {
          const timeStart = parseDateInput(params.timeStart);
          updates.push(`rec.timestart = new Date("${timeStart.toISOString()}");`);
        }
        if (params.timeEnd !== undefined) {
          const timeEnd = parseDateInput(params.timeEnd);
          updates.push(`rec.timeend = new Date("${timeEnd.toISOString()}");`);
        }
        if (params.note !== undefined) updates.push(`rec.note = "${sanitize(params.note)}";`);
        if (params.billed !== undefined) updates.push(`rec.billed = ${params.billed};`);
        if (params.paid !== undefined) updates.push(`rec.paid = ${params.paid};`);

        if (updates.length === 0) {
          return formatSuccess("No fields to update");
        }

        const script = `
const app = Application("Tyme");
if (!app.getrecordwithid("${sanitize(params.recordId)}")) {
  throw new Error("Record not found: ${sanitize(params.recordId)}");
}
const rec = app.lastfetchedtaskrecord;
${updates.join("\n")}
JSON.stringify({ updated: true });
`;
        await execJXA(script);
        return formatSuccess(`Record ${params.recordId} updated`);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "delete_record",
    "Delete a time record from Tyme",
    {
      recordId: z.string().describe("Record ID to delete"),
    },
    async ({ recordId }) => {
      const safeId = sanitize(recordId);
      const script = `tell application "Tyme"
  repeat with proj in projects
    repeat with tsk in tasks of proj
      -- count check needed: Tyme's whose silently succeeds on non-matching IDs
      set found to (taskRecords of tsk whose id is "${safeId}")
      if (count of found) > 0 then
        delete (first item of found)
        return "ok"
      end if
      repeat with sub in subtasks of tsk
        set foundSub to (taskRecords of sub whose id is "${safeId}")
        if (count of foundSub) > 0 then
          delete (first item of foundSub)
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
  return "not found"
end tell`;
      try {
        const result = await execAppleScript(script, RECORD_TIMEOUT);
        if (result === "not found") {
          return formatError(`Record ${recordId} not found`);
        }
        return formatSuccess(`Record ${recordId} deleted`);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
