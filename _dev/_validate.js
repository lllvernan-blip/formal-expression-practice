#!/usr/bin/env node
"use strict";

/*
 * AI 生成题目 schema 校验器（可移植·可复跑）
 *
 * 背景：内置题库 SUMMARY_BANK 已清空（概括训练改为“我的材料”+ AI 生成，
 * 用户材料不写入 SUMMARY_BANK），本脚本不再校验 HTML 内联题库，
 * 改为校验 AI 生成题目的同款 schema——与主应用 umGeneratePractice 产出的
 * generated 对象、运行时 validateUserMaterialResult 的硬约束保持同一口径：
 *
 *   { type, level, prompt, material, slices:[{text,punct,valid,point,reason}],
 *     points:[{name,keys,acceptable}], buildChain, answerStructure, ref }
 *
 * 用法（从项目根目录）：
 *   node _dev/_validate.js                # 默认校验 _dev/sample-question.json（虚构示例夹具）
 *   node _dev/_validate.js <路径>         # 校验指定 .json / .js 文件
 *
 * <路径> 支持：
 *   - .json：单个题目对象，或题目对象数组
 *   - .js  ：数组/对象字面量，或裸露的逗号分隔对象列表
 *   - 数组元素若带 generated 字段（“我的材料”导出项），自动取其 generated 校验
 *
 * 路径解析顺序：绝对路径 → 相对当前工作目录 → 相对项目根目录。
 * 脚本内不含任何绝对路径，可在任意机器上直接运行。
 *
 * 退出码：有 ERROR 或校验对象为空时为 1，否则为 0（可用于 CI / 提交前校验）。
 */

const fs = require("fs");
const path = require("path");

// 项目根 = _dev/ 的上一级，独立于当前工作目录
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_TARGET = path.join(__dirname, "sample-question.json");

function resolveInput(arg) {
  if (!arg) return DEFAULT_TARGET;
  if (path.isAbsolute(arg)) return arg;
  const fromCwd = path.resolve(process.cwd(), arg);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(PROJECT_ROOT, arg); // 回退到相对项目根
}

function loadQuestions(file) {
  const raw = fs.readFileSync(file, "utf8");
  const trimmed = raw.trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    // 非严格 JSON：按 JS 字面量解析（数组/对象，或裸露对象列表）
    const literal = trimmed.startsWith("[") || trimmed.startsWith("{")
      ? trimmed
      : "[" + trimmed + "]";
    try {
      parsed = Function('"use strict";return (' + literal + ");")();
    } catch (e) {
      throw new Error("解析输入失败（既不是 JSON 也不是合法字面量）：" + e.message);
    }
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  // “我的材料”导出项带 generated 字段时，取其 generated 作为校验对象
  return list.map(item =>
    item && typeof item === "object" && item.generated && typeof item.generated === "object"
      ? item.generated
      : item
  );
}

// 结构性必填字段（缺失 → ERROR），对应 AI 生成协议的硬约束
const REQUIRED_FIELDS = ["type", "level", "prompt", "material", "slices", "points", "ref"];
// 协议中要求生成、但运行时可空缺省的字段（缺失 → WARNING）
const OPTIONAL_FIELDS = ["domain", "buildChain", "answerStructure"];

const TYPE_ENUM = ["问题", "做法", "成效", "变化", "经验"];
const LEVEL_ENUM = ["L1", "L2", "L3"];

