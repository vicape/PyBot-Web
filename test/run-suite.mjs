import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filesForSuite } from "./suiteManifest.mjs";

const suite = process.argv[2] || "fast";
const testDir = dirname(fileURLToPath(import.meta.url));
const files = filesForSuite(suite).map((name) => join(testDir, name));

console.log(`[tests] suite=${suite} files=${files.length}`);

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
