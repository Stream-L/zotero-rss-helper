import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { lookupCrossref } from "../build/src/crossref.js";

const calls = [];
const added = [];
const windows = [];
const lines = [];
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

globalThis.Zotero = {
  Prefs: { get: () => false, set() {} },
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
  Items: { get: (id) => (id === 7 ? item : id === 8 ? rssItem : undefined) },
  Notifier: {
    registerObserver(value) {
      observer = value;
    },
    unregisterObserver(value) {
      assert.equal(value, observer);
      observer = undefined;
    },
  },
  debug() {},
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

// 任务1：打包产物必须能按 Zotero 插件入口加载，并干净地 startup/shutdown。
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
