import { describe, expect, it } from "vitest";
import type { AccountState } from "@/types/domain";
import { resolveAccountMarginUsageWarning } from "./accountMarginWarning";

function account(accountCode: "P" | "N", marginUsagePercent: number, withSource = false): AccountState {
  return {
    accountCode,
    currency: accountCode === "N" ? "USD" : "JPY",
    cashBalance: 1,
    marginAvailable: 1,
    marginUsagePercent,
    updatedAt: "2026-08-21T08:00:00.000Z",
    saxoSyncHistory: withSource ? [{ id: "anonymous-sync", source: "saxo_api", accountKey: "masked", fetchedAt: "2026-08-21T08:00:00.000Z", appliedAt: "2026-08-21T08:01:00.000Z", appliedFields: ["marginUsagePercent"] }] : [],
  };
}

describe("account margin usage warning", () => {
  it("does not warn below 60", () => {
    expect(resolveAccountMarginUsageWarning(account("N", 59.9))).toBeUndefined();
  });

  it.each([60, 69.9])("returns one attention warning from 60 through 69.9 at %s", (value) => {
    expect(resolveAccountMarginUsageWarning(account("N", value))).toMatchObject({ accountCode: "N", level: "attention", usagePercent: value, sourceLabel: "取得元未確認" });
  });

  it.each([70, 80])("returns one strong warning from 70 at %s", (value) => {
    expect(resolveAccountMarginUsageWarning(account("P", value, true))).toMatchObject({ accountCode: "P", level: "strong", usagePercent: value, sourceLabel: "Saxo API" });
  });
});
