# Modern UI „Calm" Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the editor's chrome into the approved "Calm" aesthetic — flat surfaces, hairline dividers, a single muted accent per theme, airy components, and subtle motion — across all four themes, plus the Monaco completion/hover widgets.

**Architecture:** Two clean layers in `src/App.css`: a **token layer** (theme-independent radius/motion/shadow/accent-soft tokens in `:root` + retuned per-theme `--color-*` palettes) and a **component layer** (selectors consuming only tokens). Monaco widgets are themed via custom Monaco themes in `src/components/monacoThemes.ts`. JSX changes are minimal and only where CSS cannot express the change.

**Tech Stack:** React 19 + TypeScript, Vite, Tauri, Monaco editor, vitest + jsdom. Styling is plain CSS with custom properties (no CSS framework). Icons via `lucide-react`.

## Global Constraints

- **NO git commits.** Per the user instruction "nič nekomituj", nothing in this effort is committed. Every task ends with a **verification checkpoint** (`npm run check && npm test`) and a manual visual check — never a commit step.
- **No new dependencies**, no build/config changes.
- **No behavior/feature changes** — visual & interaction polish only. (E.g. do NOT add matched-substring highlighting to app palettes.)
- **Contrast gate:** `src/domain/themeContrast.test.ts` must stay green for every theme — `--color-active` vs `--color-active-text` ≥ 4.5, and terminal ANSI colors ≥ 4.5. Keep `--color-active` / `--color-active-text` as **6-digit hex** (the test parses hex from the CSS).
- **Themes covered:** `:root` (dark / system-dark), `.app-shell[data-theme="light"]`, the `@media (prefers-color-scheme: light) .app-shell[data-theme="system"]` block, `.app-shell[data-theme="ayuMirage"]`, `.app-shell[data-theme="materialDeepOcean"]`. Each keeps its identity (dark→soft-blue, light→clean, ayu→warm gold, ocean→deep-blue/cyan).
- **Token-only components:** component selectors must reference `--color-*` / `--radius-*` / `--motion-*` tokens, never hard-coded colors or radii.
- After all BE+FE work, run `coderabbit review --agent --base main` and address valid findings (final task).

## File Structure

- `src/App.css` — **primary.** Token layer (`:root` additions + per-theme palette retune) and component layer (tabs, sidebar tabs, tree rows, activity bar, toolbar toggles, status bar, palettes/overlays, suggest-widget rounding, motion, focus ring).
- `src/components/monacoThemes.ts` — add `mockor-calm-dark` + `mockor-calm-light` themes; add `editorSuggestWidget.*` / `editorWidget.*` / `editorHoverWidget.*` / `input.*` keys and aligned `editor.background` to all four custom themes.
- `src/domain/settings.ts` — extend `MonacoAppTheme` union; map dark/light/system to the new calm Monaco themes.
- `src/components/StatusBar.tsx` — add a `status-mode` class to the intelligence-mode span (only JSX change in the status bar).
- `src/App.tsx` — toolbar toggles: reorder to label-left and give Auto Save a switch track (Variant A).
- Tests touched: `src/domain/themeContrast.test.ts` (token presence + keep contrast green), `src/components/monacoThemes.test.ts` (new themes + widget keys), `src/domain/settings.test.ts` (updated mapping expectations).

---

### Task 1: Design-token foundation + global motion & focus

**Files:**
- Modify: `src/App.css` (`:root`, end of file)
- Test: `src/domain/themeContrast.test.ts`

**Interfaces:**
- Produces: CSS custom properties consumed by every later task — `--radius-sm|md|lg|pill`, `--motion-fast|base`, `--ease-standard`, `--shadow-pop`, `--color-accent-soft`, `--color-accent-bar`, `--focus-ring`. Global `:focus-visible` ring and `prefers-reduced-motion` reset.

- [ ] **Step 1: Write the failing test** — assert the new tokens exist in the stylesheet.

Add to `src/domain/themeContrast.test.ts` inside the top-level `describe` (after the existing imports, reuse `readFileSync`):

