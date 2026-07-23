#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../package.json";
import { registerTimerTools } from "./tools/timer.ts";
import { registerCategoryTools } from "./tools/categories.ts";
import { registerProjectTools } from "./tools/projects.ts";
import { registerTaskTools } from "./tools/tasks.ts";
import { registerSubtaskTools } from "./tools/subtasks.ts";
import { registerRecordTools } from "./tools/records.ts";
import { registerReportTools } from "./tools/reports.ts";

const server = new McpServer({
  name: "tyme-mcp",
  version: packageJson.version,
}, {
  instructions: "Controls the Tyme time-tracking app on macOS via AppleScript/JXA; Tyme must be running on the same machine. Most tools take IDs — discover them with list_categories, list_projects, list_tasks, list_subtasks, or get_task_records. Date-only date inputs are interpreted in the server's local timezone; range endDate is inclusive (end of day).",
});

registerTimerTools(server);
registerCategoryTools(server);
registerProjectTools(server);
registerTaskTools(server);
registerSubtaskTools(server);
registerRecordTools(server);
registerReportTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tyme MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

export { server };
