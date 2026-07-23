export function parseIdFromRef(
  ref: string,
  kind: "project" | "task" | "taskRecord",
): string {
  const id = ref.match(new RegExp(`${kind} id ([^\\s]+)`))?.[1];
  if (!id) {
    throw new Error(`Failed to parse ${kind} ID from: ${ref}`);
  }
  return id;
}
