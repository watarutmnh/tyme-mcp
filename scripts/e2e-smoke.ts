// E2E smoke test for tyme-mcp — exercises all 22 MCP tools against the real
// Tyme app through the actual tool handlers (InMemoryTransport).
//
// Requirements: macOS with Tyme running. Not suitable for CI.
// Usage: bun run smoke
//
// Creates a project prefixed "MCP-TEST-" and removes everything it created,
// even on failure. Running timers that existed before the run are untouched.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTimerTools } from "../src/tools/timer.ts";
import { registerCategoryTools } from "../src/tools/categories.ts";
import { registerProjectTools } from "../src/tools/projects.ts";
import { registerTaskTools } from "../src/tools/tasks.ts";
import { registerSubtaskTools } from "../src/tools/subtasks.ts";
import { registerRecordTools } from "../src/tools/records.ts";
import { registerReportTools } from "../src/tools/reports.ts";
import { execJXA } from "../src/applescript.ts";

const server = new McpServer({ name: "tyme-mcp-smoke", version: "0.0.0" });
registerTimerTools(server);
registerCategoryTools(server);
registerProjectTools(server);
registerTaskTools(server);
registerSubtaskTools(server);
registerRecordTools(server);
registerReportTools(server);

const [clientT, serverT] = InMemoryTransport.createLinkedPair();
await server.connect(serverT);
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(clientT);

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : " — " + detail}`);
  if (!cond) failures++;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content?: { type: string; text: string }[];
  };
  const text = res.content?.[0]?.text ?? "";
  return { isError: !!res.isError, text };
}

function today(): { dateOnly: string; y: number; m: number; d: number } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { dateOnly: `${y}-${pad(m)}-${pad(d)}`, y, m, d };
}

const BOGUS = "BOGUS-ID-SMOKE-TEST";
const PROJECT_NAME = `MCP-TEST-e2e-${Date.now()}`;
const T = today();

const baselineTimers = JSON.parse(
  await execJXA(`const app=Application("Tyme");JSON.stringify(app.trackedtaskids());`),
) as string[];
console.log(`baseline running timers: ${JSON.stringify(baselineTimers)}`);

let projectId = "";
let taskId = "";
let recordId = "";

try {
  // --- input validation ---
  const badDate = await call("get_task_records", { startDate: "garbage", endDate: T.dateOnly });
  check("invalid date rejected", badDate.isError && badDate.text.includes("Invalid date"), badDate.text);
  const rollover = await call("get_task_records", { startDate: "2026-02-30", endDate: "2026-03-05" });
  check("calendar rollover rejected", rollover.isError && rollover.text.includes("no such calendar date"), rollover.text);
  const dailyDt = await call("get_daily_summary", { date: `${T.dateOnly}T10:00:00` });
  check("daily summary rejects datetime input", dailyDt.isError && dailyDt.text.includes("date-only"), dailyDt.text);

  // --- read-only tools (no fixtures needed) ---
  const cats = await call("list_categories");
  check("list_categories returns JSON array", !cats.isError && Array.isArray(JSON.parse(cats.text)), cats.text.slice(0, 200));
  const sel = await call("get_selected_object");
  const selJson = sel.isError ? null : JSON.parse(sel.text);
  check("get_selected_object returns id/name", selJson !== null && "id" in selJson && "name" in selJson, sel.text);

  // --- project lifecycle ---
  const cp = await call("create_project", { name: PROJECT_NAME, dueDate: "2026-08-01" });
  check("create_project ok", !cp.isError, cp.text);
  projectId = JSON.parse(cp.text).id;

  const lp = await call("list_projects");
  check("list_projects includes new project", JSON.parse(lp.text).some((p: { id: string }) => p.id === projectId), lp.text.slice(0, 200));

  const up = await call("update_project", { projectId, name: `${PROJECT_NAME}-renamed`, hourlyRate: 120 });
  check("update_project ok", !up.isError, up.text);
  const upBogus = await call("update_project", { projectId: BOGUS, name: "x" });
  check("update_project bogus → Project not found", upBogus.isError && upBogus.text.includes("Project not found"), upBogus.text);

  // --- task lifecycle ---
  const ct = await call("create_task", { projectId, name: "smoke-task", dueDate: "2026-07-30" });
  check("create_task ok", !ct.isError, ct.text);
  taskId = JSON.parse(ct.text).id;

  const lt = await call("list_tasks", { projectId });
  check("list_tasks includes new task", JSON.parse(lt.text).some((t: { id: string }) => t.id === taskId), lt.text.slice(0, 200));

  const td = await call("get_task_detail", { taskId });
  const tdJson = JSON.parse(td.text);
  check("get_task_detail dueDate set", tdJson.dueDate === new Date(2026, 6, 30).toISOString(), `got ${tdJson.dueDate}`);

  const ls = await call("list_subtasks", { taskId });
  check("list_subtasks returns array", !ls.isError && Array.isArray(JSON.parse(ls.text)), ls.text);

  const ut = await call("update_task", { taskId, plannedDuration: 3600 });
  check("update_task ok", !ut.isError, ut.text);
  const utBogus = await call("update_task", { taskId: BOGUS, name: "x" });
  check("update_task bogus → Task not found", utBogus.isError && utBogus.text.includes("Task not found"), utBogus.text);

  // --- timer three-state semantics ---
  const stBogus = await call("start_timer", { taskId: BOGUS });
  check("start_timer bogus → not found", stBogus.isError && stBogus.text.includes("not found"), stBogus.text);
  const st1 = await call("start_timer", { taskId });
  check("start_timer → started", !st1.isError && st1.text.includes("started"), st1.text);
  const st2 = await call("start_timer", { taskId });
  check("start_timer again → already running", !st2.isError && st2.text.includes("already running"), st2.text);
  const running = await call("get_running_timers");
  check("get_running_timers includes test task", running.text.includes(taskId), running.text);
  const sp1 = await call("stop_timer", { taskId });
  check("stop_timer → stopped", !sp1.isError && sp1.text.includes("stopped"), sp1.text);
  const sp2 = await call("stop_timer", { taskId });
  check("stop_timer again → no running timer", !sp2.isError && sp2.text.includes("No running timer"), sp2.text);
  const spBogus = await call("stop_timer", { taskId: BOGUS });
  check("stop_timer bogus → not found", spBogus.isError && spBogus.text.includes("not found"), spBogus.text);

  // remove the record left by the start/stop cycle
  const cycleRecords = await call("get_task_records", { startDate: T.dateOnly, endDate: T.dateOnly, taskId });
  for (const r of JSON.parse(cycleRecords.text).records) {
    await call("delete_record", { recordId: r.id });
  }

  // --- record lifecycle ---
  const cr = await call("create_record", {
    taskId,
    timeStart: `${T.dateOnly}T09:00:00`,
    timeEnd: `${T.dateOnly}T09:05:00`,
    note: "smoke-note",
  });
  check("create_record ok", !cr.isError, cr.text);
  recordId = JSON.parse(cr.text).id;

  const afterCreate = JSON.parse(
    await execJXA(`const app=Application("Tyme");JSON.stringify(app.trackedtaskids());`),
  ) as string[];
  check("create_record leaves no running timer", !afterCreate.includes(taskId), JSON.stringify(afterCreate));

  const rd = await call("get_record_detail", { recordId });
  const rdJson = JSON.parse(rd.text);
  check("record timeStart correct", rdJson.timeStart === new Date(T.y, T.m - 1, T.d, 9, 0, 0).toISOString(), rdJson.timeStart);
  check("record detail has mileage fields", "mileageTraveledDistance" in rdJson, rd.text);

  const search = await call("get_task_records", { startDate: T.dateOnly, endDate: T.dateOnly, projectId });
  const searchJson = JSON.parse(search.text);
  const found = searchJson.records.find((r: { id: string }) => r.id === recordId);
  check("date-only range finds record", !!found, search.text.slice(0, 300));
  check("list serializer includes mileage fields", found && "mileageTraveledDistance" in found, JSON.stringify(found));

  const rdBogus = await call("get_record_detail", { recordId: BOGUS });
  check("get_record_detail bogus → Record not found", rdBogus.isError && rdBogus.text.includes("Record not found"), rdBogus.text);
  const urBogus = await call("update_record", { recordId: BOGUS, note: "x" });
  check("update_record bogus → Record not found", urBogus.isError && urBogus.text.includes("Record not found"), urBogus.text);
  const ur = await call("update_record", { recordId, note: "smoke-note-2", billed: true });
  check("update_record ok", !ur.isError, ur.text);

  // --- reports ---
  const daily = await call("get_daily_summary", { date: T.dateOnly });
  check("daily summary includes test project", JSON.parse(daily.text).entries.some(
    (e: { projectName: string }) => e.projectName.startsWith("MCP-TEST"),
  ), daily.text.slice(0, 300));
  const range = await call("get_range_summary", { startDate: T.dateOnly, endDate: T.dateOnly, projectId });
  check("range summary includes test project", JSON.parse(range.text).projects.some(
    (p: { id: string }) => p.id === projectId,
  ), range.text.slice(0, 300));

  // --- day-boundary semantics (endOfDay inclusive) ---
  const prev = new Date(T.y, T.m - 1, T.d - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const prevDateOnly = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
  const crEdge = await call("create_record", {
    taskId, timeStart: `${prevDateOnly}T23:30:00`, timeEnd: `${prevDateOnly}T23:59:59`, note: "edge",
  });
  const crNext = await call("create_record", {
    taskId, timeStart: `${T.dateOnly}T00:00:00`, timeEnd: `${T.dateOnly}T00:10:00`, note: "edge-next",
  });
  const edgeId = JSON.parse(crEdge.text).id;
  const nextId = JSON.parse(crNext.text).id;
  const dayX = await call("get_task_records", { startDate: prevDateOnly, endDate: prevDateOnly, projectId });
  const dayXIds = JSON.parse(dayX.text).records.map((r: { id: string }) => r.id);
  check("boundary: 23:59:59 record inside its day", dayXIds.includes(edgeId), JSON.stringify(dayXIds));
  check("boundary: next-day 00:00 record outside", !dayXIds.includes(nextId), JSON.stringify(dayXIds));
  await call("delete_record", { recordId: edgeId });
  await call("delete_record", { recordId: nextId });
} catch (err) {
  // Without this, a mid-run crash would reach the finally block with
  // failures === 0 and process.exit(0) would swallow the exception,
  // reporting a false ALL PASS.
  failures++;
  console.error("UNCAUGHT FAILURE:", err);
} finally {
  if (recordId) {
    const dr = await call("delete_record", { recordId });
    check("delete_record ok", !dr.isError, dr.text);
    const drAgain = await call("delete_record", { recordId });
    check("delete_record again → not found", drAgain.isError, drAgain.text);
  }
  if (taskId) {
    const dt = await call("delete_task", { taskId });
    check("delete_task ok", !dt.isError, dt.text);
  }
  if (projectId) {
    const dp = await call("delete_project", { projectId });
    check("delete_project ok", !dp.isError, dp.text);
    const dp2 = await call("delete_project", { projectId });
    check("delete_project again → not found", dp2.isError && dp2.text.includes("not found"), dp2.text);
  }

  const finalTimers = JSON.parse(
    await execJXA(`const app=Application("Tyme");JSON.stringify(app.trackedtaskids());`),
  ) as string[];
  check("baseline timers untouched", JSON.stringify(finalTimers) === JSON.stringify(baselineTimers),
    `baseline=${JSON.stringify(baselineTimers)} final=${JSON.stringify(finalTimers)}`);
  const leftovers = await execJXA(
    `const app=Application("Tyme");JSON.stringify(app.projects().filter(p=>p.name().startsWith("MCP-TEST")).map(p=>p.id()));`,
  );
  check("no MCP-TEST leftovers", leftovers === "[]", leftovers);

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
