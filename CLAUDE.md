# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

「规范表达练习」(Shenlun formal-expression practice) — a single-file web app that drills the micro-skill of rewriting casual/oral Chinese into formal 规范表达 (civil-service exam) register. v3 redesign「宣纸朱批」(paper-and-red-annotation). Offline = vocabulary + self-rating; Online = AI placement test → profile → adaptive question generation → AI grading.

## Running / iterating

- **Run**: double-click `启动规范练习.bat` (a desktop `.lnk` points at it). It runs `python -m http.server` on 8080, auto-incrementing to 8090 if busy, then opens the browser. There is no build step, no `node_modules`, no bundler.
- **Why http://, not file://**: the app fetches `_expanded-data.js` at runtime. Under `file://` that fetch fails CORS and falls back to a `<script>` tag injection (works, but the FSA/IndexedDB paths also behave differently — see "Gotchas"). For headless verification, serve via `python -m http.server` from the project root.
- **JS syntax check**: there is no test suite. The standing verification is `node --check` against the inline `<script>` block(s) — extract the script body into a temp `.js` and run `node --check` on it.
- **Visual verification**: `_dev/_shot.html` is an iframe harness that pre-seeds `localStorage['formal_expression_v2']` (`hasSeenWelcome=true`, optional `?theme=dark` / `?training=rewrite` / `?act=scan|select|verdict|archive|settings|type`) and drives the app for headless Chrome screenshots. Outputs land in `_dev/shots/`.

## Architecture

Everything lives in `index.html` (~4.2k lines): CSS in one `<style>` (lines ~19–1170), HTML body, then one big `<script>` (lines ~1565–4187). `gsap.min.js` is loaded locally before it (v3.15.0, offline). `_expanded-data.js` is the only separate code file — it defines three globals via `var`: `DICTIONARY` (oral→formal word maps), `QUESTION_BANK` (rewrite prompts), `SUMMARY_BANK` (概括 prompts). It is `eval`'d at boot, not imported.

### Boot sequence (`boot()`, end of file)
`initData()` (load localStorage → restore FSA file handle from IndexedDB → optional file load) → `loadExpandedData()` (fetch+eval the data file, with script-tag fallback) → `renderDomainSelect()` → `initApp()` (wire all DOM listeners) → `setTrainingMode()` → render helpers → `hideBootLoader()`. The `#bootLoader` overlay ("铺纸研墨…") is shown first-frame and removed on success; an 8s `setTimeout` safety-net force-hides it if anything hangs.

