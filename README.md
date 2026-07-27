# 规范表达练习

一个单文件 HTML 网页工具，用于刻意练习「读材料 → 找点 → 归类 → 概括成句」的完整闭环。

🔗 [在线使用（GitHub Pages）](https://lllvernan-blip.github.io/formal-expression-practice/)

## 功能

- **概括训练**：四步向导（通读材料 → 找点 → 归类命名 → 成句对照），L1/L2 使用预切片点击，L3 在线且配置 API 后支持连续材料自由划选，4 道基于公开事实改写的素材题
- **规范改写**：口语化表达转正式公文语体，支持离线题库和在线 AI 出题
- **我的材料**：粘贴或上传材料，由 AI 生成题目、切片、采分点和参考答案；原始材料与 AI 加工结果分开保存
- **两种批改模式**：离线对照参考答案，或接入 AI 做语义级逐点批改
- **错题本**：自动记录错误，支持优先重练
- **数据本地化**：练习记录、API 配置和用户材料均存储在浏览器 localStorage，不上传服务器

## 使用方法

### 在线

直接打开 [GitHub Pages](https://lllvernan-blip.github.io/formal-expression-practice/)，浏览器即可运行。

### 本地

```bash
git clone https://github.com/lllvernan-blip/formal-expression-practice.git
cd formal-expression-practice
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

或直接双击 `规范表达练习.html`。

## 接入 AI 批改

1. 在页面设置中选择「在线模式」
2. 点击「AI 设置」，填入你的 API 信息：
   - 支持 OpenAI 兼容接口（DeepSeek / 豆包 / 智谱 / 通义千问 等）
   - 需要填写：provider、API Key、模型名、接口地址
3. API Key 仅存储在浏览器 localStorage，不会上传到任何服务器

**建议使用单独的低额度 Key，并设置消费上限。**

## 题库

内置 4 道概括训练题，另支持导入个人材料和完整真题。内置题库按类型分为：

| 类型 | 数量 | 来源 |
|------|------|------|
| 做法 | 3 | 公开事实改写素材 |
| 问题 | 0 | 待补充 |
| 成效 | 0 | 待补充 |
| 变化 | 0 | 待补充 |
| 经验 | 1 | 公开事实改写素材 |

所有材料均来自真实公开来源，每题附来源名称、链接和抓取日期。

## 项目文档

- [项目方案与进度](项目方案与进度.md)：当前有效的产品机制、技术边界和后续计划
- [回归验收清单](回归验收清单.md)：每次改动后的静态、浏览器和手机端验收步骤
- `_archive/`：已并入主方案的历史文档，仅供查阅

## 技术说明

- 纯单文件 HTML（约 740KB），无外部依赖
- 内联 GSAP 3.15.0（开启动效，支持 reduced-motion 降级）
- 数据存储在 localStorage + 可选的 File System Access API 文件持久化
- 离线模式无需任何后端，在线模式通过 OpenAI 兼容 API 直连

## 许可证

MIT
