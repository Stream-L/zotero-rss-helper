import { lookupCrossref, lookupCrossrefByBibliographic, lookupOpenAlexAbstract, type CrossrefClient, type EnrichedMetadata } from "./crossref";
import { logEvent } from "./log";
import { enrichmentProgress } from "./progress";
import { recognize, type RssEntryLike } from "./rules";
import { screenItem } from "./screen";
import { getSetting } from "./settings";
import { translateItem } from "./translate";

type ZoteroItemLike = RssEntryLike & { id?: number; getField?(field: string): unknown; setField?(field: string, value: unknown): void; setCreators?(creators: Array<{ firstName?: string; lastName?: string; creatorType: "author" }>): void; saveTx?(): Promise<unknown>; itemTypeID?: number };
const pending = new Set<number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const processed = new Map<number, string>();

function toEntry(item: ZoteroItemLike): RssEntryLike {
  const get = (field: string) => item.getField?.(field);
  return { title: String(get("title") ?? item.title ?? ""), description: String(get("abstractNote") ?? item.description ?? ""), url: String(get("url") ?? item.url ?? ""), DOI: String(get("DOI") ?? item.DOI ?? ""), publisher: String(get("publisher") ?? item.publisher ?? ""), extra: String(get("extra") ?? item.extra ?? "") };
}

function createClient(): CrossrefClient {
  return { request: (method, url, options) => Zotero.HTTP.request(method, url, options as any) as Promise<{ response: string | object }> };
}

function applyMetadata(item: ZoteroItemLike, metadata: EnrichedMetadata): number {
  const fields: Array<[string, unknown]> = [["DOI", metadata.DOI], ["title", metadata.title], ["publicationTitle", metadata.publicationTitle], ["date", metadata.date], ["url", metadata.url], ["publisher", metadata.publisher], ["abstractNote", metadata.abstractNote]];
  for (const [field, value] of fields) if (value !== undefined && value !== "") item.setField?.(field, value);
  if (metadata.creators?.length) item.setCreators?.(metadata.creators);
  return fields.filter(([, value]) => value !== undefined && value !== "").length + (metadata.creators?.length ? 1 : 0);
}

function itemFingerprint(item: ZoteroItemLike): string {
  const get = (field: string) => item.getField?.(field);
  return [get("DOI"), get("title"), get("url"), get("abstractNote")].map((value) => String(value ?? "")).join("\u001f");
}

function isFeedItem(item: ZoteroItemLike): boolean {
  if (item.itemTypeID === 22) return true;
  if (typeof item.isFeedItem === "function") return item.isFeedItem();
  if (item.isFeedItem === true) return true;
  return item.itemTypeID === undefined;
}

