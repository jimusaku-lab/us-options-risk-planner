import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSaxoOptionPremiumCandidate, fetchSaxoStatus, isSaxoLocalApiAvailable, startSaxoAuth } from "./saxoApiClient";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Saxo API client", () => {
  it("keeps the public build Saxo client disabled and does not fetch premium candidates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSaxoOptionPremiumCandidate({
      symbol: "V",
      expiry: "2026-11-20",
      strike: 340,
      optionType: "call",
      accountKey: "XLu-live-account-key",
      uic: 54341397,
      assetType: "StockOption",
      positionId: "7655451244",
      instrumentCode: "V/20X26C340:XCBF",
    })).rejects.toThrow("公開版ではSaxo候補価格の自動取得を無効化しています");

    expect(isSaxoLocalApiAvailable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps status and auth entrypoints disabled without network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSaxoStatus()).rejects.toThrow("公開版ではSaxoローカルAPI接続を無効化しています");
    expect(() => startSaxoAuth()).toThrow("公開版ではSaxoローカルAPI接続を無効化しています");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
