/**
 * AI 重要文献筛选：让模型给条目分级，用彩色标签标出「重要」和「值得看看」。
 * - 支持多选条目、整个分类批量筛选；
 * - 只给重要/关注打标签，略过的不标（可在设置里打开灰色标签）；
 * - 模型可先调用工具查条目详情和库内常用标签，再下结论；
 * - 标签名可在设置页改，颜色由 Zotero.Tags.setColor 设置。
 */
import { chatEndpoint, chatWithTools, getLlmProfile, type ToolDefinition } from "./llm";
import { logEvent } from "./log";
import { enrichmentProgress } from "./progress";
import { getSetting, getTagHintCount, getTextSetting } from "./settings";
import { toast } from "./toast";

export type Level = "important" | "watch" | "skip";

/** 颜色固定，标签名从设置读，用户可以改成自己的命名。 */
export const LEVEL_COLORS: Record<Level, string> = {
  important: "#e03131",
  watch: "#f59f00",
  skip: "#868e96",
};

const LEVEL_KEYS: Level[] = ["important", "watch", "skip"];

export function levelTag(level: Level): string {
  if (level === "important") return getTextSetting("tagImportant") || "RSS/重要";
  if (level === "watch") return getTextSetting("tagWatch") || "RSS/关注";
  return getTextSetting("tagSkip") || "RSS/略过";
}

export function levelTags(): string[] {
  return LEVEL_KEYS.map((level) => levelTag(level));
}

export type ItemLike = {
  id?: number;
  libraryID: number;
  getField(field: string): unknown;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  getTags?(): unknown[];
  saveTx?(): Promise<unknown>;
};

export type ScreenContext = { tagHints: string[] };

export type TagStat = { name: string; count: number };

const tagCache = new Map<number, TagStat[]>();

let lastTagError: string | null = null;

/** 最近一次读取库内标签的错误；设置页预览为空时用来区分「读取失败」和「还没有标签」。 */
export function getLastTagError(): string | null {
  return lastTagError;
}

/**
 * 取库内使用频次最高的标签。用途是让模型据此推断用户的研究领域（写进系统提示词），
 * 而不是把标签原样丢回去当筛选结果。
 */
export async function fetchLibraryTagStats(
  libraryID: number,
  limit = getTagHintCount(),
  refresh = false,
): Promise<TagStat[]> {
  const cached = refresh ? undefined : tagCache.get(libraryID);
  if (cached) return cached;
  const db = (Zotero as unknown as { DB?: { queryAsync(sql: string, params: unknown[]): Promise<unknown[]> } }).DB;
  if (!db?.queryAsync) {
    lastTagError = "Zotero.DB 不可用";
    return [];
  }
  try {
    // 注：tags 表没有 libraryID 列（Zotero 的标签按条目关联），库归属要 join items 判断。
    // 以 "/" 开头的是 Zotero 的内部标签（如 /unread），不作为研究领域线索。
    const rows = (await db.queryAsync(
      "SELECT t.name AS name, COUNT(DISTINCT it.itemID) AS n " +
        "FROM itemTags it JOIN tags t ON t.tagID = it.tagID JOIN items i ON i.itemID = it.itemID " +
        "WHERE i.libraryID = ? AND t.name NOT LIKE '/%' GROUP BY t.name ORDER BY n DESC LIMIT ?",
      [libraryID, limit],
    )) as Array<{ name?: unknown; n?: unknown }>;
    const stats = rows
      .map((row) => ({ name: String(row?.name ?? "").trim(), count: Number(row?.n) || 0 }))
      .filter((stat) => stat.name);
    lastTagError = null;
    tagCache.set(libraryID, stats);
    return stats;
  } catch (error) {
    lastTagError = String(error);
    logEvent("tags", `failed to read library ${libraryID} tags: ${String(error)}`);
    return [];
  }
}

