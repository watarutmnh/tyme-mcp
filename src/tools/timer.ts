import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";

export function registerTimerTools(server: McpServer) {
  server.tool(
    "start_timer",
    "Start a timer for the specified task in Tyme",
    { taskId: z.string().describe("The task ID to start tracking") },
    async ({ taskId }) => {
      // StartTrackerForTaskID returns true even when a timer is already
      // running for the task, so check trackedtaskids() first to
      // distinguish the states.
      const script = `
const app = Application("Tyme");
const task = app.gettaskwithid("${sanitize(taskId)}");
let out;
if (!task) {
  out = { status: "not_found" };
} else if (app.trackedtaskids().includes("${sanitize(taskId)}")) {
  out = { status: "already_running" };
} else {
  out = { status: app.starttrackerfortaskid("${sanitize(taskId)}") ? "started" : "failed" };
}
JSON.stringify(out);
`;
      try {
        const result = await execJXA(script);
        const { status } = JSON.parse(result) as { status: string };
        if (status === "not_found") {
          return formatError(`Task ${taskId} not found`);
        }
        if (status === "started") {
          return formatSuccess(`Timer started for task ${taskId}`);
        }
        if (status === "already_running") {
          return formatSuccess(`Timer is already running for task ${taskId}`);
        }
        return formatError(`Failed to start timer for task ${taskId}`);
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
      // StopTrackerForTaskID returns true even when no timer is running
      // for the task, so check trackedtaskids() first to distinguish
      // the states.
      const script = `
const app = Application("Tyme");
const task = app.gettaskwithid("${sanitize(taskId)}");
let out;
if (!task) {
  out = { status: "not_found" };
} else if (!app.trackedtaskids().includes("${sanitize(taskId)}")) {
  out = { status: "not_running" };
} else {
  out = { status: app.stoptrackerfortaskid("${sanitize(taskId)}") ? "stopped" : "failed" };
}
JSON.stringify(out);
`;
      try {
        const result = await execJXA(script);
        const { status } = JSON.parse(result) as { status: string };
        if (status === "not_found") {
          return formatError(`Task ${taskId} not found`);
        }
        if (status === "stopped") {
          return formatSuccess(`Timer stopped for task ${taskId}`);
        }
        if (status === "not_running") {
          return formatSuccess(`No running timer found for task ${taskId}`);
        }
        return formatError(`Failed to stop timer for task ${taskId}`);
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
