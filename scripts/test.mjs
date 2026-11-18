import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { lookupCrossref } from "../build/src/crossref.js";

const calls = [];
const added = [];
const windows = [];
const lines = [];
const dbQueries = [];
const feedQueries = [];
let observer;
const item = {
  id: 7,
  fields: {
    title: "RSS title",
    url: "https://doi.org/10.1234/example",
    abstractNote: "Original abstract",
  },
  getField(field) {
    return this.fields[field];
  },
  setField(field, value) {
    this.fields[field] = value;
  },
  setCreators(creators) {
    this.creators = creators;
  },
  async saveTx() {
    added.push(this);
  },
};
const rssItem = {
  id: 8,
  itemTypeID: 22,
  fields: {
    title: "When ratings speak louder than words: Seek alpha in Seeking Alpha",
    abstractNote: "Publication date: January 2027",
    url: "https://www.sciencedirect.com/science/article/pii/S0167923626001764?dgcid=rss_sd_all",
    extra: "Copyright 2026 Elsevier B.V.",
  },
  getField(field) { return this.fields[field]; },
  setField(field, value) { this.fields[field] = value; },
  setCreators(creators) { this.creators = creators; },
  async saveTx() { added.push(this); },
};

const prefs = new Map();
globalThis.Zotero = {
  Prefs: {
    get(key) { return prefs.has(key) ? prefs.get(key) : undefined; },
    set(key, value) { prefs.set(key, value); },
  },
  ProgressWindow: class {
    constructor(options) {
      this.options = options;
      this.headlinePosts = [];
      this.shown = 0;
      this.timers = [];
      this.descriptions = [];
      this.closed = false;
      this.ItemProgress = class {
        constructor(icon, text) {
          this.icon = icon;
          this.text = text;
          this.progress = [];
          this.icons = [];
          this.errored = false;
          lines.push(this);
        }
        setText(text) { this.text = text; }
        setItemTypeAndIcon(itemType, cssIcon) { this.icons.push(cssIcon); }
        setProgress(percent) { this.progress.push(percent); }
        setError() { this.errored = true; }
      };
      windows.push(this);
    }
    changeHeadline(text, cssIcon, postText) { this.headline = text; this.headlinePosts.push(postText); }
    addDescription(text) { this.descriptions.push(text); }
    show() { this.shown += 1; }
    startCloseTimer(ms) { this.timers.push(ms); }
    close() { this.closed = true; }
  },
  Attachments: { addAvailablePDF: async () => false },
  HTTP: {
    async request(method, url, options) {
      calls.push({ method, url, options });
      if (url.includes("api.openalex.org")) {
        return { response: { abstract_inverted_index: { "Abstract": [0], "from": [1], "OpenAlex": [2] } } };
      }
      if (url.includes("query.bibliographic")) {
        return { response: { message: { items: [{ DOI: "10.5555/rss-fixture", title: ["RSS fixture title"] }] } } };
      }
      return {
        response: {
          message: {
            DOI: "10.1234/example",
            title: ["Normalized title"],
            author: [{ given: "Ada", family: "Lovelace" }],
            "container-title": ["Journal of Tests"],
            published: { "date-parts": [[2026, 11, 15]] },
            URL: "https://doi.org/10.1234/example",
            publisher: "Test Press",
            abstract: "Normalized abstract",
          },
        },
      };
    },
  },
  Items: {
    get: (id) => (id === 7 ? item : id === 8 ? rssItem : undefined),
    async getAll(libraryID) {
      feedQueries.push(libraryID);
      return [tagItem];
    },
  },
  Libraries: { userLibraryID: 1 },
  DB: {
    async queryAsync(sql, params) {
      dbQueries.push({ sql, params });
      return [
        { name: "供应链管理", n: 12 },
        { name: "碳市场", n: 4 },
      ];
    },
  },
  Notifier: {
    registerObserver(value) {
      observer = value;
    },
    unregisterObserver(value) {
      assert.equal(value, observer);
      observer = undefined;
    },
  },
  debug(...args) {
    if (process.env.RSS_HELPER_DEBUG) console.error("[zotero]", ...args);
  },
};

const metadata = await lookupCrossref(
  { request: async () => ({ response: { message: { DOI: "10.1/test", title: ["Test"] } } }) },
  "10.1/test",
);
assert.equal(metadata.title, "Test");
assert.equal(metadata.DOI, "10.1/test");

