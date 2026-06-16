import { describe, expect, it } from "vitest";
import { addLocalDays, formatLocalDate } from "./date";

describe("local date helpers", () => {
  it("formats dates using local calendar fields", () => {
    expect(formatLocalDate(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02");
  });

  it("adds days using local calendar arithmetic", () => {
    expect(formatLocalDate(addLocalDays(new Date(2026, 0, 31, 23, 30), 1))).toBe("2026-02-01");
  });
});
