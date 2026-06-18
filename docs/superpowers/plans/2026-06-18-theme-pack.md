# Theme Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-tune Ayu Mirage and Material Deep Ocean to their canonical palettes and add five complete themes (One Dark Pro, Dracula, Catppuccin Mocha, Catppuccin Latte, One Light), each fully coloring every app surface — editor + syntax, completion/hover popups, palettes, git, settings, terminal.

**Architecture:** A palette-driven Monaco theme builder (`ThemePalette` + `buildMonacoTheme`) turns each theme into one compact palette object that yields editor colors, suggest/hover/widget/input colors, diff-editor colors, and a full set of syntax `rules` (Monarch token types + LSP semantic token types). Chrome lives in per-theme `.app-shell[data-theme]` blocks in `App.css`; terminal lives in `terminalThemeForAppTheme`; registration in `appThemeOptions` / `MonacoAppTheme` / `monacoThemeForAppTheme`.

**Tech Stack:** React + TypeScript, Monaco editor, vitest. Plain CSS custom properties.

## Global Constraints

- **Commits are at the user's discretion.** Do NOT commit. Each task ends with a verification checkpoint (`npm run check && npm test`); the user reviews and commits.
- **No new dependencies; no layout/component/behavior changes** — theme data only.
- **Default theme stays `dark`** (Calm dark). `mockor-calm-dark` / `mockor-calm-light` Monaco themes are unchanged (they keep `rules: []`). New themes are opt-in via Settings → Appearance.
- **Contrast gate (must stay green):** for every theme, `--color-active` vs `--color-active-text` ≥ 4.5 (both 6-digit hex); the accent-soft active-tint vs `--color-active-text`/`--color-text-strong` ≥ 4.5; and **every terminal ANSI color + foreground** ≥ 4.5 vs the terminal background. Light themes need darkened ANSI colors.
- **Monaco rule colors are 6-hex WITHOUT `#`**; chrome `colors` map values are WITH `#`. The builder strips `#` for rules.
- **Each theme block in `App.css` must include the git tokens** `--change-added|deleted|modified` (+ `-soft`, `-strong`) — PR #2 made these per-theme.
- Canonical sources to verify exact hexes against: Ayu (`github.com/ayu-theme`), Material Theme (`github.com/material-theme`), One Dark Pro (`github.com/Binaryify/OneDark-Pro`), Dracula (`draculatheme.com/contribute`), Catppuccin (`github.com/catppuccin/palette`), Atom One Light.

---

### Task 1: Palette-driven Monaco theme builder + retune Ayu Mirage

**Files:**
- Modify: `src/components/monacoThemes.ts`
- Modify: `src/App.css` (`.app-shell[data-theme="ayuMirage"]` block)
- Modify: `src/domain/settings.ts` (`terminalThemeForAppTheme` ayuMirage branch)
- Test: `src/components/monacoThemes.test.ts`

**Interfaces:**
- Produces: `interface ThemePalette` and `function buildMonacoTheme(p: ThemePalette): Monaco.editor.IStandaloneThemeData`. Later theme tasks consume these.

- [ ] **Step 1: Add the builder + `ThemePalette` to `monacoThemes.ts`** (above `registerMonacoAppThemes`):

```ts
interface ThemePalette {
  base: "vs" | "vs-dark";
  bg: string; fg: string; lineHighlight: string; selection: string;
  cursor: string; lineNumber: string; lineNumberActive: string; whitespace: string;
  widgetBg: string; border: string; selectedBg: string; selectedFg: string;
  accent: string; inputBg: string;
  diffInserted: string; diffRemoved: string;
  keyword: string; func: string; type: string; string: string; number: string;
  variable: string; parameter: string; property: string; constant: string;
  operator: string; comment: string; commentItalic: boolean;
  namespace: string; regexp: string;
}

function buildSyntaxRules(p: ThemePalette) {
  const hex = (c: string) => c.replace("#", "");
  const rule = (token: string, color: string, italic = false) =>
    italic
      ? { token, foreground: hex(color), fontStyle: "italic" }
      : { token, foreground: hex(color) };
  return [
    rule("comment", p.comment, p.commentItalic),
    rule("string", p.string),
    rule("string.escape", p.regexp),
    rule("regexp", p.regexp),
    rule("keyword", p.keyword),
    rule("number", p.number),
    rule("operator", p.operator),
    rule("delimiter", p.operator),
    rule("type", p.type),
    rule("type.identifier", p.type),
    rule("namespace", p.namespace),
    rule("variable", p.variable),
    rule("variable.predefined", p.variable),
    rule("constant", p.constant),
    rule("tag", p.keyword),
    rule("metatag", p.comment),
    rule("annotation", p.comment),
    // LSP semantic token types
    rule("class", p.type),
    rule("interface", p.type),
    rule("enum", p.type),
    rule("struct", p.type),
    rule("typeParameter", p.type),
    rule("function", p.func),
    rule("method", p.func),
    rule("macro", p.func),
    rule("property", p.property),
    rule("parameter", p.parameter),
    rule("enumMember", p.constant),
    rule("modifier", p.keyword),
  ];
}

function buildMonacoTheme(p: ThemePalette): Monaco.editor.IStandaloneThemeData {
  return {
    base: p.base,
    inherit: true,
    colors: {
      "activityBar.background": p.bg,
      "editor.background": p.bg,
      "editor.foreground": p.fg,
      "editor.lineHighlightBackground": p.lineHighlight,
      "editor.selectionBackground": p.selection,
      "editorCursor.foreground": p.cursor,
      "editorGutter.background": p.bg,
      "editorLineNumber.foreground": p.lineNumber,
      "editorLineNumber.activeForeground": p.lineNumberActive,
      "editorWhitespace.foreground": p.whitespace,
      "editorSuggestWidget.background": p.widgetBg,
      "editorSuggestWidget.border": p.border,
      "editorSuggestWidget.foreground": p.fg,
      "editorSuggestWidget.selectedBackground": p.selectedBg,
      "editorSuggestWidget.selectedForeground": p.selectedFg,
      "editorSuggestWidget.highlightForeground": p.accent,
      "editorSuggestWidget.focusHighlightForeground": p.accent,
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
    rules: buildSyntaxRules(p),
  };
}
```

