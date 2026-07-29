#!/usr/bin/env node
"use strict";

/*
 * _dev/storage.js — localStorage 存取/迁移规则断言（零依赖·可一键复跑）
 *
 * 与 check.js（语法/ID 引用）、_validate.js（题库结构）、behavior.js（题库切片
 * 规则 + API 配置「本地优先」合并/迁移）互补，覆盖存储层四段最易回归的逻辑：
 *   1) <head> 主题预载脚本：旧键名 → 新键名的一次性迁移 + 已存主题同步应用
 *   2) loadFromLocal / sanitizeSettings / applyParsedData：
 *      读取本地练习数据时敏感字段（apiKey 等）不进 D.settings；
 *      载入数据文件时练习数据进 D、API 配置走独立存储（本地优先）
 *   3) migrateV1：v1 旧键练习数据一次性迁移（仅 D.history 为空时）
 *   4) 用户材料 CRUD：loadUserMaterials / add / update / delete 往返一致
 *
 * 被测代码从 规范表达练习.html 中原样抽取，在 node:vm 沙箱内执行（假 localStorage /
 * document / D），不复制实现，HTML 内语义被改动时断言即失败。
 *
 * 用法（从项目根目录）：
 *   node _dev/storage.js                # 默认断言 ../规范表达练习.html
 *   node _dev/storage.js <路径.html>    # 断言指定文件
 *
 * 退出码：全部断言通过 0，任一失败 1（并打印失败断言）。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
// 源码抽取（跳过字符串与注释做括号配平，同 behavior.js 策略）
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

// 抽取 `const <name> = { ... };` 对象字面量声明
function extractConstObject(src, name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*\\{").exec(src);
  if (!m) fatal("未找到 " + name + " 声明");
  const open = src.indexOf("{", m.index);
  const end = balancedEnd(src, open, "{", "}");
  if (end < 0) fatal(name + " 对象未正确闭合");
  return src.slice(m.index, end + 1) + ";";
}

// 抽取 `const <name> = '...';` 字符串常量声明
function extractConstString(src, name) {
  const m = new RegExp("const\\s+" + name + "\\s*=\\s*['\"][^'\"]+['\"]\\s*;").exec(src);
  if (!m) fatal("未找到 " + name + " 声明");
  return m[0];
}

// ============================================================
// 主流程
// ============================================================
const target = resolveInput(process.argv[2]);
if (!fs.existsSync(target)) fatal("找不到输入文件：" + target);
const html = fs.readFileSync(target, "utf8");
const rel = path.relative(PROJECT_ROOT, target) || target;

// 假 localStorage：Map 封装，行为对齐浏览器（getItem 未命中返回 null）
function fakeLocalStorage(store) {
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
}

// 旧键名与 HTML 内一致：通过 String.fromCharCode 生成，不在仓库落明文
const OLD_MAIN = String.fromCharCode(115, 104, 101, 110, 108, 117, 110, 95, 118, 50);
const OLD_API = String.fromCharCode(115, 104, 101, 110, 108, 117, 110, 95, 97, 112, 105, 95, 115, 101, 116, 116, 105, 110, 103, 115, 95, 118, 49);
const OLD_PRACTICE = String.fromCharCode(115, 104, 101, 110, 108, 117, 110, 95, 112, 114, 97, 99, 116, 105, 99, 101, 95, 100, 97, 116, 97);
const NEW_MAIN = "formal_expression_v2";
const NEW_API = "formal_expression_api_settings_v1";
const NEW_PRACTICE = "formal_expression_practice_data";

// ============================================================
// 1) <head> 主题预载脚本：键名迁移 + 主题应用
// ============================================================
console.log("\n== <head> 键名迁移 / 主题预载 — " + rel + " ==");

const headM = /<!-- 阻止暗色模式闪白[\s\S]*?-->\s*<script>([\s\S]*?)<\/script>/.exec(html);
if (!headM) fatal("未找到 <head> 主题预载脚本（注释标记「阻止暗色模式闪白」）");
const headSrc = headM[1];

// 每个用例一个全新沙箱：先播种 localStorage，再原样执行脚本
function runHead(seed) {
  const store = new Map();
  Object.entries(seed || {}).forEach(([k, v]) => store.set(k, v));
  const doc = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
  const sandbox = { localStorage: fakeLocalStorage(store), document: doc };
  vm.createContext(sandbox);
  let threw = false;
  try { vm.runInContext(headSrc, sandbox, { filename: "head-under-test.js" }); }
  catch (e) { threw = true; }
  return { store, doc, threw };
}

{ // 三个旧键各自迁到新键，旧键删除
  const { store, threw } = runHead({
    [OLD_MAIN]: '{"hasSeenWelcome":true}',
    [OLD_API]: '{"apiKey":"sk-old"}',
    [OLD_PRACTICE]: '{"history":[]}',
  });
  assert(!threw, "H1 迁移执行不抛异常");
  assert(store.get(NEW_MAIN) === '{"hasSeenWelcome":true}', "H1 主数据旧键内容迁入 " + NEW_MAIN);
  assert(store.get(NEW_API) === '{"apiKey":"sk-old"}', "H1 API 配置旧键内容迁入 " + NEW_API);
  assert(store.get(NEW_PRACTICE) === '{"history":[]}', "H1 v1 练习数据旧键内容迁入 " + NEW_PRACTICE);
  assert(!store.has(OLD_MAIN) && !store.has(OLD_API) && !store.has(OLD_PRACTICE), "H1 三个旧键迁移后均被删除");
}
{ // 新键已有内容：不被旧键覆盖，旧键仍删除
  const { store } = runHead({ [OLD_MAIN]: '{"a":1}', [NEW_MAIN]: '{"b":2}' });
  assert(store.get(NEW_MAIN) === '{"b":2}', "H2 新键已存在时不被旧键覆盖");
  assert(!store.has(OLD_MAIN), "H2 新键已存在时旧键仍被清除");
}
{ // 已存主题在 <body> 渲染前同步应用
  const { doc } = runHead({ [NEW_MAIN]: '{"settings":{"theme":"dark"}}' });
  assert(doc.documentElement.attrs["data-theme"] === "dark", "H3 已存 theme=dark 同步写入 data-theme");
}
{ // 主数据损坏：不抛异常、不写主题
  const { doc, threw } = runHead({ [NEW_MAIN]: "{corrupt" });
  assert(!threw && doc.documentElement.attrs["data-theme"] === undefined, "H4 主数据 JSON 损坏时不抛异常、不写主题");
}
{ // 全空环境：无迁移、无主题、不抛异常
  const { store, threw } = runHead({});
  assert(!threw && store.size === 0, "H5 全空 localStorage 下为无操作");
}

// ============================================================
// 2) loadFromLocal / sanitizeSettings / applyParsedData
// ============================================================
console.log("\n== 本地读写 / 数据文件载入（敏感字段过滤 + API 独立存储） ==");

if (!/let\s+D\s*=\s*JSON\.parse\(JSON\.stringify\(defaultData\)\)\s*;/.test(html)) {
  fatal("未找到 `let D = JSON.parse(JSON.stringify(defaultData));` 声明");
}

const dataBundle = [
  extractConstString(html, "STORAGE_KEY"),
  extractConstString(html, "API_SETTINGS_KEY"),
  extractConstObject(html, "defaultApiSettings"),
  "let _apiSettings = null;",
  extractConstObject(html, "defaultData"),
  "let D = JSON.parse(JSON.stringify(defaultData));",
  "let _saveFailToastAt = 0;",
  extractFunction(html, "loadApiSettings"),
  extractFunction(html, "saveApiSettings"),
  extractFunction(html, "mergeApiSettingsFromFile"),
  extractFunction(html, "sanitizeSettings"),
  extractFunction(html, "applyParsedData"),
  extractFunction(html, "loadFromLocal"),
  extractFunction(html, "saveToLocal"),
  extractFunction(html, "migrateV1"),
  "__exports({ STORAGE_KEY, API_SETTINGS_KEY, defaultData, sanitizeSettings, applyParsedData, loadFromLocal, saveToLocal, migrateV1, loadApiSettings, getD: () => D, setD: v => { D = v; } });",
].join("\n");

// 每个用例一个全新沙箱：假 localStorage + 可记录的 showToast/markDirty
function makeDataEnv(seed) {
  const store = new Map();
  Object.entries(seed || {}).forEach(([k, v]) => store.set(k, typeof v === "string" ? v : JSON.stringify(v)));
  const calls = { toast: [], dirty: 0 };
  let api = null;
  const sandbox = {
    localStorage: fakeLocalStorage(store),
    console: { warn: () => {}, log: () => {} },
    Date,
    showToast: msg => { calls.toast.push(String(msg)); },
    markDirty: () => { calls.dirty++; },
    __exports: x => { api = x; },
  };
  vm.createContext(sandbox);
  try { vm.runInContext(dataBundle, sandbox, { filename: "data-layer-under-test.js" }); }
  catch (e) { fatal("执行抽取的数据层代码失败：" + e.message); }
  if (!api) fatal("数据层代码导出失败");
  return { api, store, calls };
}

{ // sanitizeSettings：敏感字段全部剔除、非敏感字段保留
  const { api } = makeDataEnv();
  const s = api.sanitizeSettings({ mode: "online", theme: "dark", apiKey: "sk-x", provider: "p", model: "m", baseUrl: "u", temperature: 0.5, maxTokens: 8000 });
  const sensitive = ["apiKey", "provider", "model", "baseUrl", "temperature", "maxTokens"];
  assert(sensitive.every(k => !(k in s)), "S1 sanitizeSettings 剔除全部敏感字段：" + sensitive.join("/"));
  assert(s.mode === "online" && s.theme === "dark", "S1 非敏感字段 mode/theme 保留");
  assert(JSON.stringify(api.sanitizeSettings(null)) === "{}" && JSON.stringify(api.sanitizeSettings("x")) === "{}", "S1 非对象入参返回空对象不抛异常");
}
{ // loadFromLocal：存量数据与默认值合并，settings 内敏感字段不进 D
  const { api } = makeDataEnv({
    formal_expression_v2: { version: 2, hasSeenWelcome: true, history: [{ id: 1 }], settings: { theme: "dark", apiKey: "sk-leak" } },
  });
  api.loadFromLocal();
  const D = api.getD();
  assert(D.hasSeenWelcome === true && D.history.length === 1, "S2 loadFromLocal 合并存量 history/hasSeenWelcome");
  assert(D.settings.theme === "dark" && D.settings.mode === "online", "S2 存量 theme 保留、缺失的 mode 取默认值");
  assert(!("apiKey" in D.settings), "S2 存量 settings 中的 apiKey 被过滤，不进 D.settings");
}
{ // loadFromLocal：损坏 JSON 不抛异常、D 保持默认
  const { api } = makeDataEnv({ formal_expression_v2: "{corrupt" });
  let threw = false;
  try { api.loadFromLocal(); } catch (e) { threw = true; }
  assert(!threw && api.getD().history.length === 0, "S3 本地 JSON 损坏时不抛异常，D 保持默认");
}
{ // saveToLocal→loadFromLocal 往返一致
  const { api, store } = makeDataEnv();
  api.getD().hasSeenWelcome = true;
  api.saveToLocal();
  const { api: api2 } = makeDataEnv({ formal_expression_v2: store.get("formal_expression_v2") });
  api2.loadFromLocal();
  assert(api2.getD().hasSeenWelcome === true, "S4 saveToLocal→loadFromLocal 往返一致");
}
{ // applyParsedData：练习数据进 D（敏感字段过滤），API 配置进独立存储
  const { api, store } = makeDataEnv();
  api.applyParsedData({ version: 2, history: [{ id: 9 }], settings: { theme: "dark", apiKey: "sk-file", model: "m-file" } });
  const D = api.getD();
  assert(D.history.length === 1 && D.settings.theme === "dark", "S5 数据文件的 history/theme 进 D");
  assert(!("apiKey" in D.settings) && !("model" in D.settings), "S5 数据文件的 apiKey/model 不进 D.settings");
  const persisted = JSON.parse(store.get("formal_expression_api_settings_v1") || "{}");
  assert(persisted.apiKey === "sk-file" && persisted.model === "m-file", "S5 数据文件 API 配置写入独立存储（本地为空时补充）");
}
{ // applyParsedData：本地已有 API 配置时文件配置被忽略（F3 语义）
  const { api, store } = makeDataEnv({
    formal_expression_api_settings_v1: { provider: "zhipu", apiKey: "sk-local", model: "glm", baseUrl: "https://local.example" },
  });
  api.applyParsedData({ version: 2, settings: { apiKey: "", model: "" } });
  const persisted = JSON.parse(store.get("formal_expression_api_settings_v1") || "{}");
  assert(persisted.apiKey === "sk-local" && persisted.model === "glm", "S6 旧文件空配置不覆盖本地已存 API 配置");
}

// ============================================================
// 3) migrateV1：v1 旧键练习数据一次性迁移
// ============================================================
console.log("\n== migrateV1（v1 旧键一次性迁移） ==");

{ // 标准迁移：history 映射、mistakes→oralWordStats、API 配置进独立存储
  const { api, store, calls } = makeDataEnv({
    formal_expression_practice_data: { history: [{ q: "x" }, { q: "y", id: 7 }], settings: { apiKey: "sk-v1", provider: "deepseek" }, mistakes: { "的": 2 } },
  });
  api.migrateV1();
  const D = api.getD();
  assert(D.history.length === 2, "V1 v1 history 迁入 D.history");
  assert(D.history.every(h => h.mode === "offline" && h.selfRating === null && h.aiScore === null && h.id != null), "V1 迁移记录补齐 mode=offline / selfRating / aiScore / id");
  assert(D.history[1].id === 7, "V1 已有 id 的记录保留原 id");
  assert(JSON.stringify(D.oralWordStats) === JSON.stringify({ "的": 2 }), "V1 v1 mistakes 迁入 oralWordStats");
  assert(D.hasSeenWelcome === true, "V1 迁移后视为已见欢迎页");
  const persisted = JSON.parse(store.get("formal_expression_api_settings_v1") || "{}");
  assert(persisted.apiKey === "sk-v1" && persisted.provider === "deepseek", "V1 v1 的 API 配置迁入独立存储，不写 D.settings");
  assert(!("apiKey" in D.settings), "V1 D.settings 内无 apiKey");
  assert(calls.dirty > 0, "V1 迁移后 markDirty 被调用（触发持久化）");
}
{ // D.history 非空：不迁移（防覆盖）
  const { api } = makeDataEnv({ formal_expression_practice_data: { history: [{ q: "x" }] } });
  const D = api.getD();
  D.history.push({ id: 1 });
  api.migrateV1();
  assert(api.getD().history.length === 1 && api.getD().history[0].id === 1, "V2 D.history 已有记录时跳过迁移");
}
{ // 旧键损坏 / 缺失：不抛异常
  const { api } = makeDataEnv({ formal_expression_practice_data: "{corrupt" });
  let threw = false;
  try { api.migrateV1(); } catch (e) { threw = true; }
  assert(!threw && api.getD().history.length === 0, "V3 v1 数据损坏时不抛异常、不迁移");
  const { api: api2 } = makeDataEnv();
  api2.migrateV1();
  assert(api2.getD().history.length === 0, "V3 无 v1 旧键时为无操作");
}

// ============================================================
// 4) 用户材料 CRUD
// ============================================================
console.log("\n== 用户材料 CRUD（localStorage 往返） ==");

const materialsBundle = [
  extractConstString(html, "USER_MATERIALS_KEY"),
  extractFunction(html, "loadUserMaterials"),
  extractFunction(html, "saveUserMaterials"),
  extractFunction(html, "addUserMaterial"),
  extractFunction(html, "updateUserMaterial"),
  extractFunction(html, "deleteUserMaterial"),
  extractFunction(html, "getUserMaterial"),
  "__exports({ USER_MATERIALS_KEY, loadUserMaterials, addUserMaterial, updateUserMaterial, deleteUserMaterial, getUserMaterial });",
].join("\n");

function makeMaterialsEnv(seed) {
  const store = new Map();
  Object.entries(seed || {}).forEach(([k, v]) => store.set(k, typeof v === "string" ? v : JSON.stringify(v)));
  let api = null;
  const sandbox = {
    localStorage: fakeLocalStorage(store),
    console: { warn: () => {}, log: () => {} },
    Date,
    showToast: () => {},
    __exports: x => { api = x; },
  };
  vm.createContext(sandbox);
  try { vm.runInContext(materialsBundle, sandbox, { filename: "materials-under-test.js" }); }
  catch (e) { fatal("执行抽取的用户材料代码失败：" + e.message); }
  if (!api) fatal("用户材料代码导出失败");
  return { api, store };
}

{ // 增删改查往返
  const { api } = makeMaterialsEnv();
  api.addUserMaterial({ id: "um_1", title: "A" });
  api.addUserMaterial({ id: "um_2", title: "B" });
  assert(api.loadUserMaterials().length === 2, "U1 add→load 往返：2 条材料");
  assert(api.getUserMaterial("um_2").title === "B", "U1 getUserMaterial 按 id 命中");
  api.updateUserMaterial("um_1", { title: "A2" });
  const updated = api.getUserMaterial("um_1");
  assert(updated.title === "A2" && typeof updated.updatedAt === "string", "U2 update 应用补丁并写入 updatedAt");
  api.updateUserMaterial("um_missing", { title: "X" });
  assert(api.loadUserMaterials().length === 2, "U2 update 不存在的 id 为无操作");
  api.deleteUserMaterial("um_1");
  const rest = api.loadUserMaterials();
  assert(rest.length === 1 && rest[0].id === "um_2", "U3 delete 只移除匹配项");
  assert(api.getUserMaterial("um_1") === null, "U3 删除后 getUserMaterial 返回 null");
}
{ // 存量损坏：load 返回空数组不抛异常
  const { api } = makeMaterialsEnv({ formal_expression_user_materials_v1: "{corrupt" });
  let threw = false, list = null;
  try { list = api.loadUserMaterials(); } catch (e) { threw = true; }
  assert(!threw && Array.isArray(list) && list.length === 0, "U4 存量 JSON 损坏时返回空数组不抛异常");
}

// ============================================================
// 结果
// ============================================================
console.log("");
if (failed > 0) {
  console.error("✗ 存储层断言未通过：" + failed + " 项失败（通过 " + passed + " 项）。");
  process.exit(1);
}
console.log("✓ 全部通过（" + passed + " 项断言）。");
process.exit(0);
