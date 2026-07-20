# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

「规范表达练习」(Shenlun formal-expression practice) — a single-file web app that drills the micro-skill of rewriting casual/oral Chinese into formal 规范表达 (civil-service exam) register. v3 redesign「宣纸朱批」(paper-and-red-annotation). Offline = vocabulary + self-rating; Online = AI placement test → profile → adaptive question generation → AI grading.

## Running / iterating

- **Run**: double-click `启动规范练习.bat` (or a desktop `.lnk` pointing at it). It runs `python -m http.server` on 8080, auto-incrementing to 8090 if busy, then opens the browser. There is no build step, no `node_modules`, no bundler.
- **Why http://, not file://**: FSA (File System Access API) and IndexedDB behave differently under `file://` and historically hung boot in headless. For headless verification, serve via `python -m http.server` from the project root.
- **JS syntax check**: there is no test suite. The standing verification is `node --check` against the inline `<script>` block(s) — extract the script body into a temp `.js` and run `node --check` on it.
- **Visual verification**: `_dev/_shot.html` is an iframe harness that pre-seeds `localStorage['formal_expression_v2']` (`hasSeenWelcome=true`, optional `?theme=dark` / `?training=rewrite` / `?act=scan|select|verdict|archive|settings|type`) and drives the app for headless Chrome screenshots. Outputs land in `_dev/shots/`.

## Architecture

Everything lives in `规范表达练习.html` (~4.9k lines, self-contained): CSS in one `<style>` (lines ~19–1200), HTML body, GSAP 3.15.0 inlined in its own `<script>` tag (lines ~1607–1618), then one big app `<script>` (lines ~1619–end). No external JS dependencies. Data (DICTIONARY, QUESTION_BANK, SUMMARY_BANK) is inlined as plain `var` declarations within the app script — no fetch, no eval.

### Boot sequence (`boot()`, end of file)
`initData()` (load localStorage → restore FSA file handle from IndexedDB → optional file load) → `renderDomainSelect()` → `initApp()` (wire all DOM listeners) → `setTrainingMode()` → render helpers → `hideBootLoader()`. The `#bootLoader` overlay ("铺纸研墨…") is shown first-frame and removed on success; an 8s `setTimeout` safety-net force-hides it if anything hangs.

