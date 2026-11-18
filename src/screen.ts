/**
 * AI 重要文献筛选：让模型给 RSS 条目分级，用彩色标签标出来。
 * 标签颜色通过 Zotero.Tags.setColor(libraryID, tag, color) 设置。
 */
import { chatJSON, hasApiKey } from "./llm";
import { toast } from "./toast";

export const LEVELS = {
  important: { tag: "RSS/重要", color: "#e03131", icon: "tick" },
  watch: { tag: "RSS/关注", color: "#f59f00", icon: "feed" },
  skip: { tag: "RSS/略过", color: "#868e96", icon: "minus-circle" },
} as const;

export type Level = keyof typeof LEVELS;

const LEVEL_KEYS: Level[] = ["important", "watch", "skip"];

const SYSTEM_PROMPT =
  "你是科研文献筛选助手。判断一篇 RSS 推送的论文对一位管理科学与工程方向研究者的重要性。" +
  "只返回 JSON 对象，不要输出其他文本。";

function userPrompt(title: string, abstract: string, journal: string, date: string): string {
  return [
    "请给这篇论文分级。",
    "",
    "分级标准：",
    "- important：提出新理论/新方法，或与供应链、能源、平台经济、算法治理等主题高度相关，值得精读；",
    "- watch：主题相关但创新有限，或方法可借鉴，值得收藏；",
    "- skip：与研究方向无关、纯综述广告、征稿启事、会议通知等。",
    "",
    "返回格式：{\"level\":\"important|watch|skip\",\"score\":1-5,\"reason\":\"不超过40字的中文理由\",\"topic\":\"主题关键词\"}",
    "",
    `标题：${title}`,
    `期刊：${journal}`,
    `日期：${date}`,
    `摘要：${abstract.slice(0, 2500)}`,
  ].join("\n");
}

type ItemLike = {
  id?: number;
  libraryID: number;
  getField(field: string): unknown;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  saveTx?(): Promise<unknown>;
};

function normalizeLevel(value: unknown): Level | null {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("important") || text.includes("高")) return "important";
  if (text.includes("watch") || text.includes("中")) return "watch";
  if (text.includes("skip") || text.includes("低")) return "skip";
  return null;
}

async function applyLevel(item: ItemLike, level: Level): Promise<void> {
  for (const key of LEVEL_KEYS) {
    const tag = LEVELS[key].tag;
    if (key !== level) item.removeTag(tag);
  }
  item.addTag(LEVELS[level].tag);
  await item.saveTx?.();
  try {
    await (Zotero.Tags as unknown as { setColor(libraryID: number, name: string, color: string): Promise<unknown> }).setColor(
      item.libraryID,
      LEVELS[level].tag,
      LEVELS[level].color,
    );
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to color tag ${LEVELS[level].tag}: ${String(error)}`);
  }
}

/** 判断单个条目，返回等级；失败抛错。 */
export async function screenItem(item: ItemLike): Promise<Level> {
  const title = String(item.getField("title") ?? "").trim();
  if (!title) throw new Error("标题为空");
  const abstract = String(item.getField("abstractNote") ?? "");
  const journal = String(item.getField("publicationTitle") ?? "");
  const date = String(item.getField("date") ?? "");
  const answer = await chatJSON(SYSTEM_PROMPT, userPrompt(title, abstract, journal, date), 400);
  const level = normalizeLevel(answer.level);
  if (!level) throw new Error(`模型返回无法识别：${JSON.stringify(answer).slice(0, 120)}`);
  await applyLevel(item, level);
  Zotero.debug(`[rss-helper] screened item ${item.id}: ${level}`);
  return level;
}

export function clearAiTags(item: ItemLike): void {
  for (const key of LEVEL_KEYS) item.removeTag(LEVELS[key].tag);
}

/** 菜单/自动流程入口：一次弱提示汇报整体结果。 */
export async function screenItems(items: ItemLike[], source = "AI 筛选"): Promise<void> {
  if (!(await hasApiKey())) {
    toast.show("请先在设置页保存 API Key", "cross");
    return;
  }
  if (!items.length) return;
  toast.show(`${source}中…`, "feed-updating");
  const counts: Record<Level, number> = { important: 0, watch: 0, skip: 0 };
  let failed = 0;
  for (const item of items) {
    try {
      counts[await screenItem(item)] += 1;
    } catch (error) {
      failed += 1;
      Zotero.debug(`[rss-helper] screen failed for item ${item.id}: ${String(error)}`);
    }
  }
  const parts = [`重要 ${counts.important}`, `关注 ${counts.watch}`, `略过 ${counts.skip}`];
  if (failed) parts.push(`失败 ${failed}`);
  toast.show(parts.join(" · "), failed ? "cross" : "tick");
}
