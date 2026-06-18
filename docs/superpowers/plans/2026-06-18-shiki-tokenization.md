# Shiki Tokenization & Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Monaco's coarse Monarch tokenizer with Shiki TextMate grammars for PHP + the web stack (VS-Code-grade highlighting without a language server), and theme via real VS Code theme JSONs (bundled) + custom themes generated from our palettes.

**Architecture:** A singleton Shiki highlighter (JS regex engine, no WASM) loads the chosen grammars and themes; `@shikijs/monaco`'s `shikiToMonaco(highlighter, monaco)` overrides Monaco's tokenizer in `beforeMount`. Custom themes are generated from reused `ThemePalette` objects via `buildShikiTheme`. Chrome (`App.css`), terminal, and LSP intelligence are untouched.

**Tech Stack:** `shiki` + `@shikijs/monaco` + `shiki/engine/javascript`, Monaco editor, React, vitest, Tauri/Vite.

## Global Constraints

- **Commits at user's discretion.** Do NOT commit; each task ends with `npm run check && npm test`.
- **No WASM:** use the JavaScript regex engine (`createJavaScriptRegexEngine`); WASM oniguruma is a fallback only.
- **Local only:** fine-grained dynamic imports of grammars/themes (`createHighlighterCore`) — no CDN (Tauri offline).
- **Languages:** `php`, `blade`, `javascript`, `typescript`, `json`, `css`, `scss`, `html`, `yaml`, `markdown`, `sql`.
- **Bundled Shiki themes (pixel-perfect):** `dracula`, `one-dark-pro`, `catppuccin-mocha`, `catppuccin-latte`. **Custom (from palettes):** `ayu-mirage`, `material-deep-ocean`, `one-light`, `calm-dark`, `calm-light`.
- **Unchanged:** `App.css` chrome tokens, `terminalThemeForAppTheme`, all LSP providers, Monaco language workers.
- App-theme → Shiki-theme name map: dark/system→`calm-dark`, light/system-light→`calm-light`, ayuMirage→`ayu-mirage`, materialDeepOcean→`material-deep-ocean`, oneDarkPro→`one-dark-pro`, dracula→`dracula`, catppuccinMocha→`catppuccin-mocha`, catppuccinLatte→`catppuccin-latte`, oneLight→`one-light`.

## File Structure

- **Create** `src/components/themePalettes.ts` — `ThemePalette` interface + the 5 custom palette objects (`calmDark`, `calmLight`, `ayuMirage`, `materialDeepOcean`, `oneLight`).
- **Create** `src/infrastructure/shikiHighlighter.ts` — `buildShikiTheme(palette)`, `createAppHighlighter()`, `setupShikiTokenization(monaco)`, `APP_SHIKI_THEMES` constant.
- **Create** `src/infrastructure/shikiHighlighter.test.ts` and `src/components/themePalettes.test.ts`.
- **Modify** `src/domain/settings.ts` — `MonacoAppTheme` union + `monacoThemeForAppTheme` → Shiki theme names.
- **Modify** `src/components/EditorSurface.tsx` + `src/components/GitDiffPreview.tsx` — call `setupShikiTokenization` instead of `registerMonacoAppThemes`.
- **Delete** `src/components/monacoThemes.ts` + `src/components/monacoThemes.test.ts` (superseded).

---

### Task 1: Theme palettes + `buildShikiTheme`

**Files:**
- Create: `src/components/themePalettes.ts`, `src/infrastructure/shikiHighlighter.ts` (only `buildShikiTheme` + types in this task), `src/infrastructure/shikiHighlighter.test.ts`

**Interfaces:**
- Produces: `interface ThemePalette`; the 5 palette consts; `buildShikiTheme(p: ThemePalette): { name: string; type: "dark" | "light"; colors: Record<string,string>; tokenColors: Array<{ scope: string[]; settings: { foreground?: string; fontStyle?: string } }> }`.