- [ ] **Step 2: Replace the `mockor-ayu-mirage` defineTheme call** with a builder + canonical Ayu palette:

```ts
  monaco.editor.defineTheme("mockor-ayu-mirage", buildMonacoTheme({
    base: "vs-dark",
    bg: "#1f2430", fg: "#cbccc6", lineHighlight: "#242b38", selection: "#33415e",
    cursor: "#ffcc66", lineNumber: "#707a8c", lineNumberActive: "#ffd580", whitespace: "#3b4557",
    widgetBg: "#242b38", border: "#3a4453", selectedBg: "#2f3a4f", selectedFg: "#fff3d4",
    accent: "#ffcc66", inputBg: "#1f2430",
    diffInserted: "#95e6cb22", diffRemoved: "#f2877922",
    keyword: "#ffa759", func: "#ffd580", type: "#73d0ff", string: "#bae67e", number: "#d4bfff",
    variable: "#cbccc6", parameter: "#f29e74", property: "#cbccc6", constant: "#d4bfff",
    operator: "#f29e74", comment: "#5c6773", commentItalic: true,
    namespace: "#73d0ff", regexp: "#95e6cb",
  }));
```

- [ ] **Step 3: Keep `mockor-calm-dark`, `mockor-calm-light`, and `mockor-material-deep-ocean` as-is for now** (calm themes stay literal with `rules: []`; ocean is retuned in Task 2). Verify the file still exports `registerMonacoAppThemes` and compiles.

- [ ] **Step 4: Update `App.css` Ayu chrome block** to the canonical Ayu Mirage palette (replace the values in `.app-shell[data-theme="ayuMirage"]`, keeping every existing token key including `--change-*`):

```css
  --color-accent: #ffcc66;
  --color-active: #2d3650;
  --color-active-text: #ffffff;
  --color-active-muted: #242c44;
  --color-app: #1f2430;
  --color-border: #2a3140;
  --color-border-strong: #3a4357;
  --color-control: #232936;
  --color-disabled: #707a8c;
  --color-error: #f28779;
  --color-hover: #232a3a;
  --color-hover-strong: #283044;
  --color-modal: #232936;
  --color-panel: #1f2430;
  --color-panel-deep: #1a1f29;
  --color-sidebar: #1f2430;
  --color-status: #1f2430;
  --color-success: #87d96c;
  --color-surface: #232936;
  --color-tab: #1f2430;
  --color-tab-active: #232936;
  --color-tabs: #1f2430;
  --color-text: #cbccc6;
  --color-text-muted: #9aa3b4;
  --color-text-strong: #ffffff;
  --color-text-subtle: #707a8c;
  --color-warning: #ffd580;
  --color-white: #ffffff;
  --change-added: #87d96c;
  --change-added-soft: rgba(135, 217, 108, 0.14);
  --change-added-strong: #a6e88c;
  --change-deleted: #f28779;
  --change-deleted-soft: rgba(242, 135, 121, 0.14);
  --change-deleted-strong: #ffab9d;
  --change-modified: #ffcc66;
  --change-modified-soft: rgba(255, 204, 102, 0.15);
  --change-modified-strong: #ffd580;
  color-scheme: dark;
```

- [ ] **Step 5: Update the Ayu terminal palette** in `terminalThemeForAppTheme` (the `ayuMirage` branch) to canonical Ayu ANSI (keep keys; values aligned to syntax palette, all ≥ 4.5 on `#1f2430`):

