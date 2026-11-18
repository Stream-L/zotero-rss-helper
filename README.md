# Zotero RSS Helper

Zotero RSS Helper improves the way paper RSS entries become Zotero items.

**状态：1.0.1 正式版 | Status: 1.0.1 stable.** 补全、设置页、右键菜单、翻译联动、AI 分级标签、邮件转 RSS 均可用；AI 部分依赖外部模型服务和 Key，配置见下文。1.0.1 起 AI 筛选按 6 篇一批合并请求、进度一次定好总数，菜单项带图标。

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
- **多选时按 6 篇一批合并成一个请求**（不再逐条请求），7 篇大约 2 个请求；进度按「已筛选 x/总数」一次定好总数，不会出现 4/5 这种漂移；
- 库内高频标签会作为「研究领域线索」写进系统提示词；设置页可以先预览标签、决定数量，再「从库内标签归纳领域」生成一段领域描述；
- 单篇条目仍允许模型调用内置工具 `get_item_details`（读完整摘要、Extra、已有标签）和 `get_library_tags`（读库内高频标签），再给结论；批量模式直接按标题+摘要判断，少一次往返、快很多；
- 返回 `level`、`reason`，可选 `suggestedTag`（必须来自库内高频标签）。

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

## 出版商 RSS 与学术快讯邮件 | Publisher feeds and alert email

已实测可用的期刊 RSS（直接粘到 Zotero「新建订阅」）：

- Nature：`https://www.nature.com/nature.rss`
- Science：`https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science`
- arXiv：`https://rss.arxiv.org/rss/cs.CL`（换分类改末段）
- Elsevier / ScienceDirect：`https://rss.sciencedirect.com/publication/science/<ISSN>`，例如 Decision Support Systems 是 `01679236`
- ACM：`https://dl.acm.org/action/showFeed?type=etoc&feed=rss&jc=<期刊代码>`，例如 ACM Computing Surveys 是 `csur`

Wiley、Springer 的旧式 `/feed/...`、`/journal/<id>/rss` 路径会 404；IEEE、MDPI 对脚本抓取返回 418 / Access Denied，但 Zotero 内部订阅未必受限，值得在 Zotero 里直接试。中文期刊（知网/万方/维普）没有官方 RSS，推荐走下面的学术快讯邮件。

Google 学术快讯邮件是离线转换，不需要另起服务：

```powershell
# 把「创建快讯」邮件原文存成 .eml，然后：
node scripts/eml-to-rss.mjs "LLM recommendation - 新的结果.eml" dist/gs-alert.rss
```

生成的 `dist/gs-alert.rss` 是普通 RSS 文件。Zotero 只接受 http/https 订阅地址、不能直接订阅本地文件，所以这个转换结果需要你放到自己的静态托管/网盘直链上用；不想托管就不用这条路径，直接订阅上面列出的出版商 RSS。转换与解析完全离线，条目链接会还原成出版商原始地址；中文标题条目在补全阶段会被识别为「无 DOI 的中文条目」并保留 RSS 原始元数据，不会被塞进错误的英文论文。

Verified publisher feeds are listed above; Wiley/Springer legacy paths 404, IEEE/MDPI block scrapers. The Google Scholar alert e-mail can be converted offline with `scripts/eml-to-rss.mjs`; Zotero still needs an http(s) URL, so host the generated file yourself if you want to subscribe. No extra local server is involved.

## 日志与排查 | Logs and troubleshooting

- 日志文件：`<Zotero 数据目录>\rss-helper.log`（通常是 `C:\Users\<你>\Zotero\rss-helper.log`），单文件超过约 200 KB 会自动截断；
- 记录内容：插件启动版本、菜单注册/点击、每次 AI 请求的来源（插件设置还是 Zotero GPT）、AI 连接测试、请求失败的状态和响应体、标签查询失败原因、附件下载 API 的调用方；
- 附件下载探针只读取调用栈，不改变 Zotero 的行为：出现重复 PDF 时，日志里的 `attachments: addAvailableFiles(...) from ...` 能直接看出是谁调用的；
- `Get-Content` 在部分 PowerShell 里会把 UTF-8 日志显示成乱码，用编辑器打开或 `Select-String` 读取即可。

Log file lives in the Zotero data directory as `rss-helper.log` and is truncated at about 200 KB. It records startup, menu registration/click, AI request source and failures (status and response body), tag query errors, and callers of Zotero's attachment download API. The attachment probe is read-only and does not change Zotero's behavior.

## 后续计划 | Roadmap

- ~~用邮件订阅 Google Scholar 的关键词提醒，转成 RSS 分类，复用本套补全 + 筛选流程~~（1.0.0 已完成，见上节）；
- 更精确的来源识别，以及基于标签共现的轻量聚类，用来合并同义重复标签（待做）。

Future work: lightweight tag co-occurrence merging for synonymous tags. Google Scholar alert e-mail to RSS is implemented in 1.0.0 (see above).

## License

MIT
