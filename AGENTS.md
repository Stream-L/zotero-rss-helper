# RSS Helper 开发约定

## 目标

这是一个面向 Zotero 10 的 RSS 元数据增强插件。当前开发顺序以 F1（DOI 识别、Crossref 补全、失败保留原数据）为主，先验证 Zotero RSS 对象和入库事件，再扩展 Translator、翻译和 AI 筛选。

## 常用命令

- `npm run check`：运行轻量规则检查。
- `npm run build`：类型检查并生成 `build/`。
- `npm run dev`：启动独立的 `.dev-profile`，监听源码并在修改后重建、重启 Zotero。

## 开发规则

- 只使用 `.dev-profile`，不要操作用户的默认 Zotero profile。
- 网络请求通过 `Zotero.HTTP`，失败必须返回原始 RSS 数据。
- 识别规则通过 `registerRecognitionRule` 注册，规则模块不直接依赖入库流程。
- 接入真实 Zotero API 前先记录对象字段和调用结果；不要从 UI DOM 反推内部接口。
- 不把密钥写入日志、源码或 profile 配置。
- 改动后至少运行 `npm run check`；涉及 TypeScript 或构建脚本时再运行 `npm run build`。

## 热加载边界

Zotero 不会自动重新执行已加载的 bootstrap 模块，因此开发 watcher 会重建产物并重启当前独立 Zotero 进程。生产 profile 不会被触碰。当前构建只验证 TypeScript 模块，正式 bootstrap bundle 仍需先确认 Zotero 10 的加载方式。