```ts
      background: "#1f2430",
      black: "#9aa5b7",
      blue: "#73d0ff",
      brightBlack: "#c0cad8",
      brightBlue: "#9fdcff",
      brightCyan: "#b8f4e6",
      brightGreen: "#d5ff80",
      brightMagenta: "#ffb8f0",
      brightRed: "#ffc0b8",
      brightWhite: "#f8f4e3",
      brightYellow: "#ffe6a3",
      cursor: "#ffcc66",
      cyan: "#95e6cb",
      foreground: "#cbccc6",
      green: "#bae67e",
      magenta: "#d4bfff",
      red: "#f28779",
      selectionBackground: "#33415e",
      white: "#d9dee8",
      yellow: "#ffd580",
```

- [ ] **Step 6: Extend `monacoThemes.test.ts`** to assert Ayu now carries syntax rules:

```ts
    expect(defineTheme).toHaveBeenCalledWith(
      "mockor-ayu-mirage",
      expect.objectContaining({
        base: "vs-dark",
        rules: expect.arrayContaining([
          expect.objectContaining({ token: "function" }),
          expect.objectContaining({ token: "class" }),
        ]),
      }),
    );
```

- [ ] **Step 7: Verify**

Run: `npm run check && npm test`
Expected: `check` clean; contrast tests green (Ayu active `#ffffff` on `#2d3650` ≥ 4.5; terminal ≥ 4.5); monacoThemes + settings green.

---

### Task 2: Retune Material Deep Ocean

**Files:** Modify `src/components/monacoThemes.ts`, `src/App.css` (`[data-theme="materialDeepOcean"]`), `src/domain/settings.ts` (terminal branch).

**Interfaces:** Consumes `buildMonacoTheme` from Task 1.

- [ ] **Step 1: Replace `mockor-material-deep-ocean` defineTheme** with the builder + canonical Material Deep Ocean palette:

```ts
  monaco.editor.defineTheme("mockor-material-deep-ocean", buildMonacoTheme({
    base: "vs-dark",
    bg: "#0f111a", fg: "#a6accd", lineHighlight: "#161b2a", selection: "#1f2233",
    cursor: "#84ffff", lineNumber: "#3b4868", lineNumberActive: "#84ffff", whitespace: "#2a3148",
    widgetBg: "#161a26", border: "#2f3754", selectedBg: "#20305a", selectedFg: "#ffffff",
    accent: "#84ffff", inputBg: "#0f111a",
    diffInserted: "#c3e88d22", diffRemoved: "#f0717822",
    keyword: "#c792ea", func: "#82aaff", type: "#ffcb6b", string: "#c3e88d", number: "#f78c6c",
    variable: "#eeffff", parameter: "#f78c6c", property: "#f07178", constant: "#f78c6c",
    operator: "#89ddff", comment: "#717cb4", commentItalic: true,
    namespace: "#ffcb6b", regexp: "#89ddff",
  }));
```

- [ ] **Step 2: Update `App.css` Ocean chrome block** (`.app-shell[data-theme="materialDeepOcean"]`), keeping all keys incl. `--change-*`:

```css
  --color-accent: #84ffff;
  --color-active: #1f3a5f;
  --color-active-text: #ffffff;
  --color-active-muted: #16263f;
  --color-app: #0f111a;
  --color-border: #1c2133;
  --color-border-strong: #2a3350;
  --color-control: #151926;
  --color-disabled: #4b5572;
  --color-error: #f07178;
  --color-hover: #151a28;
  --color-hover-strong: #1a2236;
  --color-modal: #151926;
  --color-panel: #0f111a;
  --color-panel-deep: #0a0c14;
  --color-sidebar: #0f111a;
  --color-status: #0f111a;
  --color-success: #c3e88d;
  --color-surface: #151926;
  --color-tab: #0f111a;
  --color-tab-active: #151926;
  --color-tabs: #0f111a;
  --color-text: #a6accd;
  --color-text-muted: #8a90b5;
  --color-text-strong: #ffffff;
  --color-text-subtle: #4b5572;
  --color-warning: #ffcb6b;
  --color-white: #ffffff;
  --change-added: #c3e88d;
  --change-added-soft: rgba(195, 232, 141, 0.13);
  --change-added-strong: #d7ff9d;
  --change-deleted: #f07178;
  --change-deleted-soft: rgba(240, 113, 120, 0.14);
  --change-deleted-strong: #ff9aa0;
  --change-modified: #ffcb6b;
  --change-modified-soft: rgba(255, 203, 107, 0.15);
  --change-modified-strong: #ffd98a;
  color-scheme: dark;
```

- [ ] **Step 3: Update Ocean terminal palette** (`materialDeepOcean` branch) — canonical Material ANSI, all ≥ 4.5 on `#0f111a`:

