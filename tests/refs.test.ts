import { test, expect } from "bun:test";
import { parseIdFromRef } from "../src/refs.ts";

test("extracts a project ID from an AppleScript reference", () => {
  expect(parseIdFromRef("project id PROJECT-1", "project")).toBe("PROJECT-1");
});

test("extracts a task ID from a nested AppleScript reference", () => {
  expect(
    parseIdFromRef(
      "task id TASK-1 of project id PROJECT-1",
      "task",
    ),
  ).toBe("TASK-1");
});

test("extracts a taskRecord ID from a nested AppleScript reference", () => {
  expect(
    parseIdFromRef(
      "taskRecord id RECORD-1 of task id TASK-1 of project id PROJECT-1",
      "taskRecord",
    ),
  ).toBe("RECORD-1");
});

test("task kind does not match the taskRecord ID prefix", () => {
  expect(
    parseIdFromRef(
      "taskRecord id RECORD-1 of task id TASK-1 of project id PROJECT-1",
      "task",
    ),
  ).toBe("TASK-1");
});

test("extracts a subtask ID from a subtask-record reference", () => {
  expect(
    parseIdFromRef(
      "taskRecord id RECORD-1 of subtask id SUB-1 of task id TASK-1 of project id PROJECT-1",
      "subtask",
    ),
  ).toBe("SUB-1");
});

test("task kind does not match inside 'subtask id'", () => {
  expect(
    parseIdFromRef(
      "taskRecord id RECORD-1 of subtask id SUB-1 of task id TASK-1 of project id PROJECT-1",
      "task",
    ),
  ).toBe("TASK-1");
});

test("extracts a category ID from an AppleScript reference", () => {
  expect(parseIdFromRef("category id CAT-1", "category")).toBe("CAT-1");
});

test("throws when the requested reference kind is absent", () => {
  expect(() => parseIdFromRef("project id PROJECT-1", "task")).toThrow(
    "Failed to parse task ID from: project id PROJECT-1",
  );
});
