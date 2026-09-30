import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSaxoOptionPremiumCandidate, fetchSaxoOptionPremiumCandidatesPreview, resolveLocalHelperBase } from "./saxoApiClient";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Saxo API client", () => {
  it("rejects non-loopback helper bases", () => {
    expect(resolveLocalHelperBase("https://example.invalid")).toBe("http://127.0.0.1:18787");
    expect(resolveLocalHelperBase("http://127.0.0.1:18787/")).toBe("http://127.0.0.1:18787");
  });
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

  it("reports premium candidate AbortError as a Saxo price timeout instead of local API not running", async () => {
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }));

    await expect(fetchSaxoOptionPremiumCandidate({
      symbol: "V",
      expiry: "2026-11-20",
      strike: 340,
      optionType: "call",
      accountKey: "XLu-live-account-key",
      uic: 54341397,
      assetType: "StockOption",
    })).rejects.toThrow("Saxo価格取得がタイムアウトしました。Saxo側の応答待ちまたはレート制限の可能性があります。");

    await expect(fetchSaxoOptionPremiumCandidate({
      symbol: "V",
      expiry: "2026-11-20",
      strike: 340,
      optionType: "call",
      accountKey: "XLu-live-account-key",
      uic: 54341397,
      assetType: "StockOption",
    })).rejects.not.toThrow("SaxoローカルAPIが起動していません");
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 20_000);
  });

  it("surfaces Saxo API rate limit messages from premium candidate lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({
        message: "Saxo APIレート制限に達しました。少し時間を置いて再試行してください。",
      }),
    })));

    await expect(fetchSaxoOptionPremiumCandidate({
      symbol: "V",
      expiry: "2026-11-20",
      strike: 340,
      optionType: "call",
      accountKey: "XLu-live-account-key",
      uic: 54341397,
      assetType: "StockOption",
    })).rejects.toThrow("Saxo APIレート制限に達しました");
  });

  it("uses the read-only local helper for bulk preview without persisting anything", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ fetchedAt: "2026-08-15T00:00:00.000Z", readOnly: true, results: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchSaxoOptionPremiumCandidatesPreview([{
      targetId: "fixture-target",
      symbol: "ABC",
      expiry: "2027-01-15",
      strike: 100,
      optionType: "call",
      uic: 123,
    }]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.hostname).toBe("127.0.0.1");
    expect(requestUrl.port).toBe("18787");
    expect(requestUrl.pathname).toBe("/api/saxo/options/premium-candidates/preview");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ targets: [{ targetId: "fixture-target" }] });
    expect(window.localStorage.length).toBe(0);
  });
});