- [ ] **Step 1: Create `src/components/themePalettes.ts`** with the interface and 5 palettes:

```ts
export interface ThemePalette {
  name: string;
  base: "vs" | "vs-dark";
  bg: string; fg: string; lineHighlight: string; selection: string;
  cursor: string; lineNumber: string; lineNumberActive: string; whitespace: string;
  widgetBg: string; border: string; selectedBg: string; selectedFg: string;
  accent: string; inputBg: string; diffInserted: string; diffRemoved: string;
  keyword: string; func: string; type: string; string: string; number: string;
  variable: string; parameter: string; property: string; constant: string;
  operator: string; comment: string; commentItalic: boolean; namespace: string; regexp: string;
}

export const calmDark: ThemePalette = {
  name: "calm-dark", base: "vs-dark",
  bg: "#16181d", fg: "#c2c8d2", lineHighlight: "#1d2026", selection: "#28323d",
  cursor: "#8aa9c9", lineNumber: "#5e6573", lineNumberActive: "#c2c8d2", whitespace: "#2c303a",
  widgetBg: "#1b1e24", border: "#2c303a", selectedBg: "#23303a", selectedFg: "#eef1f5",
  accent: "#8aa9c9", inputBg: "#16181d", diffInserted: "#8fbcae22", diffRemoved: "#d98b8b22",
  keyword: "#b48ead", func: "#8aa9c9", type: "#d8b878", string: "#8fbcae", number: "#d8b878",
  variable: "#c2c8d2", parameter: "#c2c8d2", property: "#c2c8d2", constant: "#d8b878",
  operator: "#8b94a3", comment: "#5e6573", commentItalic: true, namespace: "#d8b878", regexp: "#8fbcae",
};

export const calmLight: ThemePalette = {
  name: "calm-light", base: "vs",
  bg: "#f5f7f9", fg: "#3a4654", lineHighlight: "#eef1f4", selection: "#d3e1e7",
  cursor: "#3d7c8a", lineNumber: "#9aa7b6", lineNumberActive: "#3a4654", whitespace: "#cfd6de",
  widgetBg: "#ffffff", border: "#e2e7ec", selectedBg: "#dbe8ed", selectedFg: "#1b2733",
  accent: "#3d7c8a", inputBg: "#ffffff", diffInserted: "#2a7d6f22", diffRemoved: "#b0565622",
  keyword: "#8a5c8f", func: "#3d7c8a", type: "#9a7016", string: "#2a7d6f", number: "#9a7016",
  variable: "#3a4654", parameter: "#3a4654", property: "#3a4654", constant: "#9a7016",
  operator: "#5d6b7a", comment: "#74808f", commentItalic: true, namespace: "#9a7016", regexp: "#2a7d6f",
};

export const ayuMirage: ThemePalette = {
  name: "ayu-mirage", base: "vs-dark",
  bg: "#1f2430", fg: "#cccac2", lineHighlight: "#242b38", selection: "#33415e",
  cursor: "#ffcc66", lineNumber: "#707a8c", lineNumberActive: "#ffd580", whitespace: "#3b4557",
  widgetBg: "#242b38", border: "#3a4453", selectedBg: "#2f3a4f", selectedFg: "#fff3d4",
  accent: "#ffcc66", inputBg: "#1f2430", diffInserted: "#95e6cb22", diffRemoved: "#f2877922",
  keyword: "#ffad66", func: "#ffd173", type: "#73d0ff", string: "#d5ff80", number: "#ffcc66",
  variable: "#cccac2", parameter: "#dfbfff", property: "#f28779", constant: "#ffcc66",
  operator: "#f29e74", comment: "#5c6773", commentItalic: true, namespace: "#73d0ff", regexp: "#95e6cb",
};

export const materialDeepOcean: ThemePalette = {
  name: "material-deep-ocean", base: "vs-dark",
  bg: "#0f111a", fg: "#a6accd", lineHighlight: "#161b2a", selection: "#1f2233",
  cursor: "#84ffff", lineNumber: "#3b4868", lineNumberActive: "#84ffff", whitespace: "#2a3148",
  widgetBg: "#161a26", border: "#2f3754", selectedBg: "#20305a", selectedFg: "#ffffff",
  accent: "#84ffff", inputBg: "#0f111a", diffInserted: "#c3e88d22", diffRemoved: "#f0717822",
  keyword: "#c792ea", func: "#82aaff", type: "#ffcb6b", string: "#c3e88d", number: "#f78c6c",
  variable: "#eeffff", parameter: "#eeffff", property: "#eeffff", constant: "#f78c6c",
  operator: "#89ddff", comment: "#717cb4", commentItalic: true, namespace: "#ffcb6b", regexp: "#89ddff",
};

export const oneLight: ThemePalette = {
  name: "one-light", base: "vs",
  bg: "#fafafa", fg: "#383a42", lineHighlight: "#f0f0f1", selection: "#cfcfcf",
  cursor: "#526fff", lineNumber: "#9d9d9f", lineNumberActive: "#383a42", whitespace: "#d4d4d4",
  widgetBg: "#ffffff", border: "#dcdcdc", selectedBg: "#e5e5e6", selectedFg: "#1c1d22",
  accent: "#4078f2", inputBg: "#ffffff", diffInserted: "#50a14f22", diffRemoved: "#e4564922",
  keyword: "#a626a4", func: "#4078f2", type: "#c18401", string: "#50a14f", number: "#986801",
  variable: "#e45649", parameter: "#383a42", property: "#e45649", constant: "#986801",
  operator: "#383a42", comment: "#a0a1a7", commentItalic: true, namespace: "#c18401", regexp: "#e45649",
};

export const customPalettes: ThemePalette[] = [
  calmDark, calmLight, ayuMirage, materialDeepOcean, oneLight,
];
```

