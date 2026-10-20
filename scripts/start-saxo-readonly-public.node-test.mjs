import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertLoopbackPortAvailable,
  parseLocalEnvText,
  resolveSaxoHelperLaunchConfig,
} from "./start-saxo-readonly-local.mjs";

const PUBLIC_ORIGIN = "https://jimusaku-lab.github.io";
const PUBLIC_RETURN = `${PUBLIC_ORIGIN}/us-options-risk-planner/`;

test("public launcher honors process environment, loads local settings, and defaults OAuth UI return to Pages", () => {
  const fromFile = parseLocalEnvText([
    "SAXO_LOCAL_API_PORT=18789",
    'SAXO_CLIENT_ID="ANON-FILE-CLIENT"',
    "SAXO_ENVIRONMENT=live",
    "SAXO_LOCAL_UI_ALLOWED_ORIGIN=http://localhost:5173",
    "SAXO_LOCAL_UI_RETURN_URL=http://localhost:5173/",
  ].join("\n"));
  const config = resolveSaxoHelperLaunchConfig({
    cwd: process.cwd(), args: ["--public"],
    environment: { SAXO_LOCAL_API_PORT: "18801", SAXO_CLIENT_ID: "ANON-ENV-CLIENT" },
    localEnvironment: fromFile,
  });
  assert.equal(config.publicMode, true);
  assert.equal(config.port, 18801);
  assert.equal(config.childEnvironment.SAXO_CLIENT_ID, "ANON-ENV-CLIENT");
  assert.equal(config.childEnvironment.SAXO_ENVIRONMENT, "live");
  assert.equal(config.childEnvironment.SAXO_LOCAL_UI_ALLOWED_ORIGIN, PUBLIC_ORIGIN);
  assert.equal(config.childEnvironment.SAXO_LOCAL_UI_RETURN_URL, PUBLIC_RETURN);
  assert.equal("ANON-ENV-CLIENT" in config.safeStartupMetadata, false);
  assert.equal("cwd" in config.safeStartupMetadata, false);
});

test("public launcher honors explicit process UI overrides and rejects invalid ports", () => {
  const config = resolveSaxoHelperLaunchConfig({
    cwd: process.cwd(), args: ["--public"],
    environment: { SAXO_LOCAL_UI_ALLOWED_ORIGIN: "https://example.invalid", SAXO_LOCAL_UI_RETURN_URL: "https://example.invalid/app/" },
    localEnvironment: {},
  });
  assert.equal(config.childEnvironment.SAXO_LOCAL_UI_ALLOWED_ORIGIN, "https://example.invalid");
  assert.equal(config.childEnvironment.SAXO_LOCAL_UI_RETURN_URL, "https://example.invalid/app/");
  assert.throws(() => resolveSaxoHelperLaunchConfig({ cwd: process.cwd(), args: ["--public"], environment: { SAXO_LOCAL_API_PORT: "0" }, localEnvironment: {} }), /valid TCP port/);
});

