import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 18787;
const PUBLIC_UI_ORIGIN = "https://jimusaku-lab.github.io";
const PUBLIC_UI_RETURN_URL = "https://jimusaku-lab.github.io/us-options-risk-planner/";

export function parseLocalEnvText(text) {
  const values = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  return values;
}

export function resolveSaxoHelperLaunchConfig({ cwd = process.cwd(), args = [], environment = process.env, localEnvironment = {} } = {}) {
  const publicMode = args.includes("--public");
  const merged = { ...localEnvironment, ...environment };
  const port = Number(merged.SAXO_LOCAL_API_PORT ?? String(DEFAULT_PORT));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error("SAXO_LOCAL_API_PORT must be a valid TCP port from 1 to 65535.");
    error.code = "INVALID_PORT";
    throw error;
  }
  const defaults = publicMode
    ? { SAXO_LOCAL_UI_ALLOWED_ORIGIN: PUBLIC_UI_ORIGIN, SAXO_LOCAL_UI_RETURN_URL: PUBLIC_UI_RETURN_URL }
    : {};
  const childEnvironment = { ...defaults, ...localEnvironment, ...environment };
  if (publicMode) {
    if (environment.SAXO_LOCAL_UI_ALLOWED_ORIGIN === undefined) childEnvironment.SAXO_LOCAL_UI_ALLOWED_ORIGIN = PUBLIC_UI_ORIGIN;
    if (environment.SAXO_LOCAL_UI_RETURN_URL === undefined) childEnvironment.SAXO_LOCAL_UI_RETURN_URL = PUBLIC_UI_RETURN_URL;
  }
  childEnvironment.SAXO_LOCAL_API_PORT = String(port);
  return {
    root: PROJECT_ROOT,
    port,
    publicMode,
    childEnvironment,
    safeStartupMetadata: {
      cwdMatchesProjectRoot: path.resolve(cwd) === PROJECT_ROOT,
      port,
      publicMode,
      apiContractVersion: "2026-08-22.order-activities-close-lifecycle.v1",
      capabilities: ["optionPremiumCandidate", "bulkOptionPremiumPreview", "orderActivitiesCloseLifecycle"],
    },
  };
}

export async function assertLoopbackPortAvailable(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", (cause) => {
      const error = new Error(`Loopback port ${port} is unavailable. Check the existing listener without stopping it.`);
      error.code = cause?.code === "EADDRINUSE" || cause?.code === "EACCES" ? "PORT_IN_USE" : "PORT_CHECK_FAILED";
      reject(error);
    });
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
}

async function main() {
  const localEnvPath = path.join(PROJECT_ROOT, ".env.local");
  const localEnvironment = fs.existsSync(localEnvPath) ? parseLocalEnvText(fs.readFileSync(localEnvPath, "utf8")) : {};
  const config = resolveSaxoHelperLaunchConfig({ args: process.argv.slice(2), localEnvironment });
  if (!config.safeStartupMetadata.cwdMatchesProjectRoot) {
    const error = new Error("Open the extracted helper folder that contains package.json, scripts, and server, then retry.");
    error.code = "INVALID_HELPER_FOLDER";
    throw error;
  }
  await assertLoopbackPortAvailable(config.port);
  for (const [key, value] of Object.entries(config.childEnvironment)) {
    if (process.env[key] === undefined || (config.publicMode && key.startsWith("SAXO_LOCAL_UI_"))) process.env[key] = value;
  }
  console.log(JSON.stringify({ event: "saxo_helper_starting", ...config.safeStartupMetadata }));
  // Keep the HTTP server in this process: Ctrl+C/normal exit cannot orphan a nested helper.
  await import(new URL("../server/saxo-readonly-server.mjs", import.meta.url));
  const status = await waitForLocalStatus(config.port);
  console.log(JSON.stringify({
    event: "saxo_helper_ready",
    apiContractVersion: status.apiContractVersion,
    readOnly: status.readOnly === true,
    orderEndpointsEnabled: status.orderEndpointsEnabled === true,
    capabilities: status.capabilities,
    tokenPersistenceSupported: status.capabilities?.tokenPersistence === true,
  }));
}

async function waitForLocalStatus(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/saxo/status`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return await response.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Helper status check did not succeed.");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.code === "INVALID_HELPER_FOLDER" || error.code === "PORT_IN_USE" || error.code === "INVALID_PORT"
      ? error.message
      : "Saxo helper startup or status check failed. No other process was stopped.");
    process.exitCode = 1;
  });
}