### Layered JS (top-down within the script)
- **Data layer**: `STORAGE_KEY='formal_expression_v2'`, `FILE_HANDLE_DB` (IndexedDB for the FSA handle), `D` is the live state object (练习数据 only). API 配置 (provider/apiKey/model/baseUrl/temperature/maxTokens) is stored **separately** in `API_SETTINGS_KEY='formal_expression_api_settings_v1'`, never in `D.settings` — this prevents旧数据文件/清空记录/切离线时覆盖本地 apiKey. `loadApiSettings`/`saveApiSettings` 读写, `mergeApiSettingsFromFile` 本地优先合并(载入数据文件时仅本地为空才从文件补充), `migrateApiSettingsFromLegacy` 一次性迁移老 `D.settings.apiKey`. `loadFromLocal`/`saveToLocal`, `openHandleDB`/`saveFileHandle`/`loadFileHandle`, FSA funcs `connectDataFile`/`authorizeDataFile`/`writeDataFile`. Mutations go through `markDirty()` → debounced `flushPersist()` (writes both localStorage and, if authorized, the file). `pagehide` does a final synchronous `saveToLocal()` + best-effort async `writeDataFile()`.
- **AI layer**: `PROVIDERS` map (deepseek/openai/zhipu/moonshot/qwen/doubao/siliconflow/custom — all OpenAI-compatible). `AI_SYSTEM_BASE` forces pure-JSON output. `callAI(messages, jsonMode)` wraps an inner `attempt()` with: jsonMode 400 fallback (provider doesn't support response_format), transient-error retry (429/502/503, max 2 retries with exponential backoff), English-leak retry + `diagnoseFetchError`. `parseJSON` is strict; `isEnglishLeak` detects English leaking into Chinese output.
- **Question engine**: two training modes selected by `D.settings.trainingMode` — `'summary'` (概括训练: 01 选点 / 02 命名 / 03 成句, DOM contract `label.sentence-option > input:checkbox + span`) and `'rewrite'` (规范改写). `pickQuestion`/`pickSummaryQuestion`/`showPracticeQuestion`/`showRewriteQuestion`/`aiGenerateQuestion`. Online placement test: `startLevelTest` → `nextTestQuestion` ×5 → `finishLevelTest` builds `D.profile`.
- **Scan/proof**: `scanText` → `aiScanText` (online) or `offlineScan` (regex via `getOralWordMatcher`) → `renderScanResult` + `renderScanHistory`.
- **Render layer** (all of v3's「卷宗」): `renderArchive`/`renderArchiveStats`/`renderRadar` (SVG)/`renderProfile`/`renderFreqWords`/`renderHistory`/`renderSessionStats` (`calcStreak` for 笔耕连续天数).

### Motion
`const G = window.gsap; const MOTION = !!G && !prefers-reduced-motion`. When on, `<html>` gets class `gsap-motion` and GSAP drives destination-switch / question-in / verdict / toast / drawer animations; `.gsap-motion` rules also disable conflicting CSS transitions (e.g. `#drawer`). When GSAP fails to load or user prefers reduced motion, `MOTION=false` and the original CSS animations stand. Headless Chrome's virtual-time freezes rAF, so GSAP timing isn't reliable in screenshots — verify motion on a real browser; static end-states are checkable via `_shot.html` with reduced-motion.

### Visual system「宣纸朱批」
Three-color discipline enforced via CSS vars in `:root` (light) and `[data-theme="dark"]`: 墨 `--ink` (text), 朱 `--zhu` (annotation/action), 黛 `--dai` (reference/info), gold only as accent. Paper base `--paper` + SVG grain. Grid-paper textareas use CSS gradient + `letter-spacing = grid-cell − 1em` (one glyph per cell), `--grid-cell` is the single knob (26px default, 28 desktop, 24 mobile). No card stacks — 2–3px radius, hairline dividers, editorial whitespace. Dark mode = 墨夜 (`#15181d`) with paper-toned text; reds stay restrained. Theme is read synchronously from localStorage before `<body>` paints (anti-flash, line 6). When changing visuals, match this language — don't reintroduce cards/shadows. Reference skill: `..\..\..\skills\vintage-watercolor-style\`.

## Conventions specific to this repo

- **State object `D`** is the single source of truth; never keep parallel state. After mutating `D`, call `markDirty()` (or `flushPersist()` for immediate write). The v1→v2 migration key is separate (`formal_expression_v2`); `migrateV1()` handles legacy data.
- **DOM IDs are the contract**: JS references ~87 element ids by `$('#id')`. When adding/renaming an element, grep both directions — the standing check is "every `$('#...')` resolves to an id in the HTML."
- **Two run modes** (`D.settings.mode`: `offline`/`online`) gate behavior throughout — `getApiConfig()` returns falsy in offline. Switching to online requires a configured API (enforced in `#setMode` change handler).
- **离线概括训练不输出分数**: `assessSummary()` 返回结构化结果 (selectedFacts/missedFacts/coveredPoints/namesMatched/expressionIssues) 但**不打分** — 离线只展示"答案对照 + 过程统计"(覆盖 X/Y 组采分点), 顶部标注"离线答案对照 · 题库预设, 非 AI 批改". 改写 AI 批改 (`aiSubmitAnswer`) 保留 10 分制; 概括训练 AI 批改 (`aiAssessSummary`) 返回逐语义单元 `units[]` (status: covered/partial/missing/extra/uncertain) + `dimensions` + `nextFocus`, 顶部标注"AI 批改 · 模型:XXX", 失败降级离线对照并标"AI 失败降级". `renderHistory` 区分: AI summary 记录显示 `score/10` 且按分数判错题, 离线 summary 记录显示"概括 X/Y"且按 `summaryFeedback` 未达标层判待加强.
- **题库时效字段**: `SUMMARY_BANK` 样板题带 `source`/`sourceDate`/`sourceType`/`topicTags`/`timeliness`/`timelinessNote`. 材料为基于真实政策的压缩改写, `sourceType` 标"政策文件(材料为压缩改写)"; **不得伪造 `sourceDate`** (查不到留空). 已完成的阶段性议题(脱贫攻坚等)只作历史背景.
- **`_questionGenerating`** flag guards against concurrent question generation; check it before triggering new questions.
- **IME**: grid-paper textareas add `.ime-active` on `compositionstart` to suspend per-char grid alignment during pinyin composition, snap back on `compositionend`/`focusout`. Preserve this if touching the grid-paper CSS.
- **Backups**: before a non-trivial edit, copy to `_backups/规范表达练习_pre-vN-<desc>.html`. Design rationale for past changes is in git history (`.cola-task.md` no longer exists; do not reference it).

## Gotchas

- **`file://` vs `http://`**: IndexedDB and FSA behave differently (and historically hung boot under `file://` in headless). `openHandleDB()` has a 2.5s timeout that degrades to `null` (skips file-handle restore, localStorage still works); `boot()` has an 8s force-hide. Do not remove these safety nets — they prevent the user from being stuck on "铺纸研墨".
- **Headless screenshots under virtual-time** can't reliably reproduce GSAP or timer-driven states; use reduced-motion or a real browser for motion verification.
- **File size**: the single file is ~400KB+ (GSAP accounts for ~60KB minified). Edits are manageable but keep the layered structure in mind — data declarations sit between helpers and the question engine.
