#!/usr/bin/env node
"use strict";

/*
 * 题库校验器（可移植·可复跑）
 *
 * 用法（从项目根目录）：
 *   node _dev/_validate.js                # 默认校验主应用 规范表达练习.html 内联的 SUMMARY_BANK
 *   node _dev/_validate.js <路径>         # 校验指定文件
 *
 * <路径> 支持：
 *   - .html 文件：自动抽取 `var SUMMARY_BANK = [...]` 数组
 *   - .js / .json 文件：整段视为数组字面量，或裸露的逗号分隔对象列表
 *     （兼容旧的 _dev/batch-*.js 分批稿）
 *
 * 路径解析顺序：绝对路径 → 相对当前工作目录 → 相对项目根目录。
 * 脚本内不含任何绝对路径，可在任意机器上直接运行。
 *
 * 退出码：有 ERROR 时为 1，否则为 0（可用于 CI / 提交前校验）。
 */

const fs = require("fs");
const path = require("path");

// 项目根 = _dev/ 的上一级，独立于当前工作目录
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_TARGET = path.join(PROJECT_ROOT, "规范表达练习.html");

function resolveInput(arg) {
  if (!arg) return DEFAULT_TARGET;
  if (path.isAbsolute(arg)) return arg;
  const fromCwd = path.resolve(process.cwd(), arg);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(PROJECT_ROOT, arg); // 回退到相对项目根
}

