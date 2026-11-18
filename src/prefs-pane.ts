import { ensureDefaults } from "./settings";

export const PLUGIN_ID = "zotero-rss-helper@github.com";

type PrefsDocument = {
  getElementById(id: string): Element | null;
};

function resolveDocument(target: unknown): PrefsDocument | undefined {
  if (!target || typeof target !== "object") return undefined;
  const candidate = target as { getElementById?: unknown; ownerDocument?: unknown; document?: unknown };
  if (typeof candidate.getElementById === "function") return candidate as PrefsDocument;
  if (candidate.ownerDocument) return resolveDocument(candidate.ownerDocument);
  if (candidate.document) return resolveDocument(candidate.document);
  return undefined;
}

/**
 * 设置页的勾选框由 Zotero 的 preference 属性自动双向绑定（见 preferences.js 的 attachToPreference），
 * 这里只负责加载时补齐默认值、写入版本号。
 */
export function onPrefsLoad(target: unknown): void {
  ensureDefaults();
  const doc = resolveDocument(target);
  if (!doc) return;
  const version = doc.getElementById("rss-helper-version");
  const plugin = (Zotero as unknown as { RSSHelper?: { version?: string } }).RSSHelper;
  if (version) version.textContent = plugin?.version ? `RSS Helper v${plugin.version}` : "RSS Helper";
  Zotero.debug("[rss-helper] preferences pane loaded");
}

/**
 * 注册设置页。必须等 Zotero 初始化/解锁/界面就绪之后，否则面板列表里不会出现。
 */
export async function registerPreferencePane(rootURI: string): Promise<void> {
  const panes = (Zotero as unknown as { PreferencePanes?: { register(options: unknown): Promise<unknown> } }).PreferencePanes;
  if (!panes?.register) {
    Zotero.debug("[rss-helper] Zotero.PreferencePanes is unavailable; skipping settings pane");
    return;
  }
  await Promise.all([
    Zotero.initializationPromise,
    (Zotero as unknown as { unlockPromise?: Promise<unknown> }).unlockPromise ?? Promise.resolve(),
    (Zotero as unknown as { uiReadyPromise?: Promise<unknown> }).uiReadyPromise ?? Promise.resolve(),
  ]);
  await panes.register({
    pluginID: PLUGIN_ID,
    src: `${rootURI}content/preferences.xhtml`,
    label: "RSS Helper",
    image: `${rootURI}content/icons/rss-helper.svg`,
  });
  Zotero.debug(`[rss-helper] preference pane registered from ${rootURI}content/preferences.xhtml`);
}
