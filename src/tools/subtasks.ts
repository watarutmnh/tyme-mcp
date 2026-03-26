import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";

export function registerSubtaskTools(server: McpServer) {
  server.tool(
    "list_subtasks",
    "List all subtasks of a task",
    {
      taskId: z.string().describe("Task ID"),
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
}