// 从任意文本中抽取 `var SUMMARY_BANK = [ ... ]` 数组字面量（跳过字符串与注释做括号配平）
function extractSummaryBank(src) {
  const m = /var\s+SUMMARY_BANK\s*=\s*\[/.exec(src);
  if (!m) throw new Error("未找到 SUMMARY_BANK 声明（期望 `var SUMMARY_BANK = [`）");
  const open = m.index + m[0].length - 1; // '[' 的位置
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
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error("SUMMARY_BANK 数组未正确闭合");
}

function loadBank(file) {
  const raw = fs.readFileSync(file, "utf8");
  const ext = path.extname(file).toLowerCase();
  let literal;
  if (ext === ".html" || /var\s+SUMMARY_BANK\s*=/.test(raw)) {
    literal = extractSummaryBank(raw);
  } else {
    const trimmed = raw.trim();
    // 已是数组字面量则直接用，否则视为裸露对象列表（兼容 batch-*.js）
    literal = trimmed.startsWith("[") ? trimmed : "[" + raw + "]";
  }
  let arr;
  try {
    arr = Function('"use strict";return (' + literal + ");")();
  } catch (e) {
    throw new Error("解析题库失败：" + e.message);
  }
  if (!Array.isArray(arr)) throw new Error("题库解析结果不是数组");

  // 主应用保留历史题目作底稿，运行时通过末尾 slice 选择有效题。
  // 校验器也必须校验同一批题，否则会把已下线题目和重复编号算进去。
  if (ext === ".html") {
    const active = /SUMMARY_BANK\s*=\s*SUMMARY_BANK\.slice\(\s*-\s*(\d+)\s*\)/.exec(raw);
    if (active) arr = arr.slice(-Number(active[1]));
  }
  return arr;
}

// 结构性必填字段（缺失 → ERROR）
const REQUIRED_FIELDS = [
  "id", "type", "level", "domain", "context", "material", "slices", "points", "ref",
  "buildChain", "answerStructure", "source", "sourceDate", "sourceType",
  "topicTags", "timeliness", "timelinessNote"
];
// 元数据字段（缺失 → WARNING，允许查不到而留空）
const OPTIONAL_FIELDS = ["sourceUrl"];

function validate(arr) {
  const errors = [];
  const warnings = [];

  arr.forEach((q, qi) => {
    const id = q && q.id !== undefined ? q.id : `#${qi}`;

    // 0. 必填字段
    REQUIRED_FIELDS.forEach(f => {
      if (q[f] === undefined) errors.push(`[${id}] 缺少必填字段：${f}`);
    });
    OPTIONAL_FIELDS.forEach(f => {
      if (q[f] === undefined) warnings.push(`[${id}] 缺少可选字段：${f}`);
    });

    // 1. 切片必须是完整材料中的有效片段，并按材料顺序出现。
    // 当前题型会保留背景和过渡段，但 slices 只记录用于训练的语义片段，
    // 因此不能再要求 slices 拼接后逐字还原全文。
    if (Array.isArray(q.slices) && typeof q.material === "string") {
      q.slices.forEach((s, si) => {
        const text = String(s.text || "");
        const pos = text ? q.material.indexOf(text) : 0;
        if (text && pos < 0) {
          errors.push(`[${id}] 切片 ${si} 未在材料中找到：${text.substring(0, 30)}${text.length > 30 ? "…" : ""}`);
        }
      });
    }

    // 2. 材料长度 300-600（提示）：按当前叙事型训练材料的实际长度设定
    if (typeof q.material === "string") {
      const mlen = q.material.length;
      if (mlen < 300 || mlen > 600) warnings.push(`[${id}] 材料长度 ${mlen} 超出 300-600 区间`);
    }

    // 3. 切片 point 索引与有效性
    if (Array.isArray(q.slices)) {
      const pointCount = Array.isArray(q.points) ? q.points.length : 0;
      q.slices.forEach((s, si) => {
        if (s.valid && s.point !== undefined) {
          if (s.point < 0 || s.point >= pointCount) {
            errors.push(`[${id}] 切片 ${si} 的 point 索引 ${s.point} 越界（应为 0-${pointCount - 1}）`);
          }
        }
        if (s.valid && s.point === undefined) errors.push(`[${id}] 切片 ${si} 标记有效却缺少 point 索引`);
        if (!s.valid && !s.reason) errors.push(`[${id}] 切片 ${si} 标记无效却缺少 reason 说明`);
      });

      // 5. 切片数量 8-14（提示）：叙事材料允许保留更多语义片段
      const sc = q.slices.length;
      if (sc < 8 || sc > 14) warnings.push(`[${id}] 切片数量 ${sc} 超出 8-14 区间`);

      // 6. 干扰项数量 1-3（提示）：材料紧凑时允许只有一个干扰项
      const invalidCount = q.slices.filter(s => !s.valid).length;
      if (invalidCount < 1 || invalidCount > 3) warnings.push(`[${id}] 干扰项数量 ${invalidCount} 超出 1-3 区间`);
    }

    // 4. 参考答案长度 60-320（提示）：答案保留总括句、概括词和具体事实
    if (typeof q.ref === "string") {
      const rlen = q.ref.length;
      if (rlen < 60 || rlen > 320) warnings.push(`[${id}] 参考答案长度 ${rlen} 超出 60-320 区间`);
    }

    // 7. 要点数量 3-4（提示）
    if (Array.isArray(q.points)) {
      const pc = q.points.length;
      if (pc < 3 || pc > 4) warnings.push(`[${id}] 要点数量 ${pc} 超出 3-4 区间`);
    }
  });

  return { errors, warnings };
}

function printDistribution(arr) {
  const byType = {};
  arr.forEach(q => {
    const t = q.type || "未知";
    byType[t] = byType[t] || [];
    byType[t].push(q);
  });
  console.log(`共 ${arr.length} 道题`);
  Object.keys(byType).forEach(t => {
    const list = byType[t];
    const levels = {};
    list.forEach(q => { const l = q.level || "?"; levels[l] = (levels[l] || 0) + 1; });
    const lvStr = Object.keys(levels).sort().map(l => `${l}:${levels[l]}`).join(" ");
    console.log(`  ${t}: ${list.length} (${lvStr})`);
  });
  console.log(`ID: ${arr.map(q => q.id).join(", ")}`);
  console.log("");
}

function main() {
  const target = resolveInput(process.argv[2]);
  if (!fs.existsSync(target)) {
    console.error(`找不到输入文件：${target}`);
    process.exitCode = 1;
    return;
  }
  console.log(`校验文件：${path.relative(PROJECT_ROOT, target) || target}`);
  console.log("");

  let arr;
  try {
    arr = loadBank(target);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }

  printDistribution(arr);
  const { errors, warnings } = validate(arr);

  if (errors.length) {
    console.log(`ERRORS (${errors.length}):`);
    errors.forEach(e => console.log("  " + e));
  } else {
    console.log("无 ERROR。");
  }
  if (warnings.length) {
    console.log(`WARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log("  " + w));
  } else {
    console.log("无 WARNING。");
  }

  process.exitCode = errors.length ? 1 : 0;
}

main();
