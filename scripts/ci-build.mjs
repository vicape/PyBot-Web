#!/usr/bin/env node
/** Temporary helper — prefer: npm ci && npm run build */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const [cmd, args] of [
  ["npm", ["ci"]],
  ["npm", ["run", "build"]],
]) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