```ts
      background: "#0f111a",
      black: "#8a90b5",
      blue: "#82aaff",
      brightBlack: "#b4b9d4",
      brightBlue: "#9fc1ff",
      brightCyan: "#a3f7f7",
      brightGreen: "#d3f59a",
      brightMagenta: "#e2b6ff",
      brightRed: "#ff9aa0",
      brightWhite: "#ffffff",
      brightYellow: "#ffe0a3",
      cursor: "#84ffff",
      cyan: "#89ddff",
      foreground: "#a6accd",
      green: "#c3e88d",
      magenta: "#c792ea",
      red: "#f07178",
      selectionBackground: "#1f2233",
      white: "#d7dbe8",
      yellow: "#ffcb6b",
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: green; Ocean active `#ffffff` on `#1f3a5f` ≥ 4.5; terminal ≥ 4.5.

---

### Task 3: Add One Dark Pro

**Files:** Modify `src/components/monacoThemes.ts`, `src/App.css` (new block), `src/domain/settings.ts` (`appThemeOptions`, `MonacoAppTheme`, `monacoThemeForAppTheme`, `terminalThemeForAppTheme`). Tests: `monacoThemes.test.ts`, `settings.test.ts`, `themeContrast.test.ts`.

**Interfaces:** Consumes `buildMonacoTheme`. Produces app id `oneDarkPro` → monaco id `mockor-one-dark-pro`.

- [ ] **Step 1: Register the app theme** — add to `appThemeOptions` (after `materialDeepOcean`):

```ts
  { id: "oneDarkPro", label: "One Dark Pro" },
```

- [ ] **Step 2: Extend `MonacoAppTheme` union** — add `| "mockor-one-dark-pro"`.

- [ ] **Step 3: Map it** in `monacoThemeForAppTheme` (before the light/dark fallback):

```ts
  if (theme === "oneDarkPro") {
    return "mockor-one-dark-pro";
  }
```

- [ ] **Step 4: Define the Monaco theme** in `monacoThemes.ts` (inside `registerMonacoAppThemes`):

```ts
  monaco.editor.defineTheme("mockor-one-dark-pro", buildMonacoTheme({
    base: "vs-dark",
    bg: "#282c34", fg: "#abb2bf", lineHighlight: "#2c313a", selection: "#3e4451",
    cursor: "#61afef", lineNumber: "#4b5263", lineNumberActive: "#abb2bf", whitespace: "#3b4048",
    widgetBg: "#21252b", border: "#3a3f4b", selectedBg: "#2c323c", selectedFg: "#ffffff",
    accent: "#61afef", inputBg: "#1b1d23",
    diffInserted: "#98c37922", diffRemoved: "#e06c7522",
    keyword: "#c678dd", func: "#61afef", type: "#e5c07b", string: "#98c379", number: "#d19a66",
    variable: "#e06c75", parameter: "#abb2bf", property: "#e06c75", constant: "#d19a66",
    operator: "#56b6c2", comment: "#7f848e", commentItalic: true,
    namespace: "#e5c07b", regexp: "#98c379",
  }));
```

- [ ] **Step 5: Add the chrome block** in `App.css` (after the `materialDeepOcean` block):

```css
.app-shell[data-theme="oneDarkPro"] {
  --color-accent: #61afef;
  --color-active: #2f4156;
  --color-active-text: #ffffff;
  --color-active-muted: #2a3744;
  --color-app: #282c34;
  --color-border: #31363f;
  --color-border-strong: #3e4451;
  --color-control: #2c313a;
  --color-disabled: #5c6370;
  --color-error: #e06c75;
  --color-hover: #2c313a;
  --color-hover-strong: #333a45;
  --color-modal: #21252b;
  --color-panel: #282c34;
  --color-panel-deep: #21252b;
  --color-sidebar: #282c34;
  --color-status: #282c34;
  --color-success: #98c379;
  --color-surface: #2c313a;
  --color-tab: #282c34;
  --color-tab-active: #2c313a;
  --color-tabs: #282c34;
  --color-text: #abb2bf;
  --color-text-muted: #868e9c;
  --color-text-strong: #ffffff;
  --color-text-subtle: #5c6370;
  --color-warning: #e5c07b;
  --color-white: #ffffff;
  --change-added: #98c379;
  --change-added-soft: rgba(152, 195, 121, 0.14);
  --change-added-strong: #b6e09a;
  --change-deleted: #e06c75;
  --change-deleted-soft: rgba(224, 108, 117, 0.14);
  --change-deleted-strong: #f4929a;
  --change-modified: #e5c07b;
  --change-modified-soft: rgba(229, 192, 123, 0.16);
  --change-modified-strong: #f0d29a;
  color-scheme: dark;
}
```

- [ ] **Step 6: Add the terminal branch** in `terminalThemeForAppTheme` (before the light/dark fallback):