### Layered JS (top-down within the script)
- **Data layer**: `STORAGE_KEY='formal_expression_v2'`, `FILE_HANDLE_DB` (IndexedDB for the FSA handle), `D` is the live state object (shape in `.cola-task.md` appendix). `loadFromLocal`/`saveToLocal`, `openHandleDB`/`saveFileHandle`/`loadFileHandle`, FSA funcs `connectDataFile`/`authorizeDataFile`/`writeDataFile`. Mutations go through `markDirty()` → debounced `flushPersist()` (writes both localStorage and, if authorized, the file). `pagehide` does a final flush.
- **AI layer**: `PROVIDERS` map (deepseek/openai/zhipu/moonshot/qwen/doubao/siliconflow/custom — all OpenAI-compatible). `AI_SYSTEM_BASE` forces pure-JSON output. `callAI(messages, jsonMode)` wraps an inner `attempt()` with language-switch retry + `diagnoseFetchError`. `parseJSON` is strict; `isEnglishLeak` detects English leaking into Chinese output.
- **Question engine**: two training modes selected by `D.settings.trainingMode` — `'summary'` (概括训练: 01 选点 / 02 命名 / 03 成句, DOM contract `label.sentence-option > input:checkbox + span`) and `'rewrite'` (规范改写). `pickQuestion`/`pickSummaryQuestion`/`showPracticeQuestion`/`showRewriteQuestion`/`aiGenerateQuestion`. Online placement test: `startLevelTest` → `nextTestQuestion` ×5 → `finishLevelTest` builds `D.profile`.
- **Scan/proof**: `scanText` → `aiScanText` (online) or `offlineScan` (regex via `getOralWordMatcher`) → `renderScanResult` + `renderScanHistory`.
- **Render layer** (all of v3's「卷宗」): `renderArchive`/`renderArchiveStats`/`renderRadar` (SVG)/`renderProfile`/`renderFreqWords`/`renderHistory`/`renderSessionStats` (`calcStreak` for 笔耕连续天数).

### Motion
`const G = window.gsap; const MOTION = !!G && !prefers-reduced-motion`. When on, `<html>` gets class `gsap-motion` and GSAP drives destination-switch / question-in / verdict / toast / drawer animations; `.gsap-motion` rules also disable conflicting CSS transitions (e.g. `#drawer`). When GSAP fails to load or user prefers reduced motion, `MOTION=false` and the original CSS animations stand. Headless Chrome's virtual-time freezes rAF, so GSAP timing isn't reliable in screenshots — verify motion on a real browser; static end-states are checkable via `_shot.html` with reduced-motion.

### Visual system「宣纸朱批」
Three-color discipline enforced via CSS vars in `:root` (light) and `[data-theme="dark"]`: 墨 `--ink` (text), 朱 `--zhu` (annotation/action), 黛 `--dai` (reference/info), gold only as accent. Paper base `--paper` + SVG grain. Grid-paper textareas use CSS gradient + `letter-spacing = grid-cell − 1em` (one glyph per cell), `--grid-cell` is the single knob (26px default, 28 desktop, 24 mobile). No card stacks — 2–3px radius, hairline dividers, editorial whitespace. Dark mode = 墨夜 (`#15181d`) with paper-toned text; reds stay restrained. Theme is read synchronously from localStorage before `<body>` paints (anti-flash, line 6). When changing visuals, match this language — don't reintroduce cards/shadows. Reference skill: `..\skills\vintage-watercolor-style\` (per `.cola-task.md`).

## Conventions specific to this repo

- **State object `D`** is the single source of truth; never keep parallel state. After mutating `D`, call `markDirty()` (or `flushPersist()` for immediate write). The v1→v2 migration key is separate (`formal_expression_v2`); `migrateV1()` handles legacy data.
- **DOM IDs are the contract**: JS references ~87 element ids by `$('#id')`. When adding/renaming an element, grep both directions — the standing check is "every `$('#...')` resolves to an id in the HTML."
- **Two run modes** (`D.settings.mode`: `offline`/`online`) gate behavior throughout — `getApiConfig()` returns falsy in offline. Switching to online requires a configured API (enforced in `#setMode` change handler).
- **`_questionGenerating`** flag guards against concurrent question generation; check it before triggering new questions.
- **IME**: grid-paper textareas add `.ime-active` on `compositionstart` to suspend per-char grid alignment during pinyin composition, snap back on `compositionend`/`focusout`. Preserve this if touching the grid-paper CSS.
- **Backups**: before a non-trivial `index.html` edit, copy to `_backups/index.vN.backup.html` (next number). The version log + design rationale lives in `.cola-task.md` (read its v3 / v22 / v23 sections for why things are the way they are before redesigning).

## Gotchas

- **`file://` vs `http://`**: IndexedDB and FSA behave differently (and historically hung boot under `file://` in headless). `openHandleDB()` has a 2.5s timeout that degrades to `null` (skips file-handle restore, localStorage still works); `boot()` has an 8s force-hide. Do not remove these safety nets — they prevent the user from being stuck on "铺纸研墨".
- **`_expanded-data.js` load failure** shows a toast and falls back to empty DICTIONARY/QUESTION_BANK/SUMMARY_BANK — silent feature loss. If the bank seems empty, check the fetch/eval path.
- **Headless screenshots under virtual-time** can't reliably reproduce GSAP or timer-driven states; use reduced-motion or a real browser for motion verification.
