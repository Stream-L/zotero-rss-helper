import { mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
const root = resolve(".");
const outputDir = resolve("dist");
const output = resolve(outputDir, "zotero-rss-helper-0.1.0.xpi");
const temporaryZip = resolve(outputDir, "zotero-rss-helper-0.1.0.zip");

await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
  cwd: root,
  ...(process.platform === "win32" ? { shell: true } : {}),
});
await mkdir(outputDir, { recursive: true });
await rm(output, { force: true });
await rm(temporaryZip, { force: true });

if (process.platform === "win32") {
  const command = `Compress-Archive -Path '${resolve("build", "*")}' -DestinationPath '${temporaryZip}' -Force`;
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: root });
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Move-Item -LiteralPath '${temporaryZip}' -Destination '${output}' -Force`], { cwd: root });
} else {
  await run("zip", ["-qr", temporaryZip, "."], { cwd: resolve(root, "build") });
  await run("mv", [temporaryZip, output]);
}

console.log(`Plugin package complete: ${output}`);
