// Isolated fictional R10 browser acceptance. Never opens a user profile or live API.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/Users/motomichi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const url = process.env.TEST_APP_URL || "http://127.0.0.1:4190";
const fetchedAt = "2026-09-15T01:02:03.000Z";
const accountKey = "TEST-account-P";
const simulation = {
  id: "TEST-long-call", status: "open", name: "TEST long call", ticker: "TEST", strategyType: "long_call",
  currentPriceUSD: 55, fxRateJPY: 150, accountCode: "P", accountEnvironment: "PROD_P_JPY_SETTLEMENT",
  entryDate: "2026-06-01", expiryDate: "2026-10-16", dte: 137, accountCurrency: "JPY", stockPosition: null,
  brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "japan_derivative_separate_tax_user_confirm",
  optionLegs: [{ id: "TEST-call-leg", type: "call", side: "buy", strikeUSD: 55, premiumUSD: 3.3, quantity: 1, expiryDate: "2026-10-16", saxoAccountKey: accountKey, saxoUic: 990001 }],
  optionEntryExecutions: [{ id: "TEST-entry", legId: "TEST-call-leg", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 3.3, settlementCurrency: "JPY", brokerBookedAmountJPY: -50000, source: "broker_statement", confirmed: true }],
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const parsed = new URL(route.request().url());
    const envelope = { environment: "live", readOnly: true, fetchedAt };
    const responses = {
      "/api/market/fx/usdjpy": { pair: "USDJPY", rate: 150, source: "fixture", date: "2026-09-15", fetchedAt },
      "/api/saxo/status": { connected: true, connectionState: "connected", hasToken: true, readOnly: true, environment: "live", environmentConfigured: true, oauthConfigured: true, bindAddress: "127.0.0.1" },
      "/api/saxo/config/status": { readOnly: true, environment: "live", environmentConfigured: true, clientIdConfigured: true, configurationWarnings: [], localConfigFileExists: true },
      "/api/saxo/accounts/snapshot": { ...envelope, accounts: [] },
      "/api/saxo/positions/snapshot": { ...envelope, positions: [], coverage: { completedPages: 1, status: "complete" } },
      "/api/saxo/orders/snapshot": { ...envelope, orders: [{ id: "TEST-stop", accountKey, accountAssignment: "P", accountCode: "P", symbol: "TEST/16V26C55:XCBF", assetType: "StockOption", quantity: 1, side: "sell", optionType: "call", strike: 55, expiry: "2026-10-16", uic: 990001, status: "Working", orderType: "StopIfTraded", orderRelation: "StandAlone", openClose: "close", stopPrice: 0.5, missingFields: [], fetchedAt }], coverage: { completedPages: 1, status: "complete" } },
      "/api/saxo/history/discovery": { ...envelope, endpoints: [] },
    };
    if (responses[parsed.pathname]) return route.fulfill({ status: 200, json: responses[parsed.pathname] });
    if (parsed.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "isolated_fixture" } });
    return route.continue();
  });
  await page.addInitScript(({ simulation, accountKey, fetchedAt }) => {
    localStorage.clear();
    localStorage.setItem("us-options-first-run-notice-accepted", "true");
    localStorage.setItem("us-options-active-workspace", JSON.stringify("live"));
    localStorage.setItem("us-options-simulations-v2", JSON.stringify({ demo: [], live: [simulation] }));
    localStorage.setItem("us-options-saxo-account-mappings-v1", JSON.stringify([{ workspace: "real", accountKey, currency: "JPY", mappedCode: "P", environment: "live", confirmedByUser: true, confirmedAt: fetchedAt }]));
  }, { simulation, accountKey, fetchedAt });
  await page.goto(url);
  await page.locator("summary").filter({ hasText: "Saxo API詳細" }).click();
  const load = page.getByRole("button", { name: "まとめて取得" });
  await load.waitFor();
  await load.click();
  const row = page.getByLabel("TESTの詳細を表示する", { exact: true });
  await row.getByText(/逆指値注文あり（未約定）/).waitFor();
  assert.match(await row.innerText(), /\$0\.50/);
  await row.getByRole("button", { name: "Saxoの注文を見る（任意）" }).click();
  const review = page.getByRole("region", { name: "TESTの決済注文レビュー" });
  await review.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "TESTの決済注文レビュー");
  assert.equal(await review.evaluate(element => document.activeElement === element), true);
  assert.match(await review.innerText(), /逆指値 \/ \$0\.50/);
  assert.match(await review.innerText(), /再入力は不要です/);
  assert.doesNotMatch(await review.innerText(), /OCO/);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("us-options-simulations-v2")));
  assert.equal(persisted.live[0].status, "open");
  assert.equal((persisted.live[0].optionCloseExecutions ?? []).length, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ url, status: "PASS", reviewFocused: true, workingOrderOptional: true, brokerWrites: 0, consoleErrors: 0 }));
  await context.close();
} finally {
  await browser.close();
}
