import assert from "node:assert/strict";
import { lookupCrossref } from "../build/src/crossref.js";

const calls = [];
const added = [];
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
    changeHeadline() {}
    addDescription() {}
    show() {}
    startCloseTimer() {}
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
observer.notify("add", "item", [7]);
await new Promise((resolve) => setTimeout(resolve, 850));
assert.equal(calls[0].method, "GET");
assert.equal(item.fields.title, "Normalized title");
assert.equal(item.fields.publicationTitle, "Journal of Tests");
assert.equal(item.fields.date, "2026-11-15");
assert.equal(item.creators[0].lastName, "Lovelace");
assert.equal(added.length, 1);
observer.notify("add", "item", [8]);
await new Promise((resolve) => setTimeout(resolve, 850));
assert.equal(rssItem.fields.DOI, "10.5555/rss-fixture");
assert.equal(rssItem.fields.abstractNote, "Abstract from OpenAlex");
assert.equal(added.length, 2);
unregisterItemHook();

console.log("rss-helper tests passed: Crossref lookup + item observer enrichment");