/** 研究领域线索永远取「我的文库」的标签，而不是当前 RSS 订阅所在的库。 */
export function tagHintLibraryID(): number {
  return Number((Zotero as unknown as { Libraries?: { userLibraryID?: number } }).Libraries?.userLibraryID) || 1;
}

export async function fetchLibraryTags(libraryID: number, limit = getTagHintCount()): Promise<string[]> {
  return (await fetchLibraryTagStats(libraryID, limit)).map((stat) => stat.name);
}

function buildSystemPrompt(tagHints: string[] = []): string {
  const custom = getTextSetting("customPrompt");
  const lines = [
    "你是科研文献筛选助手，替研究者从 RSS 推送里挑出真正值得读的论文。",
    "",
    "研究者的领域与偏好（这段由用户自定义，优先级最高）：",
    custom,
  ];
  if (tagHints.length) {
    lines.push(
      "",
      "用户文献库里使用频次最高的标签（用来佐证/补全用户的研究领域；与上面的自述冲突时以自述为准）：",
      tagHints.join("、"),
    );
  }
  lines.push(
    "",
    "分级：",
    "- important：方法与问题都切中偏好，或提出新理论/新方法，值得精读并跟进；",
    "- watch：主题相关但创新有限，或方法可借鉴，值得收藏备查；",
    "- skip：与偏好无关、纯综述/征稿/会议通知/书评/新闻稿，或信息不足以判断。",
    "",
    "如果标题和摘要不足以判断，可以先调用 get_item_details 获取条目完整信息；",
    "如果需要核对库内标签，可以调用 get_library_tags。不要为了凑数调用工具。",
    "",
    '只返回一个 JSON 对象，不要输出其他文本：{"level":"important|watch|skip","score":1-5,"reason":"不超过40字的中文理由","topic":"主题关键词","suggestedTag":"可选，必须是库内常用标签之一"}',
  );
  return lines.join("\n");
}

function buildUserPrompt(item: ItemLike, context?: ScreenContext): string {
  const title = String(item.getField("title") ?? "").trim();
  const abstract = String(item.getField("abstractNote") ?? "");
  const journal = String(item.getField("publicationTitle") ?? "");
  const date = String(item.getField("date") ?? "");
  const doi = String(item.getField("DOI") ?? "");
  const lines = [
    "请给这篇论文分级。",
    "",
    `标题：${title}`,
    `期刊：${journal}`,
    `日期：${date}`,
    doi ? `DOI：${doi}` : "",
    `摘要：${abstract ? abstract.slice(0, 2500) : "（RSS 未提供摘要，可以调用 get_item_details 获取）"}`,
  ].filter(Boolean);
  if (getSetting("useLibraryTags") && context?.tagHints?.length) {
    lines.push("", "suggestedTag 只能从系统提示词里的库内标签中选，没有合适的不填。");
  }
  return lines.join("\n");
}

function normalizeLevel(value: unknown): Level | null {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("important") || text.includes("高")) return "important";
  if (text.includes("watch") || text.includes("中")) return "watch";
  if (text.includes("skip") || text.includes("低")) return "skip";
  return null;
}

async function colorize(libraryID: number, tag: string, color: string): Promise<void> {
  try {
    await (Zotero.Tags as unknown as { setColor(libraryID: number, name: string, color: string): Promise<unknown> }).setColor(
      libraryID,
      tag,
      color,
    );
  } catch (error) {
    logEvent("tags", `failed to color tag ${tag}: ${String(error)}`);
  }
}

async function applyLevel(item: ItemLike, level: Level, suggestedTag?: string): Promise<void> {
  const chosen = levelTag(level);
  for (const key of LEVEL_KEYS) {
    if (key !== level) item.removeTag(levelTag(key));
  }
  item.addTag(chosen);
  if (suggestedTag && getSetting("useLibraryTags") && suggestedTag !== chosen) {
    item.addTag(suggestedTag);
  }
  await item.saveTx?.();
  await colorize(item.libraryID, chosen, LEVEL_COLORS[level]);
}