```ts
  if (theme === "oneDarkPro") {
    return {
      background: "#282c34",
      black: "#8b919e",
      blue: "#61afef",
      brightBlack: "#abb2bf",
      brightBlue: "#8fc4f5",
      brightCyan: "#7fd4de",
      brightGreen: "#b6e09a",
      brightMagenta: "#dba6e8",
      brightRed: "#f4929a",
      brightWhite: "#ffffff",
      brightYellow: "#f0d29a",
      cursor: "#61afef",
      cyan: "#56b6c2",
      foreground: "#abb2bf",
      green: "#98c379",
      magenta: "#c678dd",
      red: "#e06c75",
      selectionBackground: "#3e4451",
      white: "#cdd3de",
      yellow: "#e5c07b",
    };
  }
```

- [ ] **Step 7: Extend tests.**
  - `settings.test.ts` (in the `monacoThemeForAppTheme` test): `expect(monacoThemeForAppTheme("oneDarkPro")).toBe("mockor-one-dark-pro");`
  - `monacoThemes.test.ts`: `expect(defineTheme).toHaveBeenCalledWith("mockor-one-dark-pro", expect.objectContaining({ base: "vs-dark" }));`
  - `themeContrast.test.ts`: add `oneDarkPro` to the active-state checks (read `--color-active`/`--color-active-text` from `.app-shell[data-theme="oneDarkPro"]`, assert ≥ 4.5), to the accent-soft `themeSelectors` array, and to the terminal check (`expectTerminalThemeContrast(terminalThemeForAppTheme("oneDarkPro"))`).

- [ ] **Step 8: Verify**

Run: `npm run check && npm test`
Expected: green; One Dark Pro active `#ffffff` on `#2f4156` ≥ 4.5; terminal ANSI ≥ 4.5 on `#282c34`.

---

### Task 4: Add Dracula

**Files:** same set as Task 3, for `dracula` → `mockor-dracula`.

- [ ] **Step 1: Register** — `appThemeOptions`: `{ id: "dracula", label: "Dracula" },`; `MonacoAppTheme`: `| "mockor-dracula"`; `monacoThemeForAppTheme`: `if (theme === "dracula") { return "mockor-dracula"; }`.

- [ ] **Step 2: Monaco theme:**

```ts
  monaco.editor.defineTheme("mockor-dracula", buildMonacoTheme({
    base: "vs-dark",
    bg: "#282a36", fg: "#f8f8f2", lineHighlight: "#313442", selection: "#44475a",
    cursor: "#f8f8f2", lineNumber: "#6272a4", lineNumberActive: "#f8f8f2", whitespace: "#424450",
    widgetBg: "#21222c", border: "#3a3d4d", selectedBg: "#343746", selectedFg: "#ffffff",
    accent: "#bd93f9", inputBg: "#21222c",
    diffInserted: "#50fa7b22", diffRemoved: "#ff555522",
    keyword: "#ff79c6", func: "#50fa7b", type: "#8be9fd", string: "#f1fa8c", number: "#bd93f9",
    variable: "#f8f8f2", parameter: "#ffb86c", property: "#f8f8f2", constant: "#bd93f9",
    operator: "#ff79c6", comment: "#6272a4", commentItalic: true,
    namespace: "#8be9fd", regexp: "#f1fa8c",
  }));
```

- [ ] **Step 3: Chrome block** in `App.css`:

```css
.app-shell[data-theme="dracula"] {
  --color-accent: #bd93f9;
  --color-active: #443a5e;
  --color-active-text: #ffffff;
  --color-active-muted: #353145;
  --color-app: #282a36;
  --color-border: #343746;
  --color-border-strong: #44475a;
  --color-control: #2d2f3d;
  --color-disabled: #6272a4;
  --color-error: #ff5555;
  --color-hover: #2f3142;
  --color-hover-strong: #383b4d;
  --color-modal: #21222c;
  --color-panel: #282a36;
  --color-panel-deep: #21222c;
  --color-sidebar: #282a36;
  --color-status: #282a36;
  --color-success: #50fa7b;
  --color-surface: #2d2f3d;
  --color-tab: #282a36;
  --color-tab-active: #2d2f3d;
  --color-tabs: #282a36;
  --color-text: #f8f8f2;
  --color-text-muted: #b3bbe0;
  --color-text-strong: #ffffff;
  --color-text-subtle: #6272a4;
  --color-warning: #ffb86c;
  --color-white: #ffffff;
  --change-added: #50fa7b;
  --change-added-soft: rgba(80, 250, 123, 0.13);
  --change-added-strong: #74ffa0;
  --change-deleted: #ff5555;
  --change-deleted-soft: rgba(255, 85, 85, 0.14);
  --change-deleted-strong: #ff8080;
  --change-modified: #ffb86c;
  --change-modified-soft: rgba(255, 184, 108, 0.16);
  --change-modified-strong: #ffce95;
  color-scheme: dark;
}
```

- [ ] **Step 4: Terminal branch:**

