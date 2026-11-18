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

安装后，插件会自动处理新入库的 RSS 条目，不需要 API key 或账号。批量补全时，右下角只保留一个进度提示窗，标题栏显示完成数量，全部结束后自动关闭。

After installation, the plugin works automatically for newly added RSS items. No API key or account is required. A batch shares a single progress window in the lower-right corner; the headline counts finished items and the window closes itself when the batch is done.

## 设置 | Settings

**工具 > 设置 > RSS Helper**：

- **自动补全 RSS 条目元数据**：只处理新入库的 RSS 条目；点击条目、转存文库不会再触发重查，已有 DOI、摘要、期刊的条目直接跳过（默认开启）；插件不自动下载 PDF，需要全文请用 Zotero 自带的「查找可用 PDF」；
- **补全元数据后自动翻译标题和摘要**：复用本机 Translate for Zotero 插件，译文写进 Extra 的 `titleTranslation` / `abstractTranslation`（默认关闭）；
- **补全元数据后自动判断重要性**：调用大模型给条目分级并打彩色标签（默认关闭）；
- **我的研究领域与偏好**：一段自然语言，写清方向、方法偏好、不想要的内容；原样进入提示词，可以同时写多个领域；
- **重要 / 关注 / 略过标签名**：默认 `RSS/重要`、`RSS/关注`、`RSS/略过`，可改成自己习惯的命名；
- **给「略过」也打灰色标签**：默认关闭，略过的条目不打标签；
- **把库内常用标签作为研究领域的线索**：把使用频次最高的若干标签写进提示词，帮助模型判断你的方向；「提取标签数量」控制取前几个（默认 40，范围 5–120），改完点「预览库内标签」就能先看清这批标签和条目数，再点「从库内标签归纳领域」让模型总结成领域描述（默认开启）；
- **接口地址 / 模型名称 / API Key**：任何 OpenAI 兼容的 `/chat/completions` 服务。API Key 留空时自动读取本机 **Zotero GPT** 插件（`zoterogpt@polygon.org`）保存的 `extensions.zotero.zoterogpt.*`；自己填的 Key 用 `Zotero.OSKeyStore` 加密后保存，不落明文，只接受 ASCII 字符（含中文/全角符号会被拒绝，HTTP 头放不下）。保存过的 Key 若解出来包含非 ASCII 字符，会被跳过并自动回退到 Zotero GPT。模型不支持 `tools` 或 `response_format` 时自动降级重试；失败摘要会直接显示在进度窗，完整错误写到数据目录的 `rss-helper.log`。
- **测试 AI 连接**：保存 Key 后点一下，插件会发一条最小的 `chat/completions` 请求，状态行会显示用的是哪个 Key、哪个模型，以及失败时的具体原因；同时把 `connection test: …` 写进 `rss-helper.log`。AI 筛选失败时先看这里，再看日志。

Settings cover auto-enrichment, auto-translation through Translate for Zotero, and AI screening. Enrichment only runs for newly added feed items and skips items that already have a DOI, abstract, and journal, so clicking or filing an item does not re-query Crossref; the plugin does not download PDFs itself. Tag hints are configurable in count and can be previewed before use; the "generate domain prompt" button turns them into a research-area description. An empty API key makes the plugin reuse the key, endpoint, and model already stored by the Zotero GPT plugin; a key entered here is encrypted with the OS key store. **Test AI connection** sends one minimal request and reports which key/model was used, so configuration problems are visible before running a batch. Unsupported `tools`/`response_format` requests fall back automatically, and full errors go to `rss-helper.log` in the data directory.

## AI 筛选 | AI screening

- 只标「重要」和「关注」，略过默认不标；重复筛选会替换旧标签，不会越积越多；
- 支持多选条目右键筛选，也支持在**分类**（期刊/专题）或 **RSS 订阅**上右键整批筛选；
- 库内高频标签会作为「研究领域线索」写进系统提示词；设置页可以先预览标签、决定数量，再「从库内标签归纳领域」生成一段领域描述；
- 模型可以先调用内置工具 `get_item_details`（读完整摘要、Extra、已有标签）和 `get_library_tags`（读库内高频标签），再给结论；最多两轮工具调用，最后强制 JSON 输出；
- 返回 `level`、`score`、`reason`、`topic`，可选 `suggestedTag`（必须来自库内高频标签）。

Screening tags only "important" and "watch" by default, works on multi-selected items and on a whole collection via its context menu, and lets the model call two read-only tools (item details, library tag frequency) before answering. Only two tool rounds are allowed, then a JSON answer is forced.

## 右键菜单 | Context menu

选中条目后右键 **RSS Helper** 子菜单：

- **补全元数据**：对选中的 RSS 条目立即执行 Crossref 补全；
- **翻译标题和摘要**：调用 Translate for Zotero 翻译并写入 Extra；
- **AI 筛选：重要 / 关注**：调用大模型分级，按设置的标签名打彩色标签；
- **清除 AI 标记**：移除三个等级标签，不影响其他标签。

在左侧**分类**或 **RSS 订阅**上右键 **RSS Helper** 子菜单：

- **AI 筛选此分类 / RSS 订阅**：把这个期刊/专题/订阅下的条目整批送去做重要性筛选；
- **清除此分类的 AI 标记**：批量移除等级标签；
- **测试：给此分类打 rss/test 标签**：只打一个灰蓝色 `rss/test`，用来确认菜单、打标签、设色链路是通的。

条目菜单里也有同样的「测试：打 rss/test 灰蓝标签」，先跑它确认右键没问题，再跑 AI 筛选。

On items: enrich, translate, AI-screen, clear AI tags, and a `rss/test` probe. On a collection or an RSS feed: screen everything, clear AI tags, or run the probe.

## 日志与排查 | Logs and troubleshooting

- 日志文件：`<Zotero 数据目录>\rss-helper.log`（通常是 `C:\Users\<你>\Zotero\rss-helper.log`），单文件超过约 200 KB 会自动截断；
- 记录内容：插件启动版本、菜单注册/点击、每次 AI 请求的来源（插件设置还是 Zotero GPT）、AI 连接测试、请求失败的状态和响应体、标签查询失败原因、附件下载 API 的调用方；
- 附件下载探针只读取调用栈，不改变 Zotero 的行为：出现重复 PDF 时，日志里的 `attachments: addAvailableFiles(...) from ...` 能直接看出是谁调用的；
- `Get-Content` 在部分 PowerShell 里会把 UTF-8 日志显示成乱码，用编辑器打开或 `Select-String` 读取即可。

Log file lives in the Zotero data directory as `rss-helper.log` and is truncated at about 200 KB. It records startup, menu registration/click, AI request source and failures (status and response body), tag query errors, and callers of Zotero's attachment download API. The attachment probe is read-only and does not change Zotero's behavior.

## 后续计划 | Roadmap

- 用邮件订阅 Google Scholar 的关键词提醒，转成 RSS 分类，复用本套补全 + 筛选流程（待做）；
- 更精确的来源识别，以及基于标签共现的轻量聚类，用来合并同义重复标签（待做）。

Future work: turn Google Scholar e-mail alerts into RSS collections that reuse this enrichment and screening pipeline, and add lightweight tag co-occurrence merging for synonymous tags.

## License

MIT
