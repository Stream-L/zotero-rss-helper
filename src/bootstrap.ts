import { lookupCrossref, mergeMetadata } from "./crossref";
import { registerItemHook, unregisterItemHook } from "./item-hook";
import { registerContextMenu, unregisterContextMenu } from "./menu";
import { PLUGIN_ID, onPrefsCommand, onPrefsGeneratePrompt, onPrefsLoad, onPrefsPreviewTags, registerPreferencePane } from "./prefs-pane";
import { enrichmentProgress } from "./progress";
import { recognize, type RssEntryLike } from "./rules";
import { ensureDefaults } from "./settings";
import { toast } from "./toast";

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
    hooks: { onPrefsLoad, onPrefsCommand, onPrefsGeneratePrompt, onPrefsPreviewTags },
  };
  try {
    ensureDefaults();
    registerItemHook();
  } catch (error) {
    Zotero.debug(`[rss-helper] item observer setup failed: ${String(error)}`);
  }
  registerExistingWindows();
  if (!rootURI) {
    Zotero.debug("[rss-helper] no rootURI in startup data; settings pane not registered");
    return;
  }
  void registerPreferencePane(rootURI).catch((error: unknown) => {
    Zotero.debug(`[rss-helper] preference pane registration failed: ${String(error)}`);
  });
}

/**
 * Zotero 只对新打开的窗口调用 onMainWindowLoad；插件在运行时安装时，当前已开的主窗口不会被补调，
 * 右键菜单就会一直不出现。所以启动后再主动给现有窗口注册一遍。
 */
function registerExistingWindows(): void {
  const ready = (Zotero as unknown as { uiReadyPromise?: Promise<unknown> }).uiReadyPromise ?? Promise.resolve();
  void ready
    .then(() => {
      const wins = ((Zotero as unknown as { getMainWindows?: () => any[] }).getMainWindows?.() ?? []) as any[];
      for (const win of wins) {
        try {
          registerContextMenu(win);
        } catch (error) {
          Zotero.debug(`[rss-helper] context menu registration failed for existing window: ${String(error)}`);
        }
      }
    })
    .catch((error: unknown) => {
      Zotero.debug(`[rss-helper] failed to register menus in existing windows: ${String(error)}`);
    });
}

export function onMainWindowLoad(data?: { window?: any }): void {
  const win = data?.window;
  if (!win) return;
  try {
    registerContextMenu(win);
  } catch (error) {
    Zotero.debug(`[rss-helper] context menu registration failed: ${String(error)}`);
  }
}

export function onMainWindowUnload(data?: { window?: any }): void {
  const win = data?.window;
  if (!win) return;
  try {
    unregisterContextMenu(win);
  } catch (error) {
    Zotero.debug(`[rss-helper] context menu removal failed: ${String(error)}`);
  }
  toast.dispose();
}

export function shutdown(): void {
  unregisterItemHook();
  enrichmentProgress.dispose();
  toast.dispose();
  const zotero = Zotero as unknown as { RSSHelper?: unknown };
  if (zotero.RSSHelper) delete zotero.RSSHelper;
  Zotero.debug(`[rss-helper] shutdown (${PLUGIN_ID})`);
}
