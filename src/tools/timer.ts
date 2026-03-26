import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";

export function registerTimerTools(server: McpServer) {
  server.tool(
    "start_timer",
    "Start a timer for the specified task in Tyme",
    { taskId: z.string().describe("The task ID to start tracking") },
    async ({ taskId }) => {
      const script = `tell application "Tyme"
  set result to (StartTrackerForTaskID "${sanitize(taskId)}")
  return result as text
end tell`;
      try {
        const result = await execAppleScript(script);
        return formatSuccess(
          result === "true"
            ? `Timer started for task ${taskId}`
            : `Timer is already running for task ${taskId}`
        );
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "stop_timer",
    "Stop a timer for the specified task in Tyme",
    { taskId: z.string().describe("The task ID to stop tracking") },
    async ({ taskId }) => {
      const script = `tell application "Tyme"
  set result to (StopTrackerForTaskID "${sanitize(taskId)}")
  return result as text
end tell`;
      try {
        const result = await execAppleScript(script);
        return formatSuccess(
          result === "true"
            ? `Timer stopped for task ${taskId}`
            : `No running timer found for task ${taskId}`
        );
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "get_running_timers",
    "List all currently running timers in Tyme with task and project details",
    {},
    async () => {
      const script = `
const app = Application("Tyme");
const taskIDs = app.trackedtaskids();
const recordIDs = app.trackedrecordids();
const results = [];
for (let i = 0; i < taskIDs.length; i++) {
  const task = app.gettaskwithid(taskIDs[i]);
  results.push({
    taskId: taskIDs[i],
    recordId: recordIDs[i] || null,
    taskName: task.name(),
    projectId: task.relatedprojectid(),
  });
}
JSON.stringify(results);
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