test("launcher actually starts from a Japanese path containing spaces without logging it", async () => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "saxo helper 日本語 path "));
  const helperRoot = path.join(tempRoot, "展開した helper folder");
  const portReservation = createServer();
  await new Promise((resolve) => portReservation.listen(0, "127.0.0.1", resolve));
  const port = portReservation.address().port;
  await new Promise((resolve) => portReservation.close(resolve));
  await Promise.all([
    mkdir(path.join(helperRoot, "scripts"), { recursive: true }),
    mkdir(path.join(helperRoot, "server"), { recursive: true }),
  ]);
  const launcherPath = path.join(helperRoot, "scripts", "start-saxo-readonly-local.mjs");
  await Promise.all([
    copyFile(path.join(sourceRoot, "scripts", "start-saxo-readonly-local.mjs"), launcherPath),
    copyFile(path.join(sourceRoot, "server", "saxo-readonly-server.mjs"), path.join(helperRoot, "server", "saxo-readonly-server.mjs")),
    writeFile(path.join(helperRoot, "package.json"), JSON.stringify({ type: "module" })),
    ...(existsSync(path.join(sourceRoot, "server", "instrument-details-resolver.mjs"))
      ? [copyFile(path.join(sourceRoot, "server", "instrument-details-resolver.mjs"), path.join(helperRoot, "server", "instrument-details-resolver.mjs"))]
      : []),
  ]);
  const env = {
    PATH: process.env.PATH ?? "",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    SAXO_LOCAL_API_PORT: String(port), SAXO_ENVIRONMENT: "sim", SAXO_CLIENT_ID: "",
    SAXO_SKIP_KEYCHAIN_RESTORE: "1",
  };
  const child = spawn(process.execPath, [launcherPath, "--public"], { cwd: helperRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.on("error", (error) => { output += `spawn-error:${error.code ?? "unknown"}`; });
  child.on("exit", (code, signal) => { output += `exit:${code ?? "null"}:${signal ?? "none"}`; });
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { response = await fetch(`http://127.0.0.1:${port}/api/saxo/status`); if (response.ok) break; }
      catch { await delay(50); }
    }
    assert.ok(response?.ok, output);
    assert.equal(output.includes(helperRoot), false);
    assert.equal(JSON.parse(output.split("\n").find((line) => line.includes('"event":"saxo_helper_starting"'))).cwdMatchesProjectRoot, true);
  } finally {
    child.kill("SIGINT");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3_000)]);
    if (child.exitCode === null) child.kill();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("loopback guard refuses occupied port and leaves its listener alive", async () => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(assertLoopbackPortAvailable(occupied.address().port), (error) => error.code === "PORT_IN_USE");
    assert.equal(occupied.listening, true);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("helper status supports public-origin CORS, read-only contract, and truthful persistence capability", async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const safeEnv = {
    PATH: process.env.PATH ?? "",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    SAXO_LOCAL_API_PORT: String(port), SAXO_LOCAL_UI_ALLOWED_ORIGIN: PUBLIC_ORIGIN,
    SAXO_LOCAL_UI_RETURN_URL: PUBLIC_RETURN, SAXO_ENVIRONMENT: "sim", SAXO_CLIENT_ID: "",
    SAXO_SKIP_KEYCHAIN_RESTORE: "1",
  };
  const child = spawn(process.execPath, [path.resolve("server/saxo-readonly-server.mjs")], { cwd: process.cwd(), env: safeEnv, stdio: "ignore" });
  try {
    let response;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { response = await fetch(`http://127.0.0.1:${port}/api/saxo/status`, { headers: { Origin: PUBLIC_ORIGIN } }); if (response.ok) break; }
      catch { await delay(50); }
    }
    assert.ok(response?.ok);
    const status = await response.json();
    assert.equal(response.headers.get("access-control-allow-origin"), PUBLIC_ORIGIN);
    assert.equal(status.readOnly, true);
    assert.equal(status.orderEndpointsEnabled, false);
    assert.equal(status.connected, false);
    assert.equal(status.hasToken, false);
    assert.equal(status.capabilities.tokenPersistence, process.platform === "darwin");
    assert.equal(status.tokenPersistence.supported, process.platform === "darwin");
    if (process.platform !== "darwin") {
      assert.equal(status.tokenPersistence.storage, "session-memory");
      assert.match(status.tokenPersistence.message, /helper終了後.*再ログイン/);
    }
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
    if (child.exitCode === null) child.kill();
  }
});

test("portable launcher Ctrl+C exits the same-process helper cleanly", async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const env = {
    PATH: process.env.PATH ?? "",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    SAXO_LOCAL_API_PORT: String(port), SAXO_LOCAL_UI_ALLOWED_ORIGIN: PUBLIC_ORIGIN,
    SAXO_LOCAL_UI_RETURN_URL: PUBLIC_RETURN, SAXO_ENVIRONMENT: "sim", SAXO_CLIENT_ID: "",
    SAXO_SKIP_KEYCHAIN_RESTORE: "1",
  };
  const launcher = spawn(process.execPath, [path.resolve("scripts/start-saxo-readonly-local.mjs"), "--public"], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  launcher.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  launcher.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { response = await fetch(`http://127.0.0.1:${port}/api/saxo/status`); if (response.ok) break; }
      catch { await delay(50); }
    }
    assert.ok(response?.ok);
    assert.equal(output.includes("SAXO_CLIENT_ID"), false);
    launcher.kill("SIGINT");
    await Promise.race([
      new Promise((resolve, reject) => { launcher.once("exit", resolve); launcher.once("error", reject); }),
      delay(3_000).then(() => { throw new Error("launcher did not exit after Ctrl+C"); }),
    ]);
    let stopped = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { await fetch(`http://127.0.0.1:${port}/api/saxo/status`); }
      catch { stopped = true; break; }
      await delay(25);
    }
    assert.equal(stopped, true);
  } finally {
    if (launcher.exitCode === null) launcher.kill();
  }
});

test("wrong folder startup fails without echoing environment values", async () => {
  const launcher = spawn(process.execPath, [path.resolve("scripts/start-saxo-readonly-local.mjs"), "--public"], {
    cwd: path.dirname(process.cwd()), env: { PATH: process.env.PATH ?? "", SAXO_CLIENT_ID: "ANON-DO-NOT-ECHO" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  launcher.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => { launcher.once("error", reject); launcher.once("exit", resolve); });
  assert.equal(code, 1);
  assert.match(output, /extracted helper folder/);
  assert.equal(output.includes("ANON-DO-NOT-ECHO"), false);
});
