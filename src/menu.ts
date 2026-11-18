/**
 * 条目右键菜单：RSS Helper 子菜单。
 * Zotero 7+ 的条目菜单元素 id 是 #zotero-itemmenu，菜单项用 createXULElement 创建。
 */
import { enrichItem } from "./item-hook";
import { clearAiTags, screenItems } from "./screen";
import { toast } from "./toast";
import { translateItems } from "./translate";

const MENU_ID = "rss-helper-itemmenu";
const MENU_LABEL = "RSS Helper";

type WinLike = {
  document: any;
  ZoteroPane?: { getSelectedItems(): any[] };
};

const registered = new WeakSet<object>();

function selectedItems(win: WinLike): any[] {
  try {
    return win.ZoteroPane?.getSelectedItems() ?? [];
  } catch {
    return [];
  }
}

function addMenuItem(doc: any, popup: any, label: string, command: () => void): void {
  const item = doc.createXULElement("menuitem");
  item.setAttribute("label", label);
  item.addEventListener("command", () => {
    try {
      command();
    } catch (error) {
      Zotero.debug(`[rss-helper] menu action failed: ${String(error)}`);
    }
  });
  popup.appendChild(item);
}

export function registerContextMenu(win: WinLike): void {
  const doc = win?.document;
  if (!doc || registered.has(win)) return;
  if (doc.getElementById(MENU_ID)) return;

  const itemmenu = doc.querySelector("#zotero-itemmenu");
  if (!itemmenu) {
    Zotero.debug("[rss-helper] #zotero-itemmenu not found; context menu not added");
    return;
  }

  const menu = doc.createXULElement("menu");
  menu.id = MENU_ID;
  menu.setAttribute("label", MENU_LABEL);
  const popup = doc.createXULElement("menupopup");
  menu.appendChild(popup);

  addMenuItem(doc, popup, "补全元数据", () => {
    const items = selectedItems(win);
    for (const item of items) void enrichItem(item);
  });

  addMenuItem(doc, popup, "翻译标题和摘要", () => {
    const items = selectedItems(win);
    if (!items.length) {
      toast.show("请先选择条目", "cross");
      return;
    }
    void translateItems(items);
  });

  addMenuItem(doc, popup, "AI 判断重要性", () => {
    const items = selectedItems(win);
    if (!items.length) {
      toast.show("请先选择条目", "cross");
      return;
    }
    void screenItems(items);
  });

  addMenuItem(doc, popup, "清除 AI 标记", () => {
    const items = selectedItems(win);
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
  });

  itemmenu.appendChild(menu);
  registered.add(win);
  Zotero.debug("[rss-helper] context menu registered");
}

export function unregisterContextMenu(win: WinLike): void {
  const doc = win?.document;
  if (!doc) return;
  const menu = doc.getElementById(MENU_ID);
  if (menu) menu.remove();
  registered.delete(win);
  Zotero.debug("[rss-helper] context menu removed");
}
