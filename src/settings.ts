/**
 * 插件设置项的唯一来源：默认值、读取、写入都在这里。
 * 新增布尔项时在 SETTINGS 上加一项，再在 content/preferences.xhtml 里放一个带 preference 属性的 checkbox；
 * 新增文本项时加到 TEXT_SETTINGS。
 */
export const SETTINGS = {
  autoEnrich: true,
  fetchAttachments: false,
  autoTranslate: false,
  autoScreen: false,
} as const;

export const TEXT_SETTINGS = {
  llmBaseUrl: "https://api.siliconflow.cn/v1",
  llmModel: "Qwen/Qwen3-8B",
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

export function getRawPref(key: string): unknown {
  try {
    return Zotero.Prefs.get(PREF_BRANCH + key);
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
