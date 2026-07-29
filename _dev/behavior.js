#!/usr/bin/env node
"use strict";

/*
 * _dev/behavior.js — 核心纯函数行为断言（零依赖·可一键复跑）
 *
 * 与 check.js（语法/ID 引用）、_validate.js（题库结构）互补，覆盖两条最脆弱的行为语义：
 *   1) 题库末尾切片选择规则：SUMMARY_BANK = SUMMARY_BANK.slice(-N)
 *      —— 有效题库必须恰好是声明数组的末尾 N 条，ID 不重复、关键字段齐全。
 *      若切片语句已被移除（SUMMARY_BANK 为空、AI-only 模式），有效题库即声明数组本身。
 *   2) API 配置迁移与合并的「本地优先」语义：
 *      mergeApiSettingsFromFile / migrateApiSettingsFromLegacy
 *      —— 本地已有配置时文件/旧版配置被忽略；仅本地为空时补充；默认 maxTokens（defaultApiSettings.maxTokens）视为空。
 *
 * 被测代码从 规范表达练习.html 中原样抽取，在 node:vm 沙箱内执行（假 localStorage / D），
 * 不复制实现，HTML 内语义被改动时断言即失败。
 *
 * 用法（从项目根目录）：
 *   node _dev/behavior.js                # 默认断言 ../规范表达练习.html
 *   node _dev/behavior.js <路径.html>    # 断言指定文件
 *
 * 退出码：全部断言通过 0，任一失败 1（并打印失败断言）。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 项目根 = _dev/ 的上一级，独立于当前工作目录
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_TARGET = path.join(PROJECT_ROOT, "规范表达练习.html");

function resolveInput(arg) {
  if (!arg) return DEFAULT_TARGET;
  if (path.isAbsolute(arg)) return arg;
  const fromCwd = path.resolve(process.cwd(), arg);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(PROJECT_ROOT, arg);
}

// ============================================================
// 断言收集器
// ============================================================
let failed = 0;
let passed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.log("  ✗ 断言失败：" + msg);
  }
}

function fatal(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// ============================================================
// 源码抽取（跳过字符串与注释做括号配平，同 _validate.js 策略）
// ============================================================
function balancedEnd(src, open, openCh, closeCh) {
  let depth = 0, inStr = null, esc = false, inLine = false, inBlock = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// 抽取 `function <name>(...) { ... }` 整段源码
function extractFunction(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = re.exec(src);
  if (!m) fatal("未在 HTML 中找到函数 " + name + "（被测代码可能已被重命名或删除）");
  const brace = src.indexOf("{", m.index);
  if (brace < 0) fatal("函数 " + name + " 缺少函数体");
  const end = balancedEnd(src, brace, "{", "}");
  if (end < 0) fatal("函数 " + name + " 括号未配平");
  return src.slice(m.index, end + 1);
}

// 抽取 `var SUMMARY_BANK = [ ... ]` 数组字面量
function extractSummaryBankLiteral(src) {
  const m = /var\s+SUMMARY_BANK\s*=\s*\[/.exec(src);
  if (!m) fatal("未找到 SUMMARY_BANK 声明（期望 `var SUMMARY_BANK = [`）");
  const open = m.index + m[0].length - 1;
  const end = balancedEnd(src, open, "[", "]");
  if (end < 0) fatal("SUMMARY_BANK 数组未正确闭合");
  return src.slice(open, end + 1);
}

// ============================================================
// 主流程
// ============================================================
const target = resolveInput(process.argv[2]);
if (!fs.existsSync(target)) fatal("找不到输入文件：" + target);
const html = fs.readFileSync(target, "utf8");
const rel = path.relative(PROJECT_ROOT, target) || target;

// ============================================================
// 1) 题库末尾切片选择规则
// ============================================================
console.log("\n== 题库末尾切片选择规则 — " + rel + " ==");

const bankLiteral = extractSummaryBankLiteral(html);
let fullBank;
try {
  fullBank = Function('"use strict";return (' + bankLiteral + ");")();
} catch (e) {
  fatal("解析 SUMMARY_BANK 失败：" + e.message);
}
assert(Array.isArray(fullBank), "SUMMARY_BANK 声明为数组（共 " + fullBank.length + " 条；允许为空）");

// 抽取真实的切片语句原文并原样执行（改成 slice(0,N) 等都会在此失配）
// 若切片语句已被移除（SUMMARY_BANK 为空、AI-only 模式），有效题库即声明数组本身。
const sliceStmt = /SUMMARY_BANK\s*=\s*SUMMARY_BANK\.slice\(\s*-\s*(\d+)\s*\)\s*;/.exec(html);
let activeBank;
if (sliceStmt) {
  const N = Number(sliceStmt[1]);
  assert(N >= 1, "切片数量 N=" + N + " 为正整数");
  try {
    activeBank = Function("SUMMARY_BANK", '"use strict";' + sliceStmt[0] + " return SUMMARY_BANK;")(fullBank.slice());
  } catch (e) {
    fatal("执行切片语句失败：" + e.message);
  }
  const expectLen = Math.min(N, fullBank.length);
  assert(activeBank.length === expectLen, "有效题库数量 " + activeBank.length + " === min(N, 总数) = " + expectLen);
  // 必须恰好是声明数组的末尾 N 条（逐条同引用比较）
  const tail = fullBank.slice(fullBank.length - expectLen);
  const isTail = activeBank.every((q, i) => q === tail[i]);
  assert(isTail, "有效题库恰好是声明数组的末尾 " + expectLen + " 条（末尾选择语义）");
} else {
  assert(fullBank.length === 0, "无切片语句时 SUMMARY_BANK 为空数组（AI-only 模式，共 " + fullBank.length + " 条）");
  activeBank = fullBank.slice();
}

const ids = activeBank.map(q => q && q.id);
assert(new Set(ids).size === ids.length, "有效题 ID 无重复：" + ids.join(", "));
const FIELDS = ["id", "type", "level", "material", "slices"];
activeBank.forEach((q, i) => {
  const miss = FIELDS.filter(f => q == null || q[f] === undefined || q[f] === "");
  assert(miss.length === 0, "[" + (q && q.id ? q.id : "#" + i) + "] 关键字段齐全" + (miss.length ? "（缺 " + miss.join("/") + "）" : ""));
});

// ============================================================
// 2) API 配置迁移与合并的「本地优先」语义
// ============================================================
console.log("\n== API 配置合并/迁移（本地优先） ==");

// 抽取被测的常量与函数原文
const keyDecl = /const\s+API_SETTINGS_KEY\s*=\s*['"][^'"]+['"]\s*;/.exec(html);
const defDecl = (() => {
  const m = /const\s+defaultApiSettings\s*=\s*\{/.exec(html);
  if (!m) return null;
  const open = html.indexOf("{", m.index);
  const end = balancedEnd(html, open, "{", "}");
  return end < 0 ? null : html.slice(m.index, end + 1) + ";";
})();
if (!keyDecl) fatal("未找到 API_SETTINGS_KEY 声明");
if (!defDecl) fatal("未找到 defaultApiSettings 声明");
if (!/let\s+_apiSettings\s*=\s*null\s*;/.test(html)) fatal("未找到 `let _apiSettings = null;` 声明");

const apiBundle = [
  keyDecl[0],
  defDecl,
  "let _apiSettings = null;",
  extractFunction(html, "loadApiSettings"),
  extractFunction(html, "saveApiSettings"),
  extractFunction(html, "mergeApiSettingsFromFile"),
  extractFunction(html, "migrateApiSettingsFromLegacy"),
  "__exports({ API_SETTINGS_KEY, defaultApiSettings, loadApiSettings, mergeApiSettingsFromFile, migrateApiSettingsFromLegacy });",
].join("\n");

// 每个用例一个全新沙箱：假 localStorage + 假 D，互不串状态
function makeEnv(seedLocal, legacySettings) {
  const store = new Map();
  let api = null;
  const sandbox = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    D: { settings: legacySettings || {} },
    console: { warn: () => {}, log: () => {} },
    __exports: x => { api = x; },
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(apiBundle, sandbox, { filename: "api-settings-under-test.js" });
  } catch (e) {
    fatal("执行抽取的 API 配置代码失败：" + e.message);
  }
  if (!api) fatal("API 配置代码导出失败");
  if (seedLocal) store.set(api.API_SETTINGS_KEY, JSON.stringify(seedLocal));
  return { api, store, raw: () => store.get(api.API_SETTINGS_KEY) || null };
}

// —— M1 本地为空：文件配置补充并持久化 ——
{
  const { api, raw } = makeEnv(null);
  api.mergeApiSettingsFromFile({ provider: "deepseek", apiKey: "sk-file", model: "m-file", baseUrl: "https://file.example", temperature: 0.3, maxTokens: 4096 });
  const s = api.loadApiSettings();
  assert(s.provider === "deepseek" && s.apiKey === "sk-file" && s.model === "m-file" && s.baseUrl === "https://file.example", "M1 本地为空时，文件的 provider/apiKey/model/baseUrl 被补充");
  assert(s.maxTokens === 4096, "M1 本地为默认 16384 时，文件的 maxTokens=4096 被采纳");
  assert(s.temperature === 0.7, "M1 本地 temperature 默认已是数字 0.7，不被文件覆盖");
  const persisted = JSON.parse(raw() || "{}");
  assert(persisted.apiKey === "sk-file", "M1 合并结果已持久化到 localStorage");
}

// —— M2 本地已有完整配置：文件配置整体被忽略（本地优先核心） ——
{
  const local = { provider: "zhipu", apiKey: "sk-local", model: "glm", baseUrl: "https://local.example", temperature: 0.5, maxTokens: 3000 };
  const { api, raw } = makeEnv(local);
  const before = raw();
  api.mergeApiSettingsFromFile({ provider: "deepseek", apiKey: "sk-file", model: "m-file", baseUrl: "https://file.example", temperature: 0.9, maxTokens: 8000 });
  const s = api.loadApiSettings();
  assert(s.provider === "zhipu" && s.apiKey === "sk-local" && s.model === "glm" && s.baseUrl === "https://local.example", "M2 本地已有配置时，文件的 provider/apiKey/model/baseUrl 被忽略");
  assert(s.maxTokens === 3000 && s.temperature === 0.5, "M2 本地 maxTokens/temperature 保持不变");
  assert(raw() === before, "M2 无实际变更时不重写 localStorage");
}

// —— M3 空 / 非法文件参数不破坏本地配置 ——
{
  const { api, raw } = makeEnv({ apiKey: "sk-local" });
  const before = raw();
  let threw = false;
  try {
    api.mergeApiSettingsFromFile(null);
    api.mergeApiSettingsFromFile(undefined);
    api.mergeApiSettingsFromFile("not-an-object");
    api.mergeApiSettingsFromFile({});
    api.mergeApiSettingsFromFile({ provider: "", apiKey: "", model: "", baseUrl: "", maxTokens: 16384 });
  } catch (e) { threw = true; }
  assert(!threw, "M3 空/非法/旧文件空配置入参不抛异常");
  assert(api.loadApiSettings().apiKey === "sk-local" && raw() === before, "M3 本地 apiKey 与持久化内容均未被空配置破坏");
}

// —— M4 maxTokens 默认值语义：16384 视为「未配置」 ——
{
  const { api, store } = makeEnv(null);
  api.mergeApiSettingsFromFile({ maxTokens: 16384 });
  assert(api.loadApiSettings().maxTokens === 16384 && store.size === 0, "M4 文件 maxTokens=16384（默认值）不触发采纳与写入");
}
{
  const { api } = makeEnv({ maxTokens: 3000 });
  api.mergeApiSettingsFromFile({ maxTokens: 8000 });
  assert(api.loadApiSettings().maxTokens === 3000, "M4 本地 maxTokens=3000 非默认值时，文件的 8000 被忽略");
}

// —— M5 逐字段本地优先：本地有的保留，本地空的补充 ——
{
  const { api } = makeEnv({ apiKey: "sk-local" });
  api.mergeApiSettingsFromFile({ apiKey: "sk-file", model: "m-file" });
  const s = api.loadApiSettings();
  assert(s.apiKey === "sk-local", "M5 本地已有 apiKey 保留（不被文件覆盖）");
  assert(s.model === "m-file", "M5 本地为空的 model 从文件补充");
}

// —— L1 旧版 D.settings 迁移：仅本地为空时迁入并持久化 ——
{
  const { api, raw } = makeEnv(null, { provider: "qwen", apiKey: "sk-legacy", model: "qm", baseUrl: "https://legacy.example", maxTokens: 4096 });
  api.migrateApiSettingsFromLegacy();
  const s = api.loadApiSettings();
  assert(s.provider === "qwen" && s.apiKey === "sk-legacy" && s.model === "qm" && s.baseUrl === "https://legacy.example" && s.maxTokens === 4096, "L1 本地为空时，旧版 D.settings 配置迁入独立存储");
  assert(JSON.parse(raw() || "{}").apiKey === "sk-legacy", "L1 迁移结果已持久化");
}

// —— L2 本地已有配置：旧版配置被忽略 ——
{
  const local = { provider: "zhipu", apiKey: "sk-local", model: "glm", baseUrl: "https://local.example", maxTokens: 3000 };
  const { api, raw } = makeEnv(local, { provider: "qwen", apiKey: "sk-legacy", model: "qm", baseUrl: "https://legacy.example", maxTokens: 8000 });
  const before = raw();
  api.migrateApiSettingsFromLegacy();
  const s = api.loadApiSettings();
  assert(s.apiKey === "sk-local" && s.provider === "zhipu" && s.maxTokens === 3000, "L2 本地已有配置时，旧版 D.settings 被忽略");
  assert(raw() === before, "L2 无实际变更时不重写 localStorage");
}

// —— L3 D.settings 缺失时迁移不抛异常 ——
{
  const { api } = makeEnv(null, undefined);
  let threw = false;
  try { api.migrateApiSettingsFromLegacy(); } catch (e) { threw = true; }
  assert(!threw, "L3 D.settings 为空对象时迁移不抛异常");
}

// ============================================================
// 结果
// ============================================================
console.log("");
if (failed > 0) {
  console.error("✗ 行为断言未通过：" + failed + " 项失败（通过 " + passed + " 项）。");
  process.exit(1);
}
console.log("✓ 全部通过（" + passed + " 项断言）。");
process.exit(0);
