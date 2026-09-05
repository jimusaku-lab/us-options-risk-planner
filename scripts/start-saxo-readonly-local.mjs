import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = process.env.SAXO_LOCAL_API_PORT ?? "18787";
if (process.cwd() !== root) throw new Error(`Refusing Saxo helper start from a different cwd: ${process.cwd()}`);
let listeners = "";
try { listeners = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }); } catch { /* port is available */ }
if (listeners.trim()) throw new Error(`Refusing to replace an existing ${port} listener. Verify its PID, command, and cwd first.\n${listeners.trim()}`);
console.log(JSON.stringify({ cwd: root, port: Number(port), apiContractVersion: "2026-08-15.bulk-option-premium-preview.v1", requiredCapability: "bulkOptionPremiumPreview" }));
const child = spawn(process.execPath, ["server/saxo-readonly-server.mjs"], { cwd: root, stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
