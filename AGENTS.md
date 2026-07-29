# 规范表达练习项目规则

## 项目用途

这是一个单页 HTML 练习工具，训练“读材料 → 找点 → 归类 → 概括 → 规范表达”的完整闭环。

## 文件边界

- `规范表达练习.html`：主应用入口。
- `index.html`：部署入口，只是指向主文件的纯跳转桩（meta refresh + 兜底链接）。双入口同步口径：不往 `index.html` 写业务逻辑或复制主文件内容；主文件改名时同步改跳转目标；`node _dev/check.js` 默认校验双入口并检查跳转桩一致性。
- `package.json`：机器可读的入口声明（`entryPoints.app` = `规范表达练习.html`，`entryPoints.deploy` = `index.html`），仅作元数据，不引入依赖或构建体系；与本节文字口径保持一致。
- `README.md`：项目使用说明。
- `项目方案与进度.md`：当前产品机制、技术边界和进度。
- `回归验收清单.md`：修改后的验收步骤和状态口径。
- `_material_drafts/`：来源型材料草稿不再保留；用户材料只保存在浏览器本地。
- `_inbox/`：WorkBuddy 原始事实卡片，只读，不覆盖、删除或移动。
- `_rejected/`：复核后淘汰的材料草稿，可恢复，不进入题库。
- `_archive/`：已合并或退役文档的历史存档；含来源型材料的旧样板已清理。
- `_dev/`：开发检查脚本和临时验证文件，不作为应用运行入口。
- 内置来源型概括材料、来源型样板和材料草稿不进入仓库；概括训练通过“我的材料”使用用户有权使用的材料，由 AI 生成。
- 正常练习统一为 AI 模式：规范改写题目、概括题目和批改都要求 API；AI 失败时保留当前内容，不回退到离线题库或词库。

用户材料不写入内置题库 `SUMMARY_BANK`。API Key、token 和其他凭据不得进入代码、题库、日志或 Git 历史。

## 修改与归档

- 保持单文件 HTML 架构，除非方案明确批准迁移。
- 文档更新优先修改当前有效文档；退役方案优先移入 `_archive/`，经确认需要彻底清理的来源型材料可移入系统回收站。
- 不修改 `_inbox/` 原始卡片。
- 不未经确认执行 `git push`、部署或公开发布。

## 修改后验证

在项目根目录执行：

```bash
node _dev/check.js
node _dev/_validate.js
node _dev/behavior.js
node _dev/storage.js
git diff --check
```

报告中区分“已写入代码”“静态检查通过”“浏览器实测”和“尚未实测”。`node _dev/check.js` 默认同时覆盖 `规范表达练习.html` 和 `index.html`（语法、id 引用、跳转桩同步）。`node _dev/behavior.js` 断言题库切片规则与 API 配置「本地优先」合并/迁移语义；`node _dev/storage.js` 断言 localStorage 键名迁移、敏感字段过滤、v1 数据迁移和用户材料 CRUD（两者均从 HTML 原样抽取被测代码在 node:vm 沙箱执行，零依赖）。