const { registerItemHook, unregisterItemHook } = await import("../build/src/item-hook.js");
registerItemHook();
observer.notify("add", "item", [7, 8]);
await new Promise((resolve) => setTimeout(resolve, 900));
assert.equal(calls[0].method, "GET");
assert.equal(item.fields.title, "Normalized title");
assert.equal(item.fields.publicationTitle, "Journal of Tests");
assert.equal(item.fields.date, "2026-11-15");
assert.equal(item.creators[0].lastName, "Lovelace");
assert.equal(rssItem.fields.DOI, "10.5555/rss-fixture");
assert.equal(rssItem.fields.abstractNote, "Abstract from OpenAlex");
assert.equal(added.length, 2);

// 任务1：多个条目共用同一个进度窗，标题栏计数递增，结束后空闲关闭。
assert.equal(windows.length, 1, "a single enrichment session must reuse one progress window");
const progressWindow = windows[0];
assert.equal(progressWindow.shown, 1);
assert.deepEqual([progressWindow.headlinePosts[0], progressWindow.headlinePosts.at(-1)], ["0/1", "2/2"]);
assert.equal(progressWindow.timers.length, 0, "close timing must be owned by the progress module");
assert.equal(lines.length, 1, "the progress window must own exactly one line");
assert.match(lines[0].text, /2 项已补全/);
assert.equal(lines[0].icons.at(-1), "tick");
await new Promise((resolve) => setTimeout(resolve, 4200));
assert.equal(progressWindow.closed, true, "the progress window must close itself when idle");
unregisterItemHook();

// 任务2：设置项走 extensions.rss-helper.* 分支，首次启动补默认值，设置页用完整键名双向绑定。
const { getSetting, setSetting, ensureDefaults, SETTING_KEYS, TEXT_SETTING_KEYS, FULL_PREF_PREFIX, getTagHintCount } = await import("../build/src/settings.js");
assert.equal(getSetting("autoEnrich"), true, "missing pref must fall back to the default");
assert.equal(getSetting("autoTranslate"), false);
assert.equal(getTagHintCount(), 40, "tag hint count must default to 40");
prefs.set("extensions.rss-helper.tagHintCount", "7");
assert.equal(getTagHintCount(), 7);
prefs.set("extensions.rss-helper.tagHintCount", "999");
assert.equal(getTagHintCount(), 120, "tag hint count must be clamped");
prefs.delete("extensions.rss-helper.tagHintCount");
ensureDefaults();
assert.equal(prefs.get("extensions.rss-helper.autoEnrich"), true);
assert.equal(prefs.get("extensions.rss-helper.fetchAttachments"), undefined, "PDF auto-download setting must be gone");

const paneMarkup = readFileSync(new URL("../content/preferences.xhtml", import.meta.url), "utf8");
for (const key of [...SETTING_KEYS, ...TEXT_SETTING_KEYS]) {
  assert.ok(
    paneMarkup.includes(`preference="${FULL_PREF_PREFIX}${key}"`),
    `preferences.xhtml must bind ${key} to the full pref key`,
  );
}

const { onPrefsLoad, registerPreferencePane } = await import("../build/src/prefs-pane.js");
const versionLabel = { textContent: "" };
globalThis.Zotero.RSSHelper = { version: "9.9.9", hooks: { onPrefsLoad } };
onPrefsLoad({ getElementById: (id) => (id === "rss-helper-version" ? versionLabel : null) });
assert.match(versionLabel.textContent, /9\.9\.9/);

let paneOptions;
globalThis.Zotero.initializationPromise = Promise.resolve();
globalThis.Zotero.PreferencePanes = { async register(options) { paneOptions = options; } };
await registerPreferencePane("file:///plugin/");
assert.equal(paneOptions.src, "file:///plugin/content/preferences.xhtml");
assert.equal(paneOptions.pluginID, "zotero-rss-helper@github.com");

