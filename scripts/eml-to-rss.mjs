#!/usr/bin/env node
/**
 * 把 Google 学术快讯（"新的结果" 提醒邮件）转成 RSS 2.0。
 *
 * 用法：
 *   node scripts/eml-to-rss.mjs "LLM recommendation - 新的结果.eml" dist/gs-alert.rss
 *
 * 邮件是 quoted-printable 编码的 HTML，每篇文献一条
 * <a class="gse_alrt_title">，后面跟作者/期刊行和摘要片段。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_IN = "LLM recommendation - 新的结果.eml";
const DEFAULT_OUT = "dist/gs-alert.rss";

function decodeQuotedPrintable(text) {
  const binary = text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(binary, "binary").toString("utf8");
}

function decodeHeader(value) {
  return value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => Buffer.from(b64, "base64").toString("utf8"));
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 邮件里的标题链接是 scholar_url?url=<出版商地址>，把它还原出来。 */
function publisherUrl(href) {
  const decoded = href.replace(/&amp;/g, "&");
  const match = decoded.match(/[?&]url=([^&]+)/);
  if (!match) return decoded;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return decoded;
  }
}

/** RFC 822 时间（RSS 2.0 日期格式）。 */
function rfc822(date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

export function parseAlertEmail(raw) {
  const split = raw.includes("\r\n\r\n") ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
  if (split < 0) throw new Error("eml 里找不到邮件头与正文的分隔");
  const headers = raw.slice(0, split);
  const body = raw.slice(split).replace(/^\r?\n\r?\n/, "");
  const header = (name) => {
    const match = headers.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
    return match ? decodeHeader(match[1].trim()) : "";
  };
  const html = decodeQuotedPrintable(body);
  const date = new Date(header("Date") || Date.now());
  const items = [];
  const pattern = /<a\s+href="([^"]+)"\s+class="gse_alrt_title"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const title = stripTags(match[2]);
    if (!title) continue;
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 2000);
    const meta = tail.match(/<div style="color:#006621[^"]*">([\s\S]*?)<\/div>/);
    const snippet = tail.match(/<div class="gse_alrt_sni"[^>]*>([\s\S]*?)<\/div>/);
    const source = publisherUrl(href);
    items.push({
      title,
      link: source,
      meta: meta ? stripTags(meta[1]) : "",
      snippet: snippet ? stripTags(snippet[1]).replace(/^…\s*/, "") : "",
    });
  }
  const seen = new Set();
  return {
    title: header("Subject") || "Google 学术快讯",
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    items: items.filter((item) => (seen.has(item.title) ? false : seen.add(item.title))),
  };
}

export function buildRss(alert) {
  const entries = alert.items.map((item) => {
    const description = [item.meta, item.snippet].filter(Boolean).join("\n\n");
    return [
      "  <item>",
      `    <title>${escapeXml(item.title)}</title>`,
      `    <link>${escapeXml(item.link)}</link>`,
      `    <guid isPermaLink="false">${escapeXml(item.link)}</guid>`,
      `    <pubDate>${rfc822(alert.date)}</pubDate>`,
      `    <description>${escapeXml(description)}</description>`,
      "  </item>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel>',
    `  <title>${escapeXml(alert.title)}</title>`,
    "  <link>https://scholar.google.com/</link>",
    "  <description>Converted from a Google Scholar alert email by RSS Helper</description>",
    "  <language>zh-CN</language>",
    `  <lastBuildDate>${rfc822(alert.date)}</lastBuildDate>`,
    ...entries,
    "</channel></rss>",
    "",
  ].join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const input = process.argv[2] || DEFAULT_IN;
  const output = process.argv[3] || DEFAULT_OUT;
  const alert = parseAlertEmail(readFileSync(resolve(input), "utf8"));
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), buildRss(alert), "utf8");
  console.log(`eml-to-rss: ${alert.items.length} item(s) -> ${output}`);
}
