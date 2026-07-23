import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";
import { parseDateInput } from "../dates.ts";
import { parseIdFromRef } from "../refs.ts";

export function registerProjectTools(server: McpServer) {
  server.registerTool(
    "list_projects",
    {
      description: "List all projects in Tyme, optionally filtered by category",
      inputSchema: {
        categoryId: z.string().optional().describe("Filter by category ID"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
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

  server.registerTool(
    "create_project",
    {
      description: "Create a new project in Tyme",
      inputSchema: {
        name: z.string().describe("Project name"),
        categoryId: z.string().optional().describe("Category ID to assign"),
        hourlyRate: z.number().finite().optional().describe("Default hourly rate"),
        dueDate: z.string().optional().describe("Due date (ISO 8601)"),
        plannedBudget: z.number().finite().optional().describe("Planned budget"),
        plannedDuration: z.number().finite().optional().describe("Planned duration in seconds"),
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
        const ref = await execAppleScript(script);
        // Parse ID from "project id <UUID>"
        const newId = parseIdFromRef(ref, "project");

        if (dueDate) {
          const dateScript = `
const app = Application("Tyme");
const proj = app.projects().find(p => p.id() === "${sanitize(newId)}");
if (!proj) throw new Error("Project not found after creation");
proj.duedate = new Date("${dueDate.toISOString()}");
`;
          try {
            await execJXA(dateScript);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return formatError(
              new Error(`Project created with id ${newId}, but setting dueDate failed: ${message}`),
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
    "update_project",
    {
      description: "Update an existing project in Tyme",
      inputSchema: {
        projectId: z.string().describe("Project ID to update"),
        name: z.string().optional().describe("New project name"),
        completed: z.boolean().optional().describe("Mark as completed"),
        hourlyRate: z.number().finite().optional().describe("New hourly rate"),
        dueDate: z.string().optional().describe("New due date (ISO 8601)"),
        plannedBudget: z.number().finite().optional().describe("New planned budget"),
        plannedDuration: z.number().finite().optional().describe("New planned duration in seconds"),
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
        if (params.name !== undefined) updates.push(`proj.name = "${sanitize(params.name)}";`);
        if (params.completed !== undefined) updates.push(`proj.completed = ${params.completed};`);
        if (params.hourlyRate !== undefined) updates.push(`proj.defaulthourlyrate = ${params.hourlyRate};`);
        if (params.dueDate !== undefined) {
          const dueDate = parseDateInput(params.dueDate);
          updates.push(`proj.duedate = new Date("${dueDate.toISOString()}");`);
        }
        if (params.plannedBudget !== undefined) updates.push(`proj.plannedbudget = ${params.plannedBudget};`);
        if (params.plannedDuration !== undefined) updates.push(`proj.plannedduration = ${params.plannedDuration};`);

        if (updates.length === 0) {
          return formatSuccess("No fields to update");
        }

        const script = `
const app = Application("Tyme");
const proj = app.projects().find(p => p.id() === "${sanitize(params.projectId)}");
if (!proj) throw new Error("Project not found: ${sanitize(params.projectId)}");
${updates.join("\n")}
JSON.stringify({ updated: true });
`;
        await execJXA(script);
        return formatSuccess(`Project ${params.projectId} updated`);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "delete_project",
    {
      description: "Delete a project from Tyme",
      inputSchema: {
        projectId: z.string().describe("Project ID to delete"),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      const safeId = sanitize(projectId);
      const script = `tell application "Tyme"
  -- count check needed: Tyme's whose silently succeeds on non-matching IDs
  set found to (projects whose id is "${safeId}")
  if (count of found) > 0 then
    delete (first item of found)
    return "ok"
  end if
  return "not found"
end tell`;
      try {
        const result = await execAppleScript(script);
        if (result === "not found") {
          return formatError(`Project ${projectId} not found`);
        }
        return formatSuccess(`Project ${projectId} deleted`);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
