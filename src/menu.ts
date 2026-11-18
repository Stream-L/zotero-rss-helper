/**
 * 右键菜单：
 * - 条目菜单（#zotero-itemmenu）：补全、翻译、AI 筛选、清除标记，支持多选；
 * - 分类菜单（#zotero-collectionmenu）：对一个期刊/专题分类整批筛选。
 * Zotero 7+ 用 createXULElement 创建菜单项，重复注册时按 id 去重。
 */
import { enrichItem } from "./item-hook";
import { applyTestTag, clearAiTags, screenCollection, screenFeed, screenItems, type ItemLike } from "./screen";
import { toast } from "./toast";
import { translateItems } from "./translate";

const ITEM_MENU_ID = "rss-helper-itemmenu";
const COLLECTION_MENU_ID = "rss-helper-collectionmenu";
const MENU_LABEL = "RSS Helper";

type CollectionLike = {
  name?: string;
  loadAllData?(): Promise<unknown>;
  getChildItems?(asIDs?: boolean, includeTrashed?: boolean): unknown[];
};

type WinLike = {
  document: any;
  ZoteroPane?: {
    getSelectedItems(): any[];
    getSelectedCollection?(): CollectionLike | false | null;
    getSelectedLibraryID?(): number | false | null;
  };
};

const registered = new WeakSet<object>();

function selectedItems(win: WinLike): any[] {
  try {
    return win.ZoteroPane?.getSelectedItems() ?? [];
  } catch {
    return [];
  }
}

function selectedCollection(win: WinLike): CollectionLike | null {
  try {
    return win.ZoteroPane?.getSelectedCollection?.() || null;
  } catch {
    return null;
  }
}

/** 选中的是 RSS 订阅时，ZoteroPane 给的是该 feed library 的 libraryID。 */
function selectedFeedLibraryID(win: WinLike): number | null {
  try {
    const libraryID = Number(win.ZoteroPane?.getSelectedLibraryID?.() ?? 0);
    if (!libraryID) return null;
    const feeds = (Zotero as unknown as { Feeds?: { get?(libraryID: number): unknown } }).Feeds;
    return feeds?.get?.(libraryID) ? libraryID : null;
  } catch {
    return null;
  }
}

async function collectionItems(collection: CollectionLike | null): Promise<ItemLike[]> {
  if (!collection) return [];
  try {
    await collection.loadAllData?.();
  } catch {}
  return ((collection.getChildItems?.(false, false) ?? []) as ItemLike[]).filter(
    (item) => item && typeof item.getField === "function",
  );
}

