import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";

const DELETE_TIMEOUT = 30_000;

export function registerTaskTools(server: McpServer) {
  server.tool(
    "list_tasks",
    "List all tasks in a project",
    {
      projectId: z.string().describe("Project ID"),
    },
    async ({ projectId }) => {
      const script = `
const app = Application("Tyme");
const proj = app.projects().find(p => p.id() === "${sanitize(projectId)}");
if (!proj) throw new Error("Project not found");
const tasks = proj.tasks();
JSON.stringify(tasks.map(t => ({
  id: t.id(),
  name: t.name(),
  taskType: t.tasktype(),
  completed: t.completed(),
  hourlyRate: t.timedhourlyrate(),
  plannedDuration: t.timedplannedduration(),
  projectId: t.relatedprojectid(),
  categoryId: t.relatedcategoryid(),
})));
`;
      try {
        const result = await execJXA(script, 30_000);
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "get_task_detail",
    "Get detailed information about a specific task",
    {
      taskId: z.string().describe("Task ID"),
    },
    async ({ taskId }) => {
      const script = `
const app = Application("Tyme");
const t = app.gettaskwithid("${sanitize(taskId)}");
JSON.stringify({
  id: t.id(),
  name: t.name(),
  taskType: t.tasktype(),
  completed: t.completed(),
  completedDate: t.completeddate() ? t.completeddate().toISOString() : null,
  dueDate: t.duedate() ? t.duedate().toISOString() : null,
  startDate: t.startdate() ? t.startdate().toISOString() : null,
  hourlyRate: t.timedhourlyrate(),
  plannedDuration: t.timedplannedduration(),
  roundingMethod: t.timedroundingmethod(),
  roundingMinutes: t.timedroundingminutes(),
  projectId: t.relatedprojectid(),
  categoryId: t.relatedcategoryid(),
});
`;
      try {
        const result = await execJXA(script);
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "get_selected_object",
    "Get the currently selected item in the Tyme UI",
    {},
    async () => {
      const script = `
const app = Application("Tyme");
JSON.stringify({
  id: app.selectedobjecturl(),
  name: app.selectedobjectname(),
});
`;
      try {
        const result = await execJXA(script);
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "create_task",
    "Create a new task in a project",
    {
      projectId: z.string().describe("Project ID"),
      name: z.string().describe("Task name"),
      taskType: z.enum(["timed", "mileage", "fixed"]).optional().default("timed").describe("Task type (default: timed)"),
      hourlyRate: z.number().finite().optional().describe("Hourly rate"),
      plannedDuration: z.number().finite().optional().describe("Planned duration in seconds"),
      startDate: z.string().optional().describe("Start date (ISO 8601)"),
      dueDate: z.string().optional().describe("Due date (ISO 8601)"),
      roundingMethod: z.number().finite().min(0).max(2).optional().describe("0=down, 1=nearest, 2=up"),
      roundingMinutes: z.number().finite().optional().describe("Rounding minutes"),
    },
    async (params) => {
      // Use AppleScript make new — returns "task id <UUID> of project id <UUID>"
      const props = [`name:"${sanitize(params.name)}"`];
      if (params.taskType) props.push(`taskType:"${sanitize(params.taskType)}"`);
      if (params.hourlyRate !== undefined) props.push(`timedHourlyRate:${params.hourlyRate}`);
      if (params.plannedDuration !== undefined) props.push(`timedPlannedDuration:${params.plannedDuration}`);
      if (params.roundingMethod !== undefined) props.push(`timedRoundingMethod:${params.roundingMethod}`);
      if (params.roundingMinutes !== undefined) props.push(`timedRoundingMinutes:${params.roundingMinutes}`);

      const script = `tell application "Tyme"
  set proj to first project whose id is "${sanitize(params.projectId)}"
  set newTask to (make new task at end of tasks of proj with properties {${props.join(", ")}})
end tell`;
      try {
        const ref = await execAppleScript(script);
        // Parse ID from "task id <UUID> of project id <UUID>"
        const match = ref.match(/task id ([^\s]+)/);
        const newId = match ? match[1] : ref;
        return formatSuccess(JSON.stringify({ id: newId, name: params.name }));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "update_task",
    "Update an existing task",
    {
      taskId: z.string().describe("Task ID to update"),
      name: z.string().optional().describe("New task name"),
      completed: z.boolean().optional().describe("Mark as completed"),
      hourlyRate: z.number().finite().optional().describe("New hourly rate"),
      plannedDuration: z.number().finite().optional().describe("New planned duration in seconds"),
      startDate: z.string().optional().describe("New start date (ISO 8601)"),
      dueDate: z.string().optional().describe("New due date (ISO 8601)"),
    },
    async (params) => {
      // Use JXA for updates to handle date parameters correctly
      const updates: string[] = [];
      if (params.name !== undefined) updates.push(`tsk.name = "${sanitize(params.name)}";`);
      if (params.completed !== undefined) updates.push(`tsk.completed = ${params.completed};`);
      if (params.hourlyRate !== undefined) updates.push(`tsk.timedhourlyrate = ${params.hourlyRate};`);
      if (params.plannedDuration !== undefined) updates.push(`tsk.timedplannedduration = ${params.plannedDuration};`);
      if (params.startDate) updates.push(`tsk.startdate = new Date("${sanitize(params.startDate)}");`);
      if (params.dueDate) updates.push(`tsk.duedate = new Date("${sanitize(params.dueDate)}");`);

      if (updates.length === 0) {
        return formatSuccess("No fields to update");
      }

      const script = `
const app = Application("Tyme");
const tsk = app.gettaskwithid("${sanitize(params.taskId)}");
${updates.join("\n")}
JSON.stringify({ updated: true });
`;
      try {
        await execJXA(script);
        return formatSuccess(`Task ${params.taskId} updated`);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "delete_task",
    "Delete a task from Tyme",
    {
      taskId: z.string().describe("Task ID to delete"),
    },
    async ({ taskId }) => {
      const safeId = sanitize(taskId);
      const script = `tell application "Tyme"
  repeat with proj in projects
    -- count check needed: Tyme's whose silently succeeds on non-matching IDs
    set found to (tasks of proj whose id is "${safeId}")
    if (count of found) > 0 then
      delete (first item of found)
      return "ok"
    end if
  end repeat
  return "not found"
end tell`;
      try {
        const result = await execAppleScript(script, DELETE_TIMEOUT);
        if (result === "not found") {
          return formatError(`Task ${taskId} not found`);
        }
        return formatSuccess(`Task ${taskId} deleted`);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