function validate(arr) {
  const errors = [];
  const warnings = [];

  arr.forEach((q, qi) => {
    const id = `#${qi + 1}`;
    if (!q || typeof q !== "object") {
      errors.push(`[${id}] 不是有效的题目对象`);
      return;
    }

    // 0. 必填/可选字段
    REQUIRED_FIELDS.forEach(f => {
      if (q[f] === undefined) errors.push(`[${id}] 缺少必填字段：${f}`);
    });
    OPTIONAL_FIELDS.forEach(f => {
      if (q[f] === undefined) warnings.push(`[${id}] 缺少可选字段：${f}`);
    });

    // 1. 枚举口径（协议约束，偏差 → WARNING）
    if (q.type !== undefined && !TYPE_ENUM.includes(q.type)) {
      warnings.push(`[${id}] type「${q.type}」不在协议枚举内（${TYPE_ENUM.join("|")}）`);
    }
    if (q.level !== undefined && !LEVEL_ENUM.includes(q.level)) {
      warnings.push(`[${id}] level「${q.level}」不在协议枚举内（${LEVEL_ENUM.join("|")}）`);
    }

    // 2. 材料：非空；短于运行时最低输入 50 字则提示
    const material = typeof q.material === "string" ? q.material : "";
    if (q.material !== undefined && !material.trim()) {
      errors.push(`[${id}] material 为空`);
    } else if (material && material.length < 50) {
      warnings.push(`[${id}] 材料长度 ${material.length} 低于运行时最低输入 50 字`);
    }

    // 3. 切片与采分点：非空数组（对应运行时 requirePracticeData）
    const slices = Array.isArray(q.slices) ? q.slices : [];
    const points = Array.isArray(q.points) ? q.points : [];
    if (q.slices !== undefined && !slices.length) errors.push(`[${id}] slices 为空，无法生成可练习题目`);
    if (q.points !== undefined && !points.length) errors.push(`[${id}] points 为空，无法生成可练习题目`);

    // 4. 每个切片：text 必须逐字来自材料；valid 切片 point 索引合法；无效切片要有 reason
    slices.forEach((s, si) => {
      const text = String((s && s.text) || "").trim();
      if (!text) {
        errors.push(`[${id}] 切片 ${si} 缺少 text`);
      } else if (material && material.indexOf(text) < 0) {
        errors.push(`[${id}] 切片 ${si} 未在材料中找到：${text.substring(0, 30)}${text.length > 30 ? "…" : ""}`);
      }
      if (s && s.valid === true) {
        if (s.point === undefined) {
          errors.push(`[${id}] 切片 ${si} 标记有效却缺少 point 索引`);
        } else if (!Number.isInteger(s.point) || s.point < 0 || s.point >= points.length) {
          errors.push(`[${id}] 切片 ${si} 的 point 索引 ${s.point} 越界（应为 0-${points.length - 1} 的整数）`);
        }
      } else if (s) {
        if (!s.reason) errors.push(`[${id}] 切片 ${si} 标记无效却缺少 reason 说明`);
        if (s.point !== undefined && s.point !== -1) {
          warnings.push(`[${id}] 切片 ${si} 无效切片的 point 应为 -1，实际为 ${s.point}`);
        }
      }
    });

    // 5. 每个采分点：name 必填；keys / acceptable 按协议应为非空数组
    points.forEach((p, pi) => {
      if (!p || !String(p.name || "").trim()) errors.push(`[${id}] 采分点 ${pi} 缺少 name`);
      if (!p || !Array.isArray(p.keys) || !p.keys.length) warnings.push(`[${id}] 采分点 ${pi} 缺少 keys 关键词数组`);
      if (!p || !Array.isArray(p.acceptable)) warnings.push(`[${id}] 采分点 ${pi} 缺少 acceptable 同义表达数组`);
    });

    // 6. 采分点数量 3-5（提示）：协议约定 L1=3 个、L2=4 个核心点
    if (points.length && (points.length < 3 || points.length > 5)) {
      warnings.push(`[${id}] 采分点数量 ${points.length} 超出 3-5 区间`);
    }

    // 7. 参考答案：过短提示（协议要求“总括句 + 编号 + 概括词 + 具体事实”）
    if (typeof q.ref === "string" && q.ref.trim() && q.ref.trim().length < 30) {
      warnings.push(`[${id}] 参考答案长度 ${q.ref.trim().length} 过短，难以覆盖总括句+分点结构`);
    }
  });

  return { errors, warnings };
}

function printDistribution(arr) {
  const byType = {};
  arr.forEach(q => {
    const t = (q && q.type) || "未知";
    byType[t] = byType[t] || [];
    byType[t].push(q);
  });
  console.log(`共 ${arr.length} 道题`);
  Object.keys(byType).forEach(t => {
    const list = byType[t];
    const levels = {};
    list.forEach(q => { const l = (q && q.level) || "?"; levels[l] = (levels[l] || 0) + 1; });
    const lvStr = Object.keys(levels).sort().map(l => `${l}:${levels[l]}`).join(" ");
    console.log(`  ${t}: ${list.length} (${lvStr})`);
  });
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
    arr = loadQuestions(target);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }

  // 空输入视为失败：门禁必须有校验对象，避免空转
  if (!arr.length) {
    console.error("校验对象为空：输入中未找到任何题目对象。");
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