```ts
  if (theme === "dracula") {
    return {
      background: "#282a36",
      black: "#8b93b8",
      blue: "#bd93f9",
      brightBlack: "#b3bbe0",
      brightBlue: "#d6b8ff",
      brightCyan: "#a4ffff",
      brightGreen: "#74ffa0",
      brightMagenta: "#ff92e0",
      brightRed: "#ff8080",
      brightWhite: "#ffffff",
      brightYellow: "#ffffa5",
      cursor: "#f8f8f2",
      cyan: "#8be9fd",
      foreground: "#f8f8f2",
      green: "#50fa7b",
      magenta: "#ff79c6",
      red: "#ff5555",
      selectionBackground: "#44475a",
      white: "#e8e8e3",
      yellow: "#f1fa8c",
    };
  }
```

- [ ] **Step 5: Extend tests** — same three files as Task 3 Step 7, with `dracula` / `mockor-dracula` (active `#ffffff` on `#443a5e`).

- [ ] **Step 6: Verify** — `npm run check && npm test` green.

---

### Task 5: Add Catppuccin Mocha

**Files:** same set, for `catppuccinMocha` → `mockor-catppuccin-mocha`.

- [ ] **Step 1: Register** — `{ id: "catppuccinMocha", label: "Catppuccin Mocha" },`; `| "mockor-catppuccin-mocha"`; `if (theme === "catppuccinMocha") { return "mockor-catppuccin-mocha"; }`.

- [ ] **Step 2: Monaco theme:**

```ts
  monaco.editor.defineTheme("mockor-catppuccin-mocha", buildMonacoTheme({
    base: "vs-dark",
    bg: "#1e1e2e", fg: "#cdd6f4", lineHighlight: "#262637", selection: "#363a4f",
    cursor: "#f5e0dc", lineNumber: "#6c7086", lineNumberActive: "#cdd6f4", whitespace: "#45475a",
    widgetBg: "#181825", border: "#313244", selectedBg: "#2a2b3c", selectedFg: "#ffffff",
    accent: "#cba6f7", inputBg: "#181825",
    diffInserted: "#a6e3a122", diffRemoved: "#f38ba822",
    keyword: "#cba6f7", func: "#89b4fa", type: "#f9e2af", string: "#a6e3a1", number: "#fab387",
    variable: "#cdd6f4", parameter: "#eba0ac", property: "#bac2de", constant: "#fab387",
    operator: "#89dceb", comment: "#6c7086", commentItalic: true,
    namespace: "#f9e2af", regexp: "#f5c2e7",
  }));
```

- [ ] **Step 3: Chrome block:**

```css
.app-shell[data-theme="catppuccinMocha"] {
  --color-accent: #cba6f7;
  --color-active: #423d5c;
  --color-active-text: #ffffff;
  --color-active-muted: #302d44;
  --color-app: #1e1e2e;
  --color-border: #2a2b3c;
  --color-border-strong: #45475a;
  --color-control: #262637;
  --color-disabled: #6c7086;
  --color-error: #f38ba8;
  --color-hover: #262637;
  --color-hover-strong: #2f3043;
  --color-modal: #181825;
  --color-panel: #1e1e2e;
  --color-panel-deep: #181825;
  --color-sidebar: #1e1e2e;
  --color-status: #1e1e2e;
  --color-success: #a6e3a1;
  --color-surface: #262637;
  --color-tab: #1e1e2e;
  --color-tab-active: #262637;
  --color-tabs: #1e1e2e;
  --color-text: #cdd6f4;
  --color-text-muted: #a6adc8;
  --color-text-strong: #ffffff;
  --color-text-subtle: #6c7086;
  --color-warning: #f9e2af;
  --color-white: #ffffff;
  --change-added: #a6e3a1;
  --change-added-soft: rgba(166, 227, 161, 0.14);
  --change-added-strong: #c2f0bd;
  --change-deleted: #f38ba8;
  --change-deleted-soft: rgba(243, 139, 168, 0.15);
  --change-deleted-strong: #f8aec2;
  --change-modified: #f9e2af;
  --change-modified-soft: rgba(249, 226, 175, 0.16);
  --change-modified-strong: #fceec6;
  color-scheme: dark;
}
```

- [ ] **Step 4: Terminal branch** (Catppuccin Mocha ANSI, ≥ 4.5 on `#1e1e2e`):

```ts
  if (theme === "catppuccinMocha") {
    return {
      background: "#1e1e2e",
      black: "#9399b2",
      blue: "#89b4fa",
      brightBlack: "#a6adc8",
      brightBlue: "#a6c8ff",
      brightCyan: "#a0eaf0",
      brightGreen: "#c2f0bd",
      brightMagenta: "#f0abdc",
      brightRed: "#f8aec2",
      brightWhite: "#ffffff",
      brightYellow: "#fceec6",
      cursor: "#f5e0dc",
      cyan: "#94e2d5",
      foreground: "#cdd6f4",
      green: "#a6e3a1",
      magenta: "#f5c2e7",
      red: "#f38ba8",
      selectionBackground: "#363a4f",
      white: "#dce0f0",
      yellow: "#f9e2af",
    };
  }
```

