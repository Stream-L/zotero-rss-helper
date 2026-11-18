import { mkdir, rm, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const outputDir = resolve("dist");
const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const output = resolve(outputDir, `zotero-rss-helper-${version}.xpi`);
const temporaryZip = resolve(outputDir, `zotero-rss-helper-${version}.zip`);

const build = spawnSync(process.execPath, [resolve("scripts/build.mjs")], { cwd: root, stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

await mkdir(outputDir, { recursive: true });
await rm(output, { force: true });
await rm(temporaryZip, { force: true });

if (process.platform === "win32") {
  const command = `Compress-Archive -Path '${resolve("build", "*")}' -DestinationPath '${temporaryZip}' -Force; Move-Item -LiteralPath '${temporaryZip}' -Destination '${output}' -Force`;
  const zip = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: root, stdio: "inherit" });
  if (zip.error) throw zip.error;
  if (zip.status !== 0) process.exit(zip.status ?? 1);
} else {
  const zip = spawnSync("zip", ["-qr", temporaryZip, "."], { cwd: resolve(root, "build"), stdio: "inherit" });
  if (zip.error) throw zip.error;
  if (zip.status !== 0) process.exit(zip.status ?? 1);
  spawnSync("mv", [temporaryZip, output], { stdio: "inherit" });
}

console.log(`Plugin package complete: ${output}`);
