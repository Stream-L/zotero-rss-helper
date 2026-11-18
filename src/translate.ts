/**
 * 调用本机 Translate for Zotero 插件翻译标题/摘要，结果写进 Extra。
 * 调用方式来自 zotero 脚本 transAb.js / transTit.js：
 *   Zotero.PDFTranslate.api.translate(text).result
 *   Zotero.PDFTranslate.data.ztoolkit.ExtraField.setExtraField(item, key, value)
 */
import { toast } from "./toast";

type ItemLike = {
  id?: number;
  getField(field: string): unknown;
  setField(field: string, value: unknown): void;
  saveTx?(): Promise<unknown>;
};

type TranslateAPI = {
  api?: { translate(text: string): Promise<{ result?: string }> };
  data?: { ztoolkit?: { ExtraField?: { setExtraField(item: unknown, key: string, value: string): Promise<unknown> } } };
};

export function getTranslateAPI(): TranslateAPI | null {
  let api: TranslateAPI | undefined;
  try {
    api = (Zotero as unknown as { PDFTranslate?: TranslateAPI }).PDFTranslate;
  } catch {
    api = undefined;
  }
  return api?.api?.translate ? api : null;
}

export function isChinese(item: ItemLike): boolean {
  const language = String(item.getField("language") ?? "").toLowerCase();
  return language.includes("zh");
}

export function setExtraField(item: ItemLike, key: string, value: string): void {
  const extra = String(item.getField("extra") ?? "");
  const line = `${key}: ${value.replace(/\s*\n\s*/g, " ").trim()}`;
  const pattern = new RegExp(`^${key}:.*$`, "m");
  const next = pattern.test(extra) ? extra.replace(pattern, line) : extra.trim() ? `${extra.replace(/\s+$/, "")}\n${line}` : line;
  item.setField("extra", next);
}

async function writeExtra(item: ItemLike, api: TranslateAPI, key: string, value: string): Promise<void> {
  const setter = api.data?.ztoolkit?.ExtraField?.setExtraField;
  if (setter) {
    await setter(item, key, value);
    return;
  }
  setExtraField(item, key, value);
}

/** 翻译单个条目的标题和摘要，返回成功写入的字段数。 */
export async function translateItem(item: ItemLike): Promise<number> {
  const api = getTranslateAPI();
  if (!api) throw new Error("未安装或未启用 Translate for Zotero");
  if (isChinese(item)) return 0;

  let count = 0;
  const title = String(item.getField("title") ?? "").trim();
  if (title) {
    const result = (await api.api!.translate(title)).result;
    if (result) {
      await writeExtra(item, api, "titleTranslation", result);
      count += 1;
    }
  }
  const abstract = String(item.getField("abstractNote") ?? "").trim();
  if (abstract) {
    const result = (await api.api!.translate(abstract)).result;
    if (result) {
      await writeExtra(item, api, "abstractTranslation", result);
      count += 1;
    }
  }
  if (count) await item.saveTx?.();
  return count;
}

/** 菜单/自动流程入口：一次弱提示汇报整体结果。 */
export async function translateItems(items: ItemLike[], source = "翻译"): Promise<void> {
  const api = getTranslateAPI();
  if (!api) {
    toast.show(`${source}需要 Translate for Zotero 插件`, "cross");
    return;
  }
  toast.show(`${source}中…`, "feed-updating");
  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    try {
      if (isChinese(item)) {
        skipped += 1;
        continue;
      }
      const count = await translateItem(item);
      if (count > 0) done += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      Zotero.debug(`[rss-helper] translate failed for item ${item.id}: ${String(error)}`);
    }
  }
  const parts = [`${done} 项已翻译`];
  if (skipped) parts.push(`${skipped} 项跳过`);
  if (failed) parts.push(`${failed} 项失败`);
  toast.show(parts.join(" · "), failed ? "cross" : "tick");
}