async function feedItems(libraryID: number | null): Promise<ItemLike[]> {
  if (!libraryID) return [];
  try {
    const raw = (await (Zotero.Items as unknown as { getAll(libraryID: number, onlyTopLevel?: boolean): Promise<unknown[]> }).getAll(
      libraryID,
      true,
    )) as unknown[];
    return raw.filter((item): item is ItemLike => !!item && typeof (item as ItemLike).getField === "function");
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to load feed items: ${String(error)}`);
    return [];
  }
}

function addMenuItem(doc: any, popup: any, label: string, command: () => void | Promise<void>): void {
  const item = doc.createXULElement("menuitem");
  item.setAttribute("label", label);
  item.addEventListener("command", () => {
    try {
      const result = command();
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((error: unknown) =>
          Zotero.debug(`[rss-helper] menu action failed: ${String(error)}`),
        );
      }
    } catch (error) {
      Zotero.debug(`[rss-helper] menu action failed: ${String(error)}`);
    }
  });
  popup.appendChild(item);
}

function addMenu(doc: any, parent: any, id: string): any {
  const menu = doc.createXULElement("menu");
  menu.id = id;
  menu.setAttribute("label", MENU_LABEL);
  const popup = doc.createXULElement("menupopup");
  menu.appendChild(popup);
  parent.appendChild(menu);
  return popup;
}

function registerItemMenu(win: WinLike): void {
  const doc = win?.document;
  if (doc.getElementById(ITEM_MENU_ID)) return;
  const itemmenu = doc.querySelector("#zotero-itemmenu");
  if (!itemmenu) {
    Zotero.debug("[rss-helper] #zotero-itemmenu not found; item menu not added");
    return;
  }
  const popup = addMenu(doc, itemmenu, ITEM_MENU_ID);

  addMenuItem(doc, popup, "补全元数据", () => {
    for (const item of selectedItems(win)) void enrichItem(item);
  });

  addMenuItem(doc, popup, "翻译标题和摘要", () => {
    const items = selectedItems(win);
    if (!items.length) {
      toast.show("请先选择条目", "cross");
      return;
    }
    void translateItems(items);
  });

  addMenuItem(doc, popup, "AI 筛选：重要 / 关注", () => {
    const items = selectedItems(win);
    if (!items.length) {
      toast.show("请先选择条目", "cross");
      return;
    }
    void screenItems(items as ItemLike[]);
  });

  addMenuItem(doc, popup, "清除 AI 标记", () => {
    const items = selectedItems(win);
    if (!items.length) {
      toast.show("请先选择条目", "cross");
      return;
    }
    clearTags(items);
  });

  addMenuItem(doc, popup, "测试：打 rss/test 灰蓝标签", () => {
    const items = selectedItems(win);
    if (!items.length) {
      toast.show("请先选择条目", "cross");
      return;
    }
    void applyTestTag(items as ItemLike[]);
  });
}

/** 分类菜单：整批筛选一个期刊/专题。 */
function registerCollectionMenu(win: WinLike): void {
  const doc = win?.document;
  if (doc.getElementById(COLLECTION_MENU_ID)) return;
  const collectionmenu = doc.querySelector("#zotero-collectionmenu");
  if (!collectionmenu) {
    Zotero.debug("[rss-helper] #zotero-collectionmenu not found; collection menu not added");
    return;
  }
  const popup = addMenu(doc, collectionmenu, COLLECTION_MENU_ID);

  addMenuItem(doc, popup, "AI 筛选此分类 / RSS 订阅", async () => {
    const collection = selectedCollection(win);
    if (collection) {
      await screenCollection(collection);
      return;
    }
    const feedLibraryID = selectedFeedLibraryID(win);
    if (!feedLibraryID) {
      toast.show("请先选择一个分类或 RSS 订阅", "cross");
      return;
    }
    await screenFeed(feedLibraryID);
  });

  addMenuItem(doc, popup, "清除此分类的 AI 标记", async () => {
    const collection = selectedCollection(win);
    const feedLibraryID = collection ? null : selectedFeedLibraryID(win);
    if (!collection && !feedLibraryID) {
      toast.show("请先选择一个分类或 RSS 订阅", "cross");
      return;
    }
    const items = collection ? await collectionItems(collection) : await feedItems(feedLibraryID);
    clearTags(items);
  });

  addMenuItem(doc, popup, "测试：给此分类打 rss/test 标签", async () => {
    const collection = selectedCollection(win);
    const feedLibraryID = collection ? null : selectedFeedLibraryID(win);
    if (!collection && !feedLibraryID) {
      toast.show("请先选择一个分类或 RSS 订阅", "cross");
      return;
    }
    const items = collection ? await collectionItems(collection) : await feedItems(feedLibraryID);
    await applyTestTag(items, collection?.name ? `测试：${collection.name}` : "测试：RSS 订阅");
  });
}

function clearTags(items: ItemLike[]): void {
  let changed = 0;
  for (const item of items) {
    try {
      clearAiTags(item);
      void item.saveTx?.();
      changed += 1;
    } catch (error) {
      Zotero.debug(`[rss-helper] clear tag failed: ${String(error)}`);
    }
  }
  toast.show(changed ? `已清除 ${changed} 项的 AI 标记` : "无可清除的标记", changed ? "tick" : "cross");
}

export function registerContextMenu(win: WinLike): void {
  const doc = win?.document;
  if (!doc || registered.has(win)) return;
  registerItemMenu(win);
  registerCollectionMenu(win);
  registered.add(win);
  Zotero.debug("[rss-helper] context menus registered");
}

export function unregisterContextMenu(win: WinLike): void {
  const doc = win?.document;
  if (!doc) return;
  for (const id of [ITEM_MENU_ID, COLLECTION_MENU_ID]) {
    const menu = doc.getElementById(id);
    if (menu) menu.remove();
  }
  registered.delete(win);
  Zotero.debug("[rss-helper] context menus removed");
}
