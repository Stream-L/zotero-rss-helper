import { chatJSON, getLlmProfile, saveApiKey } from "./llm";
import { fetchLibraryTagStats } from "./screen";
import { ensureDefaults, setTextSetting } from "./settings";

export const PLUGIN_ID = "zotero-rss-helper@github.com";

type PrefsDocument = {
  getElementById(id: string): Element | null;
};

type ElementLike = {
  textContent?: string | null;
  value?: string;
  hidden?: boolean;
};

function resolveDocument(target: unknown): PrefsDocument | undefined {
  if (!target || typeof target !== "object") return undefined;
  const candidate = target as { getElementById?: unknown; ownerDocument?: unknown; document?: unknown };
  if (typeof candidate.getElementById === "function") return candidate as PrefsDocument;
  if (candidate.ownerDocument) return resolveDocument(candidate.ownerDocument);
  if (candidate.document) return resolveDocument(candidate.document);
  return undefined;
}

async function refreshKeyStatus(doc: PrefsDocument): Promise<void> {
  const status = doc.getElementById("rss-helper-apiKey-status") as unknown as ElementLike | null;
  if (!status) return;
  status.textContent = await describeProfile();
}

/** 设置页的状态文案：优先说明是否复用了 Zotero GPT 的配置。 */
async function describeProfile(): Promise<string> {
  const profile = await getLlmProfile();
  if (!profile) return "未保存";
  if (profile.source === "zoterogpt") return `未保存；将使用 Zotero GPT 的配置（${profile.model}）`;
  return "已保存（系统钥匙串加密）";
}

/**
 * 设置页的勾选框/输入框由 Zotero 的 preference 属性自动双向绑定（见 preferences.js 的 attachToPreference），
 * 这里只负责加载时补齐默认值、写入版本号、刷新 API Key 状态。
 */
export function onPrefsLoad(target: unknown): void {
  ensureDefaults();
  const doc = resolveDocument(target);
  if (!doc) return;
  const version = doc.getElementById("rss-helper-version");
  const plugin = (Zotero as unknown as { RSSHelper?: { version?: string } }).RSSHelper;
  if (version) version.textContent = plugin?.version ? `RSS Helper v${plugin.version}` : "RSS Helper";
  void refreshKeyStatus(doc);
  Zotero.debug("[rss-helper] preferences pane loaded");
}

/** 设置页上的按钮命令入口（oncommand 属性指向这里）。 */
export async function onPrefsCommand(target: unknown): Promise<void> {
  const doc = resolveDocument(target);
  if (!doc) return;
  const input = doc.getElementById("rss-helper-apiKey") as unknown as ElementLike | null;
  const status = doc.getElementById("rss-helper-apiKey-status") as unknown as ElementLike | null;
  const value = input?.value ?? "";
  if (status) status.textContent = "保存中…";
  const ok = await saveApiKey(value);
  if (input) input.value = "";
  if (status) status.textContent = ok ? (value.trim() ? "已保存（系统钥匙串加密）" : await describeProfile()) : "保存失败：系统钥匙串不可用";
}

/** 让模型根据文献库里常用的主题标签，归纳出用户的研究领域，直接写进自定义提示词。 */
const GENERATE_SYSTEM = [
  "你是研究兴趣分析助手。根据用户文献库里使用频次较高的标签，归纳出 2-4 个具体的研究领域和偏好。",
  "要求：",
  "- 只输出一个 JSON 对象：{\"profile\":\"多行中文文本\"}；",
  "- 不要罗列全部标签，也不要编造具体论文；",
  "- 每个领域单独一行，格式如「1. 供应链与运营管理：库存控制、定价、风险传染」；",
  "- 最后一行写方法偏好与不关心的内容，例如「偏好实证识别或优化建模；不关心纯综述和会议通知」；",
  "- 标签有同义重复时自行归并，不要照抄。",
].join("\n");

export async function onPrefsGeneratePrompt(target: unknown): Promise<void> {
  const doc = resolveDocument(target);
  if (!doc) return;
  const status = doc.getElementById("rss-helper-prompt-status") as unknown as ElementLike | null;
  const textarea = doc.getElementById("rss-helper-customPrompt") as unknown as ElementLike | null;
  if (status) status.textContent = "正在根据库内标签归纳…";
  const libraries = (Zotero as unknown as { Libraries?: { userLibraryID?: number } }).Libraries;
  const libraryID = Number(libraries?.userLibraryID ?? 1);
  const stats = await fetchLibraryTagStats(libraryID, 80, true);
  if (!stats.length) {
    if (status) status.textContent = "库里还没有标签：先给文献打一些主题标签，或手动填写上面的领域描述";
    return;
  }
  try {
    const answer = await chatJSON(
      GENERATE_SYSTEM,
      `标签（格式为 标签名(条目数)）：${stats.map((stat) => `${stat.name}(${stat.count})`).join("、")}`,
      700,
    );
    const profile = String(answer.profile ?? "").trim();
    if (!profile) throw new Error("模型没有返回 profile 字段");
    setTextSetting("customPrompt", profile);
    if (textarea) textarea.value = profile;
    if (status) status.textContent = "已写入上面的领域描述，可继续手动修改";
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to generate domain prompt: ${String(error)}`);
    if (status) status.textContent = `生成失败：${String(error).slice(0, 80)}`;
  }
}

/**
 * 注册设置页。必须等 Zotero 初始化/解锁/界面就绪之后，否则面板列表里不会出现。
 */
export async function registerPreferencePane(rootURI: string): Promise<void> {
  const panes = (Zotero as unknown as { PreferencePanes?: { register(options: unknown): Promise<unknown> } }).PreferencePanes;
  if (!panes?.register) {
    Zotero.debug("[rss-helper] Zotero.PreferencePanes is unavailable; skipping settings pane");
    return;
  }
  await Promise.all([
    Zotero.initializationPromise,
    (Zotero as unknown as { unlockPromise?: Promise<unknown> }).unlockPromise ?? Promise.resolve(),
    (Zotero as unknown as { uiReadyPromise?: Promise<unknown> }).uiReadyPromise ?? Promise.resolve(),
  ]);
  await panes.register({
    pluginID: PLUGIN_ID,
    src: `${rootURI}content/preferences.xhtml`,
    label: "RSS Helper",
    image: `${rootURI}content/icons/rss-helper.svg`,
  });
  Zotero.debug(`[rss-helper] preference pane registered from ${rootURI}content/preferences.xhtml`);
}
