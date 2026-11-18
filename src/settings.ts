/**
 * 插件设置项的唯一来源：默认值、读取、写入都在这里。
 * 新增布尔项时在 SETTINGS 上加一项，再在 content/preferences.xhtml 里放一个带 preference 属性的 checkbox；
 * 新增文本项时加到 TEXT_SETTINGS。
 */
export const SETTINGS = {
  autoEnrich: true,
  autoTranslate: false,
  autoScreen: false,
  markSkipped: false,
  useLibraryTags: true,
} as const;

const DEFAULT_CUSTOM_PROMPT = [
  "我研究管理科学与工程（请改成你自己的方向，可写多个）：",
  "1. 供应链与运营管理：库存、定价、风险传染、采购契约；",
  "2. 平台经济与算法治理：推荐系统、算法定价、监管与合规；",
  "3. 能源与环境政策：碳市场、绿色供应链、ESG。",
  "偏好有实证识别（DID、IV、RDD、实验）或优化建模的文章；",
  "不关心纯综述、征稿启事、会议通知、书评和无摘要的新闻稿。",
].join("\n");

export const TEXT_SETTINGS = {
  llmBaseUrl: "https://api.siliconflow.cn/v1",
  llmModel: "Qwen/Qwen3-8B",
  customPrompt: DEFAULT_CUSTOM_PROMPT,
  tagImportant: "RSS/重要",
  tagWatch: "RSS/关注",
  tagSkip: "RSS/略过",
  tagHintCount: "40",
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValues = { [K in SettingKey]: boolean };
export type TextSettingKey = keyof typeof TEXT_SETTINGS;

/** 插件自己的 pref 分支。Zotero.Prefs 会自动补 extensions.zotero. 前缀。 */
export const PREF_BRANCH = "extensions.rss-helper.";
/** 设置页的 preference 属性要写完整键名（Zotero 用 global=true 读取）。 */
export const FULL_PREF_PREFIX = `extensions.zotero.${PREF_BRANCH}`;

/** API Key 不以明文进 prefs：用 Zotero.OSKeyStore 加密后存这个键。 */
export const API_KEY_PREF = "apiKeyEnc";

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const TEXT_SETTING_KEYS = Object.keys(TEXT_SETTINGS) as TextSettingKey[];

export function getSetting<K extends SettingKey>(key: K): SettingValues[K] {
  const fallback = SETTINGS[key] as SettingValues[K];
  try {
    const value = Zotero.Prefs.get(PREF_BRANCH + key) as unknown;
    return typeof value === typeof fallback ? (value as SettingValues[K]) : fallback;
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to read pref ${PREF_BRANCH}${key}: ${String(error)}`);
    return fallback;
  }
}

export function setSetting<K extends SettingKey>(key: K, value: SettingValues[K]): void {
  try {
    Zotero.Prefs.set(PREF_BRANCH + key, value);
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to write pref ${PREF_BRANCH}${key}: ${String(error)}`);
  }
}

export function getTextSetting<K extends TextSettingKey>(key: K): string {
  const fallback = TEXT_SETTINGS[key];
  try {
    const value = Zotero.Prefs.get(PREF_BRANCH + key) as unknown;
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to read pref ${PREF_BRANCH}${key}: ${String(error)}`);
    return fallback;
  }
}

export function setTextSetting<K extends TextSettingKey>(key: K, value: string): void {
  try {
    Zotero.Prefs.set(PREF_BRANCH + key, value.trim());
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to write pref ${PREF_BRANCH}${key}: ${String(error)}`);
  }
}

/** 写进提示词的库内标签数量：用户可以在设置页预览后自己定，限制 5–120。 */
export function getTagHintCount(): number {
  const parsed = Number.parseInt(getTextSetting("tagHintCount"), 10);
  if (!Number.isFinite(parsed)) return 40;
  return Math.min(120, Math.max(5, parsed));
}

export function getRawPref(key: string): unknown {
  try {
    return Zotero.Prefs.get(PREF_BRANCH + key);
  } catch {
    return undefined;
  }
}

/**
 * 读取插件分支之外的完整 pref 键（例如从 Zotero GPT 插件读配置）。
 * 必须传 global=true：Zotero.Prefs.get(key) 默认会补 extensions.zotero. 前缀，
 * 之前漏了这个参数，导致读 Zotero GPT 的配置永远是 undefined。
 */
export function getAbsolutePref(key: string): unknown {
  try {
    return (Zotero.Prefs.get as unknown as (pref: string, global?: boolean) => unknown)(key, true);
  } catch {
    return undefined;
  }
}

export function setRawPref(key: string, value: string | number | boolean): void {
  try {
    Zotero.Prefs.set(PREF_BRANCH + key, value);
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to write pref ${PREF_BRANCH}${key}: ${String(error)}`);
  }
}

/** 首次启动时把默认值写进 prefs，否则设置页的控件读不到值。 */
export function ensureDefaults(): void {
  for (const key of SETTING_KEYS) {
    try {
      if (typeof Zotero.Prefs.get(PREF_BRANCH + key) !== "boolean") {
        setSetting(key, SETTINGS[key] as SettingValues[typeof key]);
      }
    } catch (error) {
      Zotero.debug(`[rss-helper] failed to initialize pref ${PREF_BRANCH}${key}: ${String(error)}`);
    }
  }
  for (const key of TEXT_SETTING_KEYS) {
    try {
      const value = Zotero.Prefs.get(PREF_BRANCH + key) as unknown;
      if (typeof value !== "string") setTextSetting(key, TEXT_SETTINGS[key]);
    } catch (error) {
      Zotero.debug(`[rss-helper] failed to initialize pref ${PREF_BRANCH}${key}: ${String(error)}`);
    }
  }
}
