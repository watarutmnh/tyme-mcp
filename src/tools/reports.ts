import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";
import { parseDateInput } from "../dates.ts";

const REPORT_TIMEOUT = 30_000;

export function registerReportTools(server: McpServer) {
  server.registerTool(
    "get_daily_summary",
    {
      description: "Get a summary of work done on a specific day. The date is interpreted in the server's local timezone.",
      inputSchema: {
        date: z.string().describe("Date to summarize (date-only, e.g. 2026-03-25)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ date }) => {
      try {
        const start = parseDateInput(date, { dateOnly: true });
        const end = parseDateInput(date, { dateOnly: true, endOfDay: true });
        const script = `
const app = Application("Tyme");
const start = new Date("${start.toISOString()}");
const end = new Date("${end.toISOString()}");
app.gettaskrecordids({ startdate: start, enddate: end });
const ids = app.fetchedtaskrecordids();
const projects = app.projects();
const projectNames = {};
for (let i = 0; i < projects.length; i++) {
  projectNames[projects[i].id()] = projects[i].name();
}
const taskNames = {};
const entries = [];
let totalDuration = 0;
let totalCosts = 0;
for (let i = 0; i < ids.length; i++) {
  if (!app.getrecordwithid(ids[i])) continue;
  const r = app.lastfetchedtaskrecord;
  const duration = r.timedduration();
  const costs = r.costs();
  totalDuration += duration;
  totalCosts += costs;
  // Find project name via related IDs
  const projId = r.relatedprojectid();
  const taskId = r.relatedtaskid();
  if (taskNames[taskId] === undefined) {
    const task = app.gettaskwithid(taskId);
    taskNames[taskId] = task ? task.name() : "Unknown";
  }
  entries.push({
    projectName: projectNames[projId] !== undefined ? projectNames[projId] : "Unknown",
    taskName: taskNames[taskId],
    duration: duration,
    costs: costs,
  });
}
JSON.stringify({
  date: "${sanitize(date)}",
  totalDuration: totalDuration,
  totalCosts: totalCosts,
  entries: entries,
});
`;
        const result = await execJXA(script, REPORT_TIMEOUT);
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "get_range_summary",
    {
      description: "Get a summary of work done over a date range, grouped by project. Date-only values are interpreted in the server's local timezone; endDate is inclusive (end of day).",
      inputSchema: {
        startDate: z.string().describe("Start date (ISO 8601)"),
        endDate: z.string().describe("End date (ISO 8601)"),
        projectId: z.string().optional().describe("Filter by project ID"),
        categoryId: z.string().optional().describe("Filter by category ID"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const start = parseDateInput(params.startDate);
        const end = parseDateInput(params.endDate, { endOfDay: true });
        const script = `
const app = Application("Tyme");
const start = new Date("${start.toISOString()}");
const end = new Date("${end.toISOString()}");
app.gettaskrecordids({
  startdate: start,
  enddate: end,
  ${params.projectId ? `projectid: "${sanitize(params.projectId)}",` : ""}
  ${params.categoryId ? `categoryid: "${sanitize(params.categoryId)}",` : ""}
});
const ids = app.fetchedtaskrecordids();
const projectMap = {};
let totalDuration = 0;
let totalCosts = 0;
for (let i = 0; i < ids.length; i++) {
  if (!app.getrecordwithid(ids[i])) continue;
  const r = app.lastfetchedtaskrecord;
  const duration = r.timedduration();
  const costs = r.costs();
  totalDuration += duration;
  totalCosts += costs;
  const projId = r.relatedprojectid();
  if (!projectMap[projId]) {
    const proj = app.projects().find(p => p.id() === projId);
    projectMap[projId] = {
      id: projId,
      name: proj ? proj.name() : "Unknown",
      duration: 0,
      costs: 0,
    };
  }
  projectMap[projId].duration += duration;
  projectMap[projId].costs += costs;
}
JSON.stringify({
  startDate: "${sanitize(params.startDate)}",
  endDate: "${sanitize(params.endDate)}",
  totalDuration: totalDuration,
  totalCosts: totalCosts,
  projects: Object.values(projectMap),
});
`;
        const result = await execJXA(script, REPORT_TIMEOUT);
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
