import assert from "node:assert/strict";
import test from "node:test";

process.env.SAXO_READONLY_SERVER_TEST = "1";
process.env.SAXO_CLIENT_ID = "anonymous-test";
const { configureKeychainPersistenceForTest, fetchSaxoPages, getAuthenticationGenerationForTest, handleRequest } =
  await import("./saxo-readonly-server.mjs");

const token = (accessToken, persisted = false) => ({
  accessToken, refreshToken: "fixture-refresh", tokenType: "Bearer",
  expiresAt: Date.now() - 1, refreshExpiresAt: Date.now() + 3_600_000, persisted,
});
const readPages = () => fetchSaxoPages("/port/v1/accounts/me", {});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function mockKeychain(executor = async () => ({ stdout: "", stderr: "" })) {
  configureKeychainPersistenceForTest({
    executor, token: token("fixture-old", true),
    persistenceStatus: { supported: true, enabled: true, restored: true, status: "restored" },
  });
}

test("concurrent expired reads share one refresh and preserve research context generation", async () => {
  mockKeychain();
  let refreshCalls = 0;
  const gate = deferred();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/token")) {
      refreshCalls += 1;
      await gate.promise;
      return new Response(JSON.stringify({ access_token: "fixture-new", refresh_token: "fixture-rotated", expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ Data: [] }), { status: 200 });
  };
  const generation = getAuthenticationGenerationForTest();
  const first = readPages();
  const second = readPages();
  await new Promise((resolve) => setImmediate(resolve));
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(refreshCalls, 1);
  assert.equal(getAuthenticationGenerationForTest(), generation);
});

test("late refresh failure cannot clear a replacement login", async () => {
  mockKeychain();
  const gate = deferred();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/token")) { await gate.promise; return new Response("invalid", { status: 400 }); }
    return new Response(JSON.stringify({ Data: [] }), { status: 200 });
  };
  const old = readPages();
  await new Promise((resolve) => setImmediate(resolve));
  configureKeychainPersistenceForTest({ token: { ...token("fixture-new"), expiresAt: Date.now() + 3_600_000 } });
  gate.resolve();
  await assert.rejects(old, { code: "authentication_context_changed" });
  await readPages();
});

test("late refresh success cannot resurrect over a replacement login", async () => {
  mockKeychain();
  const gate = deferred();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/token")) { await gate.promise; return new Response(JSON.stringify({ access_token: "fixture-stale", refresh_token: "fixture-stale-r", expires_in: 3600 }), { status: 200 }); }
    return new Response(JSON.stringify({ Data: [] }), { status: 200 });
  };
  const old = readPages();
  await new Promise((resolve) => setImmediate(resolve));
  configureKeychainPersistenceForTest({ token: { ...token("fixture-new"), expiresAt: Date.now() + 3_600_000 } });
  gate.resolve();
  await assert.rejects(old, { code: "authentication_context_changed" });
  await readPages();
});

test("Keychain refresh persistence failure keeps a valid access token and reports persistence warning", async () => {
  mockKeychain(async () => { throw new Error("fixture-storage-failure"); });
  globalThis.fetch = async (url) => String(url).endsWith("/token")
    ? new Response(JSON.stringify({ access_token: "fixture-new", refresh_token: "fixture-rotated", expires_in: 3600 }), { status: 200 })
    : new Response(JSON.stringify({ Data: [] }), { status: 200 });
  await readPages();
  assert.equal(getAuthenticationGenerationForTest() > 0, true);
});

test("logout endpoint invalidates the in-flight refresh generation", async () => {
  mockKeychain();
  const gate = deferred();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/token")) { await gate.promise; return new Response("invalid", { status: 400 }); }
    return new Response(JSON.stringify({ Data: [] }), { status: 200 });
  };
  const old = readPages();
  await new Promise((resolve) => setImmediate(resolve));
  const response = {
    setHeader() {},
    writeHead() {}, end() {},
  };
  await handleRequest({ method: "POST", url: "/api/saxo/logout", headers: {} }, response);
  gate.resolve();
  await assert.rejects(old, { code: "authentication_context_changed" });
});

test("concurrent persistence writes are serialized through the Keychain boundary", async () => {
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  const writes = [];
  let writeStarted;
  const firstWriteStarted = new Promise((resolve) => { writeStarted = resolve; });
  mockKeychain(async (_file, args) => {
    if (args[0] === "add-generic-password") {
      const payload = JSON.parse(args[7]);
      writes.push(payload.accessToken);
      if (writes.length === 1) { writeStarted(); await writeGate; }
    }
    return { stdout: "", stderr: "" };
  });
  configureKeychainPersistenceForTest({ token: { ...token("fixture-old", true), expiresAt: Date.now() + 3_600_000 } });
  const responseA = { setHeader() {}, writeHead() {}, end() {} };
  const responseB = { setHeader() {}, writeHead() {}, end() {} };
  const writeA = handleRequest({ method: "POST", url: "/api/saxo/persistence/enable", headers: {} }, responseA);
  await firstWriteStarted;
  const writeB = handleRequest({ method: "POST", url: "/api/saxo/persistence/enable", headers: {} }, responseB);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["fixture-old"]);
  releaseWrite();
  await Promise.all([writeA, writeB]);
  assert.deepEqual(writes, ["fixture-old", "fixture-old"]);
});

test("disabling persistence during refresh cannot re-save the rotated token", async () => {
  mockKeychain();
  const gate = deferred();
  const keychainOperations = [];
  configureKeychainPersistenceForTest({
    executor: async (_file, args) => {
      keychainOperations.push(args[0]);
      return { stdout: "", stderr: "" };
    },
    token: token("fixture-old", true),
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/token")) {
      await gate.promise;
      return new Response(JSON.stringify({ access_token: "fixture-new", refresh_token: "fixture-rotated", expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ Data: [] }), { status: 200 });
  };
  const read = readPages();
  await new Promise((resolve) => setImmediate(resolve));
  const response = { setHeader() {}, writeHead() {}, end() {} };
  await handleRequest({ method: "POST", url: "/api/saxo/persistence/disable", headers: {} }, response);
  gate.resolve();
  await read;
  assert.deepEqual(keychainOperations, ["delete-generic-password"]);
});
