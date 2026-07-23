import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execAppleScript, execJXA, sanitize, formatSuccess, formatError } from "../applescript.ts";
import { parseIdFromRef } from "../refs.ts";

export function registerCategoryTools(server: McpServer) {
  server.registerTool(
    "list_categories",
    {
      description: "List all categories in Tyme",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const script = `
const app = Application("Tyme");
const cats = app.categories();
JSON.stringify(cats.map(c => ({ id: c.id(), name: c.name() })));
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
    "create_category",
    {
      description: "Create a new category in Tyme",
      inputSchema: {
        name: z.string().describe("Category name"),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      try {
        const script = `tell application "Tyme"
  set newCategory to (make new category with properties {name:"${sanitize(name)}"})
end tell`;
        const ref = await execAppleScript(script);
        const newId = parseIdFromRef(ref, "category");
        return formatSuccess(JSON.stringify({ id: newId, name }));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "update_category",
    {
      description: "Update an existing category in Tyme",
      inputSchema: {
        categoryId: z.string().describe("Category ID to update"),
        name: z.string().describe("New category name"),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ categoryId, name }) => {
      const safeId = sanitize(categoryId);
      const script = `
const app = Application("Tyme");
const cat = app.categories().find(c => c.id() === "${safeId}");
if (!cat) throw new Error("Category not found: ${safeId}");
cat.name = "${sanitize(name)}";
JSON.stringify({ updated: true });
`;
      try {
        await execJXA(script);
        return formatSuccess(`Category ${categoryId} updated`);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "delete_category",
    {
      description: "Delete a category from Tyme",
      inputSchema: {
        categoryId: z.string().describe("Category ID to delete"),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ categoryId }) => {
      const safeId = sanitize(categoryId);
      const script = `tell application "Tyme"
  -- count check needed: Tyme's whose silently succeeds on non-matching IDs
  set found to (categories whose id is "${safeId}")
  if (count of found) > 0 then
    delete (first item of found)
    return "ok"
  end if
  return "not found"
end tell`;
      try {
        const result = await execAppleScript(script);
        if (result === "not found") {
          return formatError(`Category ${categoryId} not found`);
        }
        return formatSuccess(`Category ${categoryId} deleted`);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
