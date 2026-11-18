/**
 * 插件设置项的唯一来源：默认值、读取、写入都在这里。
 * 新增设置时在 SETTINGS 上加一项，再在 content/preferences.xhtml 里放一个带 preference 属性的控件即可。
 */
export const SETTINGS = {
  autoEnrich: true,
  fetchAttachments: false,
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValues = { [K in SettingKey]: boolean };

/** 插件自己的 pref 分支。Zotero.Prefs 会自动补 extensions.zotero. 前缀。 */
export const PREF_BRANCH = "extensions.rss-helper.";
/** 设置页的 preference 属性要写完整键名（Zotero 用 global=true 读取）。 */
export const FULL_PREF_PREFIX = `extensions.zotero.${PREF_BRANCH}`;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

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

/** 首次启动时把默认值写进 prefs，否则设置页的勾选框读不到值会显示成未勾选。 */
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
}