// 任务3：翻译走本机 Translate for Zotero 插件，译文写入 Extra；中文条目跳过。
const extraWrites = [];
globalThis.Zotero.PDFTranslate = {
  api: { translate: async (text) => ({ result: `译:${text}` }) },
  data: { ztoolkit: { ExtraField: { setExtraField: async (target, key, value) => { extraWrites.push({ key, value }); } } } },
};
const { translateItem, translateItems } = await import("../build/src/translate.js");
const foreign = {
  id: 11,
  fields: { title: "A title", abstractNote: "An abstract", language: "en", extra: "" },
  getField(f) { return this.fields[f]; },
  setField(f, v) { this.fields[f] = v; },
  async saveTx() { this.saved = true; },
};
assert.equal(await translateItem(foreign), 2);
assert.deepEqual(extraWrites.map((w) => w.key), ["titleTranslation", "abstractTranslation"]);
assert.equal(foreign.saved, true);
const chinese = { id: 12, fields: { title: "标题", abstractNote: "摘要", language: "zh-CN" }, getField(f) { return this.fields[f]; }, setField() {} };
assert.equal(await translateItem(chinese), 0, "Chinese items must be skipped");
delete globalThis.Zotero.PDFTranslate;

// 任务4：AI 分级结果映射成彩色标签，颜色只设一次；自定义领域提示词进入 system prompt。
let colorCall;
const tagItem = {
  id: 21,
  libraryID: 1,
  tags: [],
  fields: { title: "Supply chain forecasting with LLMs", abstractNote: "We propose a method.", publicationTitle: "J. Test", date: "2026" },
  getField(f) { return this.fields[f]; },
  addTag(tag) { this.tags.push(tag); },
  removeTag(tag) { this.tags = this.tags.filter((t) => t !== tag); },
  async saveTx() { this.saved = true; },
};
globalThis.Zotero.OSKeyStore = {
  encrypt: async (value) => `enc:${value}`,
  decrypt: async (value) => String(value).replace(/^enc:/, ""),
};
globalThis.Zotero.Tags = { setColor: async (libraryID, name, color) => { colorCall = { libraryID, name, color }; } };
prefs.set("extensions.rss-helper.apiKeyEnc", "enc:test-key");
const originalRequest = globalThis.Zotero.HTTP.request;
let screenRequests = [];
globalThis.Zotero.HTTP.request = async (method, url, options) => {
  const body = JSON.parse(options.body);
  screenRequests.push({ url, body, auth: options.headers.Authorization });
  return { response: { choices: [{ message: { content: JSON.stringify({ level: "important", score: 5, reason: "方法相关", topic: "LLM" }) } }] } };
};
const { screenItem, levelTag } = await import("../build/src/screen.js");
assert.equal(await screenItem(tagItem), "important");
assert.deepEqual(tagItem.tags, ["RSS/重要"]);
assert.deepEqual(colorCall, { libraryID: 1, name: "RSS/重要", color: "#e03131" });
assert.equal(tagItem.saved, true);
assert.match(screenRequests[0].url, /\/chat\/completions$/);
assert.match(screenRequests[0].auth, /^Bearer test-key$/);
assert.equal(screenRequests[0].body.tools[0].function.name, "get_item_details");
assert.match(screenRequests[0].body.messages[0].content, /管理科学与工程/, "system prompt must embed the custom domain prompt");
assert.match(screenRequests[0].body.messages[0].content, /供应链管理/, "library tags must be fed into the prompt as domain evidence");

// 任务4：工具调用——模型先取条目详情，再返回结论。
screenRequests = [];
let toolRound = 0;
globalThis.Zotero.HTTP.request = async (method, url, options) => {
  const body = JSON.parse(options.body);
  screenRequests.push(body);
  toolRound += 1;
  if (toolRound === 1) {
    return { response: { choices: [{ message: { content: "", tool_calls: [{ id: "call_1", function: { name: "get_item_details", arguments: "{}" } }] } }] } };
  }
  return { response: { choices: [{ message: { content: JSON.stringify({ level: "watch", score: 3, reason: "方法可借鉴", topic: "库存" }) } }] } };
};
const detailItem = {
  id: 22,
  libraryID: 1,
  tags: [],
  fields: { title: "Inventory control with demand learning", abstractNote: "A model.", publicationTitle: "J", date: "2026" },
  getField(f) { return this.fields[f]; },
  addTag(tag) { this.tags.push(tag); },
  removeTag(tag) { this.tags = this.tags.filter((t) => t !== tag); },
  async saveTx() { this.saved = true; },
};
assert.equal(await screenItem(detailItem), "watch");
assert.equal(screenRequests.length, 2, "tool round must be followed by a final JSON round");
assert.equal(screenRequests[1].messages.at(-1).role, "tool");
assert.match(screenRequests[1].messages.at(-1).content, /Inventory control/);

