# Editor Font Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable editor font family, font size, and ligatures to Appearance settings, make the editor honor them, and expose related commands through the command palette and top View menu.

**Architecture:** Editor typography remains global app settings because `editorFontSize` already lives in `AppSettings`. The settings domain normalizes persisted values, `SettingsDialog` edits the values in Appearance, `EditorSurface` passes them to Monaco, and `WindowChrome` uses registered commands for a new View menu.

**Tech Stack:** React 19, TypeScript, Monaco Editor, Vitest, Vite.

---

### Task 1: Settings Model

**Files:**
- Modify: `src/domain/settings.ts`
- Modify: `src/domain/settings.test.ts`
- Modify: `src/infrastructure/browserSettingsGateway.test.ts`

- [ ] **Step 1: Write failing settings tests**

Add assertions that `defaultAppSettings()` includes:

```ts
editorFontFamily:
  "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
editorFontLigatures: false,
editorFontSize: 14,
```

Add a `normalizeAppSettings` case that accepts:

```ts
{
  editorFontFamily: "Fira Code",
  editorFontLigatures: true,
  editorFontSize: 18,
}
```

and rejects non-string font families, blank font families, and non-boolean ligature values back to defaults.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/domain/settings.test.ts src/infrastructure/browserSettingsGateway.test.ts`

Expected: FAIL because `editorFontFamily` and `editorFontLigatures` do not exist yet.

- [ ] **Step 3: Implement settings normalization**

Add constants and fields in `src/domain/settings.ts`:

```ts
export const defaultEditorFontFamily =
  "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
export const defaultEditorFontLigatures = false;
```

Extend `AppSettings` with `editorFontFamily: string` and `editorFontLigatures: boolean`.

In `defaultAppSettings`, set the two defaults.

Add `normalizeEditorFontFamily(value: unknown): string` that trims string values and falls back to `defaultEditorFontFamily` for blank or non-string input.

In `normalizeAppSettings`, read `editorFontFamily` and `editorFontLigatures` with `normalizeEditorFontFamily` and `normalizeBoolean`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm test -- src/domain/settings.test.ts src/infrastructure/browserSettingsGateway.test.ts`

Expected: PASS.

### Task 2: Appearance Settings UI

**Files:**
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/SettingsDialog.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add a test that opens Appearance and verifies controls for:

```ts
"Theme"
"Font family"
"Font size"
"Font ligatures"
```

Add a test that changes font family to `Fira Code`, font size to `16`, and toggles ligatures, then expects `onSave` calls with updated `appSettings`.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/components/SettingsDialog.test.tsx`

Expected: FAIL because Appearance only renders Theme today.

- [ ] **Step 3: Implement Appearance controls**

Update `AppearanceSettingsProps` with:

```ts
onChangeEditorFontFamily(value: string): void;
onChangeEditorFontLigatures(enabled: boolean): void;
onChangeEditorFontSize(value: number): void;
```

Render:

```tsx
<label className="settings-field">
  <span>Font family</span>
  <input list="editor-font-family-options" ... />
</label>
<datalist id="editor-font-family-options">...</datalist>
<label className="settings-field">
  <span>Font size</span>
  <input min={minEditorFontSize} max={maxEditorFontSize} type="number" ... />
</label>
<label className="settings-toggle">
  <input checked={appSettings.editorFontLigatures} type="checkbox" ... />
  <span>Font ligatures</span>
</label>
```

Use a static monospace option list plus optional browser local-font discovery if available through `globalThis.queryLocalFonts`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm test -- src/components/SettingsDialog.test.tsx`

Expected: PASS.

### Task 3: Editor Monaco Wiring

**Files:**
- Modify: `src/components/EditorSurface.tsx`
- Modify: `src/components/EditorSurface.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing editor option test**

Add a test rendering `EditorSurface` with:

```tsx
editorFontFamily="Fira Code, monospace"
editorFontLigatures={true}
editorFontSize={16}
```

Expect Monaco options to include:

```ts
{
  fontFamily: "Fira Code, monospace",
  fontLigatures: true,
  fontSize: 16,
}
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/components/EditorSurface.test.tsx`

Expected: FAIL because `editorFontFamily` and `editorFontLigatures` props do not exist.

- [ ] **Step 3: Implement editor wiring**

Extend `EditorSurfaceProps` with `editorFontFamily?: string` and `editorFontLigatures?: boolean`. Default them from settings constants. Pass both into Monaco `options`.

In `src/App.tsx`, pass:

```tsx
editorFontFamily={workbench.appSettings.editorFontFamily}
editorFontLigatures={workbench.appSettings.editorFontLigatures}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm test -- src/components/EditorSurface.test.tsx`

Expected: PASS.

### Task 4: Commands and View Menu

**Files:**
- Modify: `src/application/useWorkbenchController.ts`
- Modify: `src/application/useWorkbenchController.preview.test.tsx`
- Modify: `src/domain/keymap.ts`
- Modify: `src/components/WindowChrome.tsx`
- Modify: `src/components/WindowChrome.test.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing command/menu tests**

Add a controller test that runs `editor.toggleFontLigatures` and expects `appSettings.editorFontLigatures` to toggle and persist.

Add a controller test that runs `workbench.openAppearanceSettings` and expects settings to open on the Appearance section.

Add a window chrome test that opens `View` and runs `Increase Editor Font Size`, `Decrease Editor Font Size`, `Reset Editor Font Size`, `Toggle Editor Font Ligatures`, and `Appearance Settings` through command-backed menu items.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- src/application/useWorkbenchController.preview.test.tsx src/components/WindowChrome.test.tsx`

Expected: FAIL because the new command ids and View menu do not exist.

- [ ] **Step 3: Implement commands and menu**

Add keymap command ids:

```ts
{
  category: "Workbench",
  defaultShortcut: "",
  id: "workbench.openAppearanceSettings",
  label: "Open Appearance Settings",
}
{
  category: "Editor",
  defaultShortcut: "",
  id: "editor.toggleFontLigatures",
  label: "Toggle Editor Font Ligatures",
}
```

In `useWorkbenchController`, add a settings section state with `"general"` default, implement `openAppearanceSettingsPanel`, register both new commands, and return the selected section to `App`.

In `SettingsDialog`, accept `initialSection?: SettingsSection` and use it when opening.

In `WindowChrome`, add `type WindowMenuKey = "edit" | "file" | "view"` and a View menu containing the command-backed typography/settings items.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm test -- src/application/useWorkbenchController.preview.test.tsx src/components/WindowChrome.test.tsx`

Expected: PASS.

### Task 5: Final Verification and Review Loop

**Files:**
- No direct edits unless tests or review identify gaps.

- [ ] **Step 1: Run focused suite**

Run:

```bash
npm test -- src/domain/settings.test.ts src/infrastructure/browserSettingsGateway.test.ts src/components/SettingsDialog.test.tsx src/components/EditorSurface.test.tsx src/application/useWorkbenchController.preview.test.tsx src/components/WindowChrome.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 3: Request code review**

Dispatch a code-reviewer subagent with the plan and diff.

- [ ] **Step 4: Implement review feedback**

For each Critical or Important finding, verify it against the codebase, patch it, and rerun the focused suite plus `npm run check`.
