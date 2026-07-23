import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";
import { parseIdFromRef } from "../refs.ts";

const SUBTASK_TIMEOUT = 30_000;

export function registerSubtaskTools(server: McpServer) {
  server.registerTool(
    "list_subtasks",
    {
      description: "List all subtasks of a task",
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
const task = app.gettaskwithid("${sanitize(taskId)}");
const subtasks = task.subtasks();
JSON.stringify(subtasks.map(s => ({
  id: s.id(),
  name: s.name(),
  completed: s.completed(),
  plannedDuration: s.subtimedplannedduration(),
  fixedRate: s.fixedrate(),
  fixedQuantity: s.fixedquantity(),
  taskId: s.relatedtaskid(),
  projectId: s.relatedprojectid(),
})));
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
    "create_subtask",
    {
      description: "Create a new subtask for a task. completed and dueDate cannot be set through Tyme's scripting API. fixedRate and fixedQuantity only apply to subtasks of fixed tasks.",
      inputSchema: {
        taskId: z.string().describe("Parent task ID"),
        name: z.string().describe("Subtask name"),
        plannedDuration: z.number().finite().optional().describe("Planned duration in seconds"),
        fixedRate: z.number().finite().optional().describe("Fixed rate; only effective for subtasks of fixed tasks"),
        fixedQuantity: z.number().finite().optional().describe("Fixed quantity; only effective for subtasks of fixed tasks"),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const safeTaskId = sanitize(params.taskId);
        const createScript = `tell application "Tyme"
  repeat with proj in projects
    repeat with tsk in tasks of proj
      if id of tsk is "${safeTaskId}" then
        return (make new subtask at end of subtasks of tsk with properties {name:"${sanitize(params.name)}"})
      end if
    end repeat
  end repeat
  error "Task not found: ${safeTaskId}"
end tell`;
        const ref = await execAppleScript(createScript, SUBTASK_TIMEOUT);
        const newId = parseIdFromRef(ref, "subtask");

        if (
          params.plannedDuration !== undefined ||
          params.fixedRate !== undefined ||
          params.fixedQuantity !== undefined
        ) {
          const updates: string[] = [];
          if (params.plannedDuration !== undefined) {
            updates.push(`sub.subtimedplannedduration = ${params.plannedDuration};`);
          }
          if (params.fixedRate !== undefined) {
            updates.push(`sub.fixedrate = ${params.fixedRate};`);
          }
          if (params.fixedQuantity !== undefined) {
            updates.push(`sub.fixedquantity = ${params.fixedQuantity};`);
          }

          const updateScript = `
const app = Application("Tyme");
const tsk = app.gettaskwithid("${safeTaskId}");
if (!tsk) throw new Error("Task not found after subtask creation: ${safeTaskId}");
const sub = tsk.subtasks().find(s => s.id() === "${sanitize(newId)}");
if (!sub) throw new Error("Subtask not found after creation: ${sanitize(newId)}");
${updates.join("\n")}
`;
          try {
            await execJXA(updateScript, SUBTASK_TIMEOUT);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return formatError(
              new Error(`Subtask created with id ${newId}, but setting properties failed: ${message}`),
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
    "update_subtask",
    {
      description: "Update an existing subtask. completed and dueDate cannot be set through Tyme's scripting API. fixedRate and fixedQuantity only apply to subtasks of fixed tasks.",
      inputSchema: {
        subtaskId: z.string().describe("Subtask ID to update"),
        taskId: z.string().describe("Parent task ID (required: subtasks can only be looked up through their parent task, unlike delete_subtask which searches all tasks)"),
        name: z.string().optional().describe("New subtask name"),
        plannedDuration: z.number().finite().optional().describe("New planned duration in seconds"),
        fixedRate: z.number().finite().optional().describe("New fixed rate; only effective for subtasks of fixed tasks"),
        fixedQuantity: z.number().finite().optional().describe("New fixed quantity; only effective for subtasks of fixed tasks"),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const updates: string[] = [];
        if (params.name !== undefined) {
          updates.push(`sub.name = "${sanitize(params.name)}";`);
        }
        if (params.plannedDuration !== undefined) {
          updates.push(`sub.subtimedplannedduration = ${params.plannedDuration};`);
        }
        if (params.fixedRate !== undefined) {
          updates.push(`sub.fixedrate = ${params.fixedRate};`);
        }
        if (params.fixedQuantity !== undefined) {
          updates.push(`sub.fixedquantity = ${params.fixedQuantity};`);
        }

        if (updates.length === 0) {
          return formatSuccess("No fields to update");
        }

        const safeTaskId = sanitize(params.taskId);
        const safeSubtaskId = sanitize(params.subtaskId);
        const script = `
const app = Application("Tyme");
const tsk = app.gettaskwithid("${safeTaskId}");
if (!tsk) throw new Error("Task not found: ${safeTaskId}");
const sub = tsk.subtasks().find(s => s.id() === "${safeSubtaskId}");
if (!sub) throw new Error("Subtask not found: ${safeSubtaskId}");
${updates.join("\n")}
JSON.stringify({ updated: true });
`;
        await execJXA(script);
        return formatSuccess(`Subtask ${params.subtaskId} updated`);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "delete_subtask",
    {
      description: "Delete a subtask from Tyme",
      inputSchema: {
        subtaskId: z.string().describe("Subtask ID to delete"),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskId }) => {
      const safeId = sanitize(subtaskId);
      const script = `tell application "Tyme"
  repeat with proj in projects
    repeat with tsk in tasks of proj
      -- count check needed: Tyme's whose silently succeeds on non-matching IDs
      set found to (subtasks of tsk whose id is "${safeId}")
      if (count of found) > 0 then
        delete (first item of found)
        return "ok"
      end if
    end repeat
  end repeat
  return "not found"
end tell`;
      try {
        const result = await execAppleScript(script, SUBTASK_TIMEOUT);
        if (result === "not found") {
          return formatError(`Subtask ${subtaskId} not found`);
        }
        return formatSuccess(`Subtask ${subtaskId} deleted`);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