- [ ] **Step 2: Write the failing test** `src/infrastructure/shikiHighlighter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildShikiTheme } from "./shikiHighlighter";
import { ayuMirage } from "../components/themePalettes";

describe("buildShikiTheme", () => {
  it("maps palette to a TextMate theme", () => {
    const theme = buildShikiTheme(ayuMirage);
    expect(theme.name).toBe("ayu-mirage");
    expect(theme.type).toBe("dark");
    expect(theme.colors["editor.background"]).toBe("#1f2430");
    const scopeColor = (scope: string) =>
      theme.tokenColors.find((t) => t.scope.includes(scope))?.settings.foreground;
    expect(scopeColor("entity.name.function")).toBe("#ffd173");
    expect(scopeColor("keyword")).toBe("#ffad66");
    expect(scopeColor("variable.parameter")).toBe("#dfbfff");
    expect(scopeColor("constant.numeric")).toBe("#ffcc66");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`buildShikiTheme` not defined). Run: `npm test -- shikiHighlighter`

- [ ] **Step 4: Create `src/infrastructure/shikiHighlighter.ts`** with `buildShikiTheme` only (highlighter functions come in Task 2):

```ts
import type { ThemePalette } from "../components/themePalettes";

export interface ShikiThemeRegistration {
  name: string;
  type: "dark" | "light";
  colors: Record<string, string>;
  tokenColors: Array<{ scope: string[]; settings: { foreground?: string; fontStyle?: string } }>;
}

