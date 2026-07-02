import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSaxoOptionPremiumCandidate } from "./saxoApiClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Saxo API client", () => {
  it("sends existing option UIC identifiers for premium candidate lookup", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        environment: "live",
        fetchedAt: "2026-07-02T00:00:00.000Z",
        status: "available",
        classification: "取得可能",
        source: "trade/v1/infoprices (existing position UIC)",
        message: "既存建玉のUICから候補価格を取得しました。自動入力はしません。",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSaxoOptionPremiumCandidate({
      symbol: "V",
      expiry: "2026-11-20",
      strike: 340,
      optionType: "call",
      accountKey: "XLu-live-account-key",
      uic: 54341397,
      assetType: "StockOption",
      positionId: "7655451244",
      instrumentCode: "V/20X26C340:XCBF",
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/saxo/options/premium-candidate");
    expect(requestUrl.searchParams.get("symbol")).toBe("V");
    expect(requestUrl.searchParams.get("expiry")).toBe("2026-11-20");
    expect(requestUrl.searchParams.get("strike")).toBe("340");
    expect(requestUrl.searchParams.get("optionType")).toBe("call");
    expect(requestUrl.searchParams.get("accountKey")).toBe("XLu-live-account-key");
    expect(requestUrl.searchParams.get("uic")).toBe("54341397");
    expect(requestUrl.searchParams.get("assetType")).toBe("StockOption");
    expect(requestUrl.searchParams.get("positionId")).toBe("7655451244");
    expect(requestUrl.searchParams.get("instrumentCode")).toBe("V/20X26C340:XCBF");
  });
});
