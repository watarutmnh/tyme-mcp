import { test, expect } from "bun:test";
import { parseDateInput } from "../src/dates.ts";

test("date-only input is interpreted as local midnight", () => {
  expect(parseDateInput("2026-03-01")).toEqual(new Date(2026, 2, 1));
});

test("endOfDay sets date-only input to the final local millisecond", () => {
  expect(parseDateInput("2026-03-01", { endOfDay: true })).toEqual(
    new Date(2026, 2, 1, 23, 59, 59, 999),
  );
});

test("dateOnly rejects input containing a time", () => {
  expect(() =>
    parseDateInput("2026-03-01T09:30:00", { dateOnly: true }),
  ).toThrow("expected a date-only value");
});

for (const input of [
  "2026-02-30",
  "2026-13-01",
  "2026-00-10",
  "2026-02-30T10:00:00",
]) {
  test(`rejects nonexistent calendar date ${input}`, () => {
    expect(() => parseDateInput(input)).toThrow("no such calendar date");
  });
}

for (const input of ["garbage", ""]) {
  test(`rejects invalid date input ${JSON.stringify(input)}`, () => {
    expect(() => parseDateInput(input)).toThrow();
  });
}

test("time-containing ISO input is interpreted in local time", () => {
  expect(parseDateInput("2026-03-01T09:30:00")).toEqual(
    new Date(2026, 2, 1, 9, 30),
  );
});