```ts
describe("calm design tokens", () => {
  const appCss = readFileSync("src/App.css", "utf8");

  it("declares the shared radius, motion and accent tokens in :root", () => {
    const root = cssBlock(appCss, ":root");
    for (const token of [
      "--radius-sm:",
      "--radius-md:",
      "--radius-lg:",
      "--radius-pill:",
      "--motion-fast:",
      "--motion-base:",
      "--ease-standard:",
      "--shadow-pop:",
      "--color-accent-soft:",
      "--focus-ring:",
    ]) {
      expect(root).toContain(token);
    }
  });

  it("honors reduced motion", () => {
    expect(appCss).toContain("prefers-reduced-motion: reduce");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- themeContrast`
Expected: FAIL — the new `calm design tokens` assertions fail (`--radius-sm:` not found).

- [ ] **Step 3: Add the tokens to `:root`**

In `src/App.css`, inside the `:root { … }` block (after the existing `--color-*` declarations, before `color: var(--color-text);`), add:

```css
  --radius-sm: 6px;
  --radius-md: 9px;
  --radius-lg: 12px;
  --radius-pill: 999px;
  --motion-fast: 120ms;
  --motion-base: 180ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --shadow-pop: 0 12px 40px rgba(0, 0, 0, 0.45);
  --color-accent-soft: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel));
  --color-accent-bar: var(--color-accent);
  --focus-ring: 0 0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
```

- [ ] **Step 4: Add global focus ring + reduced-motion at the end of `src/App.css`**

```css
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Verify**

Run: `npm run check && npm test -- themeContrast`
Expected: `check` passes; the `calm design tokens` tests now PASS and existing contrast tests stay green.

---

### Task 2: Retune all theme palettes toward Calm

**Files:**
- Modify: `src/App.css` (`:root`, `[data-theme="light"]`, the `prefers-color-scheme: light` system block, `[data-theme="ayuMirage"]`, `[data-theme="materialDeepOcean"]`)
- Test: `src/domain/themeContrast.test.ts` (existing assertions must stay green)

**Interfaces:**
- Produces: retuned `--color-*` values per theme. `--color-active` / `--color-active-text` remain 6-digit hex with ≥ 4.5 contrast.

- [ ] **Step 1: Run the contrast suite first (baseline green)**

Run: `npm test -- themeContrast`
Expected: PASS (records the pre-change baseline).

- [ ] **Step 2: Replace the `:root` color values (Calm dark)**

Set these `--color-*` values in `:root` (leave the Task 1 tokens intact):

```css
  --color-accent: #8aa9c9;
  --color-active: #1f2630;
  --color-active-text: #eef1f5;
  --color-active-muted: #1b2027;
  --color-app: #16181d;
  --color-border: #23262e;
  --color-border-strong: #2c303a;
  --color-control: #1c1f26;
  --color-disabled: #5e6573;
  --color-error: #d98b8b;
  --color-hover: #1d2026;
  --color-hover-strong: #20242c;
  --color-modal: #1c1f26;
  --color-panel: #16181d;
  --color-panel-deep: #121419;
  --color-sidebar: #16181d;
  --color-status: #16181d;
  --color-success: #8fbcae;
  --color-surface: #1c1f26;
  --color-tab: #16181d;
  --color-tab-active: #1c1f26;
  --color-tabs: #16181d;
  --color-text: #c2c8d2;
  --color-text-muted: #8b94a3;
  --color-text-strong: #e7eaef;
  --color-text-subtle: #5e6573;
  --color-warning: #d8b878;
  --color-white: #ffffff;
```

- [ ] **Step 3: Replace `[data-theme="light"]` AND the `prefers-color-scheme: light` system block** (identical values — keep both in sync)

```css
  --color-accent: #3d7c8a;
  --color-active: #dbe8ed;
  --color-active-text: #1b2733;
  --color-active-muted: #e7eff2;
  --color-app: #f5f7f9;
  --color-border: #e2e7ec;
  --color-border-strong: #cfd6de;
  --color-control: #ffffff;
  --color-disabled: #9aa7b6;
  --color-error: #b05656;
  --color-hover: #eef1f4;
  --color-hover-strong: #e7ecf1;
  --color-modal: #ffffff;
  --color-panel: #f5f7f9;
  --color-panel-deep: #eef1f4;
  --color-sidebar: #f5f7f9;
  --color-status: #f5f7f9;
  --color-success: #2a7d6f;
  --color-surface: #ffffff;
  --color-tab: #f5f7f9;
  --color-tab-active: #ffffff;
  --color-tabs: #f5f7f9;
  --color-text: #3a4654;
  --color-text-muted: #5d6b7a;
  --color-text-strong: #1b2733;
  --color-text-subtle: #74808f;
  --color-warning: #9a7016;
  --color-white: #ffffff;
  color-scheme: light;
