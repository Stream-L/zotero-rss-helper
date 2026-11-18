import { mkdir, cp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
await rm("build", { recursive: true, force: true });
await mkdir("build", { recursive: true });
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) {
  throw new Error("TypeScript is not installed. Run: npm install --no-audit --no-fund");
}
const result = spawnSync(process.execPath, [tsc, "--project", "tsconfig.build.json"], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await cp("manifest.json", "build/manifest.json");
await cp("content", "build/content", { recursive: true });
const modules = ["rules", "crossref", "settings", "prefs-pane", "progress", "item-hook", "bootstrap"];
const bundled = modules.map((name) => {
  const source = readFile(`build/src/${name}.js`, "utf8");
  return source.then((code) => `__modules["./${name}.js"] = function (module, exports, require) {\n${code}\n};`);
});
const moduleSources = (await Promise.all(bundled)).join("\n");
const entry = (name) => `var ${name} = function (data) { return __plugin.${name}(data); };`;
const exportBlock = [
  "const __plugin = __require(\"./bootstrap.js\");",
  entry("startup"),
  entry("shutdown"),
  entry("onMainWindowLoad"),
  entry("onMainWindowUnload"),
  "var install = function () {};",
  "var uninstall = function () {};",
].join("\n");
await writeFile(
  "build/bootstrap.js",
  `const __modules = {};\n${moduleSources}\nconst __cache = {};\nfunction __require(id) {\n  if (__cache[id]) return __cache[id].exports;\n  const factory = __modules[id];\n  if (!factory) throw new Error("Module not found: " + id);\n  const module = { exports: {} };\n  __cache[id] = module;\n  factory(module, module.exports, (child) => __require(child.endsWith(".js") ? child : child + ".js"));\n  return module.exports;\n}\n${exportBlock}\n`,
  "utf8",
);
console.log("Build complete: build/");
