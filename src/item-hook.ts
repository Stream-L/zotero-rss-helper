import { lookupCrossref, lookupCrossrefByBibliographic, lookupOpenAlexAbstract, type CrossrefClient, type EnrichedMetadata } from "./crossref";
import { enrichmentProgress } from "./progress";
import { recognize, type RssEntryLike } from "./rules";
import { getSetting } from "./settings";

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

export async function enrichItem(item: ZoteroItemLike): Promise<void> {
  if (!item.id || pending.has(item.id)) return;
  if (!isFeedItem(item)) return;
  const fingerprint = itemFingerprint(item);
  if (processed.get(item.id) === fingerprint) return;
  const id = item.id;
  pending.add(id);
  enrichmentProgress.start(id, String(item.getField?.("title") ?? item.title ?? ""));
  try {
    const entry = toEntry(item);
    const identity = recognize(entry);
    const client = createClient();
    const metadata = identity.doi ? await lookupCrossref(client, identity.doi) : entry.title && entry.title.length >= 10 ? await lookupCrossrefByBibliographic(client, entry.title) : null;
    if (!metadata) {
      processed.set(id, itemFingerprint(item));
      enrichmentProgress.skip(id);
      return;
    }
    let abstractFound = Boolean(metadata.abstractNote);
    if (!metadata.abstractNote) {
      try { metadata.abstractNote = await lookupOpenAlexAbstract(client, metadata.DOI); abstractFound = Boolean(metadata.abstractNote); }
      catch (error) { Zotero.debug(`[rss-helper] OpenAlex abstract lookup failed: ${String(error)}`); }
    }
    const fieldCount = applyMetadata(item, metadata);
    await item.saveTx?.();
    if (getSetting("fetchAttachments")) {
      try {
        await (Zotero.Attachments as any).addAvailablePDF(item, { methods: ["doi", "url", "oa"] });
      } catch (error) {
        Zotero.debug(`[rss-helper] PDF lookup failed for item ${id}: ${String(error)}`);
      }
    }
    processed.set(id, itemFingerprint(item));
    enrichmentProgress.succeed(id);
    Zotero.debug(`[rss-helper] enriched ${fieldCount}/7 fields${abstractFound ? "" : " (abstract unavailable)"}`);
  } catch (error) {
    processed.set(id, itemFingerprint(item));
    enrichmentProgress.fail(id);
    Zotero.debug(`[rss-helper] enrichment failure: ${String(error)}`);
  } finally { pending.delete(id); }
}

const observer = { notify(event: string, type: string, ids: Array<number> | number): void {
  if (type !== "item" || !["add", "modify"].includes(event)) return;
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
