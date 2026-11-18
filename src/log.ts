/**
 * 轻量诊断日志：AI 请求失败、标签查询失败这类只发生一次、又不好在界面展开的错误，
 * 追加写到数据目录下的 rss-helper.log，方便装完插件后直接看文件定位问题。
 */
const LOG_NAME = "rss-helper.log";
const MAX_BYTES = 200_000;

let queue: Promise<unknown> = Promise.resolve();

export function logPath(): string {
  try {
    const dir = String((Zotero as unknown as { DataDirectory?: { dir?: string } }).DataDirectory?.dir ?? "");
    if (!dir) return "";
    return `${dir.replace(/[\\/]+$/, "")}\\${LOG_NAME}`;
  } catch {
    return "";
  }
}

function appendLine(line: string): void {
  const path = logPath();
  if (!path) return;
  queue = queue.then(async () => {
    try {
      const File = (Zotero as unknown as { File?: { getContentsAsync?: (path: string) => Promise<string>; putContentsAsync?: (path: string, data: string) => Promise<unknown> } }).File;
      let existing = "";
      try {
        existing = String((await File?.getContentsAsync?.(path)) ?? "");
      } catch {
        existing = "";
      }
      if (existing.length > MAX_BYTES) existing = existing.slice(-MAX_BYTES / 2);
      await File?.putContentsAsync?.(path, existing + line);
    } catch {
      // 日志失败不能影响主流程
    }
  });
}

/** 当前加载的插件版本；写在每行日志里，用来识别“是不是还在用旧实例”。 */
function pluginVersion(): string {
  try {
    return String((Zotero as unknown as { RSSHelper?: { version?: string } }).RSSHelper?.version ?? "");
  } catch {
    return "";
  }
}

/** 写一行诊断日志，同时保留 Zotero.debug 输出。 */
export function logEvent(scope: string, message: string): void {
  const text = String(message).replace(/\s+/g, " ").slice(0, 2000);
  const version = pluginVersion();
  const tag = version ? `v${version} ` : "";
  Zotero.debug(`[rss-helper] ${scope}: ${text}`);
  appendLine(`[${new Date().toISOString()}] ${tag}${scope}: ${text}\n`);
}