// 任务4：不填自己的 key 时复用 Zotero GPT 插件的配置。
screenRequests = [];
globalThis.Zotero.HTTP.request = async (method, url, options) => {
  const body = JSON.parse(options.body);
  screenRequests.push({ url, body, auth: options.headers.Authorization });
  return { response: { choices: [{ message: { content: JSON.stringify({ level: "skip", score: 1, reason: "与方向无关", topic: "其他" }) } }] } };
};
prefs.delete("extensions.rss-helper.apiKeyEnc");
prefs.set("extensions.zotero.zoterogpt.secretKey", "sk-zoterogpt");
prefs.set("extensions.zotero.zoterogpt.api", "https://api.siliconflow.cn");
prefs.set("extensions.zotero.zoterogpt.model", "Qwen/Qwen3-8B");
const gptItem = {
  id: 23,
  libraryID: 1,
  tags: [],
  fields: { title: "A survey of everything", abstractNote: "Review.", publicationTitle: "J", date: "2026" },
  getField(f) { return this.fields[f]; },
  addTag(tag) { this.tags.push(tag); },
  removeTag(tag) { this.tags = this.tags.filter((t) => t !== tag); },
  async saveTx() { this.saved = true; },
};
assert.equal(await screenItem(gptItem), "skip");
assert.deepEqual(gptItem.tags, [], "skipped items must stay untagged by default");
const gptRequest = screenRequests.at(-1);
assert.equal(gptRequest.url, "https://api.siliconflow.cn/v1/chat/completions");
assert.match(gptRequest.auth, /^Bearer sk-zoterogpt$/);
assert.equal(gptRequest.body.model, "Qwen/Qwen3-8B");

// 任务4：标签名可在设置页改成自己的命名。
prefs.delete("extensions.zotero.zoterogpt.secretKey");
prefs.set("extensions.rss-helper.apiKeyEnc", "enc:test-key");
prefs.set("extensions.rss-helper.tagImportant", "AI/必读");
assert.equal(levelTag("important"), "AI/必读");
globalThis.Zotero.HTTP.request = async () => ({ response: { choices: [{ message: { content: JSON.stringify({ level: "important", score: 5, reason: "相关", topic: "运营" }) } }] } });
const renamedItem = { ...tagItem, id: 24, tags: [], fields: { ...tagItem.fields } };
assert.equal(await screenItem(renamedItem), "important");
assert.deepEqual(renamedItem.tags, ["AI/必读"]);
assert.equal(colorCall.name, "AI/必读");

// 设置页「从库内标签归纳领域」：把标签交给模型总结成领域描述，直接写回提示词。
let promptRequest;
globalThis.Zotero.HTTP.request = async (method, url, options) => {
  promptRequest = JSON.parse(options.body);
  return { response: { choices: [{ message: { content: JSON.stringify({ profile: "1. 供应链管理：库存、定价\n2. 碳市场：政策评估" }) } }] } };
};
const promptStatus = { textContent: "" };
const promptTextarea = { value: "" };
const { onPrefsGeneratePrompt } = await import("../build/src/prefs-pane.js");
await onPrefsGeneratePrompt({
  getElementById: (id) =>
    id === "rss-helper-prompt-status" ? promptStatus : id === "rss-helper-customPrompt" ? promptTextarea : null,
});
assert.match(promptTextarea.value, /供应链管理/, "generated profile must be written into the textarea");
assert.equal(prefs.get("extensions.rss-helper.customPrompt"), promptTextarea.value);
assert.match(promptRequest.messages[0].content, /研究兴趣分析助手/);
assert.match(promptRequest.messages[1].content, /供应链管理\(12\)/, "tag counts must be passed to the model");
assert.match(promptStatus.textContent, /已写入/);