/** 略过且用户没要求标灰：清掉旧的 AI 标签，保持分类干净。 */
async function applySkip(item: ItemLike): Promise<void> {
  if (getSetting("markSkipped")) {
    await applyLevel(item, "skip");
    return;
  }
  const existing = new Set(
    (item.getTags?.() ?? []).map((tag) => String(typeof tag === "string" ? tag : (tag as { tag?: unknown })?.tag ?? "")),
  );
  let changed = false;
  for (const tag of levelTags()) {
    if (existing.has(tag)) {
      item.removeTag(tag);
      changed = true;
    }
  }
  if (changed) await item.saveTx?.();
}

function toolsFor(item: ItemLike, context: ScreenContext | undefined): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      spec: {
        name: "get_item_details",
        description: "读取当前条目的完整信息：标题、摘要全文（最多4000字）、期刊、日期、DOI、Extra、已有标签。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
      run: () => {
        const live = (Zotero.Items.get?.(item.id as number) as any) ?? item;
        const field = (name: string) => String(live.getField?.(name) ?? "");
        const tags = (live.getTags?.() ?? []).map((tag: any) => (typeof tag === "string" ? tag : tag?.tag)).filter(Boolean);
        return {
          title: field("title"),
          abstract: field("abstractNote").slice(0, 4000),
          journal: field("publicationTitle"),
          date: field("date"),
          doi: field("DOI"),
          extra: field("extra").slice(0, 2000),
          tags,
        };
      },
    },
    {
      spec: {
        name: "get_library_tags",
        description: "读取当前文献库中使用频次最高的标签，用于推荐已有标签。",
        parameters: { type: "object", properties: { limit: { type: "integer", minimum: 10, maximum: 80 } } },
      },
      run: async (args) => ({ tags: await fetchLibraryTags(tagHintLibraryID(), Number(args.limit) || getTagHintCount()) }),
    },
  ];
  if (!getSetting("useLibraryTags")) return tools.slice(0, 1);
  return tools;
}

/** 判断单个条目，返回等级；失败抛错。 */
export async function screenItem(item: ItemLike, context?: ScreenContext): Promise<Level> {
  const title = String(item.getField("title") ?? "").trim();
  if (!title) throw new Error("标题为空");
  const hints = context ?? (getSetting("useLibraryTags") ? { tagHints: await fetchLibraryTags(tagHintLibraryID()) } : { tagHints: [] });
  const answer = await chatWithTools(
    buildSystemPrompt(hints.tagHints),
    buildUserPrompt(item, hints),
    toolsFor(item, hints),
    500,
    2,
  );
  const level = normalizeLevel(answer.level);
  if (!level) throw new Error(`模型返回无法识别：${JSON.stringify(answer).slice(0, 120)}`);
  if (level === "skip") await applySkip(item);
  else await applyLevel(item, level, typeof answer.suggestedTag === "string" ? answer.suggestedTag.trim() : undefined);
  Zotero.debug(`[rss-helper] screened item ${item.id}: ${level}`);
  return level;
}

export function clearAiTags(item: ItemLike): void {
  for (const tag of levelTags()) item.removeTag(tag);
}

