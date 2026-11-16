import assert from "node:assert/strict";

const doi = "10.1038/s41586-020-2649-2";
const text = `https://doi.org/${doi}.`;
assert.equal(text.match(/10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0].replace(/[.,;:)]+$/, "").toLowerCase(), doi);
console.log("rss-helper checks passed");
