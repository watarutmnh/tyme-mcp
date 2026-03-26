import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";

export function registerProjectTools(server: McpServer) {
  server.tool(
    "list_projects",
    "List all projects in Tyme, optionally filtered by category",
    {
      categoryId: z.string().optional().describe("Filter by category ID"),
    },
    async ({ categoryId }) => {
      const script = `
const app = Application("Tyme");
const projects = app.projects();
const result = projects
  .filter(p => ${categoryId ? `p.categoryid() === "${sanitize(categoryId)}"` : "true"})
  .map(p => ({
    id: p.id(),
    name: p.name(),
    completed: p.completed(),
    categoryId: p.categoryid(),
    defaultHourlyRate: p.defaulthourlyrate(),
    plannedBudget: p.plannedbudget(),
    plannedDuration: p.plannedduration(),
  }));
JSON.stringify(result);
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
    "create_project",
    "Create a new project in Tyme",
    {
      name: z.string().describe("Project name"),
      categoryId: z.string().optional().describe("Category ID to assign"),
      hourlyRate: z.number().finite().optional().describe("Default hourly rate"),
      dueDate: z.string().optional().describe("Due date (ISO 8601)"),
      plannedBudget: z.number().finite().optional().describe("Planned budget"),
      plannedDuration: z.number().finite().optional().describe("Planned duration in seconds"),
      roundingMethod: z.number().finite().min(0).max(2).optional().describe("0=down, 1=nearest, 2=up"),
      roundingMinutes: z.number().finite().optional().describe("Rounding minutes"),
    },
    async (params) => {
      // Use AppleScript make new — returns "project id <UUID>"
      const props = [`name:"${sanitize(params.name)}"`];
      if (params.categoryId) props.push(`categoryID:"${sanitize(params.categoryId)}"`);
      if (params.hourlyRate !== undefined) props.push(`defaultHourlyRate:${params.hourlyRate}`);
      if (params.plannedBudget !== undefined) props.push(`plannedBudget:${params.plannedBudget}`);
      if (params.plannedDuration !== undefined) props.push(`plannedDuration:${params.plannedDuration}`);
      if (params.roundingMethod !== undefined) props.push(`roundingMethod:${params.roundingMethod}`);
      if (params.roundingMinutes !== undefined) props.push(`roundingMinutes:${params.roundingMinutes}`);

      const script = `tell application "Tyme"
  set newProject to (make new project with properties {${props.join(", ")}})
end tell`;
      try {
        const ref = await execAppleScript(script);
        // Parse ID from "project id <UUID>"
        const match = ref.match(/project id ([^\s]+)/);
        const newId = match ? match[1] : ref;
        return formatSuccess(JSON.stringify({ id: newId, name: params.name }));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "update_project",
    "Update an existing project in Tyme",
    {
      projectId: z.string().describe("Project ID to update"),
      name: z.string().optional().describe("New project name"),
      completed: z.boolean().optional().describe("Mark as completed"),
      hourlyRate: z.number().finite().optional().describe("New hourly rate"),
      dueDate: z.string().optional().describe("New due date (ISO 8601)"),
      plannedBudget: z.number().finite().optional().describe("New planned budget"),
      plannedDuration: z.number().finite().optional().describe("New planned duration in seconds"),
    },
    async (params) => {
      // Use JXA for updates to handle date parameters correctly
      const updates: string[] = [];
      if (params.name !== undefined) updates.push(`proj.name = "${sanitize(params.name)}";`);
      if (params.completed !== undefined) updates.push(`proj.completed = ${params.completed};`);
      if (params.hourlyRate !== undefined) updates.push(`proj.defaulthourlyrate = ${params.hourlyRate};`);
      if (params.dueDate) updates.push(`proj.duedate = new Date("${sanitize(params.dueDate)}");`);
      if (params.plannedBudget !== undefined) updates.push(`proj.plannedbudget = ${params.plannedBudget};`);
      if (params.plannedDuration !== undefined) updates.push(`proj.plannedduration = ${params.plannedDuration};`);

      if (updates.length === 0) {
        return formatSuccess("No fields to update");
      }

      const script = `
const app = Application("Tyme");
const proj = app.projects().find(p => p.id() === "${sanitize(params.projectId)}");
if (!proj) throw new Error("Project not found");
${updates.join("\n")}
JSON.stringify({ updated: true });
`;
      try {
        await execJXA(script);
        return formatSuccess(`Project ${params.projectId} updated`);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "delete_project",
    "Delete a project from Tyme",
    {
      projectId: z.string().describe("Project ID to delete"),
    },
    async ({ projectId }) => {
      const script = `tell application "Tyme"
  delete (first project whose id is "${sanitize(projectId)}")
  return "ok"
end tell`;
      try {
        await execAppleScript(script);
        return formatSuccess(`Project ${projectId} deleted`);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
