/**
 * 附件下载诊断：Zotero 自带的「查找可用 PDF」会把 PDF 存进条目，
 * 如果同时有两个调用方，就会出现两个验证窗口、两份同名文件。
 * 插件自己已经不再下载 PDF，这里只做只读探针：记录谁调用了 Zotero.Attachments 的相关方法，
 * 出问题时看 rss-helper.log 就能定位调用方，不改动原有行为。
 */
import { logEvent } from "./log";

type ProbeTarget = Record<string, unknown>;

const PROBE_FLAG = "__rssHelperProbe";
const NAMES = ["addAvailableFiles", "addAvailableFile", "addAvailablePDF", "addAvailablePDFs"];

let originals: Array<{ target: ProbeTarget; name: string; fn: (...args: unknown[]) => unknown }> = [];

function describeArg(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => describeArg(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "number") return `item#${id}`;
    return JSON.stringify(value).slice(0, 80);
  }
  return String(value).slice(0, 80);
}

/** 只取调用栈里最有用的几帧，去掉探针自身和调度帧。 */
function shortStack(): string {
  try {
    const stack = String(new Error().stack ?? "");
    return stack
      .split("\n")
      .slice(2)
      .map((line) => line.trim().replace(/^at\s+/, ""))
      .filter((line) => line && !line.includes("diag.") && !line.startsWith("shortStack"))
      .slice(0, 4)
      .join(" ← ")
      .slice(0, 500);
  } catch {
    return "";
  }
}

export function installAttachmentProbe(): void {
  const target = (Zotero as unknown as { Attachments?: ProbeTarget }).Attachments;
  if (!target) return;
  for (const name of NAMES) {
    const fn = target[name];
    if (typeof fn !== "function" || (fn as unknown as Record<string, unknown>)[PROBE_FLAG]) continue;
    const probe = function (this: unknown, ...args: unknown[]): unknown {
      try {
        logEvent("attachments", `${name}(${args.map(describeArg).join(", ")}) from ${shortStack()}`);
      } catch {}
      return (fn as (...inner: unknown[]) => unknown).apply(this, args);
    };
    (probe as unknown as Record<string, unknown>)[PROBE_FLAG] = true;
    originals.push({ target, name, fn: fn as (...inner: unknown[]) => unknown });
    target[name] = probe;
  }
  if (originals.length) logEvent("attachments", `probe installed (${originals.map((entry) => entry.name).join(", ")})`);
}

export function removeAttachmentProbe(): void {
  for (const { target, name, fn } of originals) {
    const current = target[name] as Record<string, unknown> | undefined;
    if (current && current[PROBE_FLAG]) target[name] = fn;
  }
  originals = [];
}
