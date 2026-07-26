#!/usr/bin/env node
/*
 * _dev/check.js — 最小可一键复跑校验脚本 (no build system, no deps)
 *
 * 对 规范表达练习.html 做两件事：
 *   1) 抽取每个内联 <script> 块，写临时 .js 跑 `node --check` 做语法检查
 *   2) 校验 HTML 中每个静态 $('#id') / $$('#id') 引用都能在文档里找到对应 id
 *
 * 用法：
 *   node _dev/check.js                    # 默认校验 ../规范表达练习.html
 *   node _dev/check.js path/to/other.html # 校验指定文件
 *
 * 退出码：全部通过 0，任一失败 1（并打印具体 行:列 / 行号 位置）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const htmlPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', '规范表达练习.html');

if (!fs.existsSync(htmlPath)) {
  console.error(`✗ 找不到文件: ${htmlPath}`);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const rel = path.relative(process.cwd(), htmlPath) || htmlPath;

// —— 把字符下标换算成 行:列（1-based），用于可读的错误定位 ——
function locOf(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const col = index - before.lastIndexOf('\n');
  return { line, col };
}

let failed = 0;

// ============================================================
// 1) 内联 <script> 语法检查（node --check）
// ============================================================
console.log(`\n== 语法检查 (node --check) — ${rel} ==`);

const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let sm;
let scriptCount = 0;

while ((sm = scriptRe.exec(html))) {
  const attrs = sm[1] || '';
  const body = sm[2] || '';
  // 跳过外链脚本与非 JS 类型（如 application/json）
  if (/\bsrc\s*=/.test(attrs)) continue;
  const typeMatch = attrs.match(/\btype\s*=\s*(['"])([^'"]*)\1/i);
  if (typeMatch && !/(text|application)\/(java|ecma)script/i.test(typeMatch[2])) continue;
  if (!body.trim()) continue;

  scriptCount++;
  // 该 <script> 体在 HTML 中的起始行
  const bodyStartIndex = scriptRe.lastIndex - '</script>'.length - body.length;
  const startLine = locOf(html, bodyStartIndex).line;

  const tmp = path.join(
    os.tmpdir(),
    `check-${process.pid}-${scriptCount}-${Math.random().toString(36).slice(2)}.js`
  );
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`  ✓ script #${scriptCount} (HTML 起始行 ${startLine}) 语法通过`);
  } catch (e) {
    failed++;
    const out = `${e.stderr ? e.stderr.toString() : ''}${e.stdout ? e.stdout.toString() : ''}`;
    const mLine = out.match(/:(\d+)\r?\n/); // 临时文件里的相对行号
    const relLine = mLine ? parseInt(mLine[1], 10) : null;
    const mErr = out.match(/^([A-Za-z]*Error:.*)$/m);
    const msg = mErr ? mErr[1] : out.trim().split('\n').slice(0, 3).join(' ');
    const htmlLine = relLine != null ? startLine + relLine - 1 : null;
    console.log(`  ✗ script #${scriptCount} 语法错误`);
    console.log(`      ${msg}`);
    if (htmlLine != null) {
      console.log(`      位置: ${rel}:${htmlLine} (script 内第 ${relLine} 行, 该 script 从 HTML 第 ${startLine} 行开始)`);
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

if (scriptCount === 0) console.log('  (未发现可检查的内联脚本)');

// ============================================================
// 2) $('#id') / $$('#id') 引用 → id 存在性校验
// ============================================================
console.log(`\n== DOM id 引用校验 ($('#id') 是否存在) ==`);

// 收集文档中出现的所有 id（含静态 HTML 与 JS 模板字符串里的 id="...")
const idSet = new Set();
let m;
const idAttrRe = /\bid\s*=\s*(['"])([A-Za-z0-9_\-:.]+)\1/g;
while ((m = idAttrRe.exec(html))) idSet.add(m[2]);
// JS 里动态赋值：el.id = 'x'
const idAssignRe = /\.id\s*=\s*(['"])([A-Za-z0-9_\-:.]+)\1/g;
while ((m = idAssignRe.exec(html))) idSet.add(m[2]);
// setAttribute('id', 'x')
const setAttrRe = /setAttribute\(\s*(['"])id\1\s*,\s*(['"])([A-Za-z0-9_\-:.]+)\2/g;
while ((m = setAttrRe.exec(html))) idSet.add(m[3]);

// 匹配以「单个字符串字面量」为参数的 $()/$$() 调用；
// 拼接/模板串（动态选择器）不满足此形，自动跳过。
const refRe = /\$\$?\(\s*(['"])([^'"]*)\1\s*\)/g;
const idTokenRe = /#([A-Za-z0-9_\-]+)/g;
let refCount = 0;
let missingCount = 0;

while ((m = refRe.exec(html))) {
  const selector = m[2];
  if (selector.indexOf('#') === -1) continue; // 非 id 选择器
  const matchIndex = m.index;
  let t;
  idTokenRe.lastIndex = 0;
  while ((t = idTokenRe.exec(selector))) {
    const id = t[1];
    refCount++;
    if (!idSet.has(id)) {
      missingCount++;
      failed++;
      const { line, col } = locOf(html, matchIndex);
      console.log(`  ✗ 引用了不存在的 id: #${id}  →  ${rel}:${line}:${col}  (选择器 "${selector}")`);
    }
  }
}

console.log(`  已检查 ${refCount} 处 id 引用；文档内已知 id 共 ${idSet.size} 个。`);
if (missingCount === 0) console.log('  ✓ 所有 $(\'#id\') 引用均可解析。');

// ============================================================
// 结果
// ============================================================
console.log('');
if (failed > 0) {
  console.error(`✗ 校验未通过：发现 ${failed} 处问题。`);
  process.exit(1);
}
console.log('✓ 全部通过。');
process.exit(0);