export function buildShikiTheme(p: ThemePalette): ShikiThemeRegistration {
  const tok = (scope: string[], foreground: string, italic = false) => ({
    scope,
    settings: italic ? { foreground, fontStyle: "italic" } : { foreground },
  });
  return {
    name: p.name,
    type: p.base === "vs" ? "light" : "dark",
    colors: {
      "editor.background": p.bg,
      "editor.foreground": p.fg,
      "editor.lineHighlightBackground": p.lineHighlight,
      "editor.selectionBackground": p.selection,
      "editorCursor.foreground": p.cursor,
      "editorLineNumber.foreground": p.lineNumber,
      "editorLineNumber.activeForeground": p.lineNumberActive,
      "editorWhitespace.foreground": p.whitespace,
      "editorSuggestWidget.background": p.widgetBg,
      "editorSuggestWidget.border": p.border,
      "editorSuggestWidget.foreground": p.fg,
      "editorSuggestWidget.selectedBackground": p.selectedBg,
      "editorSuggestWidget.highlightForeground": p.accent,
      "editorWidget.background": p.widgetBg,
      "editorWidget.border": p.border,
      "editorHoverWidget.background": p.widgetBg,
      "editorHoverWidget.border": p.border,
      "input.background": p.inputBg,
      "input.border": p.border,
      focusBorder: p.accent,
      "diffEditor.insertedTextBackground": p.diffInserted,
      "diffEditor.removedTextBackground": p.diffRemoved,
    },
    tokenColors: [
      tok(["comment", "punctuation.definition.comment"], p.comment, p.commentItalic),
      tok(["string", "string.quoted"], p.string),
      tok(["constant.character.escape", "string.regexp"], p.regexp),
      tok(["keyword", "storage", "keyword.control", "storage.modifier"], p.keyword),
      tok(["constant.numeric"], p.number),
      tok(["constant.language", "constant.other", "support.constant"], p.constant),
      tok(["entity.name.function", "support.function", "meta.function-call"], p.func),
      tok(["entity.name.type", "entity.name.class", "support.class", "storage.type"], p.type),
      tok(["variable", "variable.other"], p.variable),
      tok(["variable.parameter"], p.parameter),
      tok(["variable.other.property", "variable.other.object.property", "meta.property"], p.property),
      tok(["entity.name.namespace", "support.other.namespace"], p.namespace),
      tok(["keyword.operator", "punctuation"], p.operator),
    ],
  };
}
```

- [ ] **Step 5: Run the test — expect PASS.** Run: `npm test -- shikiHighlighter` then `npm run check`. Expected: green.

---

### Task 2: Highlighter + Monaco wiring helper

**Files:**
- Modify: `src/infrastructure/shikiHighlighter.ts` (add highlighter functions)
- Modify: `package.json` (add deps)
- Test: `src/infrastructure/shikiHighlighter.test.ts`

**Interfaces:**
- Consumes: `buildShikiTheme`, `customPalettes`.
- Produces: `createAppHighlighter(): Promise<Highlighter>`, `setupShikiTokenization(monaco): Promise<void>`, `APP_SHIKI_THEMES: string[]`, `SHIKI_LANGS: string[]`.

- [ ] **Step 1: Install deps.** Run: `npm install shiki @shikijs/monaco`
Expected: both added to `package.json` dependencies; `npm run check` still clean.

- [ ] **Step 2: Add the highlighter to `src/infrastructure/shikiHighlighter.ts`:**

```ts
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { shikiToMonaco } from "@shikijs/monaco";
import { customPalettes } from "../components/themePalettes";

export const SHIKI_LANGS = [
  "php", "blade", "javascript", "typescript", "json",
  "css", "scss", "html", "yaml", "markdown", "sql",
] as const;

export const APP_SHIKI_THEMES = [
  "dracula", "one-dark-pro", "catppuccin-mocha", "catppuccin-latte",
  "calm-dark", "calm-light", "ayu-mirage", "material-deep-ocean", "one-light",
] as const;

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function createAppHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) {
    return highlighterPromise;
  }
  highlighterPromise = createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    themes: [
      import("shiki/themes/dracula.mjs"),
      import("shiki/themes/one-dark-pro.mjs"),
      import("shiki/themes/catppuccin-mocha.mjs"),
      import("shiki/themes/catppuccin-latte.mjs"),
      ...customPalettes.map((palette) => buildShikiTheme(palette)),
    ],
    langs: [
      import("shiki/langs/php.mjs"),
      import("shiki/langs/blade.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/scss.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/yaml.mjs"),
      import("shiki/langs/markdown.mjs"),
      import("shiki/langs/sql.mjs"),
    ],
  });
  return highlighterPromise;
}