- [ ] **Step 5: Extend tests** — `catppuccinMocha` / `mockor-catppuccin-mocha` (active `#ffffff` on `#423d5c`).

- [ ] **Step 6: Verify** — green.

---

### Task 6: Add Catppuccin Latte (light)

**Files:** same set, for `catppuccinLatte` → `mockor-catppuccin-latte`. **Light theme — `base: "vs"`, `color-scheme: light`, darkened ANSI.**

- [ ] **Step 1: Register** — `{ id: "catppuccinLatte", label: "Catppuccin Latte" },`; `| "mockor-catppuccin-latte"`; `if (theme === "catppuccinLatte") { return "mockor-catppuccin-latte"; }`.

- [ ] **Step 2: Monaco theme:**

```ts
  monaco.editor.defineTheme("mockor-catppuccin-latte", buildMonacoTheme({
    base: "vs",
    bg: "#eff1f5", fg: "#4c4f69", lineHighlight: "#e6e9ef", selection: "#bcc0cc",
    cursor: "#dc8a78", lineNumber: "#9ca0b0", lineNumberActive: "#4c4f69", whitespace: "#bcc0cc",
    widgetBg: "#ffffff", border: "#ccd0da", selectedBg: "#dce0e8", selectedFg: "#1e2030",
    accent: "#8839ef", inputBg: "#ffffff",
    diffInserted: "#40a02b22", diffRemoved: "#d2024622",
    keyword: "#8839ef", func: "#1e66f5", type: "#df8e1d", string: "#40a02b", number: "#fe640b",
    variable: "#4c4f69", parameter: "#e64553", property: "#5c5f77", constant: "#fe640b",
    operator: "#04a5e5", comment: "#8c8fa1", commentItalic: true,
    namespace: "#df8e1d", regexp: "#ea76cb",
  }));
```

- [ ] **Step 3: Chrome block:**

```css
.app-shell[data-theme="catppuccinLatte"] {
  --color-accent: #8839ef;
  --color-active: #e0d4f7;
  --color-active-text: #2a124e;
  --color-active-muted: #e9e2f6;
  --color-app: #eff1f5;
  --color-border: #dce0e8;
  --color-border-strong: #ccd0da;
  --color-control: #ffffff;
  --color-disabled: #9ca0b0;
  --color-error: #d20f39;
  --color-hover: #e6e9ef;
  --color-hover-strong: #dce0e8;
  --color-modal: #ffffff;
  --color-panel: #eff1f5;
  --color-panel-deep: #e6e9ef;
  --color-sidebar: #eff1f5;
  --color-status: #eff1f5;
  --color-success: #40a02b;
  --color-surface: #ffffff;
  --color-tab: #eff1f5;
  --color-tab-active: #ffffff;
  --color-tabs: #eff1f5;
  --color-text: #4c4f69;
  --color-text-muted: #6c6f85;
  --color-text-strong: #1e2030;
  --color-text-subtle: #8c8fa1;
  --color-warning: #df8e1d;
  --color-white: #ffffff;
  --change-added: #2e7d20;
  --change-added-soft: rgba(64, 160, 43, 0.14);
  --change-added-strong: #1f5e16;
  --change-deleted: #d20f39;
  --change-deleted-soft: rgba(210, 15, 57, 0.12);
  --change-deleted-strong: #a00c2c;
  --change-modified: #b07407;
  --change-modified-soft: rgba(223, 142, 29, 0.16);
  --change-modified-strong: #8a5a05;
  color-scheme: light;
}
```

- [ ] **Step 4: Terminal branch** (darkened so ANSI is readable on `#eff1f5`):

```ts
  if (theme === "catppuccinLatte") {
    return {
      background: "#eff1f5",
      black: "#4c4f69",
      blue: "#1e5fd6",
      brightBlack: "#383a4f",
      brightBlue: "#1a52c0",
      brightCyan: "#0a6270",
      brightGreen: "#266b1b",
      brightMagenta: "#8c1a9b",
      brightRed: "#b00d2f",
      brightWhite: "#45485c",
      brightYellow: "#7a5200",
      cursor: "#dc8a78",
      cyan: "#0a7080",
      foreground: "#4c4f69",
      green: "#2e7d20",
      magenta: "#a01fb0",
      red: "#d20f39",
      selectionBackground: "#bcc0cc",
      white: "#5c5f77",
      yellow: "#8a5e00",
    };
  }
```

> All values target luminance ≤ ~0.16 so each clears 4.5:1 on `#eff1f5`. Step 6 still re-checks; darken any channel the test rejects, keeping hue.
```

- [ ] **Step 5: Extend tests** — `catppuccinLatte` / `mockor-catppuccin-latte`; in `monacoThemes.test.ts` assert `base: "vs"`. Active `#2a124e` on `#e0d4f7` ≥ 4.5; terminal ANSI ≥ 4.5 on `#eff1f5`.

- [ ] **Step 6: Verify** — green. If any ANSI color < 4.5, darken that channel until it passes (keep hue).