// 设置页「预览库内标签」：先让用户看清会写进提示词的标签，再决定数量。
dbQueries.length = 0;
const preview = { textContent: "" };
const { onPrefsPreviewTags } = await import("../build/src/prefs-pane.js");
prefs.set("extensions.rss-helper.tagHintCount", "6");
await onPrefsPreviewTags({ getElementById: (id) => (id === "rss-helper-tag-preview" ? preview : null) });
assert.equal(dbQueries.at(-1).params[1], 6, "preview must use the configured tag count");
assert.match(dbQueries.at(-1).sql, /JOIN items i ON i\.itemID = it\.itemID/, "tags have no libraryID column; must join items");
assert.match(dbQueries.at(-1).sql, /NOT LIKE '\/%'/, "internal tags like /unread must be filtered out");
assert.equal(dbQueries.at(-1).params[0], 1, "tag hints must come from the user library");
assert.match(preview.textContent, /供应链管理\(12\)/);
assert.match(preview.textContent, /前 2 个/);
prefs.delete("extensions.rss-helper.tagHintCount");
globalThis.Zotero.HTTP.request = originalRequest;

// 任务4：右键菜单同时挂条目菜单和 RSS 订阅/分类菜单，且重复注册不会产生第二个子菜单。
const menuRoot = { children: [], appendChild(child) { this.children.push(child); } };
const collectionRoot = { children: [], appendChild(child) { this.children.push(child); } };
const fakeDoc = {
  getElementById: () => null,
  querySelector: (selector) =>
    selector === "#zotero-itemmenu" ? menuRoot : selector === "#zotero-collectionmenu" ? collectionRoot : null,
  createXULElement: (tag) => ({
    tagName: tag,
    attrs: {},
    children: [],
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(child) { this.children.push(child); },
    remove() {},
  }),
};
const fakeWin = {
  document: fakeDoc,
  ZoteroPane: {
    getSelectedItems: () => [tagItem],
    getSelectedCollection: () => null,
    getSelectedLibraryID: () => 9,
  },
};
globalThis.Zotero.Feeds = { get: (libraryID) => (libraryID === 9 ? { isFeed: true, name: "Journal Feed" } : undefined) };
const { registerContextMenu, unregisterContextMenu } = await import("../build/src/menu.js");
registerContextMenu(fakeWin);
registerContextMenu(fakeWin);
const menus = menuRoot.children.filter((child) => child.id === "rss-helper-itemmenu");
assert.equal(menus.length, 1, "context menu must be idempotent");
assert.equal(menus[0].children[0].children.length, 5, "item menu must expose five actions (including the rss/test probe)");
const collectionMenus = collectionRoot.children.filter((child) => child.id === "rss-helper-collectionmenu");
assert.equal(collectionMenus.length, 1, "collection menu must be mounted once");
assert.equal(collectionMenus[0].children[0].children.length, 3, "collection menu must expose screen/clear/test");

// 测试按钮：条目右键给 rss/test 打灰蓝色，确认菜单→打标签→设色链路。
tagItem.tags = [];
menus[0].children[0].children[4].listeners.command();
await new Promise((resolve) => setTimeout(resolve, 30));
assert.ok(tagItem.tags.includes("rss/test"), "the probe action must add rss/test to the selected item");
assert.deepEqual(colorCall, { libraryID: 1, name: "rss/test", color: "#5c7c9a" }, "rss/test must get the gray-blue color");

// RSS 订阅右键：feed 选中时通过 libraryID 取条目并整批 AI 筛选。
tagItem.tags = [];
globalThis.Zotero.HTTP.request = async () => ({
  response: { choices: [{ message: { content: JSON.stringify({ level: "important", score: 5, reason: "相关", topic: "运营" }) } }] },
});
feedQueries.length = 0;
collectionMenus[0].children[0].children[0].listeners.command();
await new Promise((resolve) => setTimeout(resolve, 80));
assert.ok(feedQueries.includes(9), "feed menu action must read items of the selected feed library");
assert.ok(tagItem.tags.includes(levelTag("important")), "feed screening must tag important items");
unregisterContextMenu(fakeWin);
globalThis.Zotero.HTTP.request = originalRequest;


const bundle = readFileSync(new URL("../build/bootstrap.js", import.meta.url), "utf8");
const context = { Zotero: globalThis.Zotero, console };
vm.createContext(context);
vm.runInContext(bundle, context);
assert.equal(typeof context.startup, "function");
assert.equal(typeof context.onMainWindowLoad, "function");
context.startup();
context.onMainWindowLoad({ window: {} });
context.onMainWindowUnload({ window: {} });
context.shutdown();
assert.equal(observer, undefined, "shutdown must unregister the item observer");

console.log("rss-helper tests passed: Crossref lookup + item observer enrichment + bundle lifecycle");