type MonacoLanguages = {
  languages: { register(language: { id: string }): void; getLanguages(): Array<{ id: string }> };
};

export async function setupShikiTokenization(
  monaco: MonacoLanguages & Parameters<typeof shikiToMonaco>[1],
): Promise<void> {
  const highlighter = await createAppHighlighter();
  const registered = new Set(monaco.languages.getLanguages().map((l) => l.id));
  for (const id of SHIKI_LANGS) {
    if (!registered.has(id)) {
      monaco.languages.register({ id });
    }
  }
  shikiToMonaco(highlighter, monaco);
}
```

- [ ] **Step 3: Extend the test** in `src/infrastructure/shikiHighlighter.test.ts`:

```ts
import { createAppHighlighter, APP_SHIKI_THEMES, SHIKI_LANGS } from "./shikiHighlighter";

describe("createAppHighlighter", () => {
  it("loads all app themes and languages", async () => {
    const hl = await createAppHighlighter();
    for (const theme of APP_SHIKI_THEMES) {
      expect(hl.getLoadedThemes()).toContain(theme);
    }
    for (const lang of SHIKI_LANGS) {
      expect(hl.getLoadedLanguages()).toContain(lang);
    }
  });
});
```

- [ ] **Step 4: Run.** Run: `npm test -- shikiHighlighter` and `npm run check`.
Expected: PASS. If a `shiki/langs/blade.mjs` import path errors, check the installed shiki version's lang path (`ls node_modules/shiki/dist/langs | grep blade`) and correct the specifier. If `getLoadedThemes`/`getLoadedLanguages` names differ in the installed version, adjust to the actual API (`hl.getLoadedThemes()` is current). If the JS engine throws on a grammar, the `forgiving: true` option already suppresses; only if highlighting is wrong, switch `engine` to `createOnigurumaEngine(import("shiki/wasm"))`.

---

### Task 3: Wire into the editor + theme mapping; remove Monaco themes

**Files:**
- Modify: `src/domain/settings.ts`, `src/domain/settings.test.ts`
- Modify: `src/components/EditorSurface.tsx`, `src/components/GitDiffPreview.tsx`
- Delete: `src/components/monacoThemes.ts`, `src/components/monacoThemes.test.ts`

**Interfaces:**
- Consumes: `setupShikiTokenization`. `monacoThemeForAppTheme` now returns Shiki theme names.

- [ ] **Step 1: Update the mapping test** `src/domain/settings.test.ts` (the `monacoThemeForAppTheme` block) to expect Shiki names:

```ts
    expect(monacoThemeForAppTheme("light")).toBe("calm-light");
    expect(monacoThemeForAppTheme("dark")).toBe("calm-dark");
    expect(monacoThemeForAppTheme("system")).toBe("calm-dark");
    expect(monacoThemeForAppTheme("system", true)).toBe("calm-light");
    expect(monacoThemeForAppTheme("ayuMirage")).toBe("ayu-mirage");
    expect(monacoThemeForAppTheme("materialDeepOcean")).toBe("material-deep-ocean");
    expect(monacoThemeForAppTheme("oneDarkPro")).toBe("one-dark-pro");
    expect(monacoThemeForAppTheme("dracula")).toBe("dracula");
    expect(monacoThemeForAppTheme("catppuccinMocha")).toBe("catppuccin-mocha");
    expect(monacoThemeForAppTheme("catppuccinLatte")).toBe("catppuccin-latte");
    expect(monacoThemeForAppTheme("oneLight")).toBe("one-light");