```

- [ ] **Step 4: Replace `[data-theme="ayuMirage"]`** (warm gold identity preserved)

```css
  --color-accent: #eec07a;
  --color-active: #2f3a4f;
  --color-active-text: #fff3d4;
  --color-active-muted: #28313f;
  --color-app: #1f2430;
  --color-border: #2c3340;
  --color-border-strong: #3a4453;
  --color-control: #242b38;
  --color-disabled: #6f7888;
  --color-error: #f0a08c;
  --color-hover: #262c3a;
  --color-hover-strong: #2a3140;
  --color-modal: #242b38;
  --color-panel: #1f2430;
  --color-panel-deep: #1a1f29;
  --color-sidebar: #1f2430;
  --color-status: #1f2430;
  --color-success: #a8e0c4;
  --color-surface: #242b38;
  --color-tab: #1f2430;
  --color-tab-active: #242b38;
  --color-tabs: #1f2430;
  --color-text: #c4c6c1;
  --color-text-muted: #aab0bd;
  --color-text-strong: #f8f4e3;
  --color-text-subtle: #8b94a5;
  --color-warning: #ffd580;
  --color-white: #ffffff;
  color-scheme: dark;
```

- [ ] **Step 5: Replace `[data-theme="materialDeepOcean"]`** (deep blue + soft cyan)

```css
  --color-accent: #7fd6d6;
  --color-active: #20305a;
  --color-active-text: #ffffff;
  --color-active-muted: #1a2747;
  --color-app: #0f111a;
  --color-border: #20263a;
  --color-border-strong: #2f3754;
  --color-control: #161a26;
  --color-disabled: #5f6b85;
  --color-error: #f07178;
  --color-hover: #161b2a;
  --color-hover-strong: #1b2236;
  --color-modal: #161a26;
  --color-panel: #0f111a;
  --color-panel-deep: #0b0e14;
  --color-sidebar: #0f111a;
  --color-status: #0f111a;
  --color-success: #c3e88d;
  --color-surface: #161a26;
  --color-tab: #0f111a;
  --color-tab-active: #161a26;
  --color-tabs: #0f111a;
  --color-text: #c6cdda;
  --color-text-muted: #aab3c6;
  --color-text-strong: #ffffff;
  --color-text-subtle: #8089a3;
  --color-warning: #ffcb6b;
  --color-white: #ffffff;
  color-scheme: dark;
```

- [ ] **Step 6: Verify contrast + types**

Run: `npm run check && npm test -- themeContrast`
Expected: PASS for all themes (active/active-text ≥ 4.5 each; terminal colors ≥ 4.5 — terminal palette is unchanged). If any theme fails, lighten `--color-active-text` or darken/lighten `--color-active` for that theme until ≥ 4.5, keeping 6-digit hex.

---

### Task 3: Editor tabs — airy, rounded, accent underline, hover-reveal close

**Files:**
- Modify: `src/App.css` (`.editor-tabs`, `.editor-tab`, `.tab-main`, `.tab-close`, `.dirty-dot`, ~lines 1096-1168)

**Interfaces:**
- Consumes: `--radius-md`, `--radius-sm`, `--color-accent-soft`, `--motion-fast`, `--ease-standard`, color tokens.
- No JSX change (`EditorTabs.tsx` already renders dirty dot inside `.tab-main` and a `.tab-close`).

- [ ] **Step 1: Replace the editor-tabs block** in `src/App.css`:

```css
.editor-tabs {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  min-height: 44px;
  max-height: 44px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0 10px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-tabs);
}

.editor-tabs.empty {
  overflow: hidden;
}

