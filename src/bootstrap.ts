import { lookupCrossref, mergeMetadata } from "./crossref";
import { registerItemHook, unregisterItemHook } from "./item-hook";
import { PLUGIN_ID, onPrefsLoad, registerPreferencePane } from "./prefs-pane";
import { enrichmentProgress } from "./progress";
import { recognize, type RssEntryLike } from "./rules";
import { ensureDefaults } from "./settings";

type StartupData = {
  version?: string;
  rootURI?: string;
  resourceURI?: { spec?: string };
};

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

export function startup(data?: StartupData): void {
  const rootURI = data?.rootURI ?? data?.resourceURI?.spec;
  Zotero.debug(`[rss-helper] startup (rootURI=${rootURI ?? "unknown"})`);
  (Zotero as unknown as { RSSHelper?: unknown }).RSSHelper = {
    version: data?.version ?? "",
    hooks: { onPrefsLoad },
  };
  try {
    ensureDefaults();
    registerItemHook();
  } catch (error) {
    Zotero.debug(`[rss-helper] item observer setup failed: ${String(error)}`);
  }
  if (!rootURI) {
    Zotero.debug("[rss-helper] no rootURI in startup data; settings pane not registered");
    return;
  }
  void registerPreferencePane(rootURI).catch((error: unknown) => {
    Zotero.debug(`[rss-helper] preference pane registration failed: ${String(error)}`);
  });
}

export function onMainWindowLoad(data?: { window?: any }): void {
  void data;
}

export function onMainWindowUnload(): void {
}

export function shutdown(): void {
  unregisterItemHook();
  enrichmentProgress.dispose();
  const zotero = Zotero as unknown as { RSSHelper?: unknown };
  if (zotero.RSSHelper) delete zotero.RSSHelper;
  Zotero.debug(`[rss-helper] shutdown (${PLUGIN_ID})`);
}