```

- [ ] **Step 2: Update `MonacoAppTheme` + `monacoThemeForAppTheme` in `src/domain/settings.ts`.** Replace the union with the Shiki names and rewrite the mapper:

```ts
export type MonacoAppTheme =
  | "calm-dark" | "calm-light" | "ayu-mirage" | "material-deep-ocean"
  | "one-dark-pro" | "dracula" | "catppuccin-mocha" | "catppuccin-latte" | "one-light";

export function monacoThemeForAppTheme(theme: AppTheme, prefersLight = false): MonacoAppTheme {
  if (theme === "ayuMirage") return "ayu-mirage";
  if (theme === "materialDeepOcean") return "material-deep-ocean";
  if (theme === "oneDarkPro") return "one-dark-pro";
  if (theme === "dracula") return "dracula";
  if (theme === "catppuccinMocha") return "catppuccin-mocha";
  if (theme === "catppuccinLatte") return "catppuccin-latte";
  if (theme === "oneLight") return "one-light";
  if (resolveAppTheme(theme, prefersLight) === "light") return "calm-light";
  return "calm-dark";
}
```

(Keep the existing early returns' guard-clause style; do not use `else`.)

- [ ] **Step 3: Wire the editor.** In `src/components/EditorSurface.tsx`, replace the `registerMonacoAppThemes(monaco)` import + call. Import `setupShikiTokenization` from `../infrastructure/shikiHighlighter`; in `beforeMount` replace `registerMonacoAppThemes(monaco)` with:

```ts
    void setupShikiTokenization(monaco).then(() => {
      monaco.editor.setTheme(monacoThemeRef.current);
    });
```

where `monacoThemeRef` is a ref holding the current `monacoTheme` prop (add `const monacoThemeRef = useRef(monacoTheme); useEffect(() => { monacoThemeRef.current = monacoTheme; }, [monacoTheme]);`). The `<Editor theme={monacoTheme} />` prop still applies the theme once Shiki registers it; the `.then(setTheme)` re-applies after async load to avoid a stale default. Do the same import+call swap in `src/components/GitDiffPreview.tsx`.

- [ ] **Step 4: Delete** `src/components/monacoThemes.ts` and `src/components/monacoThemes.test.ts`. Run: `git rm src/components/monacoThemes.ts src/components/monacoThemes.test.ts` (or delete the files). Fix any remaining import of `registerMonacoAppThemes` (grep: `grep -rn registerMonacoAppThemes src`).

- [ ] **Step 5: Verify.** Run: `npm run check && npm test`. Expected: type-check clean (no dangling `MonacoAppTheme` mismatches; `EditorSurface.test.tsx` passes `monacoTheme="vs-dark"` as a prop — update those literals to `"calm-dark"`), all tests green.

---

### Task 4: Full verification + review

- [ ] **Step 1: Full gate.** Run: `npm run check && npm test && npm run build`. All green. Note bundle size delta from the build output.

- [ ] **Step 2: Manual — tokenization (IDE Mode OFF).** Run the app, open a PHP file with IDE Mode off. Confirm method calls (`->m()`), object properties, class references, `$this`, and PHPDoc tags (`@throws`) are now distinctly colored (previously flat). Open a Blade, JS/TS, CSS/SCSS, JSON, YAML, Markdown, SQL file and confirm highlighting.

- [ ] **Step 3: Manual — themes.** Switch every theme in Settings → Appearance; confirm editor colors load (bundled Dracula/One Dark Pro/Catppuccin match VS Code; custom Ayu/Ocean/One Light/Calm read correctly and the editor background matches the chrome). Confirm no stale-Monarch flash on open.

- [ ] **Step 4: Automated review.** Run: `coderabbit review --agent --base main`; address valid findings.

- [ ] **Step 5: Report.** Summarize, confirm gates green and bundle delta, leave commit to the user.
