import type { FxQuote } from "@/lib/marketData";

type ReferenceTotalAssetsInput = {
  pSaxoTotalValueJPY?: number;
  nSaxoTotalValueUSD?: number;
  fxQuote?: FxQuote | null;
};

export type ReferenceTotalAssetsBreakdownJPY = {
  pAccountAssetsJPY: number;
  nAccountAssetsJPY: number;
  referenceTotalAssetsJPY: number;
};

/** Display-only values sourced exclusively from P/N Saxo TotalValue and one valid USD/JPY quote. */
export function calculateReferenceTotalAssetsBreakdownJPY({ pSaxoTotalValueJPY, nSaxoTotalValueUSD, fxQuote }: ReferenceTotalAssetsInput): ReferenceTotalAssetsBreakdownJPY | undefined {
  const pAccountValue = Number(pSaxoTotalValueJPY);
  const nAccountValue = Number(nSaxoTotalValueUSD);
  if (
    !Number.isFinite(pAccountValue) ||
    !Number.isFinite(nAccountValue) ||
    !fxQuote ||
    !Number.isFinite(fxQuote.rate) ||
    fxQuote.rate <= 0
  ) {
    return undefined;
  }
  const nAccountAssetsRawJPY = nAccountValue * fxQuote.rate;
  return {
    pAccountAssetsJPY: Math.round(pAccountValue),
    nAccountAssetsJPY: Math.round(nAccountAssetsRawJPY),
    referenceTotalAssetsJPY: Math.round(pAccountValue + nAccountAssetsRawJPY),
  };
}

export function calculateReferenceTotalAssetsJPY(input: ReferenceTotalAssetsInput): number | undefined {
  return calculateReferenceTotalAssetsBreakdownJPY(input)?.referenceTotalAssetsJPY;
}

export function formatReferenceTotalAssetsJPY(value: number | undefined): string {
  return value === undefined ? "—" : `¥${value.toLocaleString("ja-JP")}`;
}