/** 已经有 DOI + 摘要 + 期刊的条目视为补全过，不再重复请求 Crossref，也不弹提示。 */
function isMetadataComplete(item: ZoteroItemLike): boolean {
  const get = (field: string) => String(item.getField?.(field) ?? "").trim();
  return Boolean(get("DOI") && get("abstractNote") && get("publicationTitle"));
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/** 中文 RSS 条目大多没有 DOI，按标题去 Crossref 做英文书目检索只会匹配到无关文献。 */
function looksChinese(text: string): boolean {
  return CJK.test(text);
}

/** 用词的 Jaccard 相似度粗判书目检索结果是不是同一篇，避免把同主题的英文文章套到中文标题上。 */
function titleSimilarity(a: string, b: string): number {
  const tokens = (text: string) => new Set(
    text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word.length > 1)
  );
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export async function enrichItem(item: ZoteroItemLike): Promise<void> {
  if (!item.id || pending.has(item.id)) return;
  if (!isFeedItem(item)) return;
  const fingerprint = itemFingerprint(item);
  if (processed.get(item.id) === fingerprint) return;
  const id = item.id;
  if (isMetadataComplete(item)) {
    processed.set(id, fingerprint);
    return;
  }
  pending.add(id);
  enrichmentProgress.start(id, String(item.getField?.("title") ?? item.title ?? ""));
  try {
    const entry = toEntry(item);
    const identity = recognize(entry);
    if (!identity.doi && looksChinese(String(entry.title ?? ""))) {
      processed.set(id, itemFingerprint(item));
      enrichmentProgress.skip(id);
      logEvent("enrich", `item ${id}: Chinese title without DOI; kept original RSS metadata`);
      return;
    }
    const client = createClient();
    const metadata = identity.doi ? await lookupCrossref(client, identity.doi) : entry.title && entry.title.length >= 10 ? await lookupCrossrefByBibliographic(client, entry.title) : null;
    if (!metadata) {
      processed.set(id, itemFingerprint(item));
      enrichmentProgress.skip(id);
      return;
    }
    if (!identity.doi && titleSimilarity(String(entry.title ?? ""), String(metadata.title ?? "")) < 0.5) {
      processed.set(id, itemFingerprint(item));
      enrichmentProgress.skip(id);
      logEvent("enrich", `item ${id}: bibliographic match rejected (title mismatch: "${metadata.title}")`);
      return;
    }
    let abstractFound = Boolean(metadata.abstractNote);
    if (!metadata.abstractNote) {
      try { metadata.abstractNote = await lookupOpenAlexAbstract(client, metadata.DOI); abstractFound = Boolean(metadata.abstractNote); }
      catch (error) { logEvent("enrich", `OpenAlex abstract lookup failed for item ${id}: ${String(error)}`); }
    }
    const fieldCount = applyMetadata(item, metadata);
    await item.saveTx?.();
    processed.set(id, itemFingerprint(item));
    enrichmentProgress.succeed(id);
    logEvent("enrich", `item ${id}: enriched ${fieldCount}/7 fields${abstractFound ? "" : " (abstract unavailable)"}`);
    scheduleFollowUps(item);
  } catch (error) {
    processed.set(id, itemFingerprint(item));
    enrichmentProgress.fail(id);
    logEvent("enrich", `item ${id} failed: ${String(error)}`);
  } finally { pending.delete(id); }
}

/** 补全成功后按设置继续翻译 / AI 筛选；失败只记日志，不打断主流程。 */
function scheduleFollowUps(item: ZoteroItemLike): void {
  if (getSetting("autoTranslate")) {
    void translateItem(item as any)
      .then((count) => Zotero.debug(`[rss-helper] auto-translate wrote ${count} fields for item ${item.id}`))
      .catch((error: unknown) => Zotero.debug(`[rss-helper] auto-translate failed for item ${item.id}: ${String(error)}`));
  }
  if (getSetting("autoScreen")) {
    void screenItem(item as any)
      .then((level) => Zotero.debug(`[rss-helper] auto-screen tagged item ${item.id} as ${level}`))
      .catch((error: unknown) => Zotero.debug(`[rss-helper] auto-screen failed for item ${item.id}: ${String(error)}`));
  }
}

const observer = { notify(event: string, type: string, ids: Array<number> | number): void {
  // 只处理新增：RSS 条目入库时补一次即可。点击条目、转存文库都会触发 modify，
  // 再自动重查会重复请求 Crossref，也会让进度提示反复出现。
  if (type !== "item" || event !== "add") return;
  if (!getSetting("autoEnrich")) return;
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    const item = Zotero.Items.get(id) as unknown as ZoteroItemLike | undefined;
    if (!item || item.itemTypeID === 3) continue;
    const previous = timers.get(id);
    if (previous) clearTimeout(previous);
    timers.set(id, setTimeout(() => { timers.delete(id); void enrichItem(item); }, 750));
  }
} };

export function registerItemHook(): void { (Zotero.Notifier as any).registerObserver(observer, ["item"]); Zotero.debug("[rss-helper] item observer registered"); }
export function unregisterItemHook(): void { (Zotero.Notifier as any).unregisterObserver(observer); for (const timer of timers.values()) clearTimeout(timer); timers.clear(); pending.clear(); processed.clear(); }
