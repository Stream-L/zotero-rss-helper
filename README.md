# Zotero RSS Helper

Zotero RSS Helper improves the way paper RSS entries become Zotero items.

## 解决的问题 | Problem

Zotero 的 RSS 默认导入无法可靠地把 RSS 条目匹配到论文元数据。常见结果是：

- RSS 条目没有被识别为对应的论文；
- 元数据被错误填入，或者 RSS 原文被直接塞进 `description`；
- DOI、作者、期刊、日期等字段缺失，后续整理成本很高。

Zotero's default RSS import does not reliably match an RSS entry to its paper metadata. It may fill fields with incorrect values, put the RSS feed text directly into `description`, or leave DOI, authors, journal, and date empty.

## 解决方式 | How it works

RSS 条目新增或修改时，插件会：

- 从 URL、DOI、标题、摘要描述和 Extra 中识别 DOI；
- 通过 Crossref 补全 DOI、标题、作者、期刊、日期、URL、出版社和摘要；
- 没有 DOI 时，使用标题向 Crossref 查询；
- Crossref 没有摘要时，尝试使用 OpenAlex 补全摘要；
- 找不到结果或请求失败时，保留 RSS 条目的原始数据，不覆盖原内容。

When an RSS item is added or changed, the plugin:

- detects a DOI in the URL, DOI field, title, description, or Extra field;
- fills DOI, title, authors, journal, date, URL, publisher, and abstract from Crossref;
- searches Crossref by title when no DOI is present;
- tries OpenAlex when Crossref has no abstract;
- keeps the original RSS data when matching or network requests fail.

## 要求 | Requirements

- 建议Zotero 10.0 或更高版本 | Zotero 10.0 or later
- 可访问 Crossref；摘要回退还需要访问 OpenAlex | Network access to Crossref, and OpenAlex for abstract fallback

## 安装 | Install

1. 下载最新的 `zotero-rss-helper-*.xpi`。
2. 在 Zotero 中打开 **工具 > 附加组件**。
3. 打开齿轮菜单，选择 **从文件安装附加组件...**，然后选择 XPI 文件。
4. 按提示重启 Zotero。
5. Download the latest `zotero-rss-helper-*.xpi` release.
6. Open **Tools > Add-ons** in Zotero.
7. Open the gear menu, choose **Install Add-on From File...**, and select the XPI.
8. Restart Zotero if prompted.

安装后，插件会自动处理新增或修改的 RSS 条目，不需要 API key 或账号。批量补全时，右下角只保留一个进度提示窗，标题栏显示完成数量，全部结束后自动关闭。

After installation, the plugin works automatically for new and modified RSS items. No API key or account is required. A batch shares a single progress window in the lower-right corner; the headline counts finished items and the window closes itself when the batch is done.

## 设置 | Settings

**工具 > 设置 > RSS Helper**：

- **自动补全 RSS 条目元数据**：关闭后新条目只保留 RSS 原始数据（默认开启）；
- **补全成功后尝试下载可用的 PDF**：通过 DOI、URL、开放获取渠道查找附件（默认关闭）；
- **补全元数据后自动翻译标题和摘要**：复用本机 Translate for Zotero 插件，译文写进 Extra 的 `titleTranslation` / `abstractTranslation`（默认关闭）；
- **补全元数据后自动判断重要性**：调用大模型给条目分级并打彩色标签（默认关闭）；
- **接口地址 / 模型名称 / API Key**：任何 OpenAI 兼容的 `/chat/completions` 服务；API Key 用 `Zotero.OSKeyStore` 加密后保存，不落明文。

Settings live under **Tools > Settings > RSS Helper**: auto-enrichment, optional PDF lookup, auto-translation through Translate for Zotero, and optional AI importance screening with an OpenAI-compatible endpoint. The API key is encrypted with the OS key store before being written to preferences.

## 右键菜单 | Context menu

选中条目后右键 **RSS Helper** 子菜单：

- **补全元数据**：对选中的 RSS 条目立即执行 Crossref 补全；
- **翻译标题和摘要**：调用 Translate for Zotero 翻译并写入 Extra；
- **AI 判断重要性**：调用大模型分级，打上 `RSS/重要`（红）、`RSS/关注`（黄）、`RSS/略过`（灰）标签；
- **清除 AI 标记**：移除上述三个标签，不影响其他标签。

Select items and use the **RSS Helper** submenu: enrich, translate, screen with AI (colored tags), or clear AI tags.

## 后续计划 | Roadmap

后续可能增加更精确的来源识别和可选翻译支持，范围会保持克制。

Future releases may add more feed-specific recognition and optional translation support while keeping the workflow small.

## License

MIT
