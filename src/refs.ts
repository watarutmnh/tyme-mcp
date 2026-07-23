export function parseIdFromRef(
  ref: string,
  kind: "category" | "project" | "task" | "subtask" | "taskRecord",
): string {
  // Left boundary required: without it, kind "task" would match inside
  // "subtask id" in refs like "taskRecord id X of subtask id Y of task id Z".
  const id = ref.match(new RegExp(`(?:^|\\s)${kind} id ([^\\s]+)`))?.[1];
  if (!id) {
    throw new Error(`Failed to parse ${kind} ID from: ${ref}`);
  }
  return id;
}