/** 菜单入口：多选条目批量筛选，用同一个弱进度窗刷新进度。 */
export async function screenItems(items: ItemLike[], source = "AI 筛选"): Promise<void> {
  if (!items.length) return;
  logEvent("AI", `screen start: ${items.length} item(s), source=${source}`);
  const profile = await getLlmProfile();
  if (!profile) {
    logEvent("AI", "screen aborted: no usable profile");
    toast.show("AI 未配置：插件设置里没有 Key，Zotero GPT 的 Key 也读不到，详见 rss-helper.log", "cross");
    return;
  }
  logEvent("AI", `screen profile: ${profile.source} · ${profile.model} @ ${chatEndpoint(profile.baseUrl)}`);
  const tagHints = getSetting("useLibraryTags") ? await fetchLibraryTags(tagHintLibraryID()) : [];
  const counts: Record<Level, number> = { important: 0, watch: 0, skip: 0 };
  let failed = 0;
  let firstError = "";
  enrichmentProgress.begin(`RSS Helper · ${source}`, "筛选");
  for (const item of items) {
    const id = item.id ?? 0;
    if (id) enrichmentProgress.start(id, String(item.getField("title") ?? "未命名条目"));
    try {
      counts[await screenItem(item, { tagHints })] += 1;
      if (id) enrichmentProgress.succeed(id);
    } catch (error) {
      failed += 1;
      if (!firstError) firstError = String(error);
      if (id) enrichmentProgress.fail(id);
      logEvent("AI", `screen failed for item ${item.id}: ${String(error)}`);
    }
  }
  const parts = [`重要 ${counts.important}`, `关注 ${counts.watch}`, `略过 ${counts.skip}`];
  if (failed) parts.push(`失败 ${failed}`);
  const summary = failed && firstError ? `${parts.join(" · ")}；首个错误：${firstError.slice(0, 160)}` : parts.join(" · ");
  enrichmentProgress.summarize(summary, failed ? "failed" : "success");
}

type CollectionLike = {
  name?: string;
  loadAllData?(): Promise<unknown>;
  getChildItems?(asIDs?: boolean, includeTrashed?: boolean): unknown[];
};

/** 分类右键入口：筛一个期刊/专题下的全部条目。 */
export async function screenCollection(collection: CollectionLike, source = "AI 筛选分类"): Promise<void> {
  try {
    await collection.loadAllData?.();
  } catch (error) {
    logEvent("AI", `failed to load collection items: ${String(error)}`);
  }
  const raw = (collection.getChildItems?.(false, false) ?? []) as ItemLike[];
  const items = raw.filter((item) => item && typeof item.getField === "function");
  if (!items.length) {
    toast.show("这个分类里没有可筛选的条目", "cross");
    return;
  }
  const label = collection.name ? `${source}：${collection.name}` : source;
  await screenItems(items, label);
}

/** RSS 订阅右键入口：一个订阅就是一个 feed library，条目存在该库里。 */
export async function screenFeed(libraryID: number, source = "AI 筛选 RSS 订阅"): Promise<void> {
  let raw: unknown[] = [];
  try {
    raw = (await (Zotero.Items as unknown as { getAll(libraryID: number, onlyTopLevel?: boolean): Promise<unknown[]> }).getAll(
      libraryID,
      true,
    )) as unknown[];
  } catch (error) {
    logEvent("AI", `failed to load feed items: ${String(error)}`);
  }
  const items = raw.filter((item): item is ItemLike => !!item && typeof (item as ItemLike).getField === "function");
  if (!items.length) {
    toast.show("这个 RSS 订阅里没有可筛选的条目", "cross");
    return;
  }
  await screenItems(items, source);
}

/** 测试用标签：灰蓝色，用来确认右键菜单、打标签、设色这条链路是通的。 */
export const TEST_TAG = "rss/test";
export const TEST_TAG_COLOR = "#5c7c9a";

export async function applyTestTag(items: ItemLike[], source = "测试"): Promise<void> {
  const targets = items.filter((item) => item && typeof item.addTag === "function");
  if (!targets.length) {
    toast.show("请先选择条目", "cross");
    return;
  }
  let tagged = 0;
  for (const item of targets) {
    try {
      item.addTag(TEST_TAG);
      await item.saveTx?.();
      tagged += 1;
    } catch (error) {
      Zotero.debug(`[rss-helper] test tag failed for item ${item.id}: ${String(error)}`);
    }
  }
  if (!tagged) {
    toast.show("打标签失败，请看调试日志", "cross");
    return;
  }
  await colorize(targets[0].libraryID, TEST_TAG, TEST_TAG_COLOR);
  toast.show(`${source}：${tagged} 项已打上 ${TEST_TAG}`, "tick");
}
