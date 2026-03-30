import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";

const RECORD_TIMEOUT = 30_000;

function buildRecordFetchJXA(recordId: string): string {
  return `
const app = Application("Tyme");
app.getrecordwithid("${sanitize(recordId)}");
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
    "Search time records in Tyme by date range and optional filters. Uses N+1 fetch pattern internally — use limit to control performance.",
    {
      startDate: z.string().describe("Start date (ISO 8601, e.g. 2026-03-01)"),
      endDate: z.string().describe("End date (ISO 8601, e.g. 2026-03-31)"),
      projectId: z.string().optional().describe("Filter by project ID"),
      taskId: z.string().optional().describe("Filter by task ID"),
      categoryId: z.string().optional().describe("Filter by category ID"),
      type: z.enum(["timed", "mileage", "fixed"]).optional().describe("Filter by record type"),
      onlyBillable: z.boolean().optional().describe("Only return billable records"),
      userEmail: z.string().optional().describe("Filter by user email"),
      limit: z.number().finite().optional().default(100).describe("Max records to return (default: 100)"),
    },
    async (params) => {
      // Single JXA script to avoid N+1 osascript calls
      const script = `
const app = Application("Tyme");
const start = new Date("${sanitize(params.startDate)}");
const end = new Date("${sanitize(params.endDate)}");
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
  app.getrecordwithid(ids[i]);
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
      try {
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

      try {
        const ref = await execAppleScript(createScript);
        // Parse ID from "task record id <UUID> of task id <UUID> of project id <UUID>"
        const match = ref.match(/taskRecord id ([^\s]+)/);
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
      // Use JXA to handle ISO 8601 date parsing correctly
      const updates: string[] = [];
      if (params.timeStart) updates.push(`rec.timestart = new Date("${sanitize(params.timeStart)}");`);
      if (params.timeEnd) updates.push(`rec.timeend = new Date("${sanitize(params.timeEnd)}");`);
      if (params.note !== undefined) updates.push(`rec.note = "${sanitize(params.note)}";`);
      if (params.billed !== undefined) updates.push(`rec.billed = ${params.billed};`);
      if (params.paid !== undefined) updates.push(`rec.paid = ${params.paid};`);

      if (updates.length === 0) {
        return formatSuccess("No fields to update");
      }

      const script = `
const app = Application("Tyme");
app.getrecordwithid("${sanitize(params.recordId)}");
const rec = app.lastfetchedtaskrecord;
${updates.join("\n")}
JSON.stringify({ updated: true });
`;
      try {
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
      // Find and delete via iteration (records don't have a direct delete-by-ID)
      const script = `tell application "Tyme"
  repeat with proj in projects
    repeat with tsk in tasks of proj
      repeat with rec in taskRecords of tsk
        if id of rec is "${sanitize(recordId)}" then
          delete rec
          return "ok"
        end if
      end repeat
      repeat with sub in subtasks of tsk
        repeat with rec in taskRecords of sub
          if id of rec is "${sanitize(recordId)}" then
            delete rec
            return "ok"
          end if
        end repeat
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