---

### Task 7: Add One Light (light)

**Files:** same set, for `oneLight` → `mockor-one-light`. **Light theme.**

- [ ] **Step 1: Register** — `{ id: "oneLight", label: "One Light" },`; `| "mockor-one-light"`; `if (theme === "oneLight") { return "mockor-one-light"; }`.

- [ ] **Step 2: Monaco theme:**

```ts
  monaco.editor.defineTheme("mockor-one-light", buildMonacoTheme({
    base: "vs",
    bg: "#fafafa", fg: "#383a42", lineHighlight: "#f0f0f1", selection: "#cfcfcf",
    cursor: "#526fff", lineNumber: "#9d9d9f", lineNumberActive: "#383a42", whitespace: "#d4d4d4",
    widgetBg: "#ffffff", border: "#dcdcdc", selectedBg: "#e5e5e6", selectedFg: "#1c1d22",
    accent: "#4078f2", inputBg: "#ffffff",
    diffInserted: "#50a14f22", diffRemoved: "#e4564922",
    keyword: "#a626a4", func: "#4078f2", type: "#c18401", string: "#50a14f", number: "#986801",
    variable: "#383a42", parameter: "#986801", property: "#e45649", constant: "#986801",
    operator: "#0184bc", comment: "#a0a1a7", commentItalic: true,
    namespace: "#c18401", regexp: "#e45649",
  }));
```

- [ ] **Step 3: Chrome block:**

```css
.app-shell[data-theme="oneLight"] {
  --color-accent: #4078f2;
  --color-active: #d6e2fd;
  --color-active-text: #15294f;
  --color-active-muted: #e4ecfd;
  --color-app: #fafafa;
  --color-border: #ececec;
  --color-border-strong: #dcdcdc;
  --color-control: #ffffff;
  --color-disabled: #a0a1a7;
  --color-error: #e45649;
  --color-hover: #f0f0f1;
  --color-hover-strong: #e8e8e9;
  --color-modal: #ffffff;
  --color-panel: #fafafa;
  --color-panel-deep: #f0f0f1;
  --color-sidebar: #fafafa;
  --color-status: #fafafa;
  --color-success: #50a14f;
  --color-surface: #ffffff;
  --color-tab: #fafafa;
  --color-tab-active: #ffffff;
  --color-tabs: #fafafa;
  --color-text: #383a42;
  --color-text-muted: #696c77;
  --color-text-strong: #1c1d22;
  --color-text-subtle: #a0a1a7;
  --color-warning: #c18401;
  --color-white: #ffffff;
  --change-added: #3f8c3e;
  --change-added-soft: rgba(80, 161, 79, 0.14);
  --change-added-strong: #2f6b2e;
  --change-deleted: #d83b2c;
  --change-deleted-soft: rgba(228, 86, 73, 0.13);
  --change-deleted-strong: #ad2c20;
  --change-modified: #9a6801;
  --change-modified-soft: rgba(193, 132, 1, 0.16);
  --change-modified-strong: #7a5201;
  color-scheme: light;
}
```

- [ ] **Step 4: Terminal branch** (darkened for `#fafafa`):

```ts
  if (theme === "oneLight") {
    return {
      background: "#fafafa",
      black: "#383a42",
      blue: "#274fb0",
      brightBlack: "#2b2d34",
      brightBlue: "#1f4499",
      brightCyan: "#0a5f6c",
      brightGreen: "#2a6029",
      brightMagenta: "#841d92",
      brightRed: "#b32a1e",
      brightWhite: "#1c1d22",
      brightYellow: "#6a4f00",
      cursor: "#526fff",
      cyan: "#0a6e7a",
      foreground: "#383a42",
      green: "#2f6b2e",
      magenta: "#9020a0",
      red: "#c4331f",
      selectionBackground: "#cfcfcf",
      white: "#4f525e",
      yellow: "#7a5800",
    };
  }
```

- [ ] **Step 5: Extend tests** — `oneLight` / `mockor-one-light` (assert `base: "vs"`); active `#15294f` on `#d6e2fd` ≥ 4.5; terminal ANSI ≥ 4.5 on `#fafafa`.

- [ ] **Step 6: Verify** — green; darken any failing ANSI channel.

---

### Task 8: Full verification + review

- [ ] **Step 1: Full gate** — `npm run check && npm test && npm run build`; all green.

- [ ] **Step 2: Manual sweep per new/retuned theme** (run the app, Settings → Appearance, switch each): confirm editor + syntax (keywords/types/functions/variables/strings/numbers/comments differ correctly), completion popup + hover, command palette, Quick Open, Structure, git panel + A/M/D statuses + git diff preview, settings dialog, status bar, terminal. Compare Ayu/Ocean against PhpStorm Material Theme.

- [ ] **Step 3: Automated review** — `coderabbit review --agent --base main`; address valid findings.

- [ ] **Step 4: Report** — summarize, confirm gates green, leave commit to the user.
