// Isolated fictional R11 browser acceptance. Never opens a user profile or live API.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/Users/motomichi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const url = process.env.TEST_APP_URL || "http://127.0.0.1:4191";
const simulation = {
  id: "R11-spread", status: "open", name: "Anonymous spread", ticker: "TEST", strategyType: "bear_put_spread",
  currentPriceUSD: 95, fxRateJPY: 0, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
  entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, stockPosition: null,
  optionLegs: [
    { id: "R11-long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
    { id: "R11-short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
  ],
  optionEntryExecutions: [
    { id: "R11-entry-long", legId: "R11-long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
    { id: "R11-entry-short", legId: "R11-short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
  ],
  optionCloseExecutions: [
    { id: "R11-close-short", legId: "R11-short", closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: 0.84, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "R11-candidate-short", confirmationStatus: "pending", confirmed: false },
    { id: "R11-close-long", legId: "R11-long", closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: 4.5, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "R11-candidate-long", confirmationStatus: "pending", confirmed: false },
  ],
  brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, marginUsagePercent: 0,
  availableCashJPY: 0, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison", nisaExpectedAnnualReturnPct: 8,
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { error: "isolated_fixture" } }));
  await page.addInitScript(simulationValue => {
    if (localStorage.getItem("us-options-simulations-v2")) return;
    localStorage.clear();
    localStorage.setItem("us-options-first-run-notice-accepted", "true");
    localStorage.setItem("us-options-active-workspace", JSON.stringify("live"));
    localStorage.setItem("us-options-simulations-v2", JSON.stringify({ demo: [], live: [simulationValue] }));
  }, simulation);
  await page.goto(url);
  const before = await page.evaluate(() => localStorage.getItem("us-options-simulations-v2"));
  await page.getByTitle("この建玉を編集").click();
  const shortCard = page.locator("#option-close-execution-R11-close-short");
  const longCard = page.locator("#option-close-execution-R11-close-long");
  await shortCard.waitFor();
  assert.match(await shortCard.innerText(), /\$3\.52 \/ 参考JPY 未確認/);
  assert.match(await shortCard.innerText(), /参考為替は未確認です。USD実績の確認には不要です。/);
  assert.equal(await page.evaluate(() => localStorage.getItem("us-options-simulations-v2")), before);

  await shortCard.getByRole("button", { name: "確認して正式保存" }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("us-options-simulations-v2")).live[0].optionCloseExecutions[0].confirmed === true);
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("us-options-simulations-v2")).live[0]);
  assert.equal(stored.status, "open");
  assert.equal(stored.optionCloseExecutions[1].confirmed, false);
  assert.equal(await shortCard.getByRole("button", { name: "確認して正式保存" }).isDisabled(), true);

  await longCard.getByRole("button", { name: "確認して正式保存" }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("us-options-simulations-v2")).live[0].status === "closed");
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("us-options-simulations-v2")).live[0]);
  assert.equal(stored.optionCloseExecutions.length, 2);
  assert.equal(stored.optionCloseExecutions.every(item => item.confirmed), true);

  await page.reload();
  await page.getByRole("button", { name: /履歴 終了建玉1件/ }).click();
  const historyRow = page.getByText("TEST", { exact: true }).last();
  await historyRow.waitFor();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("us-options-simulations-v2")).live[0]);
  assert.equal(stored.status, "closed");
  assert.equal(stored.optionCloseExecutions.length, 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ url, status: "PASS", beforeConfirmationInert: true, partialThenClosed: true, persistedExecutions: 2, brokerWrites: 0, consoleErrors: 0 }));
  await context.close();
} finally {
  await browser.close();
}
