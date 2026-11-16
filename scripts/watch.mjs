import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const profile = join(root, ".dev-profile");
const extension = join(profile, "extensions", "rss-helper@example.org");
const zotero = "C:\\Program Files\\Zotero\\zotero.exe";
let child;
let timer;
let building = false;

async function build() {
  if (building) return;
  building = true;
  try {
    await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: root, ...(process.platform === "win32" ? { shell: true } : {}) });
    await rm(extension, { recursive: true, force: true });
    await mkdir(join(profile, "extensions"), { recursive: true });
    await cp(join(root, "build"), extension, { recursive: true });
    console.log(`[rss-helper] built ${new Date().toISOString()}`);
  } finally {
    building = false;
  }
}

async function restart() {
  await build();
  if (child) child.kill();
  child = spawn(zotero, ["-no-remote", "-profile", profile], { stdio: "inherit" });
  child.on("error", (error) => console.error(`[rss-helper] Zotero launch failed: ${error.message}`));
  child.on("exit", (code, signal) => console.log(`[rss-helper] Zotero exited: code=${code ?? "null"} signal=${signal ?? "none"}`));
}

await restart();
const sourceWatcher = watch(join(root, "src"), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => restart().catch((error) => console.error(error)), 250);
});
const manifestWatcher = watch(join(root, "manifest.json"), () => {
  clearTimeout(timer);
  timer = setTimeout(() => restart().catch((error) => console.error(error)), 250);
});

function stop() {
  sourceWatcher.close();
  manifestWatcher.close();
  if (child) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("[rss-helper] watching src/ and manifest.json; Ctrl+C stops Zotero");
