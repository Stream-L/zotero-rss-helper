import { mkdir, cp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
const run = promisify(execFile);
await rm("build", { recursive: true, force: true });
await mkdir("build", { recursive: true });
const tsc = resolve(process.platform === "win32" ? "node_modules/.bin/tsc.cmd" : "node_modules/.bin/tsc");
if (!existsSync(tsc)) {
  throw new Error("TypeScript is not installed. Run: npm install --no-audit --no-fund");
}
const result = await run(tsc, ["--project", "tsconfig.build.json"], process.platform === "win32" ? { shell: true } : {});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
await cp("manifest.json", "build/manifest.json");
const modules = ["rules", "crossref", "item-hook", "bootstrap"];
const bundled = modules.map((name) => {
  const source = readFile(`build/src/${name}.js`, "utf8");
  return source.then((code) => `__modules["./${name}.js"] = function (module, exports, require) {\n${code}\n};`);
});
const moduleSources = (await Promise.all(bundled)).join("\n");
await writeFile("build/bootstrap.js", `const __modules = {};\n${moduleSources}\nconst __cache = {};\nfunction __require(id) {\n  if (__cache[id]) return __cache[id].exports;\n  const factory = __modules[id];\n  if (!factory) throw new Error("Module not found: " + id);\n  const module = { exports: {} };\n  __cache[id] = module;\n  factory(module, module.exports, (child) => __require(child.endsWith(".js") ? child : child + ".js"));\n  return module.exports;\n}\nconst __plugin = __require("./bootstrap.js");\nvar startup = __plugin.startup;\nvar shutdown = __plugin.shutdown;\nvar install = function () {};\nvar uninstall = function () {};\n`, "utf8");
const bootstrapPath = "build/bootstrap.js";
const bootstrapSource = await readFile(bootstrapPath, "utf8");
await writeFile(
  bootstrapPath,
  bootstrapSource.replace(
    "var shutdown = __plugin.shutdown;",
    "var shutdown = __plugin.shutdown;\nvar onMainWindowLoad = __plugin.onMainWindowLoad;\nvar onMainWindowUnload = __plugin.onMainWindowUnload;",
  ),
  "utf8",
);
console.log("Build complete: build/");
