import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";
import { parseDateInput } from "../dates.ts";
import { parseIdFromRef } from "../refs.ts";

const DELETE_TIMEOUT = 30_000;

export function registerTaskTools(server: McpServer) {
  server.registerTool(
    "list_tasks",
    {
      description: "List all tasks in a project",
      inputSchema: {
        projectId: z.string().describe("Project ID"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
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

  server.registerTool(
    "get_task_detail",
    {
      description: "Get detailed information about a specific task",
      inputSchema: {
        taskId: z.string().describe("Task ID"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
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

  server.registerTool(
    "get_selected_object",
    {
      description: "Get the currently selected item in the Tyme UI",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
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

  server.registerTool(
    "create_task",
    {
      description: "Create a new task in a project. Note: startDate cannot be set via Tyme's scripting API (read-only in practice).",
      inputSchema: {
        projectId: z.string().describe("Project ID"),
        name: z.string().describe("Task name"),
        taskType: z.enum(["timed", "mileage", "fixed"]).optional().default("timed").describe("Task type (default: timed)"),
        hourlyRate: z.number().finite().optional().describe("Hourly rate"),
        plannedDuration: z.number().finite().optional().describe("Planned duration in seconds"),
        dueDate: z.string().optional().describe("Due date (ISO 8601)"),
        roundingMethod: z.number().finite().min(0).max(2).optional().describe("0=down, 1=nearest, 2=up"),
        roundingMinutes: z.number().finite().optional().describe("Rounding minutes"),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const dueDate = params.dueDate !== undefined
          ? parseDateInput(params.dueDate)
          : undefined;

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
        const ref = await execAppleScript(script);
        // Parse ID from "task id <UUID> of project id <UUID>"
        const newId = parseIdFromRef(ref, "task");

        if (dueDate) {
          const dateScript = `
const app = Application("Tyme");
const t = app.gettaskwithid("${sanitize(newId)}");
if (!t) throw new Error("Task not found after creation");
t.duedate = new Date("${dueDate.toISOString()}");
`;
          try {
            await execJXA(dateScript);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return formatError(
              new Error(`Task created with id ${newId}, but setting dueDate failed: ${message}`),
            );
          }
        }

        return formatSuccess(JSON.stringify({ id: newId, name: params.name }));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "update_task",
    {
      description: "Update an existing task. Note: startDate cannot be set via Tyme's scripting API (read-only in practice).",
      inputSchema: {
        taskId: z.string().describe("Task ID to update"),
        name: z.string().optional().describe("New task name"),
        completed: z.boolean().optional().describe("Mark as completed"),
        hourlyRate: z.number().finite().optional().describe("New hourly rate"),
        plannedDuration: z.number().finite().optional().describe("New planned duration in seconds"),
        dueDate: z.string().optional().describe("New due date (ISO 8601)"),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        // Use JXA for updates to handle date parameters correctly
        const updates: string[] = [];
        if (params.name !== undefined) updates.push(`tsk.name = "${sanitize(params.name)}";`);
        if (params.completed !== undefined) updates.push(`tsk.completed = ${params.completed};`);
        if (params.hourlyRate !== undefined) updates.push(`tsk.timedhourlyrate = ${params.hourlyRate};`);
        if (params.plannedDuration !== undefined) updates.push(`tsk.timedplannedduration = ${params.plannedDuration};`);
        if (params.dueDate !== undefined) {
          const dueDate = parseDateInput(params.dueDate);
          updates.push(`tsk.duedate = new Date("${dueDate.toISOString()}");`);
        }

        if (updates.length === 0) {
          return formatSuccess("No fields to update");
        }

        const script = `
const app = Application("Tyme");
const tsk = app.gettaskwithid("${sanitize(params.taskId)}");
if (!tsk) throw new Error("Task not found: ${sanitize(params.taskId)}");
${updates.join("\n")}
JSON.stringify({ updated: true });
`;
        await execJXA(script);
        return formatSuccess(`Task ${params.taskId} updated`);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "delete_task",
    {
      description: "Delete a task from Tyme",
      inputSchema: {
        taskId: z.string().describe("Task ID to delete"),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
      },
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
