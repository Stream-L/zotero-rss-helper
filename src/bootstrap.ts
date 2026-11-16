import { lookupCrossref, mergeMetadata } from "./crossref";
import { recognize, type RssEntryLike } from "./rules";
import { registerItemHook, unregisterItemHook } from "./item-hook";

export async function enrichRssEntry(entry: RssEntryLike): Promise<RssEntryLike> {
  const identity = recognize(entry);
  if (!identity.doi) return { ...entry };
  try {
    const client = {
      request(method: string, url: string, options?: Record<string, unknown>) {
        return Zotero.HTTP.request(method, url, options as any) as Promise<{ response: string | object }>;
      },
    };
    const metadata = await lookupCrossref(client, identity.doi);
    return mergeMetadata(entry, metadata);
  } catch (error) {
    Zotero.debug(`[rss-helper] Crossref lookup failed for ${identity.doi}: ${String(error)}`);
    return { ...entry };
  }
}

export function startup(data?: { resourceURI?: { spec?: string } }): void {
  Zotero.debug("[rss-helper] startup");
  try {
    registerItemHook();
    Zotero.debug("[rss-helper] item observer registered");
  } catch (error) {
    Zotero.debug(`[rss-helper] item observer setup failed: ${String(error)}`);
  }
}

export function onMainWindowLoad(data?: { window?: any }): void {
  void data;
}

export function onMainWindowUnload(): void {
}

export function shutdown(): void {
  unregisterItemHook();
}