.editor-tab {
  display: grid;
  min-width: 120px;
  max-width: 220px;
  grid-template-columns: minmax(0, 1fr) 22px;
  align-items: center;
  height: 34px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: transparent;
  color: var(--color-text-muted);
  transition: background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.editor-tab:hover {
  background: var(--color-hover);
  color: var(--color-text);
}

.editor-tab.active {
  background: var(--color-accent-soft);
  color: var(--color-text-strong);
  box-shadow: inset 0 -2px 0 var(--color-accent);
}

.editor-tab.preview .tab-main span {
  font-style: italic;
}

.tab-main,
.tab-close {
  height: 34px;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.tab-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 0 4px 0 12px;
  text-align: left;
}

.tab-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirty-dot {
  color: var(--color-warning);
  fill: currentColor;
  flex: 0 0 auto;
}

.tab-close {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-right: 4px;
  border-radius: var(--radius-sm);
  color: var(--color-text-subtle);
  opacity: 0;
  transition: opacity var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.editor-tab:hover .tab-close,
.editor-tab.active .tab-close,
.tab-close:focus-visible {
  opacity: 1;
}

.tab-close:hover {
  background: var(--color-hover-strong);
  color: var(--color-text-strong);
}
```

- [ ] **Step 2: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; all existing tests (incl. `EditorSurface.test`, `tabIds`) stay green.

- [ ] **Step 3: Manual visual check**

Run the app (`npm run dev`, or the project run skill). Open 2-3 files. Confirm: tabs are separated with gaps and rounded tops; active tab has soft tint + accent underline; `×` appears only on hover/active; a dirty (unsaved) tab shows the warning dot. Tab through with the keyboard and confirm the focus ring shows.

---

### Task 4: Sidebar view tabs (Files/Git/PHP) — underline style

**Files:**
- Modify: `src/App.css` (`.sidebar-header`, `.sidebar-tabs`, `.sidebar-header button`, `.sidebar-tab.active`, ~lines 297-340)

**Interfaces:**
- Consumes: color + motion tokens. No JSX change (markup already applies `.sidebar-tab` / `.sidebar-tab.active`).
- Note: only the **view tabs** (`.sidebar-tab`) become underline-style. The non-tab action button in the header (Open / Refresh) keeps a bordered look — scope its rules with `:not(.sidebar-tab)`.

- [ ] **Step 1: Replace the sidebar-tab styling** (keep `.sidebar-header` layout; adjust the button rules):

```css
.sidebar-tabs {
  display: inline-flex;
  min-width: 0;
  gap: 4px;
}

.sidebar-tab {
  height: 28px;
  padding: 0 6px;
  border: 0 !important;
  border-radius: 0;
  background: transparent !important;
  color: var(--color-text-muted);
  box-shadow: inset 0 -2px 0 transparent;
  transition: color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.sidebar-tab:hover:not(:disabled) {
  color: var(--color-text);
}

.sidebar-tab.active {
  color: var(--color-text-strong);
  box-shadow: inset 0 -2px 0 var(--color-accent);
}
```

(The existing `.sidebar-header button { … }` rule still styles the trailing Open/Refresh action button. The `!important` on background/border above overrides that shared rule for `.sidebar-tab` only.)

- [ ] **Step 2: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; existing tests green.

- [ ] **Step 3: Manual visual check**

Confirm Files/Git/PHP read as quiet underline tabs (active one underlined in accent, no box), while the Open/Refresh button on the right still looks like a button.

---

### Task 5: Tree rows (file / git / PHP) — soft-tint active, rounded hover

**Files:**
- Modify: `src/App.css` (`.tree-row`, `.tree-row:hover`, `.tree-row.active`, ~lines 368-396)

**Interfaces:**
- Consumes: `--radius-md`, `--color-hover`, `--color-accent-soft`, `--color-active-text`, motion tokens. No JSX change.

- [ ] **Step 1: Replace the tree-row rules:**

```css
.tree-row {
  display: grid;
  width: calc(100% - 16px);
  min-height: 30px;
  grid-template-columns: 16px 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  margin: 1px 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  padding: 0 8px 0 calc(8px + var(--tree-level) * 16px);
  text-align: left;
  transition: background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.tree-row:hover {
  background: var(--color-hover);
  color: var(--color-text-strong);
}

.tree-row.active {
  background: var(--color-accent-soft);
  color: var(--color-active-text);
}

.tree-row.active small {
  color: var(--color-active-text);
}
```

- [ ] **Step 2: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; `FileStructure.test`, navigation tests green.

- [ ] **Step 3: Manual visual check**

Confirm file rows have a touch more height and air, a rounded subtle hover, and the active row shows a soft accent tint (not a hard filled block). Verify across Files, Git, and PHP sidebar views.

---

### Task 6: Activity bar — refined hover, radius, spacing

**Files:**
- Modify: `src/App.css` (`.activity-bar`, `.activity-bar button`, hover, ~lines 222-256)

**Interfaces:**
- Consumes: `--radius-md`, `--color-hover`, motion tokens. No JSX change. (These are one-shot actions — no persistent active indicator.)

- [ ] **Step 1: Replace the activity-bar button rules:**

```css
.activity-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 5px;
  border-right: 1px solid var(--color-border);
  background: var(--color-panel-deep);
}

.activity-bar button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.activity-bar button:hover:not(:disabled) {
  background: var(--color-hover);
  color: var(--color-text-strong);
}

.activity-bar button:disabled {
  color: var(--color-disabled);
  cursor: not-allowed;
}
```

- [ ] **Step 2: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; tests green.

- [ ] **Step 3: Manual visual check**

Confirm activity-bar icons have a soft rounded hover and a visible focus ring on keyboard focus.

---

### Task 7: Toolbar toggles — Variant A (label-left clean pill)

**Files:**
- Modify: `src/App.tsx` (IDE Mode button ~lines 392-410, Auto Save button ~lines 434-451)
- Modify: `src/App.css` (`.smart-mode-switch`, `.toolbar-toggle`, `.switch-track`, `.switch-thumb`, ~lines 552-619)

**Interfaces:**
- Consumes: `--radius-md`, `--radius-pill`, `--color-control`, `--color-accent`, motion tokens.
- Produces: both toggles render label-first then a switch track; Auto Save gains a track to match IDE Mode.

- [ ] **Step 1: Reorder the IDE Mode button markup** in `src/App.tsx` to label-first, track-last, and drop the verbose `<strong>` (state is shown by the track + `aria-pressed`):

```tsx
          <button
            aria-pressed={workbench.intelligenceMode === "fullSmart"}
            className={
              workbench.intelligenceMode === "fullSmart"
                ? "smart-mode-switch active"
                : "smart-mode-switch"
            }
            disabled={!workbench.workspaceRoot}
            onClick={workbench.toggleSmartMode}
            type="button"
          >
            <span>IDE Mode</span>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
          </button>
```

- [ ] **Step 2: Give the Auto Save button a matching track** in `src/App.tsx`:

```tsx
          <button
            aria-pressed={workbench.workspaceSettings.autoSave}
            className={
              workbench.workspaceSettings.autoSave
                ? "toolbar-toggle active"
                : "toolbar-toggle"
            }
            disabled={!workbench.workspaceRoot}
            onClick={() =>
              workbench.setAutoSave(!workbench.workspaceSettings.autoSave)
            }
            type="button"
          >
            <span>Auto Save</span>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
          </button>
```

- [ ] **Step 3: Replace the toggle CSS** in `src/App.css` (remove the old `strong` rules — they no longer have a target):

```css
.smart-mode-switch,
.toolbar-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-control);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  padding: 0 8px 0 12px;
  transition: color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
}

.smart-mode-switch.active,
.toolbar-toggle.active {
  color: var(--color-text-strong);
}

.smart-mode-switch:hover:not(:disabled),
.toolbar-toggle:hover:not(:disabled) {
  color: var(--color-text-strong);
}

.smart-mode-switch:disabled,
.toolbar-toggle:disabled {
  color: var(--color-disabled);
  cursor: not-allowed;
}

.switch-track {
  display: inline-flex;
  width: 34px;
  height: 19px;
  align-items: center;
  border-radius: var(--radius-pill);
  background: var(--color-border-strong);
  padding: 2.5px;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.switch-thumb {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-pill);
  background: var(--color-text-muted);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  transition: transform var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.smart-mode-switch.active .switch-track,
.toolbar-toggle.active .switch-track {
  background: var(--color-accent);
}

.smart-mode-switch.active .switch-thumb,
.toolbar-toggle.active .switch-thumb {
  background: var(--color-white);
  transform: translateX(15px);
}
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; `SettingsDialog.test` and any toolbar-touching tests stay green. (If a test queried the removed "On"/"Off" `<strong>` text, update it to assert `aria-pressed` instead.)

- [ ] **Step 5: Manual visual check**

Confirm IDE Mode and Auto Save read as clean label-left pills with a track that fills with accent + white knob when on, and animate smoothly when toggled.

---

### Task 8: Status bar — hairline segments + accent mode

**Files:**
- Modify: `src/components/StatusBar.tsx` (mode span)
- Modify: `src/App.css` (`.status-bar`, `.status-bar span`, ~lines 1170-1192)

**Interfaces:**
- Consumes: `--color-accent`, `--color-border`, color tokens.
- Produces: a `status-mode` class on the intelligence-mode span.

- [ ] **Step 1: Add the `status-mode` class** in `src/components/StatusBar.tsx` (line 33):

```tsx
      <span className="status-mode">{formatMode(intelligenceMode)}</span>
```

- [ ] **Step 2: Replace the status-bar CSS** in `src/App.css`:

```css
.status-bar {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 0;
  min-width: 0;
  height: 100%;
  border-top: 1px solid var(--color-border);
  background: var(--color-status);
  color: var(--color-text-muted);
  font-size: 11.5px;
  padding: 0 6px;
}

.status-bar span {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 12px;
}

.status-bar span:not(:last-child) {
  border-right: 1px solid var(--color-border);
}

.status-mode {
  color: var(--color-accent);
  font-weight: 600;
}

.status-message {
  color: var(--color-success);
}
```

(The shell already sizes the status row at 25px via `grid-template-rows`; `height: 100%` fills it. If 25px feels tight with the new padding, bump the shell's last grid-row from `25px` to `26px` in `.app-shell` — optional, confirm visually.)

- [ ] **Step 3: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; tests green.

- [ ] **Step 4: Manual visual check**

Confirm status items are separated by hairline dividers and the mode (e.g. "IDE Mode") is shown in the accent color.

---

### Task 9: Palettes & overlays — rounded containers, soft-tint rows

**Files:**
- Modify: `src/App.css` (`.command-palette,…` group ~1204-1216, `.implementation-chooser` ~1218, `.file-structure` ~1059, `.palette-command` hover ~1343, `.quick-open-result/.text-search-result` hover/active ~1392-1397, `.implementation-choice` hover/active ~1275, `.file-structure-option` ~1078)

**Interfaces:**
- Consumes: `--radius-lg`, `--radius-md`, `--shadow-pop`, `--color-accent-soft`, `--color-hover`, `--color-text-strong`, `--color-accent`. No JSX change. Member rows keep their existing `ListTree` / `FileCode2` icons; no checkbox/radio control is added.

- [ ] **Step 1: Round + elevate the modal containers.** Update the shared container group and the two standalone containers to use the tokens:

```css
.command-palette,
.quick-open,
.text-search,
.language-server-setup,
.settings-dialog {
  width: min(640px, calc(100vw - 36px));
  max-height: min(520px, calc(100vh - 80px));
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-modal);
  box-shadow: var(--shadow-pop);
}
```

In `.implementation-chooser` and `.file-structure`, change `border-radius` to `var(--radius-lg)`, `border` color to `var(--color-border)`, and `box-shadow` to `var(--shadow-pop)`.

- [ ] **Step 2: Soft-tint the result rows.** Replace the row hover/active rules so selected rows use the accent tint instead of `--color-hover-strong`:

```css
.palette-command:hover:not(:disabled) {
  background: var(--color-hover);
}

.quick-open-result:hover,
.text-search-result:hover {
  background: var(--color-hover);
}

.quick-open-result.active,
.text-search-result.active {
  background: var(--color-accent-soft);
  color: var(--color-text-strong);
}

.implementation-choice:hover {
  background: var(--color-hover);
}

.implementation-choice.active {
  background: var(--color-accent-soft);
  color: var(--color-text-strong);
}
```

Add `border-radius: var(--radius-md);` to `.palette-command`, `.quick-open-result`, `.text-search-result` (replace their existing `border-radius: 6px`). Add a transition to each: `transition: background-color var(--motion-fast) var(--ease-standard);`

- [ ] **Step 3: Tidy the structure checkbox row** — confirm `.file-structure-option input { accent-color: var(--color-accent); }` is present (it is) and the row divider uses `var(--color-border)`. No further markup change; the single functional "Include inherited members" checkbox stays, member rows have no added control.

- [ ] **Step 4: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; `FileStructure.test`, `SettingsDialog.test`, `CommandPalette`-related tests green.

- [ ] **Step 5: Manual visual check**

Open Quick Open (file palette), the command palette, and Structure (PHP file). Confirm rounded containers with the soft shadow, hairline borders, rounded rows, soft accent-tint selected row, and that the structure palette has no circle/checkbox before each member (only the top "Include inherited members" checkbox).

---

### Task 10: Monaco — calm editor themes + suggest/hover widgets

**Files:**
- Modify: `src/components/monacoThemes.ts`
- Modify: `src/domain/settings.ts` (`MonacoAppTheme`, `monacoThemeForAppTheme`)
- Modify: `src/domain/settings.test.ts` (mapping expectations)
- Modify: `src/components/monacoThemes.test.ts` (assert new themes + widget keys)
- Modify: `src/App.css` (optional `.monaco-editor .suggest-widget` rounding)

**Interfaces:**
- Consumes: nothing from earlier tasks (parallel-safe).
- Produces: Monaco theme ids `"mockor-calm-dark"`, `"mockor-calm-light"`; `monacoThemeForAppTheme` returns them for dark/light/system.

- [ ] **Step 1: Update the test expectations first** in `src/domain/settings.test.ts` (lines 190-193):

```ts
    expect(monacoThemeForAppTheme("light")).toBe("mockor-calm-light");
    expect(monacoThemeForAppTheme("dark")).toBe("mockor-calm-dark");
    expect(monacoThemeForAppTheme("system")).toBe("mockor-calm-dark");
    expect(monacoThemeForAppTheme("system", true)).toBe("mockor-calm-light");
```

- [ ] **Step 2: Extend `src/components/monacoThemes.test.ts`** to assert the new themes register and carry suggest-widget keys:

```ts
    expect(defineTheme).toHaveBeenCalledWith(
      "mockor-calm-dark",
      expect.objectContaining({
        colors: expect.objectContaining({
          "editorSuggestWidget.background": expect.any(String),
          "editorSuggestWidget.selectedBackground": expect.any(String),
        }),
      }),
    );
    expect(defineTheme).toHaveBeenCalledWith(
      "mockor-calm-light",
      expect.objectContaining({ base: "vs" }),
    );
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- settings monacoThemes`
Expected: FAIL — mapping returns `"vs-dark"`/`"vs"` and `mockor-calm-*` themes are not defined yet.

- [ ] **Step 4: Update the type + mapping** in `src/domain/settings.ts`:

```ts
export type MonacoAppTheme =
  | "vs"
  | "vs-dark"
  | "mockor-calm-dark"
  | "mockor-calm-light"
  | "mockor-ayu-mirage"
  | "mockor-material-deep-ocean";
```

And in `monacoThemeForAppTheme`, replace the trailing light/dark returns:

```ts
  if (resolveAppTheme(theme, prefersLight) === "light") {
    return "mockor-calm-light";
  }

  return "mockor-calm-dark";
```

- [ ] **Step 5: Add the two calm themes + widget keys** in `src/components/monacoThemes.ts`. Add a shared widget-colors helper and define `mockor-calm-dark` / `mockor-calm-light`, and add the same widget keys (with theme-appropriate values) to the existing ayu/ocean themes.

```ts
  const calmDarkWidget = {
    "editorSuggestWidget.background": "#1b1e24",
    "editorSuggestWidget.border": "#2c303a",
    "editorSuggestWidget.foreground": "#c2c8d2",
    "editorSuggestWidget.selectedBackground": "#23303a",
    "editorSuggestWidget.selectedForeground": "#eef1f5",
    "editorSuggestWidget.highlightForeground": "#8aa9c9",
    "editorSuggestWidget.focusHighlightForeground": "#8aa9c9",
    "editorWidget.background": "#1b1e24",
    "editorWidget.border": "#2c303a",
    "editorHoverWidget.background": "#1b1e24",
    "editorHoverWidget.border": "#2c303a",
    "input.background": "#16181d",
    "input.border": "#2c303a",
    focusBorder: "#8aa9c9",
  };

  monaco.editor.defineTheme("mockor-calm-dark", {
    base: "vs-dark",
    colors: {
      "activityBar.background": "#16181d",
      "editor.background": "#16181d",
      "editor.foreground": "#c2c8d2",
      "editor.lineHighlightBackground": "#1d2026",
      "editor.selectionBackground": "#28323d",
      "editorCursor.foreground": "#8aa9c9",
      "editorGutter.background": "#16181d",
      "editorLineNumber.activeForeground": "#c2c8d2",
      "editorLineNumber.foreground": "#5e6573",
      "editorWhitespace.foreground": "#2c303a",
      ...calmDarkWidget,
    },
    inherit: true,
    rules: [],
  });

  monaco.editor.defineTheme("mockor-calm-light", {
    base: "vs",
    colors: {
      "activityBar.background": "#f5f7f9",
      "editor.background": "#f5f7f9",
      "editor.foreground": "#3a4654",
      "editor.lineHighlightBackground": "#eef1f4",
      "editor.selectionBackground": "#d3e1e7",
      "editorCursor.foreground": "#3d7c8a",
      "editorGutter.background": "#f5f7f9",
      "editorLineNumber.activeForeground": "#3a4654",
      "editorLineNumber.foreground": "#9aa7b6",
      "editorWhitespace.foreground": "#cfd6de",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#e2e7ec",
      "editorSuggestWidget.foreground": "#3a4654",
      "editorSuggestWidget.selectedBackground": "#dbe8ed",
      "editorSuggestWidget.selectedForeground": "#1b2733",
      "editorSuggestWidget.highlightForeground": "#3d7c8a",
      "editorSuggestWidget.focusHighlightForeground": "#3d7c8a",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e2e7ec",
      "editorHoverWidget.background": "#ffffff",
      "editorHoverWidget.border": "#e2e7ec",
      "input.background": "#ffffff",
      "input.border": "#cfd6de",
      focusBorder: "#3d7c8a",
    },
    inherit: true,
    rules: [],
  });
```

Then add suggest/widget keys to the existing `mockor-ayu-mirage` and `mockor-material-deep-ocean` `colors` maps (aligned to their palettes), e.g. for ayu: `"editorSuggestWidget.background": "#242b38"`, `".border": "#3a4453"`, `".selectedBackground": "#2f3a4f"`, `".highlightForeground": "#eec07a"`, `"editorWidget.background": "#242b38"`, `"editorHoverWidget.background": "#242b38"`, `focusBorder: "#eec07a"`; for ocean: backgrounds `#161a26`, border `#2f3754`, selected `#20305a`, highlight `#7fd6d6`, `focusBorder: "#7fd6d6"`.

- [ ] **Step 6: Optional — round the suggest popup** in `src/App.css`:

```css
.monaco-editor .suggest-widget {
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}
```

- [ ] **Step 7: Verify**

Run: `npm run check && npm test`
Expected: `check` passes; `settings` and `monacoThemes` tests now PASS; all other tests green.

- [ ] **Step 8: Manual visual check**

Open a PHP file, trigger autocomplete (e.g. `$request->is`). Confirm the suggest popup background matches the calm canvas, has a hairline border, the selected row uses the soft tint, and matched characters show in the accent color — in each theme.

---

### Task 11: Full-app verification + automated review

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: type-check clean, all tests pass, production build succeeds.

- [ ] **Step 2: Manual sweep across all four themes**

Run the app. Switch through dark, light, ayuMirage, materialDeepOcean (Settings). For each, confirm: flat calm surfaces with hairline dividers; airy rounded tabs with accent underline; underline sidebar tabs; soft-tint tree + palette active rows; Variant A toggles; segmented status bar with accent mode; calm Monaco editor + suggest widget. Confirm reduced-motion (OS setting) disables transitions.

- [ ] **Step 3: Automated review (per global instructions)**

Run: `coderabbit review --agent --base main`
Address valid findings inline; for rejected findings, note the reasoning. (Reviews the uncommitted working-tree diff against `main`.)

- [ ] **Step 4: Report**

Summarize what changed, confirm gates are green, and remind the user nothing was committed (per "nič nekomituj").
```
