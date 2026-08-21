import type { AccountState } from "@/types/domain";

export type AccountMarginUsageWarning = {
  accountCode: AccountState["accountCode"];
  level: "attention" | "strong";
  usagePercent: number;
  updatedAt: string;
  sourceLabel: "Saxo API" | "取得元未確認";
};

export function resolveAccountMarginUsageWarning(account: AccountState): AccountMarginUsageWarning | undefined {
  if (!Number.isFinite(account.marginUsagePercent) || account.marginUsagePercent < 60) return undefined;
  const hasSaxoMarginEvidence = (account.saxoSyncHistory ?? []).some(
    (history) => history.source === "saxo_api" && history.appliedFields.includes("marginUsagePercent"),
  );
  return {
    accountCode: account.accountCode,
    level: account.marginUsagePercent >= 70 ? "strong" : "attention",
    usagePercent: account.marginUsagePercent,
    updatedAt: account.updatedAt,
    sourceLabel: hasSaxoMarginEvidence ? "Saxo API" : "取得元未確認",
  };
}
