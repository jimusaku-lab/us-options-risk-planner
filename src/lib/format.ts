export function formatJPY(value: number, options: { signed?: boolean } = {}): string {
  const rounded = Math.round(value);
  const sign = options.signed && rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("ja-JP")}円`;
}

export function formatUSD(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(value: number): string {
  return `${value.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}
