#!/usr/bin/env node
/**
 * 本地 RSS 服务：把一封 Google 学术快讯邮件实时转成 RSS 2.0。
 *
 * Zotero 的订阅只接受 http/https 地址，不能直接订阅 file://，所以这里起一个
 * 只监听本机的小服务。运行：
 *   node scripts/serve-rss.mjs ["邮件.eml"] [端口]
 * 然后在 Zotero：文件 → 新建文库 → 新建订阅，URL 填：
 *   http://127.0.0.1:8787/gs-alert.rss
 * 或者直接导入：http://127.0.0.1:8787/feeds.opml
 *
 * 换了新的快讯邮件后，把邮件覆盖保存成同一个路径即可，服务每次请求都会重新解析。
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRss, parseAlertEmail } from "./eml-to-rss.mjs";

const EML = resolve(process.argv[2] || "LLM recommendation - 新的结果.eml");
const PORT = Number(process.argv[3] || 8787);
const FEED_URL = `http://127.0.0.1:${PORT}/gs-alert.rss`;
const TITLE = "Google 学术快讯 · LLM recommendation";

function readFeed() {
  return buildRss(parseAlertEmail(readFileSync(EML, "utf8")));
}

function opml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0"><head><title>RSS Helper feeds</title></head><body>',
    `  <outline type="rss" text="${TITLE}" title="${TITLE}" xmlUrl="${FEED_URL}"/>`,
    "</body></opml>",
    "",
  ].join("\n");
}

const server = createServer((request, response) => {
  const url = request.url ?? "/";
  try {
    if (url.startsWith("/gs-alert.rss")) {
      const xml = readFeed();
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "no-store" });
      response.end(xml);
      console.log(`[serve-rss] ${new Date().toISOString()} RSS ${xml.length} bytes`);
      return;
    }
    if (url.startsWith("/feeds.opml")) {
      response.writeHead(200, { "content-type": "text/x-opml; charset=utf-8" });
      response.end(opml());
      console.log(`[serve-rss] ${new Date().toISOString()} OPML`);
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end([`RSS: ${FEED_URL}`, `OPML: http://127.0.0.1:${PORT}/feeds.opml`, ""].join("\n"));
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(`解析邮件失败：${String(error)}`);
    console.log(`[serve-rss] error: ${String(error)}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[serve-rss] 监听 http://127.0.0.1:${PORT}`);
  console.log(`[serve-rss] 邮件: ${EML}`);
  console.log(`[serve-rss] Zotero 订阅地址: ${FEED_URL}`);
  console.log("[serve-rss] 用完按 Ctrl+C 停止；Zotero 已抓到的条目会留在本地。");
});
