# Redesign P5 - Command Palette and F10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy command palette and Quick Open overlay with one t3code-style command palette. It is shared by editor mode and agent mode and opens with ⌘K (root), ⌘P (files) and ⌘/ (shortcuts cheatsheet). It has sub-pages (new thread in, switch project, go to file, run script, switch branch, change model, theme, appearance, shortcuts), fuzzy project/thread/file/branch/script results with match highlighting, and an `@` file prefix. The phase also adds the deferred "command list" base component to `src/ui/foundation`.

**Architecture:**
- `src/ui/foundation/CommandList.tsx` holds generic, domain-free command list primitives (surface, input, list, item, footer, keyboard navigation).
- `src/domain/commandPalette/**` holds the pure palette model: matching, pages, navigation reducer, root query parser, closed item and intent types.
- `src/application/commandPalette/**` holds ports: a stack-based provider slot through which agent mode publishes projects, threads and scripts, and the composer publishes models; a launch request channel used by the registry commands `palette.open` / `palette.shortcuts`; and the curated action catalog, which is backed by the existing `CommandRegistry`.
- `src/components/commandPalette/**` holds the presenter (view models), the page view, and the single `CommandPaletteHost` mounted once in `App.tsx`. It reuses the controller's existing `paletteOpen` / `quickOpenOpen` state, so `useWorkbenchController.ts` does not grow.
- The files page is the existing `QuickOpen` component, restyled on the new primitives. It keeps all of its search, location, symbol-prefix, IME and editor-keystroke behavior.

**Tech Stack:** React 19 + TypeScript (strict), Vitest + jsdom, lucide-react icons, CSS with `--cv-*` tokens only, Tauri IPC through the existing gateways (no Rust change).

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1.2 base components "command list", §3.1.7 command palette, §3.3 F10, §4 architecture, §6 testing). Mockup: `docs/redesign/v3-command-palette.html` (`<style id="screen-command-palette">` + `<script id="screen-command-palette-js">`).

## Global Constraints

- Spec §3.1.7 verbatim: "**Command palette** (⌘K, ⌘P for files, ⌘/ shortcuts): actions, recent threads, fuzzy projects/threads/files/branches/scripts, sub-pages (new thread in, switch project, go to file, run script, switch branch, change model, theme, appearance, shortcuts)."
- Spec §3.3 F10 verbatim: "Keyboard shortcuts cheatsheet (⌘/), command palette files/branches/scripts results and `@` file prefix."
- Spec §3.1.2: the command list is a base component with "one owner module each, reused by every screen" -> `src/ui/foundation/CommandList.tsx`.
- Spec §4: "no feature component defines its own colors"; hotspot files "must shrink or stay flat"; "Old styles are removed as each surface is migrated".
- Spec §1: "no existing capability is lost". This covers all registry commands reachable from the palette, `>` commands mode, Quick Open `path:line[:col]`, `@symbol`, `#symbol`, recent-file ordering, IME handling, typing while editor focus is stolen, and the pending-command guard.
- Spec §7.1: implementation and review agents are Opus 5.5 only. UI QA uses Codex Computer Use against the QA bundle `dev.mockor.editor.qa`.
- Spec §7.3: no release, tag or push in this phase.
- Mockup metrics (verbatim from `screen-command-palette`):
  - popup `max-width: 576px; max-height: 420px; border-radius: 16px`, viewport padding `90px 16px` (t3code `py 10vh`)
  - input shell `padding: 6px 8px`, field `height: 34px`, input `padding: 0 12px 0 40px`
  - list `padding: 8px`, group label `padding: 6px 8px; font-size 12px; line-height 16px; weight 500`
  - item `min-height: 28px; padding: 6px 8px; gap: 8px; radius 6px; font-size 14px; line-height 20px`
  - timestamp `min-width: 48px`, footer `padding: 10px 16px; gap: 12px; tint 2.5%`, kbd `height 20px; min-width 20px; radius 4px`
  - empty state `padding: 40px 16px`
- Copy (verbatim from mockup):
  - root placeholder "Search commands, projects, threads, and files…"; sub-page placeholders "Search files…", "Search models…", "Search shortcuts…", "Search…"
  - empties "No matching commands, projects, threads, or files.", "No matching actions.", "No matching files.", "No matching models.", "No matching shortcuts.", "No matches."
  - footer hints "Navigate", "Open file", "Run", "Back", "Close"
  - group labels "Actions", "Recent Threads", "Projects", "Threads", "Scripts", "Files", "Branches"
- Code style (repo + owner): no code comments, guard clauses and no `else`, `readonly` closed contracts, exhaustive `switch` with `never`, no `any`, no `throw` in tests, never `prettier --write` on a directory.
- Verification: fast checks while iterating (`npx vitest run <files>`, `npm run check`, `npm run lint`). Full repository gates only in the wrap-up task.

## Review Focus

1. **⌘K and ⌘/ while the caret is in a Monaco editor.**
   - In the editor, `Cmd+K` must keep working as the chord prefix (`Cmd+K Cmd+\` splits down) and `Cmd+/` must toggle a line comment. Neither may open the palette.
   - Outside the editor (composer, sidebar, file tree), ⌘K must open the palette immediately with no 2 s chord wait.
   - Pinned in Task 4 (`shortcutFocusScope.test.ts` and `useWorkbenchKeyboardShortcuts.paletteFocus.test.tsx`).
2. **Workspace A -> B -> A while the palette is open, and late async results.**
   - A root "Files" search or a branch list that resolves after the workspace changed, or after the query changed, must be dropped.
   - The palette closes when the workspace root changes under it.
   - Pinned in Task 9 (`usePaletteRootFiles.test.tsx`, `usePaletteBranches.test.tsx`, `CommandPaletteHost.test.tsx` "closes when the workspace root changes").
3. **Stale selection after the underlying list changed.**
   - Selecting a thread, project, script or model that disappeared between render and Enter must fail closed with a visible error. It must not act on a neighbour and must not silently close.
   - Pinned in Task 7 (`executePaletteIntent.test.ts`) and Task 10 (`useAgentCommandPaletteProvider.test.tsx`).
4. **Unicode and adversarial queries.**
   - Case-folding that changes string length (for example `İ`), 10 000-character pasted queries, regex metacharacters, and only-whitespace queries must never throw.
   - They must never highlight the wrong characters, and never do unbounded work per keystroke.
   - Pinned in Task 2 (`paletteMatch.test.ts`).
5. **Existing Quick Open and command palette behavior after the restyle.**
   - `>`, `@`, `#` handoffs, `path:12:3`, typing while Monaco steals focus, the pending-command guard, disabled commands and rejected commands must behave as before.
   - Pinned in Task 7 (ported command tests) and Task 8 (existing `QuickOpen.test.tsx` kept green with updated selectors).

---

## Current code map (scouted 2026-09-24)

| Surface | Current code | Notes |
|---|---|---|
| Command palette | `src/components/CommandPalette.tsx` (191 lines), `commandPaletteProps.ts`, lazy `LazyCommandPaletteHost` in `src/components/appLazySurfaces.tsx:156`, mounted `src/App.tsx:1226` | Flat list of every registry command. Runs via `executeCommandAndWait` with a pending guard. `Cmd+Shift+P` = `commands.show` (`workbenchPanelCommands.ts:32`, opener in `useWorkbenchCommandRegistry.ts:948-953`). |
| Quick Open | `src/components/QuickOpen.tsx` (318), `quickOpenProps.ts`, mounted `src/App.tsx:1236-1238`, engine `src/application/useWorkbenchQuickOpen.ts` (438) | `file.quickOpen` = Cmd+P. Handles `>`/`@`/`#` handoffs (`useQuickOpenPrefixDispatch.ts`) and `path:line[:col]`. The window capture keydown forwards typing when the editor steals focus. |
| Open state | `useQuickOpenSeededSurfaceState()` in `useQuickOpenPrefixDispatch.ts`: `paletteOpen`, `setPaletteOpen`, `commandPaletteInitialQuery`; `quickOpenOpen`/`setQuickOpenOpen` from `useWorkbenchQuickOpen` | Both are exposed on the controller return value. Floating-surface exclusivity lives in `useFloatingSurfaces.ts` open* functions (not effects). |
| Registry | `src/domain/command.ts` (`Command`, `CommandContext`), `src/application/commandRegistry.ts` (`CommandRegistry`, `executeCommandAndWait`), `useWorkbenchCommandRegistry.ts` (1240) | The controller exposes `commands` (sorted list), `commandContext`, `runCommand`, `reportCommandError`. |
| Keymap | `src/domain/keymap.ts` (1497): `keymapCommands` catalog, `shortcutForCommand`, `findKeymapConflicts`; chords in `shortcutSequence.ts` + `keyChordStateMachine.ts` (2 s); dispatch in `useWorkbenchKeyboardShortcuts.ts` (346) + `workbenchShortcutCommandDispatcher.ts` | `Cmd+K` is already the prefix of 6 editor-group chords. `Cmd+/` is unbound (Monaco comment). P2 adds `agent.toggleSidebar` Cmd+B. |
| Shortcut glyphs | `src/components/settings/pages/keybindingsPresentation.ts` `keybindingStrokes(shortcut, platform)` | Read-only for P5 (P9 owns it). |
| Agent data | `AgentModeView.tsx` (1190): `presentationThreads`, `projects: AgentProjectDescriptor[]`, `navigation` (`selectThread`, `setProjectScope`, `railScope`, `selectedThreadId`), `scripts: AgentThreadScriptsSurface`, `newProjectThread` | The agent-only palettes `AgentThreadSearchPalette` / `AgentTerminalSessionsPalette` stay (content search is P4's sidebar). |
| Models | `AgentLaunchControls.tsx` renders `AgentModelPicker` with `launch`, `catalog`, `favorites`, `providerManagement`, and model `onSelect -> onLaunchChange(agentLaunchWithModel(...))` | `agentModelRows`, `agentLaunchEffectiveModel`, `agentModelProviderName` in `agentLaunchPresentation.ts`. |
| Branches | Controller: `refreshGitBranches`, `gitBranchEntries`, `gitRemoteBranchEntries`, `switchGitBranch`, `checkoutRemoteBranch` (`useGitBranchPanel.ts`, workspace-guarded) | The legacy `GitBranchPanel` stays for create/rename/delete. |
| Scripts | Controller `nodePackageScripts.scripts` + registry commands `script.node.<key>` (`workbenchNodePackageScriptCommands.ts`) | Agent: `scripts.entries` / `scripts.runScript(key)`. |
| Appearance | `src/domain/appearance.ts` (`PALETTE_IDS`, `PALETTE_LABELS`, `COLOR_SCHEME_*`), persisted by `saveWorkbenchSettings(app, workspace, trusted)` | Swatch colours come from `paletteTokens(palette, scheme).accent`. |
| Hotspots | `App.tsx` 7188 tokens = baseline (no headroom), `useWorkbenchController.ts` 9874 = baseline | P5 must not touch the controller, and its App.tsx hunk must be a net decrease. New files stay < 2000 lines / 10000 tokens. |

## Key decisions

1. **One palette, two existing flags.** The host is visible while `paletteOpen || quickOpenOpen`. The `files` page maps to `quickOpenOpen` (so the proven `useWorkbenchQuickOpen` engine keeps doing the search), and every other page maps to `paletteOpen`. The page stack lives in a pure reducer. Nothing is added to `useWorkbenchController.ts`.
2. **Legacy openers keep working.**
   - `commands.show` (⇧⌘P) and the Quick Open `>` handoff open the root in actions-only mode (`>` + initial query).
   - `file.quickOpen` (⌘P) opens the files page.
   - The new `palette.open` (⌘K) and `palette.shortcuts` (⌘/) send an explicit launch request (`page`, `query`) through `workbenchCommandPaletteLaunch` before opening.
3. **Focus scopes instead of rebinding.**
   - `keymapCommands` entries gain an optional `focus` field: `"editorText" | "outsideEditorText"`.
   - `palette.open` (Cmd+K) and `palette.shortcuts` (Cmd+/) are `outsideEditorText`.
   - The six `Cmd+K …` editor-group chords become `editorText`.
   - Conflict detection treats the two scopes as disjoint. Outside Monaco, ⌘K is instant. Inside Monaco, the chords and the comment toggle behave exactly as before.
   - Documented behavior change: the `Cmd+K …` editor-group chords now require focus inside the editor text (they no longer work from the file tree or terminal). See Open Questions.
4. **Registry-first actions.** Curated root actions map to existing registry command ids (for example `agent.newThread`, `agent.openDiffSurface`, `terminal.show`, `workbench.openSettings`, `project.add` from P8, `panel.toggleMaximized`). An action is hidden when none of its ids is registered, and shown disabled when registered but disabled. In `>` mode, every palette-visible registry command is listed (the old palette's capability). In search mode, registry matches appear in a "Commands" group capped at 8.
5. **Mode-neutral providers.**
   - Agent mode publishes an `AgentPaletteProvider` into a stack-based slot from `AgentModeView`. It is only used while `agentModeActive`, because the agent host is sticky-mounted.
   - Editor mode derives projects (workspace tabs), scripts (node package scripts) and branches from the controller.
   - The composer publishes `ComposerPaletteModels` from `AgentLaunchControls`.
   - Pages whose provider is absent are hidden (for example "New thread in…" and "Change model" in editor mode).
5a. **Agent-mode branches.** P9 does not bind an agent branch source. The switch-branch page uses the editor git source only while the workbench workspace root equals the active agent project root. Otherwise it shows "Branch switching for this project is not available here." Follow-up for P10: bind the F8 branch hook.
6. **Truthful data.** Branch rows show no timestamp (git branch lists carry none). Thread rows show a compact age (`4m`, `2h`, `1d`) from `updatedAtEpochMs`. Truncated script discovery shows a non-selectable "Showing first N scripts" row. The cheatsheet shows the real keymap (including user rebinding), not the mockup's illustrative list.
7. **Sidebar "Search ⌘K" button.** Not wired. P4 owns the sidebar search as inline thread search (spec §3.1.5 wins over the palette mockup). The palette opens with ⌘K. Changing this is a single P4 onClick if the owner decides otherwise.
8. **Legacy CSS.** `.palette-backdrop`, `.quick-open*` and `.palette-*` rules in `App.css` stay, because SearchEverywhere, ArtisanMakePalette, SurroundWithPicker and others still use them. P10 removes dead rules after all consumers migrate.

## Ownership

P5 creates (sole owner):

- `src/ui/foundation/CommandList.tsx`, `src/ui/foundation/useCommandListNavigation.ts`, `src/ui/foundation/commandList.css`, `src/ui/foundation/commandList.test.tsx`
- `src/domain/commandPalette/paletteMatch.ts` (+ `.test.ts`), `palettePages.ts` (+ test), `paletteNavigation.ts` (+ test), `paletteRootQuery.ts` (+ test), `paletteItem.ts`, `paletteAge.ts` (+ test)
- `src/application/commandPalette/commandPaletteProvider.ts` (+ test), `commandPaletteLaunch.ts` (+ test), `commandPaletteActions.ts` (+ test), `executePaletteIntent.ts` (+ test), `usePaletteRootFiles.ts` (+ test), `usePaletteBranches.ts` (+ test)
- `src/application/workbenchPaletteCommands.ts` (+ test), `src/application/shortcutFocusScope.ts` (+ test), `src/application/useWorkbenchKeyboardShortcuts.paletteFocus.test.tsx`
- `src/components/commandPalette/commandPalettePresenter.ts` (+ test), `paletteShortcuts.ts` (+ test), `PaletteHighlight.tsx`, `paletteIcons.tsx`, `CommandPalettePage.tsx` (+ test), `CommandPaletteHost.tsx` (+ test), `useCommandPaletteSession.ts` (+ test), `editorPaletteSources.ts` (+ test), `WorkbenchCommandPalette.tsx` (hook `useCommandPaletteHostProps` + wrapper component), `commandPalette.css`
- `src/components/agentMode/useAgentCommandPaletteProvider.ts` (+ test), `src/components/agentMode/useComposerPaletteBinding.ts` (+ test), `src/components/agentMode/agentModelProviderState.ts`

P5 modifies (small hunks, agreed with owners):

- `src/domain/keymap.ts` + `src/domain/keymap.test.ts`: append `palette.open`, `palette.shortcuts`, `panel.toggleMaximized` after P2's entries; add the `focus` field on the six `Cmd+K` chords; scope-aware `findKeymapConflicts` / `findKeymapSequenceConflicts` wrapper. Rebased on P2 (P2 sets counts 157/155; P5 bumps them). P8 appends `project.add` after P5.
- `src/domain/shortcutSequence.ts`: optional `overlaps` parameter on `findKeymapSequenceConflicts` (defaults to "always overlap"; existing callers unchanged).
- `src/application/useWorkbenchKeyboardShortcuts.ts`: the chord-lookup filter and the `commandIds` passed to `dispatchWorkbenchShortcutCommand` go through `shortcutFocusScope.ts`. P5 does not touch P2's `FOCUS_SCOPED_COMMAND_IDS` in `workbenchShortcutCommandDispatcher.ts`.
- `src/application/useWorkbenchCommandRegistry.ts`: the inline `openCommandsPalette` becomes a named `openPaletteSurface`, plus a `workbenchPaletteCommands(...)` registration.
- `src/application/workbenchAgentCommands.ts` (+ test): one `layoutCommand("panel.toggleMaximized", "Toggle Maximized Panel", { kind: "toggleMaximized" })` element appended after P2's `agent.toggleSidebar` (P2 agreement).
- `src/App.tsx`: replace `<LazyCommandPaletteHost …/>` and the Quick Open `<LazySurfaceHost …><LazyQuickOpen …/></LazySurfaceHost>` with one `<LazyCommandPaletteHost …/>` of the new host (net token decrease; P2 agreement: P2 does not move these lines).
- `src/components/appLazySurfaces.tsx`: `LazyCommandPalette` points to `./commandPalette/CommandPaletteHost`; `LazyQuickOpen` removed.
- `src/components/QuickOpen.tsx` + `QuickOpen.test.tsx`: restyled as the palette's files page on the new primitives (behavior unchanged).
- `src/App.quickOpen.integration.test.tsx`, `src/App.commandRouting.test.tsx`: selector updates only.
- `src/components/agentMode/AgentModeView.tsx`: one `useAgentCommandPaletteProvider(...)` call + import right after `useAgentViewCommands(viewCommands, commandHandlers);` (reserved by P2, the file owner).
- `src/components/agentMode/AgentLaunchControls.tsx`: extract `selectModel` and add a `useComposerPaletteBinding(...)` call (reserved by P9, the file owner; P3 routed it here).
- `src/components/agentMode/AgentModelPicker.tsx`: delete the 4 private helpers moved verbatim to `agentModelProviderState.ts` and import them (P9 agreement; behavior identical).

P5 deletes: `src/components/CommandPalette.tsx`, `src/components/CommandPalette.test.tsx`, `src/components/CommandPalette.quickInput.test.tsx` (its quick-input scenario is ported to `CommandPaletteHost.test.tsx`), `src/components/commandPaletteProps.ts`, `src/components/quickOpenProps.ts`.

### Ownership agreements (recorded 2026-09-24)

- **P2 (app shell, a132e6c74ff9ee432):**
  - P2 lands first in `keymap.ts` (`agent.toggleSidebar` Cmd+B, counts 157/155). P5 appends after it and bumps the counts. P5 does not reuse Cmd+B / Cmd+Alt+R / Cmd+J.
  - P2 keeps the palette/Quick Open lines in `App.tsx` in place. The P5 hunk is net-negative.
  - P2 reserves the P5 hunk in `AgentModeView.tsx` and the appended `panel.toggleMaximized` in `workbenchAgentCommands.ts` using P2's `layoutCommand` helper.
  - The editor-text focus helper is reused (`application/editorTextFocus.ts#editorTextFocusOwner` in the keydown path; P2's `components/agentMode/editorTextFocus.ts` for its bridge). There is no third definition.
- **P3 (conversation/composer, a205baf739b446ab2):** P3 touches nothing for P5. The model binding is hosted in `AgentLaunchControls.tsx` (P9). The fallback, used only if P9 refuses, is a P3 hunk in `AgentComposer.tsx`. P9 accepted, so the fallback is unused.
- **P4 (sidebar/F1, a2482a98f8b2569a1):**
  - P5 only reads `useAgentThreadNavigation.ts`, `agentModeNavigation.ts`, `useAgentThreadSearch.ts`, `AgentThreadSearchResults.tsx` and `domain/agentThreadSearch.ts`.
  - P5 uses `navigation.selectedThreadId`, `navigation.railScope`, `navigation.selectThread(id)` and `navigation.setProjectScope(rootKey): boolean` (P4 makes setProjectScope reconcile the rail filter).
  - The sidebar search field stays inline thread search and is not a palette trigger.
- **P8 (projects/clone, adfa51e173f235c1a):**
  - P5 shows the root action "Add project…" (folder-plus; keywords open folder, clone, git, github, gitlab) and a last "Add project…" row on the Switch project page. Both run registry command `project.add` and are hidden when it is missing or disabled.
  - P8 registers `project.add` (keymap entry after P5's, handler via the agent view command bridge).
  - P8 composes the foundation primitives `CommandSurface`, `CommandInput` (with `leadIcon`, `lead: "back"`, `trailing`), `CommandPanel`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`, `CommandFooter`, `CommandFooterHint` and `useCommandListNavigation`.
  - The legacy palette CSS classes stay.
- **P7 (editor, a623878975c715028):** every palette file-open goes through `openPaletteFile(workbench, result, location?)` in `src/components/commandPalette/WorkbenchCommandPalette.tsx`. P7 (which runs after P5) adds one hunk there that reveals the editor surface (`agent.openEditorSurface`) after the open resolves. P7's new Cmd+Shift+M default for the existing `panel.showProblems` reaches the palette through the registry with no P5 work.
- **P9 (settings/pickers, a7a75a0e28b940d64):**
  - P9 does not bind the agent branch slot (P10 follow-up).
  - P9 keeps `keybindingStrokes` unchanged, and adds `keybindingWhenLabel` reading the P5 `focus` field.
  - P5 makes the `AgentLaunchControls.tsx` (`selectModel` + binding call) and `AgentModelPicker.tsx` (helper extraction) hunks before P9 restyles.
  - P9 keeps `selectModel` and `useComposerPaletteBinding(...)` intact.

## File Structure

```text
src/ui/foundation/
  CommandList.tsx               generic surface/input/list/group/item/empty/footer primitives
  useCommandListNavigation.ts   active-row state + keyboard (arrows, Ctrl+N/P, Home/End, Enter)
  commandList.css               cv-command-* rules, tokens only
  commandList.test.tsx
src/domain/commandPalette/
  paletteMatch.ts               token filter, token highlight ranges, fuzzy subsequence
  palettePages.ts               closed PalettePageId union, page copy, page->surface
  paletteNavigation.ts          page stack reducer (open/push/pop/setQuery)
  paletteRootQuery.ts           root input parser: empty | actions (">") | files ("@") | search
  paletteItem.ts                PaletteItem/PaletteGroup/PaletteIcon/PaletteGlyph/PaletteIntent
  paletteAge.ts                 compact age labels
src/application/commandPalette/
  commandPaletteProvider.ts     provider slot (stack), AgentPaletteProvider, ComposerPaletteModels, data types
  commandPaletteLaunch.ts       launch request channel for palette.open / palette.shortcuts
  commandPaletteActions.ts      curated root actions -> registry ids / pages
  executePaletteIntent.ts       intent -> side effect, fail-closed outcomes
  usePaletteRootFiles.ts        root "Files" group search (top 5), generation-guarded
  usePaletteBranches.ts         branch list load for the page and the root group
src/application/
  workbenchPaletteCommands.ts   registry commands palette.open, palette.shortcuts
  shortcutFocusScope.ts         focus-scope policy for keydown and chord lookup
src/components/commandPalette/
  commandPalettePresenter.ts    page builders -> PaletteGroup[]
  paletteShortcuts.ts           shortcut label formatting + cheatsheet groups
  PaletteHighlight.tsx          renders HighlightRange[] as <mark>/<b>
  paletteIcons.tsx              PaletteIcon -> lucide / monogram / swatch
  CommandPalettePage.tsx        one non-files page (input, groups, footer)
  useCommandPaletteSession.ts   flags <-> page stack synchronisation
  editorPaletteSources.ts       editor-mode projects/scripts/branch source from the controller
  CommandPaletteHost.tsx        container mounted once in App.tsx
  WorkbenchCommandPalette.tsx   workbench -> host props hook + lazy-loaded wrapper
  commandPalette.css            feature layout (swatch dot, monogram), tokens only
src/components/agentMode/
  useAgentCommandPaletteProvider.ts   publishes AgentPaletteProvider while mounted
  useComposerPaletteBinding.ts        publishes ComposerPaletteModels from the launch controls
  agentModelProviderState.ts          helpers moved from AgentModelPicker
```

---

### Task 1: Foundation command list primitives

**Files:**
- Create: `src/ui/foundation/CommandList.tsx`
- Create: `src/ui/foundation/useCommandListNavigation.ts`
- Create: `src/ui/foundation/commandList.css`
- Test: `src/ui/foundation/commandList.test.tsx`

**Interfaces:**
- Consumes: `cx` (`./classNames`), `useRestoreFocus` (`./useRestoreFocus`), `mountUi`/`press`/`click`/`pointer` (`./foundationTestSupport`).
- Produces:
  - `CommandSurface({label, onClose, children, returnFocusRef?})`
  - `CommandInput({value, placeholder, label, listboxId, activeDescendantId, lead?, leadIcon?, trailing?, inputRef?, onChange, onKeyDown?, onBack?, onCompositionStart?, onCompositionEnd?})`
  - `CommandPanel({children})`, `CommandList({id, label, children})`, `CommandGroup({label, children})`
  - `CommandItem({id, active, title, description?, icon?, trailing?, timestamp?, shortcut?, submenu?, disabled?, hint?, onSelect, onHover})`
  - `CommandEmpty({children})`, `CommandFooter({children, end?})`, `CommandFooterHint({keys, label})`
  - `useCommandListNavigation({count, resetKey, homeEndEnabled, onExecute}): {activeIndex, setActiveIndex, handleKeyDown}`
  - `commandItemId(listboxId, index): string`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom

import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSurface,
  commandItemId,
} from "./CommandList";
import { click, mountUi, pointer, press, type MountedUi } from "./foundationTestSupport";
import { useCommandListNavigation } from "./useCommandListNavigation";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

interface HarnessProps {
  readonly rows: readonly string[];
  onExecute(row: string): void;
  onClose(): void;
}

function Harness({ onClose, onExecute, rows }: HarnessProps) {
  const [query, setQuery] = useState("");
  const visible = rows.filter((row) => row.includes(query));
  const nav = useCommandListNavigation({
    count: visible.length,
    resetKey: query,
    homeEndEnabled: query === "",
    onExecute: (index) => {
      const row = visible[index];
      if (row === undefined) return;
      onExecute(row);
    },
  });
  return (
    <CommandSurface label="Command palette" onClose={onClose}>
      <CommandInput
        activeDescendantId={nav.activeIndex < 0 ? null : commandItemId("h", nav.activeIndex)}
        label="Search"
        listboxId="h"
        onChange={setQuery}
        onKeyDown={(event) => {
          nav.handleKeyDown(event);
        }}
        placeholder="Search…"
        value={query}
      />
      <CommandPanel>
        {visible.length === 0 ? (
          <CommandEmpty>No matches.</CommandEmpty>
        ) : (
          <CommandList id="h" label="Results">
            <CommandGroup label="Actions">
              {visible.map((row, index) => (
                <CommandItem
                  active={index === nav.activeIndex}
                  id={commandItemId("h", index)}
                  key={row}
                  onHover={() => nav.setActiveIndex(index)}
                  onSelect={() => onExecute(row)}
                  shortcut="⌘N"
                  submenu={row === "Switch project"}
                  title={row}
                />
              ))}
            </CommandGroup>
          </CommandList>
        )}
      </CommandPanel>
      <CommandFooter>
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </CommandSurface>
  );
}

const ROWS = ["New thread", "Switch project", "Open settings"] as const;

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(".cv-command-field input");
  expect(element).not.toBeNull();
  return element as HTMLInputElement;
}

function selected(): string | null {
  return document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? null;
}

describe("command list primitives", () => {
  it("renders a modal dialog with a combobox wired to the listbox", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBe("Command palette");
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-controls")).toBe("h");
    expect(input().getAttribute("aria-activedescendant")).toBe(commandItemId("h", 0));
    expect(document.activeElement).toBe(input());
  });

  it("moves the active row with arrows and Ctrl+N/P and wraps at both ends", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    press(input(), "ArrowUp");
    expect(selected()).toContain("Open settings");
    press(input(), "ArrowDown");
    expect(selected()).toContain("New thread");
    press(input(), "n", { ctrlKey: true });
    expect(selected()).toContain("Switch project");
    press(input(), "p", { ctrlKey: true });
    expect(selected()).toContain("New thread");
  });

  it("executes the active row on Enter and a clicked row without stealing input focus", () => {
    const onExecute = vi.fn();
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={onExecute} rows={ROWS} />);

    press(input(), "ArrowDown");
    press(input(), "Enter");
    const third = document.querySelectorAll('[role="option"]')[2];
    expect(third).toBeDefined();
    click(third as Element);

    expect(onExecute.mock.calls).toEqual([["Switch project"], ["Open settings"]]);
    expect(document.activeElement).toBe(input());
  });

  it("closes on Escape and on a backdrop pointer, not on a pointer inside the dialog", () => {
    const onClose = vi.fn();
    ui = mountUi();
    ui.render(<Harness onClose={onClose} onExecute={vi.fn()} rows={ROWS} />);

    pointer(document.querySelector('[role="dialog"]') as Element, "pointerdown");
    expect(onClose).not.toHaveBeenCalled();
    pointer(document.querySelector(".cv-command-viewport") as Element, "pointerdown");
    press(input(), "Escape");

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders the empty state, shortcut, submenu chevron and footer hints", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    expect(document.querySelector(".cv-command-item__shortcut")?.textContent).toBe("⌘N");
    expect(document.querySelectorAll(".cv-command-item__chevron")).toHaveLength(1);
    expect(document.querySelector(".cv-command-footer")?.textContent).toContain("Navigate");

    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={[]} />);
    expect(document.querySelector(".cv-command-empty")?.textContent).toBe("No matches.");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("resets the active row when the reset key changes", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    press(input(), "ArrowDown");
    press(input(), "ArrowDown");
    expect(selected()).toContain("Open settings");
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={[...ROWS, "Open file"]} />);
    expect(selected()).toContain("Open settings");
  });

  it("shows a back button lead that calls onBack", () => {
    const onBack = vi.fn();
    function BackHarness() {
      const ref = useRef<HTMLInputElement | null>(null);
      return (
        <CommandSurface label="Command palette" onClose={vi.fn()}>
          <CommandInput
            activeDescendantId={null}
            inputRef={ref}
            label="Search"
            lead="back"
            listboxId="b"
            onBack={onBack}
            onChange={vi.fn()}
            placeholder="Search…"
            trailing={<span className="probe-trailing">This computer</span>}
            value=""
          />
        </CommandSurface>
      );
    }
    ui = mountUi();
    ui.render(<BackHarness />);

    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    expect(back).not.toBeNull();
    click(back as Element);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cv-command-field__trailing .probe-trailing")).not.toBeNull();
  });
});
```

The class `probe-trailing` sits in test markup only, and CSS contract tests parse stylesheets only, so this is fine.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/foundation/commandList.test.tsx`
Expected: FAIL with "Failed to resolve import "./CommandList"".

- [ ] **Step 3: Write `useCommandListNavigation.ts`**

```ts
import { useState, type KeyboardEvent } from "react";

export interface CommandListNavigationOptions {
  readonly count: number;
  readonly resetKey: string;
  readonly homeEndEnabled: boolean;
  onExecute(index: number): void;
}

export interface CommandListNavigation {
  readonly activeIndex: number;
  setActiveIndex(index: number): void;
  handleKeyDown(event: KeyboardEvent<HTMLElement>): boolean;
}

interface ActiveState {
  readonly key: string;
  readonly index: number;
}

export function useCommandListNavigation({
  count,
  homeEndEnabled,
  onExecute,
  resetKey,
}: CommandListNavigationOptions): CommandListNavigation {
  const [state, setState] = useState<ActiveState>({ key: resetKey, index: 0 });
  const requested = state.key === resetKey ? state.index : 0;
  const activeIndex = count <= 0 ? -1 : Math.min(Math.max(requested, 0), count - 1);
  const setActiveIndex = (index: number): void => setState({ key: resetKey, index });
  const move = (delta: number): void => {
    if (count <= 0) return;
    setActiveIndex((Math.max(activeIndex, 0) + delta + count) % count);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const next = event.key === "ArrowDown" || (ctrlOnly && event.key === "n");
    const previous = event.key === "ArrowUp" || (ctrlOnly && event.key === "p");
    if (next || previous) {
      event.preventDefault();
      move(next ? 1 : -1);
      return true;
    }
    if ((event.key === "Home" || event.key === "End") && homeEndEnabled && count > 0) {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : count - 1);
      return true;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return false;
    event.preventDefault();
    if (activeIndex >= 0) onExecute(activeIndex);
    return true;
  };

  return { activeIndex, setActiveIndex, handleKeyDown };
}
```

- [ ] **Step 4: Write `CommandList.tsx`**

```tsx
import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./classNames";
import { useRestoreFocus } from "./useRestoreFocus";
import "./commandList.css";

export function commandItemId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

export interface CommandSurfaceProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
}

export function CommandSurface(props: CommandSurfaceProps) {
  return createPortal(<CommandSurfaceFrame {...props} />, document.body);
}

function CommandSurfaceFrame({ children, label, onClose, returnFocusRef }: CommandSurfaceProps) {
  useRestoreFocus(returnFocusRef);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const keepFocus = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
  };
  const dismiss = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    onClose();
  };
  return (
    <div className="cv-command-layer" onKeyDown={handleKeyDown}>
      <div aria-hidden="true" className="cv-command-backdrop" />
      <div className="cv-command-viewport" onMouseDown={keepFocus} onPointerDown={dismiss}>
        <div aria-label={label} aria-modal="true" className="cv-command" role="dialog">
          {children}
        </div>
      </div>
    </div>
  );
}

export type CommandInputLead = "search" | "back";

export interface CommandInputProps {
  readonly value: string;
  readonly placeholder: string;
  readonly label: string;
  readonly listboxId: string;
  readonly activeDescendantId: string | null;
  readonly lead?: CommandInputLead;
  readonly leadIcon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  onChange(value: string): void;
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
  onBack?(): void;
  onCompositionStart?(): void;
  onCompositionEnd?(value: string): void;
}

export function CommandInput({
  activeDescendantId,
  inputRef,
  label,
  lead = "search",
  leadIcon,
  listboxId,
  onBack,
  onChange,
  onCompositionEnd,
  onCompositionStart,
  onKeyDown,
  placeholder,
  trailing,
  value,
}: CommandInputProps) {
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [ref]);
  return (
    <div className="cv-command-input">
      <div className="cv-command-field">
        <CommandInputLeadView lead={lead} leadIcon={leadIcon} onBack={onBack} />
        <input
          aria-activedescendant={activeDescendantId ?? undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-label={label}
          autoComplete="off"
          onChange={(event) => onChange(event.currentTarget.value)}
          onCompositionEnd={(event) => onCompositionEnd?.(event.currentTarget.value)}
          onCompositionStart={() => onCompositionStart?.()}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          ref={ref}
          role="combobox"
          spellCheck={false}
          type="text"
          value={value}
        />
        {trailing === undefined ? null : (
          <span className="cv-command-field__trailing">{trailing}</span>
        )}
      </div>
    </div>
  );
}

function CommandInputLeadView({
  lead,
  leadIcon,
  onBack,
}: {
  readonly lead: CommandInputLead;
  readonly leadIcon: ReactNode;
  onBack?(): void;
}) {
  if (lead === "back") {
    return (
      <button
        aria-label="Back"
        className="cv-command-lead cv-command-lead--back"
        onClick={() => onBack?.()}
        onMouseDown={(event) => event.preventDefault()}
        tabIndex={-1}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={16} />
      </button>
    );
  }
  return (
    <span aria-hidden="true" className="cv-command-lead">
      {leadIcon ?? <Search size={16} />}
    </span>
  );
}

export function CommandPanel({ children }: { readonly children: ReactNode }) {
  return <div className="cv-command-panel">{children}</div>;
}

export function CommandList({
  children,
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div aria-label={label} className="cv-command-list" id={id} role="listbox">
      {children}
    </div>
  );
}

export function CommandGroup({
  children,
  label,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="cv-command-group" role="group">
      <div className="cv-command-group__label" id={labelId}>
        {label}
      </div>
      {children}
    </div>
  );
}

export interface CommandItemProps {
  readonly id: string;
  readonly active: boolean;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly timestamp?: string;
  readonly shortcut?: string;
  readonly submenu?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
  onSelect(): void;
  onHover(): void;
}

export function CommandItem({
  active,
  description,
  disabled = false,
  hint,
  icon,
  id,
  onHover,
  onSelect,
  shortcut,
  submenu = false,
  timestamp,
  title,
  trailing,
}: CommandItemProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div
      aria-disabled={disabled ? true : undefined}
      aria-selected={active}
      className={cx("cv-command-item", disabled && "cv-command-item--disabled")}
      id={id}
      onClick={() => {
        if (disabled) return;
        onSelect();
      }}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (active) return;
        onHover();
      }}
      ref={ref}
      role="option"
      title={hint}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-command-item__icon">
          {icon}
        </span>
      )}
      <span className="cv-command-item__text">
        <span className="cv-command-item__title">{title}</span>
        {description === undefined ? null : (
          <span className="cv-command-item__description">{description}</span>
        )}
      </span>
      {trailing === undefined ? null : (
        <span className="cv-command-item__trailing">{trailing}</span>
      )}
      {timestamp === undefined ? null : (
        <span className="cv-command-item__timestamp">{timestamp}</span>
      )}
      {shortcut === undefined ? null : <kbd className="cv-command-item__shortcut">{shortcut}</kbd>}
      {submenu ? (
        <ChevronRight aria-hidden="true" className="cv-command-item__chevron" size={16} />
      ) : null}
    </div>
  );
}

export function CommandEmpty({ children }: { readonly children: ReactNode }) {
  return (
    <div className="cv-command-empty" role="status">
      {children}
    </div>
  );
}

export function CommandFooter({
  children,
  end,
}: {
  readonly children: ReactNode;
  readonly end?: ReactNode;
}) {
  return (
    <div aria-hidden="true" className="cv-command-footer">
      {children}
      {end === undefined ? null : <span className="cv-command-footer__end">{end}</span>}
    </div>
  );
}

export function CommandFooterHint({
  keys,
  label,
}: {
  readonly keys: readonly string[];
  readonly label: string;
}) {
  return (
    <span className="cv-command-hint">
      {keys.map((key, index) => (
        <span className="cv-command-kbd" key={`${index}-${key}`}>
          {key}
        </span>
      ))}
      <span>{label}</span>
    </span>
  );
}
```

- [ ] **Step 5: Write `commandList.css`** (tokens only; the foundation style contract forbids colour literals, raw durations and non-`cv-` classes)

```css
@keyframes cv-command-in {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}

@keyframes cv-command-fade {
  from {
    opacity: 0;
  }
}

.cv-command-layer {
  position: fixed;
  inset: 0;
  z-index: var(--cv-z-dialog);
}

.cv-command-backdrop {
  position: absolute;
  inset: 0;
  background: var(--cv-overlay);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  animation: cv-command-fade var(--cv-motion-base) var(--cv-ease);
}

.cv-command-viewport {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10vh 16px;
}

.cv-command {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 576px;
  max-height: 420px;
  min-height: 0;
  border-radius: var(--cv-r-dialog);
  background: color-mix(in srgb, var(--cv-canvas) 80%, transparent);
  -webkit-backdrop-filter: blur(12px) saturate(1.14);
  backdrop-filter: blur(12px) saturate(1.14);
  box-shadow: var(--cv-shadow-dialog);
  color: var(--cv-fg-strong);
  font: var(--cv-t-sm) / var(--cv-lh-sm) var(--cv-font-ui);
  animation: cv-command-in var(--cv-motion-base) var(--cv-ease);
}

:root[data-cv-scheme="light"] .cv-command {
  background: color-mix(in srgb, var(--cv-raised) 86%, transparent);
}

.cv-command-input {
  flex: none;
  padding: 6px 8px;
}

.cv-command-field {
  position: relative;
  display: flex;
  align-items: center;
  height: 34px;
}

.cv-command-field input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 12px 0 40px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--cv-fg-strong);
  font: inherit;
  caret-color: var(--cv-accent);
}

.cv-command-field input::placeholder {
  color: var(--cv-fg-subtle);
}

.cv-command-field input:focus-visible {
  outline: none;
}

.cv-command-field__trailing {
  display: inline-flex;
  flex: none;
  align-items: center;
  margin-left: 10px;
}

.cv-command-lead {
  position: absolute;
  top: 50%;
  left: 12px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--cv-fg-subtle);
  transform: translateY(-50%);
}

.cv-command-lead--back {
  left: 9px;
  width: 22px;
  height: 22px;
  border-radius: var(--cv-r-sm);
  cursor: pointer;
}

.cv-command-lead--back:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-command-panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  border-radius: var(--cv-r-group) var(--cv-r-group) 0 0;
}

.cv-command-list {
  padding: 8px;
  scroll-padding: 8px;
}

.cv-command-group + .cv-command-group {
  margin-top: 6px;
}

.cv-command-group__label {
  padding: 6px 8px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-weight: 500;
  line-height: var(--cv-lh-xs);
}

.cv-command-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 6px 8px;
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg-strong);
  cursor: pointer;
  user-select: none;
}

.cv-command-item[aria-selected="true"] {
  background: var(--cv-tint-3);
}

.cv-command-item--disabled {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.cv-command-item__icon {
  display: inline-grid;
  flex: none;
  place-items: center;
  color: var(--cv-fg-subtle);
}

.cv-command-item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.cv-command-item__title,
.cv-command-item__description {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-command-item__description {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  line-height: var(--cv-lh-xs);
}

.cv-command-item__trailing {
  display: inline-grid;
  flex: none;
  place-items: center;
  color: var(--cv-fg-muted);
}

.cv-command-item__timestamp {
  flex: none;
  min-width: 48px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.cv-command-item__shortcut {
  flex: none;
  margin-left: auto;
  color: var(--cv-fg-subtle);
  font: 500 var(--cv-t-xs) / var(--cv-lh-xs) var(--cv-font-ui);
  letter-spacing: 0.1em;
}

.cv-command-item__chevron {
  flex: none;
  margin-right: -2px;
  color: var(--cv-fg-subtle);
}

.cv-command-empty {
  padding: 40px 16px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-sm);
  text-align: center;
}

.cv-command-footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 0 0 15px 15px;
  background: color-mix(in srgb, var(--cv-fg-strong) 2.5%, transparent);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-weight: 500;
}

.cv-command-footer__end {
  margin-left: auto;
}

.cv-command-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cv-command-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border-radius: var(--cv-r-xs);
  background: color-mix(in srgb, var(--cv-fg-strong) 8%, transparent);
  color: var(--cv-fg-strong);
  font: 500 var(--cv-t-xs) / 1 var(--cv-font-ui);
}
```

- [ ] **Step 6: Run the new test and the foundation style contract**

Run: `npx vitest run src/ui/foundation/commandList.test.tsx src/ui/foundation/foundationStyles.test.ts`
Expected: PASS. If `foundationStyles.test.ts` flags `--cv-raised` or `--cv-canvas` as undeclared, run `grep -n -- "--cv-raised:\|--cv-canvas:" src/ui/tokens/*.css`. Both are declared in `semantic.css` today. Use exactly those names and do not add tokens.

- [ ] **Step 7: Commit**

```bash
git add src/ui/foundation/CommandList.tsx src/ui/foundation/useCommandListNavigation.ts src/ui/foundation/commandList.css src/ui/foundation/commandList.test.tsx
git commit -m "feat(ui): add command list foundation primitives"
```

---

### Task 2: Palette matching (domain)

**Files:**
- Create: `src/domain/commandPalette/paletteMatch.ts`
- Test: `src/domain/commandPalette/paletteMatch.test.ts`

**Interfaces:**
- Produces:
  - `MAX_PALETTE_QUERY_CHARS = 256`, `MAX_PALETTE_QUERY_TOKENS = 8`
  - `interface HighlightRange { readonly start: number; readonly end: number }`
  - `paletteQueryTokens(query: string): readonly string[]`
  - `matchesAllTokens(terms: readonly string[], tokens: readonly string[]): boolean`
  - `tokenHighlightRanges(text: string, tokens: readonly string[]): readonly HighlightRange[]`
  - `interface FuzzyMatch { readonly indexes: readonly number[]; readonly span: number }`
  - `fuzzySubsequence(text: string, query: string): FuzzyMatch | null`
  - `fuzzyHighlightRanges(match: FuzzyMatch | null): readonly HighlightRange[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_PALETTE_QUERY_CHARS,
  fuzzyHighlightRanges,
  fuzzySubsequence,
  matchesAllTokens,
  paletteQueryTokens,
  tokenHighlightRanges,
} from "./paletteMatch";

describe("paletteQueryTokens", () => {
  it("lowercases, splits on whitespace and drops empties", () => {
    expect(paletteQueryTokens("  Order   API ")).toEqual(["order", "api"]);
    expect(paletteQueryTokens(" \t\n ")).toEqual([]);
  });

  it("bounds pasted input to the character and token caps", () => {
    const tokens = paletteQueryTokens(`${"a ".repeat(40)}${"b".repeat(10_000)}`);
    expect(tokens).toHaveLength(8);
    expect(tokens.join(" ").length).toBeLessThanOrEqual(MAX_PALETTE_QUERY_CHARS);
  });
});

describe("matchesAllTokens", () => {
  it("requires every token somewhere in the joined terms", () => {
    expect(matchesAllTokens(["Idempotency keys", "orders-api"], ["idem", "orders"])).toBe(true);
    expect(matchesAllTokens(["Idempotency keys"], ["idem", "billing"])).toBe(false);
    expect(matchesAllTokens(["anything"], [])).toBe(true);
  });

  it("treats regex metacharacters literally", () => {
    expect(matchesAllTokens(["a+b (c)"], ["+b", "(c)"])).toBe(true);
    expect(matchesAllTokens(["abc"], [".*"])).toBe(false);
  });
});

describe("tokenHighlightRanges", () => {
  it("marks every occurrence of every token and merges overlaps", () => {
    expect(tokenHighlightRanges("orders order", ["order", "rs"])).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 12 },
    ]);
  });

  it("returns no ranges when case folding changes the string length", () => {
    expect(tokenHighlightRanges("İstanbul orders", ["orders"])).toEqual([]);
  });
});

describe("fuzzySubsequence", () => {
  it("prefers the tightest span", () => {
    const match = fuzzySubsequence("src/middleware/idempotency.ts", "idm");
    expect(match?.span).toBeLessThan(6);
    expect(fuzzyHighlightRanges(match)).toEqual([
      { start: 15, end: 17 },
      { start: 18, end: 19 },
    ]);
  });

  it("returns null for a missing character and for an empty query", () => {
    expect(fuzzySubsequence("orders.ts", "oz")).toBeNull();
    expect(fuzzySubsequence("orders.ts", "")).toBeNull();
  });

  it("stays bounded for long adversarial input", () => {
    const text = "a".repeat(4_000);
    const query = `${"a".repeat(200)}b`;
    const started = performance.now();
    expect(fuzzySubsequence(text, query)).toBeNull();
    expect(performance.now() - started).toBeLessThan(250);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/commandPalette/paletteMatch.test.ts`
Expected: FAIL with "Failed to resolve import "./paletteMatch"".

- [ ] **Step 3: Write `paletteMatch.ts`**

```ts
export const MAX_PALETTE_QUERY_CHARS = 256;
export const MAX_PALETTE_QUERY_TOKENS = 8;
const MAX_FUZZY_TEXT_CHARS = 1_024;
const MAX_FUZZY_STARTS = 64;

export interface HighlightRange {
  readonly start: number;
  readonly end: number;
}

export interface FuzzyMatch {
  readonly indexes: readonly number[];
  readonly span: number;
}

export function paletteQueryTokens(query: string): readonly string[] {
  return query
    .slice(0, MAX_PALETTE_QUERY_CHARS)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, MAX_PALETTE_QUERY_TOKENS);
}

export function matchesAllTokens(terms: readonly string[], tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = terms.join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function tokenHighlightRanges(
  text: string,
  tokens: readonly string[],
): readonly HighlightRange[] {
  const lower = text.toLowerCase();
  if (tokens.length === 0 || lower.length !== text.length) return [];
  const hits: HighlightRange[] = [];
  for (const token of tokens) {
    let index = lower.indexOf(token);
    while (index >= 0) {
      hits.push({ start: index, end: index + token.length });
      index = lower.indexOf(token, index + token.length);
    }
  }
  return mergeRanges(hits);
}

export function fuzzySubsequence(text: string, query: string): FuzzyMatch | null {
  const needle = query.toLowerCase().replace(/\s+/g, "").slice(0, MAX_PALETTE_QUERY_CHARS);
  const haystack = text.slice(0, MAX_FUZZY_TEXT_CHARS);
  const lower = haystack.toLowerCase();
  if (needle.length === 0 || lower.length !== haystack.length) return null;
  let best: FuzzyMatch | null = null;
  let starts = 0;
  for (let start = lower.indexOf(needle[0] ?? ""); start >= 0; start = lower.indexOf(needle[0] ?? "", start + 1)) {
    if (starts >= MAX_FUZZY_STARTS) break;
    starts += 1;
    const indexes = subsequenceFrom(lower, needle, start);
    if (indexes === null) break;
    const span = (indexes[indexes.length - 1] ?? start) - start;
    if (best === null || span < best.span) best = { indexes, span };
  }
  return best;
}

export function fuzzyHighlightRanges(match: FuzzyMatch | null): readonly HighlightRange[] {
  if (match === null) return [];
  return mergeRanges(match.indexes.map((index) => ({ start: index, end: index + 1 })));
}

function subsequenceFrom(lower: string, needle: string, start: number): number[] | null {
  const indexes = [start];
  let position = start + 1;
  for (let offset = 1; offset < needle.length; offset += 1) {
    const found = lower.indexOf(needle[offset] ?? "", position);
    if (found < 0) return null;
    indexes.push(found);
    position = found + 1;
  }
  return indexes;
}

function mergeRanges(ranges: readonly HighlightRange[]): readonly HighlightRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last === undefined || range.start > last.end) {
      merged.push(range);
      continue;
    }
    merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
  }
  return merged;
}
```

Note: `mergeRanges` merges touching ranges (`start === end` of the previous one), so the fuzzy test expects `{15,17}` for adjacent indexes 15 and 16. The `for` loop header in `fuzzySubsequence` may exceed the line width. Let Prettier format this file only (`npx prettier --write src/domain/commandPalette/paletteMatch.ts`), never a directory.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/commandPalette/paletteMatch.test.ts`
Expected: PASS. If the fuzzy range assertion fails, print `fuzzySubsequence("src/middleware/idempotency.ts","idm")` in a scratch test to find the real indexes (`i`=15, `d`=16, `m`=18 in `idempotency` starting at 15). Fix the expectation only if the algorithm picked a tighter valid span. The tightest-span rule must hold.

- [ ] **Step 5: Commit**

```bash
git add src/domain/commandPalette/paletteMatch.ts src/domain/commandPalette/paletteMatch.test.ts
git commit -m "feat(palette): add bounded palette token and fuzzy matching"
```

---

### Task 3: Palette pages, navigation, root query, items and ages (domain)

**Files:**
- Create: `src/domain/commandPalette/palettePages.ts`, `paletteNavigation.ts`, `paletteRootQuery.ts`, `paletteItem.ts`, `paletteAge.ts`
- Test: `src/domain/commandPalette/palettePages.test.ts`, `paletteNavigation.test.ts`, `paletteRootQuery.test.ts`, `paletteAge.test.ts`

**Interfaces:**
- Consumes: `HighlightRange` (Task 2), `FileSearchResult` (`src/domain/workspace.ts`), `PaletteId`, `ColorSchemePreference` (`src/domain/appearance.ts`).
- Produces:
  - `PALETTE_PAGE_IDS`, `type PalettePageId`, `type PaletteSurface = "commands" | "files"`
  - `paletteSurfaceForPage(page)`, `isPalettePageId(value)`
  - `interface PalettePageCopy { placeholder; enterLabel: string | null; empty }`, `palettePageCopy(page, actionsOnly)`
  - `interface PaletteNavigationState { stack; query; generation }`, `type PaletteNavigationAction`, `INITIAL_PALETTE_NAVIGATION`, `reducePaletteNavigation`, `currentPalettePage`
  - `type PaletteRootQuery`, `parsePaletteRootQuery(raw)`
  - `type PaletteGlyph`, `type PaletteIcon`, `interface PaletteText`, `type PaletteIntent`, `interface PaletteItem`, `interface PaletteGroup`, `plainText(text)`
  - `compactAgeLabel(nowMs, thenMs)`

- [ ] **Step 1: Write the failing tests**

`palettePages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isPalettePageId, palettePageCopy, paletteSurfaceForPage } from "./palettePages";

describe("palette pages", () => {
  it("maps only the files page to the files surface", () => {
    expect(paletteSurfaceForPage("files")).toBe("files");
    expect(paletteSurfaceForPage("root")).toBe("commands");
    expect(paletteSurfaceForPage("shortcuts")).toBe("commands");
  });

  it("uses the mockup copy", () => {
    expect(palettePageCopy("root", false)).toEqual({
      placeholder: "Search commands, projects, threads, and files…",
      enterLabel: null,
      empty: "No matching commands, projects, threads, or files.",
    });
    expect(palettePageCopy("root", true).empty).toBe("No matching actions.");
    expect(palettePageCopy("files", false)).toEqual({
      placeholder: "Search files…",
      enterLabel: "Open file",
      empty: "No matching files.",
    });
    expect(palettePageCopy("changeModel", false).placeholder).toBe("Search models…");
    expect(palettePageCopy("shortcuts", false)).toEqual({
      placeholder: "Search shortcuts…",
      enterLabel: "Run",
      empty: "No matching shortcuts.",
    });
    expect(palettePageCopy("switchBranch", false)).toEqual({
      placeholder: "Search…",
      enterLabel: null,
      empty: "No matches.",
    });
  });

  it("rejects unknown page ids", () => {
    expect(isPalettePageId("theme")).toBe(true);
    expect(isPalettePageId("settings")).toBe(false);
    expect(isPalettePageId(null)).toBe(false);
  });
});
```

`paletteNavigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  INITIAL_PALETTE_NAVIGATION,
  currentPalettePage,
  reducePaletteNavigation,
} from "./paletteNavigation";

describe("reducePaletteNavigation", () => {
  it("opens root alone, files alone and other pages above root", () => {
    const root = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, { type: "open", page: "root", query: ">" });
    const files = reducePaletteNavigation(root, { type: "open", page: "files", query: "" });
    const keys = reducePaletteNavigation(files, { type: "open", page: "shortcuts", query: "" });

    expect(root.stack).toEqual(["root"]);
    expect(root.query).toBe(">");
    expect(files.stack).toEqual(["files"]);
    expect(keys.stack).toEqual(["root", "shortcuts"]);
    expect(keys.generation).toBeGreaterThan(files.generation);
  });

  it("pushes a page with an empty query and pops back to its parent", () => {
    const typed = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, { type: "setQuery", query: "ord" });
    const pushed = reducePaletteNavigation(typed, { type: "push", page: "switchProject" });
    const popped = reducePaletteNavigation(pushed, { type: "pop" });

    expect(currentPalettePage(pushed)).toBe("switchProject");
    expect(pushed.query).toBe("");
    expect(currentPalettePage(popped)).toBe("root");
    expect(popped.query).toBe("");
  });

  it("never pops the last page and ignores pushing the current page", () => {
    const popped = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, { type: "pop" });
    const same = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, { type: "push", page: "root" });

    expect(popped).toBe(INITIAL_PALETTE_NAVIGATION);
    expect(same).toBe(INITIAL_PALETTE_NAVIGATION);
  });

  it("bounds depth and query length", () => {
    let state = INITIAL_PALETTE_NAVIGATION;
    for (const page of ["switchProject", "theme", "appearance", "shortcuts", "runScript"] as const) {
      state = reducePaletteNavigation(state, { type: "push", page });
    }
    const long = reducePaletteNavigation(state, { type: "setQuery", query: "x".repeat(5_000) });

    expect(state.stack.length).toBeLessThanOrEqual(4);
    expect(long.query.length).toBe(256);
  });
});
```

`paletteRootQuery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePaletteRootQuery } from "./paletteRootQuery";

describe("parsePaletteRootQuery", () => {
  it("classifies empty, actions-only, file prefix and search input", () => {
    expect(parsePaletteRootQuery("   ")).toEqual({ kind: "empty" });
    expect(parsePaletteRootQuery(">")).toEqual({ kind: "actions", text: "" });
    expect(parsePaletteRootQuery("> toggle")).toEqual({ kind: "actions", text: " toggle" });
    expect(parsePaletteRootQuery("@")).toEqual({ kind: "files" });
    expect(parsePaletteRootQuery("@ord")).toEqual({ kind: "search", text: "@ord" });
    expect(parsePaletteRootQuery("ord")).toEqual({ kind: "search", text: "ord" });
  });
});
```

`paletteAge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compactAgeLabel } from "./paletteAge";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

describe("compactAgeLabel", () => {
  it("formats minutes, hours, days and weeks", () => {
    expect(compactAgeLabel(NOW, NOW - 20_000)).toBe("now");
    expect(compactAgeLabel(NOW, NOW - 4 * 60_000)).toBe("4m");
    expect(compactAgeLabel(NOW, NOW - 2 * 3_600_000)).toBe("2h");
    expect(compactAgeLabel(NOW, NOW - 3 * 86_400_000)).toBe("3d");
    expect(compactAgeLabel(NOW, NOW - 15 * 86_400_000)).toBe("2w");
  });

  it("treats future and non-finite times as now", () => {
    expect(compactAgeLabel(NOW, NOW + 60_000)).toBe("now");
    expect(compactAgeLabel(NOW, Number.NaN)).toBe("now");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/commandPalette`
Expected: FAIL for the four new files ("Failed to resolve import").

- [ ] **Step 3: Write the modules**

`palettePages.ts`:

```ts
export const PALETTE_PAGE_IDS = [
  "root",
  "files",
  "newThreadIn",
  "switchProject",
  "runScript",
  "switchBranch",
  "changeModel",
  "theme",
  "appearance",
  "shortcuts",
] as const;
export type PalettePageId = (typeof PALETTE_PAGE_IDS)[number];
export type PaletteSurface = "commands" | "files";

export interface PalettePageCopy {
  readonly placeholder: string;
  readonly enterLabel: string | null;
  readonly empty: string;
}

const SUB_PAGE_COPY: PalettePageCopy = {
  placeholder: "Search…",
  enterLabel: null,
  empty: "No matches.",
};

export function isPalettePageId(value: unknown): value is PalettePageId {
  return PALETTE_PAGE_IDS.some((page) => page === value);
}

export function paletteSurfaceForPage(page: PalettePageId): PaletteSurface {
  if (page === "files") return "files";
  return "commands";
}

export function palettePageCopy(page: PalettePageId, actionsOnly: boolean): PalettePageCopy {
  switch (page) {
    case "root":
      return {
        placeholder: "Search commands, projects, threads, and files…",
        enterLabel: null,
        empty: actionsOnly
          ? "No matching actions."
          : "No matching commands, projects, threads, or files.",
      };
    case "files":
      return { placeholder: "Search files…", enterLabel: "Open file", empty: "No matching files." };
    case "changeModel":
      return { placeholder: "Search models…", enterLabel: null, empty: "No matching models." };
    case "shortcuts":
      return { placeholder: "Search shortcuts…", enterLabel: "Run", empty: "No matching shortcuts." };
    case "newThreadIn":
    case "switchProject":
    case "runScript":
    case "switchBranch":
    case "theme":
    case "appearance":
      return SUB_PAGE_COPY;
    default:
      return unreachablePage(page);
  }
}

function unreachablePage(page: never): never {
  return page;
}
```

`paletteNavigation.ts`:

```ts
import { MAX_PALETTE_QUERY_CHARS } from "./paletteMatch";
import type { PalettePageId } from "./palettePages";

const MAX_PALETTE_DEPTH = 4;

export interface PaletteNavigationState {
  readonly stack: readonly PalettePageId[];
  readonly query: string;
  readonly generation: number;
}

export type PaletteNavigationAction =
  | { readonly type: "open"; readonly page: PalettePageId; readonly query: string }
  | { readonly type: "push"; readonly page: PalettePageId }
  | { readonly type: "pop" }
  | { readonly type: "setQuery"; readonly query: string };

export const INITIAL_PALETTE_NAVIGATION: PaletteNavigationState = {
  stack: ["root"],
  query: "",
  generation: 0,
};

export function currentPalettePage(state: PaletteNavigationState): PalettePageId {
  return state.stack[state.stack.length - 1] ?? "root";
}

export function reducePaletteNavigation(
  state: PaletteNavigationState,
  action: PaletteNavigationAction,
): PaletteNavigationState {
  switch (action.type) {
    case "open":
      return {
        stack: openedStack(action.page),
        query: bounded(action.query),
        generation: state.generation + 1,
      };
    case "push":
      if (currentPalettePage(state) === action.page) return state;
      if (state.stack.length >= MAX_PALETTE_DEPTH) return state;
      return { stack: [...state.stack, action.page], query: "", generation: state.generation + 1 };
    case "pop":
      if (state.stack.length <= 1) return state;
      return { stack: state.stack.slice(0, -1), query: "", generation: state.generation + 1 };
    case "setQuery":
      return { ...state, query: bounded(action.query) };
    default:
      return unreachableAction(action);
  }
}

function openedStack(page: PalettePageId): readonly PalettePageId[] {
  if (page === "root" || page === "files") return [page];
  return ["root", page];
}

function bounded(query: string): string {
  return query.slice(0, MAX_PALETTE_QUERY_CHARS);
}

function unreachableAction(action: never): never {
  return action;
}
```

`paletteRootQuery.ts`:

```ts
export type PaletteRootQuery =
  | { readonly kind: "empty" }
  | { readonly kind: "files" }
  | { readonly kind: "actions"; readonly text: string }
  | { readonly kind: "search"; readonly text: string };

export function parsePaletteRootQuery(raw: string): PaletteRootQuery {
  if (raw === "@") return { kind: "files" };
  if (raw.startsWith(">")) return { kind: "actions", text: raw.slice(1) };
  if (raw.trim() === "") return { kind: "empty" };
  return { kind: "search", text: raw };
}
```

`paletteItem.ts`:

```ts
import type { ColorSchemePreference, PaletteId } from "../appearance";
import type { FileSearchResult } from "../workspace";
import type { HighlightRange } from "./paletteMatch";
import type { PalettePageId } from "./palettePages";

export type PaletteGlyph =
  | "newThread"
  | "folder"
  | "folderPlus"
  | "fileSearch"
  | "file"
  | "play"
  | "branch"
  | "diff"
  | "terminal"
  | "panelRight"
  | "maximize"
  | "cpu"
  | "palette"
  | "monitor"
  | "sun"
  | "moon"
  | "keyboard"
  | "gear"
  | "message"
  | "command";

export type PaletteIcon =
  | { readonly kind: "glyph"; readonly glyph: PaletteGlyph }
  | { readonly kind: "monogram"; readonly letter: string }
  | { readonly kind: "swatch"; readonly color: string };

export type PaletteTextStyle = "token" | "fuzzy";

export interface PaletteText {
  readonly text: string;
  readonly ranges: readonly HighlightRange[];
  readonly style: PaletteTextStyle;
}

export type PaletteIntent =
  | { readonly kind: "page"; readonly page: PalettePageId }
  | { readonly kind: "command"; readonly commandId: string }
  | { readonly kind: "openThread"; readonly threadId: string }
  | { readonly kind: "newThreadIn"; readonly projectKey: string }
  | { readonly kind: "switchProject"; readonly projectKey: string }
  | { readonly kind: "openFile"; readonly result: FileSearchResult }
  | { readonly kind: "runScript"; readonly scriptKey: string }
  | { readonly kind: "switchBranch"; readonly name: string; readonly remote: boolean }
  | { readonly kind: "selectModel"; readonly modelKey: string }
  | { readonly kind: "setPalette"; readonly palette: PaletteId }
  | { readonly kind: "setColorScheme"; readonly scheme: ColorSchemePreference }
  | { readonly kind: "none" };

export interface PaletteItem {
  readonly key: string;
  readonly intent: PaletteIntent;
  readonly icon: PaletteIcon | null;
  readonly title: PaletteText;
  readonly description: PaletteText | null;
  readonly timestamp: string | null;
  readonly shortcut: string | null;
  readonly current: boolean;
  readonly disabled: boolean;
}

export interface PaletteGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly PaletteItem[];
}

export function plainText(text: string): PaletteText {
  return { text, ranges: [], style: "token" };
}
```

`paletteAge.ts`:

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function compactAgeLabel(nowMs: number, thenMs: number): string {
  const elapsed = nowMs - thenMs;
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / WEEK)}w`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/commandPalette`
Expected: PASS (all six domain test files including Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/domain/commandPalette
git commit -m "feat(palette): add palette pages, navigation reducer and item model"
```

---

### Task 4: Keymap commands, focus scopes and keydown policy

**Files:**
- Modify: `src/domain/keymap.ts` (catalog tail after P2's `agent.toggleSidebar`; the six `Cmd+K` chord entries at lines ~61-96; conflict functions ~1215-1233; the re-export block lines 8-14)
- Modify: `src/domain/shortcutSequence.ts:236-258`
- Modify: `src/domain/keymap.test.ts`
- Create: `src/application/shortcutFocusScope.ts`, `src/application/shortcutFocusScope.test.ts`
- Modify: `src/application/useWorkbenchKeyboardShortcuts.ts` (chord lookup ~105-121, dispatch ~251-259)
- Create: `src/application/useWorkbenchKeyboardShortcuts.paletteFocus.test.tsx`

**Interfaces:**
- Produces:
  - `type KeymapFocusScope = "any" | "editorText" | "outsideEditorText"`
  - `keymapCommandFocusScope(id: string): KeymapFocusScope`
  - `keymapFocusScopesOverlap(left: string, right: string): boolean`
  - `findKeymapSequenceConflicts(keymap, commandId, platform?)`: scope-aware in keymap.ts; the generic version in shortcutSequence.ts takes an optional `overlaps`
  - `commandActiveForEditorFocus(commandId: KeymapCommandId, editorTextFocused: boolean): boolean`
  - `keymapCommandIdsForEditorFocus(editorTextFocused: boolean): readonly KeymapCommandId[]`
  - New keymap ids `palette.open` (Cmd+K), `palette.shortcuts` (Cmd+/), `panel.toggleMaximized` ("")

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/keymap.test.ts` (inside the file's top-level `describe` or as a new `describe`):

```ts
describe("palette shortcuts and focus scopes", () => {
  it("binds the palette to Cmd+K and the cheatsheet to Cmd+/ outside editor text", () => {
    const defaults = defaultKeymapSettings("mac");
    expect(defaults["palette.open"]).toBe("Cmd+K");
    expect(defaults["palette.shortcuts"]).toBe("Cmd+/");
    expect(defaults["panel.toggleMaximized"]).toBe("");
    expect(keymapCommandFocusScope("palette.open")).toBe("outsideEditorText");
    expect(keymapCommandFocusScope("editor.splitDown")).toBe("editorText");
    expect(keymapCommandFocusScope("editor.save")).toBe("any");
  });

  it("does not report Cmd+K chords and the palette as conflicts on any platform", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      expect(findKeymapSequenceConflicts(defaults, "palette.open", platform)).toEqual([]);
      expect(findKeymapSequenceConflicts(defaults, "editor.splitDown", platform)).toEqual([]);
      expect(findKeymapConflicts(defaults, "palette.shortcuts", platform)).toEqual([]);
    }
  });

  it("still reports conflicts inside the same scope", () => {
    const keymap = { ...defaultKeymapSettings("mac"), "editor.save": "Cmd+K" };
    expect(findKeymapSequenceConflicts(keymap, "palette.open", "mac")).toContainEqual({
      id: "editor.save",
      kind: "exact",
    });
  });

  it("treats only editorText and outsideEditorText as disjoint", () => {
    expect(keymapFocusScopesOverlap("palette.open", "editor.splitDown")).toBe(false);
    expect(keymapFocusScopesOverlap("palette.open", "editor.save")).toBe(true);
    expect(keymapFocusScopesOverlap("editor.splitDown", "editor.save")).toBe(true);
  });
});
```

Add `keymapCommandFocusScope`, `keymapFocusScopesOverlap` to the test file's import from `./keymap`. Bump the command-count assertions that P2 set to 157/155 by 3 (to 160/158). Find them with `grep -n "157\|155" src/domain/keymap.test.ts`.

`src/application/shortcutFocusScope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { commandActiveForEditorFocus, keymapCommandIdsForEditorFocus } from "./shortcutFocusScope";

describe("shortcut focus scope", () => {
  it("activates palette commands only outside editor text and chords only inside", () => {
    expect(commandActiveForEditorFocus("palette.open", false)).toBe(true);
    expect(commandActiveForEditorFocus("palette.open", true)).toBe(false);
    expect(commandActiveForEditorFocus("editor.splitDown", true)).toBe(true);
    expect(commandActiveForEditorFocus("editor.splitDown", false)).toBe(false);
    expect(commandActiveForEditorFocus("editor.save", true)).toBe(true);
  });

  it("returns stable filtered id lists per focus state", () => {
    const inside = keymapCommandIdsForEditorFocus(true);
    const outside = keymapCommandIdsForEditorFocus(false);
    expect(inside).toBe(keymapCommandIdsForEditorFocus(true));
    expect(inside).not.toContain("palette.shortcuts");
    expect(outside).toContain("palette.shortcuts");
    expect(outside).not.toContain("editor.closeGroup");
  });
});
```

`src/application/useWorkbenchKeyboardShortcuts.paletteFocus.test.tsx`. First read the existing `useWorkbenchKeyboardShortcuts.test.tsx` harness (`sed -n 1,120p src/application/useWorkbenchKeyboardShortcuts.test.tsx`) and reuse its `renderShortcuts`/registry helpers verbatim if exported. Otherwise use this self-contained harness:

```tsx
// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistry, type Command, type CommandContext } from "./commandRegistry";
import { createDoubleShiftDetector } from "../domain/doubleShiftDetector";
import { __resetKeymapPlatformCacheForTests, defaultKeymapSettings, type KeymapSettings } from "../domain/keymap";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";

const context: CommandContext = { hasWorkspace: true, hasActiveDocument: true, activeDocumentDirty: false };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function command(id: string, run: () => void): Command {
  return { id, title: id, category: "Test", isEnabled: () => true, run };
}

function Harness({ keymap, registry }: { keymap: KeymapSettings; registry: CommandRegistry }) {
  const appSettingsRef = useRef({ keymap });
  const bareKeyShortcutsRef = useRef({ keymap: null, keys: new Set<string>() });
  const doubleShiftDetectorRef = useRef(createDoubleShiftDetector());
  useWorkbenchKeyboardShortcuts({
    actions: { closeFloatingSurface: () => false, openSearchEverywhere: () => undefined },
    appSettingsRef: appSettingsRef as never,
    bareKeyShortcutsRef,
    commandContext: context,
    commandRegistry: registry,
    doubleShiftDetectorRef,
    editorSurfaceIdentity: registry,
    keymap,
    runCommand: (id) => {
      const found = registry.get(id);
      if (found === undefined) return "missing";
      void found.run(context);
      return "executed";
    },
  });
  return (
    <div>
      <input aria-label="composer" />
      <div className="monaco-editor">
        <textarea aria-label="editor" className="inputarea" />
      </div>
    </div>
  );
}

function keydown(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, metaKey: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  __resetKeymapPlatformCacheForTests();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe("palette shortcuts respect editor text focus", () => {
  it("opens the palette immediately outside the editor and keeps Cmd+K chords inside it", () => {
    const openPalette = vi.fn();
    const splitDown = vi.fn();
    const cheatsheet = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command("palette.open", openPalette));
    registry.register(command("palette.shortcuts", cheatsheet));
    registry.register(command("editor.splitDown", splitDown));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness keymap={defaultKeymapSettings("mac")} registry={registry} />));
    const composer = document.querySelector('[aria-label="composer"]') as Element;
    const editor = document.querySelector('[aria-label="editor"]') as Element;

    keydown(composer, "k");
    expect(openPalette).toHaveBeenCalledTimes(1);

    keydown(editor, "k");
    keydown(editor, "\\");
    act(() => vi.advanceTimersByTime(2_500));
    expect(splitDown).toHaveBeenCalledTimes(1);
    expect(openPalette).toHaveBeenCalledTimes(1);

    const slash = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "/", metaKey: true });
    act(() => {
      editor.dispatchEvent(slash);
    });
    expect(cheatsheet).not.toHaveBeenCalled();
    expect(slash.defaultPrevented).toBe(false);
    keydown(composer, "/");
    expect(cheatsheet).toHaveBeenCalledTimes(1);
  });
});
```

`MONACO_TEXT_INPUT_SELECTOR` in `src/application/editorTextFocus.ts` defines what counts as editor text. Before running, check it with `sed -n 1,9p src/application/editorTextFocus.ts` and use the exact class names it expects in the harness markup. For example, if it is `.monaco-editor textarea.inputarea`, the markup above already matches. If `useWorkbenchKeyboardShortcuts` requires more options after P2 lands, copy their values from the existing test's harness.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/keymap.test.ts src/application/shortcutFocusScope.test.ts src/application/useWorkbenchKeyboardShortcuts.paletteFocus.test.tsx`
Expected: FAIL. `keymapCommandFocusScope` is not exported, `./shortcutFocusScope` cannot be resolved, and `palette.open` is not dispatched.

- [ ] **Step 3: Extend the generic conflict finder in `shortcutSequence.ts`**

Replace the signature and the loop guard of `findKeymapSequenceConflicts`:

```ts
export function findKeymapSequenceConflicts<CommandId extends string>(
  keymap: Readonly<Record<CommandId, string>>,
  commandId: CommandId,
  platform?: ShortcutPlatform,
  overlaps: (left: CommandId, right: CommandId) => boolean = () => true,
): ShortcutSequenceConflict<CommandId>[] {
  const parsedTarget = parseShortcutSequence(keymap[commandId] ?? "");
  const target = parsedTarget && sequenceForLookupPlatform(parsedTarget, platform);
  if (!target) return [];

  const conflicts: ShortcutSequenceConflict<CommandId>[] = [];
  for (const [candidateId, value] of Object.entries<string>(keymap)) {
    if (candidateId === commandId) continue;
    if (!overlaps(commandId, candidateId as CommandId)) continue;
    const parsedCandidate = parseShortcutSequence(value);
    const candidate = parsedCandidate && sequenceForLookupPlatform(parsedCandidate, platform);
    if (!candidate) continue;
    if (sequenceValue(candidate) === sequenceValue(target)) {
      conflicts.push({ id: candidateId as CommandId, kind: "exact" });
    } else if (isSequencePrefix(target, candidate) || isSequencePrefix(candidate, target)) {
      conflicts.push({ id: candidateId as CommandId, kind: "prefix" });
    }
  }
  return conflicts;
}
```

The body is unchanged except for the `overlaps` guard, including the existing `else if`, which is original code. Do not restructure it.

- [ ] **Step 4: Update `keymap.ts`**

1. In the re-export block (lines 8-14), remove `findKeymapSequenceConflicts` from `export { … } from "./shortcutSequence";` and add a named import:

```ts
import {
  findKeymapSequenceConflicts as findScopedSequenceConflicts,
  normalizeShortcutSequenceInput,
  parseShortcutSequence,
  shortcutKeyFromKeyboardEvent,
  shortcutSequenceForPlatform,
} from "./shortcutSequence";
```

2. Add `focus: "editorText",` to each of the six entries `editor.splitDown`, `editor.focusNextGroup`, `editor.focusPreviousGroup`, `editor.moveTabToNextGroup`, `editor.moveTabToPreviousGroup`, `editor.closeGroup`. For example:

```ts
  {
    category: "Editor Groups",
    defaultShortcut: "Cmd+K Cmd+\\",
    focus: "editorText",
    id: "editor.splitDown",
    label: "Split Editor Down",
  },
```

3. Append after P2's `agent.toggleSidebar` entry (the last element before `] as const;`). If P2 has not landed, append after `agent.openCommitMenu` and rebase later:

```ts
  {
    category: "Workbench",
    defaultShortcut: "Cmd+K",
    focus: "outsideEditorText",
    id: "palette.open",
    label: "Open Command Palette",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+/",
    focus: "outsideEditorText",
    id: "palette.shortcuts",
    label: "Keyboard Shortcuts",
  },
  {
    category: "Workbench",
    defaultShortcut: "",
    id: "panel.toggleMaximized",
    label: "Toggle Maximized Panel",
  },
```

4. Add after the `KeymapSettings` type:

```ts
export type KeymapFocusScope = "any" | "editorText" | "outsideEditorText";

const KEYMAP_FOCUS_SCOPES: ReadonlyMap<string, KeymapFocusScope> = new Map(
  keymapCommands.map((command) => [
    command.id,
    "focus" in command ? command.focus : "any",
  ] as const),
);

export function keymapCommandFocusScope(commandId: string): KeymapFocusScope {
  return KEYMAP_FOCUS_SCOPES.get(commandId) ?? "any";
}

export function keymapFocusScopesOverlap(left: string, right: string): boolean {
  const scopes = new Set([keymapCommandFocusScope(left), keymapCommandFocusScope(right)]);
  return !(scopes.has("editorText") && scopes.has("outsideEditorText"));
}

export function findKeymapSequenceConflicts<CommandId extends string>(
  keymap: Readonly<Record<CommandId, string>>,
  commandId: CommandId,
  platform?: KeymapPlatform,
) {
  return findScopedSequenceConflicts(keymap, commandId, platform, keymapFocusScopesOverlap);
}
```

`"focus" in command ? command.focus : "any"` narrows on the `as const` catalog union. If `tsc` rejects the tuple typing, write the map entry as `[command.id, focusOf(command)] as const` with `function focusOf(command: KeymapCommand): KeymapFocusScope { if ("focus" in command) return command.focus; return "any"; }`.

5. In `findKeymapConflicts`, add the scope filter:

```ts
  return keymapCommands
    .filter((command) => command.id !== commandId)
    .filter((command) => keymapFocusScopesOverlap(commandId, command.id))
    .filter(
      (command) =>
        normalizeShortcutInput(shortcutForCommand(keymap, command.id, platform)) === shortcut,
    )
    .map((command) => ({ id: command.id, label: command.label }));
```

- [ ] **Step 5: Write `src/application/shortcutFocusScope.ts`**

```ts
import { keymapCommandFocusScope, keymapCommands, type KeymapCommandId } from "../domain/keymap";

const ALL_IDS: readonly KeymapCommandId[] = keymapCommands.map((command) => command.id);
const INSIDE_EDITOR_IDS = ALL_IDS.filter((id) => commandActiveForEditorFocus(id, true));
const OUTSIDE_EDITOR_IDS = ALL_IDS.filter((id) => commandActiveForEditorFocus(id, false));

export function commandActiveForEditorFocus(
  commandId: KeymapCommandId,
  editorTextFocused: boolean,
): boolean {
  const scope = keymapCommandFocusScope(commandId);
  if (scope === "editorText") return editorTextFocused;
  if (scope === "outsideEditorText") return !editorTextFocused;
  return true;
}

export function keymapCommandIdsForEditorFocus(
  editorTextFocused: boolean,
): readonly KeymapCommandId[] {
  if (editorTextFocused) return INSIDE_EDITOR_IDS;
  return OUTSIDE_EDITOR_IDS;
}
```

The two `const … = ALL_IDS.filter(...)` initialisers call a function declared below them. Function declarations are hoisted, so this is valid.

- [ ] **Step 6: Wire the policy into `useWorkbenchKeyboardShortcuts.ts`**

Add the import `import { commandActiveForEditorFocus, keymapCommandIdsForEditorFocus } from "./shortcutFocusScope";`, then:

(a) In `currentChordMachine`, replace `commandIsInContext`:

```ts
        const commandIsInContext = (commandId: KeymapCommandId) =>
          (!EDITOR_TEXT_FOCUS_COMMAND_IDS.has(commandId) || chordContextEditorOwner !== null) &&
          commandActiveForEditorFocus(commandId, chordContextEditorOwner !== null);
```

(b) In the `!editorOwner && stroke` exact lookup and the final `dispatchWorkbenchShortcutCommand` call, pass focus-filtered ids:

```ts
      if (
        dispatchWorkbenchShortcutCommand({
          commandContext,
          commandIds: keymapCommandIdsForEditorFocus(editorOwner !== null),
          commandRegistry,
          event,
          keymap,
          runCommand,
        })
      ) {
        return;
      }
```

`dispatchWorkbenchShortcutCommand` already accepts `commandIds`. Keep `KEYMAP_COMMAND_IDS` for the `lookupKeymapShortcutSequence` calls, because the chord machine filters them.

(c) The bare-key cache is unaffected: `Cmd+/` has a modifier.

- [ ] **Step 7: Run the focused tests**

Run: `npx vitest run src/domain/keymap.test.ts src/domain/shortcutSequence.test.ts src/application/shortcutFocusScope.test.ts src/application/useWorkbenchKeyboardShortcuts.test.tsx src/application/useWorkbenchKeyboardShortcuts.paletteFocus.test.tsx src/application/workbenchShortcutCommandDispatcher.test.ts src/components/settings/pages`
Expected: PASS. If an existing keymap test enumerates every catalog entry with a fixed field set (for example a snapshot of `{category, defaultShortcut, id, label}`), update that expectation to allow the optional `focus` key. Do not remove the assertion.

- [ ] **Step 8: Commit**

```bash
git add src/domain/keymap.ts src/domain/keymap.test.ts src/domain/shortcutSequence.ts src/application/shortcutFocusScope.ts src/application/shortcutFocusScope.test.ts src/application/useWorkbenchKeyboardShortcuts.ts src/application/useWorkbenchKeyboardShortcuts.paletteFocus.test.tsx
git commit -m "feat(keymap): add palette shortcuts with editor focus scopes"
```

---

### Task 5: Palette ports, launch channel, registry commands and curated actions

**Files:**
- Create: `src/application/commandPalette/commandPaletteProvider.ts` (+ `commandPaletteProvider.test.ts`)
- Create: `src/application/commandPalette/commandPaletteLaunch.ts` (+ `commandPaletteLaunch.test.ts`)
- Create: `src/application/commandPalette/commandPaletteActions.ts` (+ `commandPaletteActions.test.ts`)
- Create: `src/application/workbenchPaletteCommands.ts` (+ `workbenchPaletteCommands.test.ts`)
- Modify: `src/application/useWorkbenchCommandRegistry.ts:942-959`

**Interfaces:**
- Consumes: `PalettePageId` (Task 3), `PaletteGlyph`, `PaletteIntent` (Task 3), `Command` (`src/domain/command.ts`), `KeymapCommandId`.
- Produces:
  - `interface PaletteProject { key; label; path; current }`
  - `interface PaletteThread { id; title; projectLabel; updatedAtMs; current }`
  - `interface PaletteScript { key; name; detail: string | null; runnable: boolean }`
  - `interface PaletteModelOption { key; group; label; current }`
  - `interface PaletteBranch { name; current; remote }`
  - `interface PaletteBranchSource { scopeKey; scopeLabel; load(): Promise<readonly PaletteBranch[]>; switchTo(branch): Promise<void> }`
  - `interface AgentPaletteProvider { projects; threads; scripts; scriptsTruncated; activeProjectKey: string | null; openThread(id): boolean; switchProject(key): boolean; newThreadIn(key): boolean; runScript(key): boolean }`
  - `interface ComposerPaletteModels { options; selectModel(key): boolean }`
  - `interface PaletteProviderSlot<T> { publish(value: T): () => void; current(): T | null; subscribe(listener): () => void }`
  - `createPaletteProviderSlot<T>()`, `workbenchAgentPaletteProvider`, `workbenchComposerPaletteModels`
  - `interface PaletteLaunchRequest { page: PalettePageId; query: string }`, `createCommandPaletteLaunch()`, `workbenchCommandPaletteLaunch`
  - `PALETTE_ACTIONS`, `interface PaletteActionView`, `availablePaletteActions(availability)`, `interface PaletteActionAvailability`
  - `workbenchPaletteCommands({shortcut, openPalette}): Command[]`

- [ ] **Step 1: Write the failing tests**

`commandPaletteProvider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPaletteProviderSlot } from "./commandPaletteProvider";

describe("createPaletteProviderSlot", () => {
  it("exposes the most recent publication and restores the previous one on revoke", () => {
    const slot = createPaletteProviderSlot<string>();
    const listener = vi.fn();
    slot.subscribe(listener);
    const revokeA = slot.publish("a");
    const revokeB = slot.publish("b");

    expect(slot.current()).toBe("b");
    revokeB();
    expect(slot.current()).toBe("a");
    revokeB();
    expect(slot.current()).toBe("a");
    revokeA();
    expect(slot.current()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("revokes only its own entry when publications interleave", () => {
    const slot = createPaletteProviderSlot<string>();
    const revokeA = slot.publish("a");
    slot.publish("b");
    revokeA();
    expect(slot.current()).toBe("b");
  });

  it("stops notifying unsubscribed listeners", () => {
    const slot = createPaletteProviderSlot<number>();
    const listener = vi.fn();
    const unsubscribe = slot.subscribe(listener);
    unsubscribe();
    slot.publish(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
```

`commandPaletteLaunch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createCommandPaletteLaunch } from "./commandPaletteLaunch";

describe("createCommandPaletteLaunch", () => {
  it("hands a request out exactly once and notifies subscribers", () => {
    const launch = createCommandPaletteLaunch();
    const listener = vi.fn();
    launch.subscribe(listener);
    launch.request({ page: "shortcuts", query: "" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(launch.take()).toEqual({ page: "shortcuts", query: "" });
    expect(launch.take()).toBeNull();
  });

  it("keeps only the latest pending request", () => {
    const launch = createCommandPaletteLaunch();
    launch.request({ page: "root", query: "" });
    launch.request({ page: "shortcuts", query: "tog" });
    expect(launch.take()).toEqual({ page: "shortcuts", query: "tog" });
  });
});
```

`commandPaletteActions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { availablePaletteActions, type PaletteActionAvailability } from "./commandPaletteActions";

function availability(overrides: Partial<PaletteActionAvailability> = {}): PaletteActionAvailability {
  return {
    commandState: () => "enabled",
    agentProvider: true,
    composerModels: true,
    ...overrides,
  };
}

describe("availablePaletteActions", () => {
  it("lists the mockup actions in order when everything is available", () => {
    expect(availablePaletteActions(availability()).map((action) => action.title)).toEqual([
      "New thread",
      "New thread in…",
      "Add project…",
      "Switch project",
      "Go to file",
      "Run script",
      "Switch branch",
      "Show diff panel",
      "Show terminal",
      "Show files panel",
      "Toggle maximized panel",
      "Change model",
      "Change theme",
      "Change appearance",
      "Keyboard shortcuts",
      "Open settings",
    ]);
  });

  it("hides agent-only pages without an agent provider and the model page without a composer", () => {
    const titles = availablePaletteActions(
      availability({ agentProvider: false, composerModels: false }),
    ).map((action) => action.title);
    expect(titles).not.toContain("New thread in…");
    expect(titles).not.toContain("Change model");
    expect(titles).toContain("Switch project");
  });

  it("uses the first registered command id and hides actions with none registered", () => {
    const actions = availablePaletteActions(
      availability({
        commandState: (id) => {
          if (id === "agent.openTerminalSurface" || id === "project.add") return "missing";
          if (id === "terminal.show") return "disabled";
          return "enabled";
        },
      }),
    );
    const terminal = actions.find((action) => action.id === "terminal");
    expect(terminal?.intent).toEqual({ kind: "command", commandId: "terminal.show" });
    expect(terminal?.disabled).toBe(true);
    expect(actions.some((action) => action.id === "addProject")).toBe(false);
  });
});
```

`workbenchPaletteCommands.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { workbenchPaletteCommands } from "./workbenchPaletteCommands";

describe("workbenchPaletteCommands", () => {
  it("opens the root and the shortcuts page through the launch request", () => {
    const openPalette = vi.fn();
    const commands = workbenchPaletteCommands({ shortcut: (id) => `sc:${id}`, openPalette });
    const byId = new Map(commands.map((command) => [command.id, command]));

    void byId.get("palette.open")?.run();
    void byId.get("palette.shortcuts")?.run();

    expect(openPalette.mock.calls).toEqual([
      [{ page: "root", query: "" }],
      [{ page: "shortcuts", query: "" }],
    ]);
    expect(byId.get("palette.open")?.shortcut).toBe("sc:palette.open");
    expect(byId.get("palette.shortcuts")?.title).toBe("Keyboard Shortcuts");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/application/commandPalette src/application/workbenchPaletteCommands.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `commandPaletteProvider.ts`**

```ts
export interface PaletteProject {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly current: boolean;
}

export interface PaletteThread {
  readonly id: string;
  readonly title: string;
  readonly projectLabel: string;
  readonly updatedAtMs: number;
  readonly current: boolean;
}

export interface PaletteScript {
  readonly key: string;
  readonly name: string;
  readonly detail: string | null;
  readonly runnable: boolean;
}

export interface PaletteModelOption {
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly current: boolean;
}

export interface PaletteBranch {
  readonly name: string;
  readonly current: boolean;
  readonly remote: boolean;
}

export interface PaletteBranchSource {
  readonly scopeKey: string;
  readonly scopeLabel: string;
  load(): Promise<readonly PaletteBranch[]>;
  switchTo(branch: PaletteBranch): Promise<void>;
}

export interface AgentPaletteProvider {
  readonly projects: readonly PaletteProject[];
  readonly threads: readonly PaletteThread[];
  readonly scripts: readonly PaletteScript[];
  readonly scriptsTruncated: boolean;
  readonly activeProjectKey: string | null;
  openThread(threadId: string): boolean;
  switchProject(projectKey: string): boolean;
  newThreadIn(projectKey: string): boolean;
  runScript(scriptKey: string): boolean;
}

export interface ComposerPaletteModels {
  readonly options: readonly PaletteModelOption[];
  selectModel(key: string): boolean;
}

export interface PaletteProviderSlot<T> {
  publish(value: T): () => void;
  current(): T | null;
  subscribe(listener: () => void): () => void;
}

interface SlotEntry<T> {
  readonly value: T;
}

export function createPaletteProviderSlot<T>(): PaletteProviderSlot<T> {
  let entries: readonly SlotEntry<T>[] = [];
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    publish(value) {
      const entry: SlotEntry<T> = { value };
      entries = [...entries, entry];
      notify();
      return () => {
        if (!entries.includes(entry)) return;
        entries = entries.filter((candidate) => candidate !== entry);
        notify();
      };
    },
    current: () => entries[entries.length - 1]?.value ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const workbenchAgentPaletteProvider = createPaletteProviderSlot<AgentPaletteProvider>();
export const workbenchComposerPaletteModels = createPaletteProviderSlot<ComposerPaletteModels>();
```

The first test expects 4 notifications: publish a, publish b, revoke b, revoke a. The second `revokeB()` is a no-op and does not notify.

- [ ] **Step 4: Write `commandPaletteLaunch.ts`**

```ts
import type { PalettePageId } from "../../domain/commandPalette/palettePages";

export interface PaletteLaunchRequest {
  readonly page: PalettePageId;
  readonly query: string;
}

export interface CommandPaletteLaunch {
  request(value: PaletteLaunchRequest): void;
  take(): PaletteLaunchRequest | null;
  subscribe(listener: () => void): () => void;
}

export function createCommandPaletteLaunch(): CommandPaletteLaunch {
  let pending: PaletteLaunchRequest | null = null;
  const listeners = new Set<() => void>();
  return {
    request(value) {
      pending = value;
      for (const listener of [...listeners]) listener();
    },
    take() {
      const value = pending;
      pending = null;
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const workbenchCommandPaletteLaunch = createCommandPaletteLaunch();
```

- [ ] **Step 5: Write `commandPaletteActions.ts`**

```ts
import type { PaletteGlyph, PaletteIntent } from "../../domain/commandPalette/paletteItem";
import type { PalettePageId } from "../../domain/commandPalette/palettePages";

export type PaletteCommandState = "enabled" | "disabled" | "missing";
export type PaletteRequirement = "none" | "agentProvider" | "composerModels";

type PaletteActionTarget =
  | { readonly kind: "page"; readonly page: PalettePageId; readonly requires: PaletteRequirement }
  | { readonly kind: "command"; readonly commandIds: readonly string[] };

interface PaletteActionDefinition {
  readonly id: string;
  readonly title: string;
  readonly glyph: PaletteGlyph;
  readonly keywords: readonly string[];
  readonly shortcutCommandId: string | null;
  readonly target: PaletteActionTarget;
}

export interface PaletteActionAvailability {
  commandState(commandId: string): PaletteCommandState;
  readonly agentProvider: boolean;
  readonly composerModels: boolean;
}

export interface PaletteActionView {
  readonly id: string;
  readonly title: string;
  readonly glyph: PaletteGlyph;
  readonly keywords: readonly string[];
  readonly shortcutCommandId: string | null;
  readonly intent: PaletteIntent;
  readonly disabled: boolean;
}

const page = (value: PalettePageId, requires: PaletteRequirement = "none"): PaletteActionTarget => ({
  kind: "page",
  page: value,
  requires,
});
const command = (...commandIds: string[]): PaletteActionTarget => ({ kind: "command", commandIds });

export const PALETTE_ACTIONS: readonly PaletteActionDefinition[] = [
  { id: "newThread", title: "New thread", glyph: "newThread", keywords: ["create", "chat"], shortcutCommandId: "agent.newThread", target: command("agent.newThread") },
  { id: "newThreadIn", title: "New thread in…", glyph: "newThread", keywords: ["project"], shortcutCommandId: null, target: page("newThreadIn", "agentProvider") },
  { id: "addProject", title: "Add project…", glyph: "folderPlus", keywords: ["open folder", "clone", "git", "github", "gitlab"], shortcutCommandId: "project.add", target: command("project.add") },
  { id: "switchProject", title: "Switch project", glyph: "folder", keywords: ["open"], shortcutCommandId: null, target: page("switchProject") },
  { id: "goToFile", title: "Go to file", glyph: "fileSearch", keywords: ["open file", "quick open"], shortcutCommandId: "file.quickOpen", target: page("files") },
  { id: "runScript", title: "Run script", glyph: "play", keywords: ["npm", "package"], shortcutCommandId: null, target: page("runScript") },
  { id: "switchBranch", title: "Switch branch", glyph: "branch", keywords: ["git", "checkout"], shortcutCommandId: null, target: page("switchBranch") },
  { id: "diff", title: "Show diff panel", glyph: "diff", keywords: ["changes"], shortcutCommandId: "agent.openDiffSurface", target: command("agent.openDiffSurface") },
  { id: "terminal", title: "Show terminal", glyph: "terminal", keywords: ["shell"], shortcutCommandId: "agent.openTerminalSurface", target: command("agent.openTerminalSurface", "terminal.show") },
  { id: "filesPanel", title: "Show files panel", glyph: "panelRight", keywords: ["explorer", "tree"], shortcutCommandId: "agent.openFilesSurface", target: command("agent.openFilesSurface") },
  { id: "maximize", title: "Toggle maximized panel", glyph: "maximize", keywords: ["focus", "zoom"], shortcutCommandId: "panel.toggleMaximized", target: command("panel.toggleMaximized") },
  { id: "changeModel", title: "Change model", glyph: "cpu", keywords: ["provider"], shortcutCommandId: null, target: page("changeModel", "composerModels") },
  { id: "theme", title: "Change theme", glyph: "palette", keywords: ["color", "palette"], shortcutCommandId: null, target: page("theme") },
  { id: "appearance", title: "Change appearance", glyph: "monitor", keywords: ["dark", "light", "system"], shortcutCommandId: null, target: page("appearance") },
  { id: "shortcuts", title: "Keyboard shortcuts", glyph: "keyboard", keywords: ["keybindings", "hotkeys"], shortcutCommandId: "palette.shortcuts", target: page("shortcuts") },
  { id: "settings", title: "Open settings", glyph: "gear", keywords: ["preferences"], shortcutCommandId: "workbench.openSettings", target: command("workbench.openSettings") },
];

export function paletteActionCommandIds(): ReadonlySet<string> {
  return new Set(
    PALETTE_ACTIONS.flatMap((action) =>
      action.target.kind === "command" ? action.target.commandIds : [],
    ),
  );
}

export function availablePaletteActions(
  availability: PaletteActionAvailability,
): readonly PaletteActionView[] {
  return PALETTE_ACTIONS.flatMap((action) => {
    const view = actionView(action, availability);
    return view === null ? [] : [view];
  });
}

function actionView(
  action: PaletteActionDefinition,
  availability: PaletteActionAvailability,
): PaletteActionView | null {
  const base = {
    id: action.id,
    title: action.title,
    glyph: action.glyph,
    keywords: action.keywords,
    shortcutCommandId: action.shortcutCommandId,
  };
  if (action.target.kind === "page") {
    if (!requirementMet(action.target.requires, availability)) return null;
    return { ...base, intent: { kind: "page", page: action.target.page }, disabled: false };
  }
  const registered = action.target.commandIds.filter(
    (id) => availability.commandState(id) !== "missing",
  );
  const enabled = registered.find((id) => availability.commandState(id) === "enabled");
  const chosen = enabled ?? registered[0];
  if (chosen === undefined) return null;
  return {
    ...base,
    shortcutCommandId: action.shortcutCommandId === null ? null : chosen,
    intent: { kind: "command", commandId: chosen },
    disabled: enabled === undefined,
  };
}

function requirementMet(
  requirement: PaletteRequirement,
  availability: PaletteActionAvailability,
): boolean {
  if (requirement === "agentProvider") return availability.agentProvider;
  if (requirement === "composerModels") return availability.composerModels;
  return true;
}
```

Run Prettier on this single file after writing it (`npx prettier --write src/application/commandPalette/commandPaletteActions.ts`). The one-line object literals above will be reflowed.

- [ ] **Step 6: Write `workbenchPaletteCommands.ts`**

```ts
import type { KeymapCommandId } from "../domain/keymap";
import type { PaletteLaunchRequest } from "./commandPalette/commandPaletteLaunch";
import type { Command } from "./commandRegistry";

interface WorkbenchPaletteCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  openPalette(request: PaletteLaunchRequest): void;
}

export function workbenchPaletteCommands({
  openPalette,
  shortcut,
}: WorkbenchPaletteCommandsOptions): Command[] {
  return [
    {
      id: "palette.open",
      title: "Open Command Palette",
      category: "Workbench",
      shortcut: shortcut("palette.open"),
      visibleInCommandPalette: false,
      isEnabled: () => true,
      run: () => openPalette({ page: "root", query: "" }),
    },
    {
      id: "palette.shortcuts",
      title: "Keyboard Shortcuts",
      category: "Workbench",
      shortcut: shortcut("palette.shortcuts"),
      visibleInCommandPalette: false,
      isEnabled: () => true,
      run: () => openPalette({ page: "shortcuts", query: "" }),
    },
  ];
}
```

- [ ] **Step 7: Register the commands in `useWorkbenchCommandRegistry.ts`**

Replace the inline `openCommandsPalette` at lines 948-954 with a shared closure defined just before `workbenchPanelCommands({`, and register the palette commands right after it:

```ts
    const openPaletteSurface = () => {
      setClassOpenOpen(false);
      setWorkspaceSymbolsOpen(false);
      setRecentFilesSwitcherOpen(false);
      setPaletteOpen(true);
      markFloatingSurfaceActivated();
    };

    workbenchPanelCommands({
      canShowExpressRoutes: canShowWorkspaceExpressRoutes(workspaceRoot, workspaceDescriptor),
      canShowNette,
      canShowSymfony,
      openExpressRoutesPanel,
      shortcut,
      openCommandsPalette: openPaletteSurface,
      showBottomPanelView,
      toggleBottomPanel,
      toggleTodoPanel,
      refreshWorkspaceTodos,
    }).forEach((command) => registry.register(command));

    workbenchPaletteCommands({
      shortcut,
      openPalette: (request) => {
        workbenchCommandPaletteLaunch.request(request);
        openPaletteSurface();
      },
    }).forEach((command) => registry.register(command));
```

Add the imports `import { workbenchCommandPaletteLaunch } from "./commandPalette/commandPaletteLaunch";` and `import { workbenchPaletteCommands } from "./workbenchPaletteCommands";`. The launch channel is a module singleton, like `workbenchAgentViewCommandBridge`, so the `useMemo` dependency list is unchanged.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/application/commandPalette src/application/workbenchPaletteCommands.test.ts src/application/useWorkbenchCommandRegistry.test.ts src/App.commandRouting.test.tsx`
Expected: PASS. If `useWorkbenchCommandRegistry.test.ts` asserts a total command count or a sorted id list, add `palette.open` and `palette.shortcuts` to that expectation.

- [ ] **Step 9: Commit**

```bash
git add src/application/commandPalette src/application/workbenchPaletteCommands.ts src/application/workbenchPaletteCommands.test.ts src/application/useWorkbenchCommandRegistry.ts src/application/useWorkbenchCommandRegistry.test.ts
git commit -m "feat(palette): add palette provider slots, launch channel and registry commands"
```

---

### Task 6: Presenter, shortcut labels and cheatsheet

**Files:**
- Create: `src/components/commandPalette/paletteShortcuts.ts` (+ `paletteShortcuts.test.ts`)
- Create: `src/components/commandPalette/commandPalettePresenter.ts` (+ `commandPalettePresenter.test.ts`)

**Interfaces:**
- Consumes:
  - Task 2 matching
  - Task 3 `PaletteItem`/`PaletteGroup`/`PaletteText`/`PalettePageId`/`parsePaletteRootQuery`/`compactAgeLabel`
  - Task 5 `PaletteActionView`, `AgentPaletteProvider`, `ComposerPaletteModels`, `PaletteProject`, `PaletteScript`, `PaletteBranch`, `paletteActionCommandIds`
  - `keybindingStrokes` (`src/components/settings/pages/keybindingsPresentation.ts`), `keymapCommands`, `shortcutForCommand`, `KeymapSettings`, `KeymapPlatform`
  - `PALETTE_IDS`, `PALETTE_LABELS`, `COLOR_SCHEME_PREFERENCES`, `COLOR_SCHEME_LABELS`, `AppearanceSettings`, `ResolvedColorScheme`, `paletteTokens`
  - `Command`, `FileSearchResult`
- Produces:
  - `formatShortcutLabel(shortcut: string, platform: KeymapPlatform): string | null`
  - `interface PaletteShortcutEntry { commandId; label; shortcut; category }`
  - `paletteShortcutGroups(keymap, platform): readonly {category; entries}[]`
  - `type PaletteBranchesView = {status:"idle"} | {status:"loading"} | {status:"ready"; scopeLabel; branches} | {status:"unavailable"; reason} | {status:"error"; message}`
  - `interface PalettePresenterInput` (below)
  - `buildPaletteGroups(input): readonly PaletteGroup[]`

- [ ] **Step 1: Write the failing tests**

`paletteShortcuts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultKeymapSettings } from "../../domain/keymap";
import { formatShortcutLabel, paletteShortcutGroups } from "./paletteShortcuts";

describe("formatShortcutLabel", () => {
  it("renders mac glyphs joined and other platforms with plus signs", () => {
    expect(formatShortcutLabel("Cmd+Shift+P", "mac")).toBe("⇧⌘P");
    expect(formatShortcutLabel("Cmd+K Cmd+\\", "mac")).toBe("⌘K ⌘\\");
    expect(formatShortcutLabel("Cmd+Shift+P", "linux")).toBe("Ctrl+Shift+P");
    expect(formatShortcutLabel("", "mac")).toBeNull();
  });
});

describe("paletteShortcutGroups", () => {
  it("lists bound commands grouped by category with Workbench and Agent first", () => {
    const groups = paletteShortcutGroups(defaultKeymapSettings("mac"), "mac");
    expect(groups[0]?.category).toBe("Workbench");
    expect(groups[1]?.category).toBe("Agent");
    const workbench = groups[0]?.entries.map((entry) => entry.label) ?? [];
    expect(workbench).toContain("Open Command Palette");
    expect(groups.flatMap((group) => group.entries).every((entry) => entry.shortcut !== "")).toBe(true);
  });

  it("reflects user rebinding", () => {
    const keymap = { ...defaultKeymapSettings("mac"), "palette.open": "Cmd+Alt+K" };
    const entry = paletteShortcutGroups(keymap, "mac")
      .flatMap((group) => group.entries)
      .find((candidate) => candidate.commandId === "palette.open");
    expect(entry?.shortcut).toBe("⌥⌘K");
  });
});
```

The mac glyph order must match what `keybindingStrokes` produces (it keeps the order modifiers are written in: `Cmd+Shift+P` -> `⌘⇧P`). Before writing the expectations, run `npx vitest run src/components/settings/pages/keybindingsPresentation.test.ts` and read how that test expresses chips. Then write the expectation from the real chip order (`["⌘","⇧","P"]` joined gives `⌘⇧P`). Replace `"⇧⌘P"` and `"⌥⌘K"` above with the chip-derived strings. Do not reorder modifiers in P5.

`commandPalettePresenter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Command } from "../../application/commandRegistry";
import type { AgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import { DEFAULT_APPEARANCE } from "../../domain/appearance";
import { buildPaletteGroups, type PalettePresenterInput } from "./commandPalettePresenter";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

const agent: AgentPaletteProvider = {
  projects: [
    { key: "orders", label: "orders-api", path: "/Users/me/Developer/orders-api", current: true },
    { key: "web", label: "web-dashboard", path: "/Users/me/Developer/web-dashboard", current: false },
  ],
  threads: [
    { id: "t1", title: "Idempotency keys for POST /orders", projectLabel: "orders-api", updatedAtMs: NOW - 4 * 60_000, current: true },
    { id: "t2", title: "Vitest coverage thresholds", projectLabel: "web-dashboard", updatedAtMs: NOW - 3 * 86_400_000, current: false },
  ],
  scripts: [{ key: "test", name: "test", detail: "vitest run", runnable: true }],
  scriptsTruncated: false,
  activeProjectKey: "orders",
  openThread: () => true,
  switchProject: () => true,
  newThreadIn: () => true,
  runScript: () => true,
};

function command(id: string, title: string, overrides: Partial<Command> = {}): Command {
  return { id, title, category: "Workbench", isEnabled: () => true, run: () => undefined, ...overrides };
}

function input(overrides: Partial<PalettePresenterInput> = {}): PalettePresenterInput {
  return {
    page: "root",
    query: "",
    actions: [
      { id: "newThread", title: "New thread", glyph: "newThread", keywords: ["create"], shortcutCommandId: "agent.newThread", intent: { kind: "command", commandId: "agent.newThread" }, disabled: false },
      { id: "switchProject", title: "Switch project", glyph: "folder", keywords: ["open"], shortcutCommandId: null, intent: { kind: "page", page: "switchProject" }, disabled: false },
    ],
    commands: [command("panel.showProblems", "Show Problems"), command("hidden", "Hidden", { visibleInCommandPalette: false })],
    commandEnabled: () => true,
    agent,
    editorProjects: [],
    editorScripts: [],
    editorScriptsTruncated: false,
    rootFiles: [],
    branches: { status: "idle" },
    models: null,
    appearance: DEFAULT_APPEARANCE,
    resolvedScheme: "dark",
    shortcutGroups: [],
    nowMs: NOW,
    shortcutLabel: (id) => (id === "agent.newThread" ? "⌘N" : null),
    rawShortcutLabel: () => null,
    canAddProject: true,
    ...overrides,
  };
}

describe("buildPaletteGroups", () => {
  it("shows actions and recent threads for an empty root query", () => {
    const groups = buildPaletteGroups(input());
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Recent Threads"]);
    const recent = groups[1]?.items ?? [];
    expect(recent.map((item) => item.title.text)).toEqual([
      "Idempotency keys for POST /orders",
      "Vitest coverage thresholds",
    ]);
    expect(recent[0]?.timestamp).toBe("4m");
    expect(recent[0]?.description?.text).toBe("orders-api · Current thread");
    expect(groups[0]?.items[0]?.shortcut).toBe("⌘N");
  });

  it("searches every source and highlights token matches in order", () => {
    const groups = buildPaletteGroups(
      input({
        query: "orders",
        rootFiles: [{ name: "orders.ts", path: "/r/src/routes/orders.ts", relativePath: "src/routes/orders.ts" }],
        branches: { status: "ready", scopeLabel: "orders-api", branches: [{ name: "feat/orders-events", current: false, remote: false }] },
      }),
    );
    expect(groups.map((group) => group.label)).toEqual(["Projects", "Threads", "Files", "Branches"]);
    expect(groups[1]?.items[0]?.title.ranges).toEqual([{ start: 28, end: 34 }]);
    expect(groups[2]?.items[0]?.title.style).toBe("fuzzy");
  });

  it("limits root to actions and registry commands in > mode and lists every visible command", () => {
    const groups = buildPaletteGroups(input({ query: ">" }));
    expect(groups.map((group) => group.label)).toEqual(["Actions", "Commands"]);
    expect(groups[1]?.items.map((item) => item.title.text)).toEqual(["Show Problems"]);
  });

  it("returns no groups for a query nothing matches", () => {
    expect(buildPaletteGroups(input({ query: "kubectl rollout" }))).toEqual([]);
  });

  it("marks the current project and appends Add project on the switch page", () => {
    const groups = buildPaletteGroups(input({ page: "switchProject" }));
    const items = groups[0]?.items ?? [];
    expect(items.map((item) => item.title.text)).toEqual(["orders-api", "web-dashboard", "Add project…"]);
    expect(items[0]?.current).toBe(true);
    expect(items[2]?.intent).toEqual({ kind: "command", commandId: "project.add" });
  });

  it("uses editor projects and scripts when no agent provider is published", () => {
    const groups = buildPaletteGroups(
      input({
        page: "runScript",
        agent: null,
        editorScripts: [{ key: "k1", name: "lint", detail: "npm run lint", runnable: false }],
        editorScriptsTruncated: true,
      }),
    );
    expect(groups[0]?.items[0]?.disabled).toBe(true);
    expect(groups[0]?.items.at(-1)?.title.text).toBe("Showing first 1 scripts");
    expect(groups[0]?.items.at(-1)?.intent).toEqual({ kind: "none" });
  });

  it("lists palettes with swatches and marks the current palette and scheme", () => {
    const theme = buildPaletteGroups(input({ page: "theme" }))[0]?.items ?? [];
    expect(theme).toHaveLength(6);
    expect(theme[0]?.current).toBe(true);
    expect(theme[0]?.icon?.kind).toBe("swatch");
    const appearance = buildPaletteGroups(input({ page: "appearance" }))[0]?.items ?? [];
    expect(appearance.map((item) => item.title.text)).toEqual(["System", "Light", "Dark"]);
    expect(appearance[0]?.current).toBe(true);
  });

  it("explains an unavailable branch source instead of an empty list", () => {
    const groups = buildPaletteGroups(
      input({ page: "switchBranch", branches: { status: "unavailable", reason: "Branch switching for this project is not available here." } }),
    );
    expect(groups[0]?.items[0]?.title.text).toBe("Branch switching for this project is not available here.");
    expect(groups[0]?.items[0]?.disabled).toBe(true);
  });
});
```

The `{start: 28, end: 34}` range is where `orders` occurs in "Idempotency keys for POST /orders" (`/` is at 27). Check it by evaluating `"Idempotency keys for POST /orders".indexOf("orders")` (28).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/commandPalette`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `paletteShortcuts.ts`**

```ts
import {
  keymapCommands,
  shortcutForCommand,
  type KeymapPlatform,
  type KeymapSettings,
} from "../../domain/keymap";
import { keybindingStrokes } from "../settings/pages/keybindingsPresentation";

const CATEGORY_PRIORITY: readonly string[] = ["Workbench", "Agent", "File", "Search", "Git", "Terminal", "Editor"];

export interface PaletteShortcutEntry {
  readonly commandId: string;
  readonly label: string;
  readonly shortcut: string;
  readonly category: string;
}

export interface PaletteShortcutGroup {
  readonly category: string;
  readonly entries: readonly PaletteShortcutEntry[];
}

export function formatShortcutLabel(shortcut: string, platform: KeymapPlatform): string | null {
  const strokes = keybindingStrokes(shortcut, platform);
  if (strokes.length === 0) return null;
  const joiner = platform === "mac" ? "" : "+";
  return strokes.map((stroke) => stroke.chips.join(joiner)).join(" ");
}

export function paletteShortcutGroups(
  keymap: KeymapSettings,
  platform: KeymapPlatform,
): readonly PaletteShortcutGroup[] {
  const grouped = new Map<string, PaletteShortcutEntry[]>();
  for (const command of keymapCommands) {
    const shortcut = formatShortcutLabel(shortcutForCommand(keymap, command.id, platform), platform);
    if (shortcut === null) continue;
    const bucket = grouped.get(command.category) ?? [];
    bucket.push({ commandId: command.id, label: command.label, shortcut, category: command.category });
    grouped.set(command.category, bucket);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => categoryRank(left) - categoryRank(right))
    .map(([category, entries]) => ({ category, entries }));
}

function categoryRank(category: string): number {
  const index = CATEGORY_PRIORITY.indexOf(category);
  if (index < 0) return CATEGORY_PRIORITY.length;
  return index;
}
```

`Array.prototype.sort` is stable, so categories outside the priority list keep catalog order.

- [ ] **Step 4: Write `commandPalettePresenter.ts`**

```ts
import type { Command } from "../../application/commandRegistry";
import {
  paletteActionCommandIds,
  type PaletteActionView,
} from "../../application/commandPalette/commandPaletteActions";
import type {
  AgentPaletteProvider,
  ComposerPaletteModels,
  PaletteBranch,
  PaletteProject,
  PaletteScript,
  PaletteThread,
} from "../../application/commandPalette/commandPaletteProvider";
import {
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  PALETTE_IDS,
  PALETTE_LABELS,
  type AppearanceSettings,
  type ColorSchemePreference,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import { paletteTokens } from "../../domain/appearancePalettes";
import { compactAgeLabel } from "../../domain/commandPalette/paletteAge";
import {
  plainText,
  type PaletteGlyph,
  type PaletteGroup,
  type PaletteItem,
  type PaletteText,
} from "../../domain/commandPalette/paletteItem";
import {
  fuzzyHighlightRanges,
  fuzzySubsequence,
  matchesAllTokens,
  paletteQueryTokens,
  tokenHighlightRanges,
} from "../../domain/commandPalette/paletteMatch";
import type { PalettePageId } from "../../domain/commandPalette/palettePages";
import { parsePaletteRootQuery } from "../../domain/commandPalette/paletteRootQuery";
import type { FileSearchResult } from "../../domain/workspace";
import type { PaletteShortcutGroup } from "./paletteShortcuts";

const RECENT_THREAD_LIMIT = 12;
const SEARCH_LIMITS = { projects: 6, threads: 8, scripts: 8, files: 5, branches: 6, commands: 8 } as const;
const SCHEME_GLYPHS: Readonly<Record<ColorSchemePreference, PaletteGlyph>> = {
  system: "monitor",
  light: "sun",
  dark: "moon",
};
const SCHEME_ORDER: readonly ColorSchemePreference[] = ["system", "light", "dark"];

export type PaletteBranchesView =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly scopeLabel: string; readonly branches: readonly PaletteBranch[] }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "error"; readonly message: string };

export interface PalettePresenterInput {
  readonly page: PalettePageId;
  readonly query: string;
  readonly actions: readonly PaletteActionView[];
  readonly commands: readonly Command[];
  commandEnabled(command: Command): boolean;
  readonly agent: AgentPaletteProvider | null;
  readonly editorProjects: readonly PaletteProject[];
  readonly editorScripts: readonly PaletteScript[];
  readonly editorScriptsTruncated: boolean;
  readonly rootFiles: readonly FileSearchResult[];
  readonly branches: PaletteBranchesView;
  readonly models: ComposerPaletteModels | null;
  readonly appearance: AppearanceSettings;
  readonly resolvedScheme: ResolvedColorScheme;
  readonly shortcutGroups: readonly PaletteShortcutGroup[];
  readonly nowMs: number;
  readonly canAddProject: boolean;
  shortcutLabel(commandId: string): string | null;
  rawShortcutLabel(shortcut: string): string | null;
}

export function buildPaletteGroups(input: PalettePresenterInput): readonly PaletteGroup[] {
  return nonEmpty(groupsForPage(input));
}

function groupsForPage(input: PalettePresenterInput): readonly PaletteGroup[] {
  const tokens = paletteQueryTokens(input.query);
  switch (input.page) {
    case "root":
      return rootGroups(input);
    case "files":
      return [];
    case "newThreadIn":
      return [group("projects", "Projects", projectItems(projectsOf(input), tokens, "newThreadIn"))];
    case "switchProject":
      return [group("projects", "Projects", [...projectItems(projectsOf(input), tokens, "switchProject"), ...addProjectItem(input, tokens)])];
    case "runScript":
      return [group("scripts", scriptsLabel(input), scriptItems(input, tokens, false))];
    case "switchBranch":
      return [branchGroup(input, tokens)];
    case "changeModel":
      return modelGroups(input, tokens);
    case "theme":
      return [group("theme", "Change theme", themeItems(input, tokens))];
    case "appearance":
      return [group("appearance", "Change appearance", appearanceItems(input, tokens))];
    case "shortcuts":
      return shortcutGroupsView(input, tokens);
    default:
      return unreachablePage(input.page);
  }
}

function rootGroups(input: PalettePresenterInput): readonly PaletteGroup[] {
  const parsed = parsePaletteRootQuery(input.query);
  switch (parsed.kind) {
    case "empty":
    case "files":
      return [
        group("actions", "Actions", actionItems(input, [])),
        group("recent", "Recent Threads", recentThreads(input).map((thread) => threadItem(thread, [], input.nowMs))),
      ];
    case "actions": {
      const tokens = paletteQueryTokens(parsed.text);
      return [
        group("actions", "Actions", actionItems(input, tokens)),
        group("commands", "Commands", commandItems(input, tokens, Number.POSITIVE_INFINITY)),
      ];
    }
    case "search": {
      const tokens = paletteQueryTokens(parsed.text);
      return [
        group("actions", "Actions", actionItems(input, tokens)),
        group("commands", "Commands", commandItems(input, tokens, SEARCH_LIMITS.commands)),
        group("projects", "Projects", projectItems(projectsOf(input), tokens, "switchProject").slice(0, SEARCH_LIMITS.projects)),
        group("threads", "Threads", filterThreads(input, tokens).slice(0, SEARCH_LIMITS.threads).map((thread) => threadItem(thread, tokens, input.nowMs))),
        group("scripts", "Scripts", scriptItems(input, tokens, true).slice(0, SEARCH_LIMITS.scripts)),
        group("files", "Files", input.rootFiles.slice(0, SEARCH_LIMITS.files).map((file) => fileItem(file, parsed.text))),
        group("branches", "Branches", branchItems(input, tokens).slice(0, SEARCH_LIMITS.branches)),
      ];
    }
    default:
      return unreachableRoot(parsed);
  }
}

function actionItems(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteItem[] {
  return input.actions
    .filter((action) => matchesAllTokens([action.title, ...action.keywords], tokens))
    .map((action) => ({
      key: `action:${action.id}`,
      intent: action.intent,
      icon: { kind: "glyph", glyph: action.glyph },
      title: tokenText(action.title, tokens),
      description: null,
      timestamp: null,
      shortcut: action.shortcutCommandId === null ? null : input.shortcutLabel(action.shortcutCommandId),
      current: false,
      disabled: action.disabled,
    }));
}

function commandItems(input: PalettePresenterInput, tokens: readonly string[], limit: number): readonly PaletteItem[] {
  const represented = paletteActionCommandIds();
  return input.commands
    .filter((command) => command.visibleInCommandPalette !== false)
    .filter((command) => !represented.has(command.id) && !command.id.startsWith("palette."))
    .filter((command) => matchesAllTokens([command.title, command.category, command.id], tokens))
    .slice(0, limit)
    .map((command) => ({
      key: `command:${command.id}`,
      intent: { kind: "command", commandId: command.id },
      icon: { kind: "glyph", glyph: "command" },
      title: tokenText(command.title, tokens),
      description: tokenText(command.category, tokens),
      timestamp: null,
      shortcut: command.shortcut === undefined ? null : input.rawShortcutLabel(command.shortcut),
      current: false,
      disabled: !input.commandEnabled(command),
    }));
}

function projectsOf(input: PalettePresenterInput): readonly PaletteProject[] {
  return input.agent?.projects ?? input.editorProjects;
}

function projectItems(
  projects: readonly PaletteProject[],
  tokens: readonly string[],
  kind: "newThreadIn" | "switchProject",
): readonly PaletteItem[] {
  return projects
    .filter((project) => matchesAllTokens([project.label, project.path], tokens))
    .map((project) => ({
      key: `project:${kind}:${project.key}`,
      intent: { kind, projectKey: project.key },
      icon: { kind: "monogram", letter: monogram(project.label) },
      title: tokenText(project.label, tokens),
      description: tokenText(project.path, tokens),
      timestamp: null,
      shortcut: null,
      current: kind === "switchProject" && project.current,
      disabled: false,
    }));
}

function addProjectItem(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteItem[] {
  if (!input.canAddProject) return [];
  if (!matchesAllTokens(["Add project…", "open folder", "clone"], tokens)) return [];
  return [
    {
      key: "project:add",
      intent: { kind: "command", commandId: "project.add" },
      icon: { kind: "glyph", glyph: "folderPlus" },
      title: plainText("Add project…"),
      description: null,
      timestamp: null,
      shortcut: null,
      current: false,
      disabled: false,
    },
  ];
}

function recentThreads(input: PalettePresenterInput): readonly PaletteThread[] {
  return [...(input.agent?.threads ?? [])]
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, RECENT_THREAD_LIMIT);
}

function filterThreads(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteThread[] {
  return recentThreadsAll(input).filter((thread) => matchesAllTokens([thread.title, thread.projectLabel], tokens));
}

function recentThreadsAll(input: PalettePresenterInput): readonly PaletteThread[] {
  return [...(input.agent?.threads ?? [])].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function threadItem(thread: PaletteThread, tokens: readonly string[], nowMs: number): PaletteItem {
  const description = thread.current ? `${thread.projectLabel} · Current thread` : thread.projectLabel;
  return {
    key: `thread:${thread.id}`,
    intent: { kind: "openThread", threadId: thread.id },
    icon: { kind: "glyph", glyph: "message" },
    title: tokenText(thread.title, tokens),
    description: tokenText(description, tokens),
    timestamp: compactAgeLabel(nowMs, thread.updatedAtMs),
    shortcut: null,
    current: false,
    disabled: false,
  };
}

function scriptsOf(input: PalettePresenterInput): readonly PaletteScript[] {
  return input.agent?.scripts ?? input.editorScripts;
}

function scriptsTruncated(input: PalettePresenterInput): boolean {
  return input.agent?.scriptsTruncated ?? input.editorScriptsTruncated;
}

function scriptsLabel(input: PalettePresenterInput): string {
  const project = projectsOf(input).find((candidate) => candidate.current);
  if (project === undefined) return "Scripts";
  return `Scripts · ${project.label}`;
}

function scriptItems(input: PalettePresenterInput, tokens: readonly string[], prefixed: boolean): readonly PaletteItem[] {
  const scripts = scriptsOf(input);
  const items: PaletteItem[] = scripts
    .map((script) => ({ script, title: prefixed ? `Run script: ${script.name}` : script.name }))
    .filter(({ script, title }) => matchesAllTokens([title, script.detail ?? ""], tokens))
    .map(({ script, title }) => ({
      key: `script:${script.key}`,
      intent: { kind: "runScript", scriptKey: script.key },
      icon: { kind: "glyph", glyph: "play" },
      title: tokenText(title, tokens),
      description: script.detail === null ? null : tokenText(script.detail, tokens),
      timestamp: null,
      shortcut: null,
      current: false,
      disabled: !script.runnable,
    }));
  if (prefixed || !scriptsTruncated(input)) return items;
  return [...items, noticeItem("scripts:truncated", `Showing first ${scripts.length} scripts`)];
}

function fileItem(file: FileSearchResult, query: string): PaletteItem {
  const nameMatch = fuzzySubsequence(file.name, query);
  const pathMatch = fuzzySubsequence(file.relativePath, query);
  return {
    key: `file:${file.path}`,
    intent: { kind: "openFile", result: file },
    icon: { kind: "glyph", glyph: "file" },
    title: { text: file.name, ranges: fuzzyHighlightRanges(nameMatch), style: "fuzzy" },
    description: { text: file.relativePath, ranges: fuzzyHighlightRanges(pathMatch), style: "fuzzy" },
    timestamp: null,
    shortcut: null,
    current: false,
    disabled: false,
  };
}

function branchItems(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteItem[] {
  if (input.branches.status !== "ready") return [];
  return input.branches.branches
    .filter((branch) => matchesAllTokens([branch.name], tokens))
    .map((branch) => ({
      key: `branch:${branch.remote ? "remote" : "local"}:${branch.name}`,
      intent: { kind: "switchBranch", name: branch.name, remote: branch.remote },
      icon: { kind: "glyph", glyph: "branch" },
      title: tokenText(branch.name, tokens),
      description: branch.remote ? plainText("Remote") : null,
      timestamp: null,
      shortcut: null,
      current: branch.current,
      disabled: false,
    }));
}

function branchGroup(input: PalettePresenterInput, tokens: readonly string[]): PaletteGroup {
  const branches = input.branches;
  switch (branches.status) {
    case "ready":
      return group("branches", branches.scopeLabel, branchItems(input, tokens));
    case "idle":
    case "loading":
      return group("branches", "Branches", [noticeItem("branches:loading", "Loading branches…")]);
    case "unavailable":
      return group("branches", "Branches", [noticeItem("branches:unavailable", branches.reason)]);
    case "error":
      return group("branches", "Branches", [noticeItem("branches:error", branches.message)]);
    default:
      return unreachableBranches(branches);
  }
}

function modelGroups(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteGroup[] {
  const options = input.models?.options ?? [];
  const labels = [...new Set(options.map((option) => option.group))];
  return labels.map((label) =>
    group(
      `models:${label}`,
      label,
      options
        .filter((option) => option.group === label)
        .filter((option) => matchesAllTokens([option.label, option.group], tokens))
        .map((option) => ({
          key: `model:${option.key}`,
          intent: { kind: "selectModel", modelKey: option.key },
          icon: { kind: "glyph", glyph: "cpu" },
          title: tokenText(option.label, tokens),
          description: null,
          timestamp: null,
          shortcut: null,
          current: option.current,
          disabled: false,
        })),
    ),
  );
}

function themeItems(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteItem[] {
  return PALETTE_IDS.filter((palette) => matchesAllTokens([PALETTE_LABELS[palette]], tokens)).map((palette) => ({
    key: `theme:${palette}`,
    intent: { kind: "setPalette", palette },
    icon: { kind: "swatch", color: paletteTokens(palette, input.resolvedScheme).accent },
    title: tokenText(PALETTE_LABELS[palette], tokens),
    description: null,
    timestamp: null,
    shortcut: null,
    current: input.appearance.palette === palette,
    disabled: false,
  }));
}

function appearanceItems(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteItem[] {
  return SCHEME_ORDER.filter((scheme) => COLOR_SCHEME_PREFERENCES.includes(scheme))
    .filter((scheme) => matchesAllTokens([COLOR_SCHEME_LABELS[scheme]], tokens))
    .map((scheme) => ({
      key: `appearance:${scheme}`,
      intent: { kind: "setColorScheme", scheme },
      icon: { kind: "glyph", glyph: SCHEME_GLYPHS[scheme] },
      title: tokenText(COLOR_SCHEME_LABELS[scheme], tokens),
      description: null,
      timestamp: null,
      shortcut: null,
      current: input.appearance.colorScheme === scheme,
      disabled: false,
    }));
}

function shortcutGroupsView(input: PalettePresenterInput, tokens: readonly string[]): readonly PaletteGroup[] {
  const registered = new Set(input.commands.map((command) => command.id));
  return input.shortcutGroups.map((shortcutGroup) =>
    group(
      `shortcuts:${shortcutGroup.category}`,
      shortcutGroup.category,
      shortcutGroup.entries
        .filter((entry) => matchesAllTokens([entry.label, entry.category], tokens))
        .map((entry) => ({
          key: `shortcut:${entry.commandId}`,
          intent: { kind: "command", commandId: entry.commandId },
          icon: null,
          title: tokenText(entry.label, tokens),
          description: null,
          timestamp: null,
          shortcut: entry.shortcut,
          current: false,
          disabled: !registered.has(entry.commandId),
        })),
    ),
  );
}

function noticeItem(key: string, text: string): PaletteItem {
  return {
    key,
    intent: { kind: "none" },
    icon: null,
    title: plainText(text),
    description: null,
    timestamp: null,
    shortcut: null,
    current: false,
    disabled: true,
  };
}

function tokenText(text: string, tokens: readonly string[]): PaletteText {
  return { text, ranges: tokenHighlightRanges(text, tokens), style: "token" };
}

function group(key: string, label: string, items: readonly PaletteItem[]): PaletteGroup {
  return { key, label, items };
}

function nonEmpty(groups: readonly PaletteGroup[]): readonly PaletteGroup[] {
  return groups.filter((candidate) => candidate.items.length > 0);
}

function monogram(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}

function unreachablePage(page: never): never {
  return page;
}

function unreachableRoot(query: never): never {
  return query;
}

function unreachableBranches(branches: never): never {
  return branches;
}
```

Implementation notes for the engineer:
- `recentThreads` and `recentThreadsAll` differ only in the limit. Keep them separate. Test "searches every source" relies on search mode considering all threads, not only the 12 most recent.
- In the "limits root to actions … in > mode" test, the input `actions` contain no match for the empty `>` query filter. Actions with no tokens match everything, so "Actions" shows both actions, and "Commands" lists only `panel.showProblems` because `hidden` is invisible.
- When the root query is `"orders"`, the Actions group is empty (no action title or keyword contains "orders"), and so is Commands. That is why the expected group labels start at "Projects".
- Run `npx prettier --write src/components/commandPalette/commandPalettePresenter.ts` to reflow long lines.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/commandPalette`
Expected: PASS. If the file grows past 500 lines, move the page builders (`themeItems`, `appearanceItems`, `modelGroups`, `shortcutGroupsView`) into `src/components/commandPalette/paletteSettingsPages.ts` and import them. Keep the exported `buildPaletteGroups` signature unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/commandPalette/paletteShortcuts.ts src/components/commandPalette/paletteShortcuts.test.ts src/components/commandPalette/commandPalettePresenter.ts src/components/commandPalette/commandPalettePresenter.test.ts
git commit -m "feat(palette): add palette presenter and keyboard shortcut cheatsheet"
```

---

### Task 7: Palette page view and intent execution

**Files:**
- Create: `src/components/commandPalette/PaletteHighlight.tsx`, `paletteIcons.tsx`, `CommandPalettePage.tsx`, `commandPalette.css`
- Create: `src/application/commandPalette/executePaletteIntent.ts` (+ `executePaletteIntent.test.ts`)
- Test: `src/components/commandPalette/CommandPalettePage.test.tsx`

**Interfaces:**
- Consumes: Task 1 primitives, Task 3 types, Task 5 providers, `executeCommandAndWait` and `CommandLookup` (`commandRegistry.ts`).
- Produces:
  - `PaletteHighlight({text})`
  - `PaletteIconView({icon})`
  - `CommandPalettePage(props: CommandPalettePageProps)`
  - `type PaletteExecutionOutcome = "close" | "stay" | "failed"`
  - `interface PaletteIntentPorts`
  - `executePaletteIntent(intent, ports): Promise<PaletteExecutionOutcome>`

- [ ] **Step 1: Write the failing tests**

`executePaletteIntent.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../commandRegistry";
import { executePaletteIntent, type PaletteIntentPorts } from "./executePaletteIntent";

const context: CommandContext = { hasWorkspace: true, hasActiveDocument: false, activeDocumentDirty: false };

function ports(overrides: Partial<PaletteIntentPorts> = {}): PaletteIntentPorts {
  return {
    commands: { get: () => undefined },
    context,
    agent: null,
    models: null,
    openFile: vi.fn(async () => undefined),
    switchEditorProject: vi.fn(async () => true),
    runEditorScript: vi.fn(() => "executed" as const),
    switchBranch: vi.fn(async () => undefined),
    setPalette: vi.fn(async () => undefined),
    setColorScheme: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("executePaletteIntent", () => {
  it("closes after an executed command and stays on a disabled one", async () => {
    const run = vi.fn();
    const enabled: Command = { id: "a", title: "A", category: "X", isEnabled: () => true, run };
    const disabled: Command = { ...enabled, id: "b", isEnabled: () => false };
    const lookup = { get: (id: string) => (id === "a" ? enabled : id === "b" ? disabled : undefined) };

    expect(await executePaletteIntent({ kind: "command", commandId: "a" }, ports({ commands: lookup }))).toBe("close");
    expect(await executePaletteIntent({ kind: "command", commandId: "b" }, ports({ commands: lookup }))).toBe("stay");
    expect(await executePaletteIntent({ kind: "command", commandId: "zzz" }, ports({ commands: lookup }))).toBe("failed");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an agent target disappeared", async () => {
    const agent = {
      projects: [], threads: [], scripts: [], scriptsTruncated: false, activeProjectKey: null,
      openThread: vi.fn(() => false), switchProject: vi.fn(() => false),
      newThreadIn: vi.fn(() => false), runScript: vi.fn(() => false),
    };
    expect(await executePaletteIntent({ kind: "openThread", threadId: "gone" }, ports({ agent }))).toBe("failed");
    expect(await executePaletteIntent({ kind: "runScript", scriptKey: "gone" }, ports({ agent }))).toBe("failed");
    expect(await executePaletteIntent({ kind: "selectModel", modelKey: "m" }, ports())).toBe("failed");
  });

  it("routes editor scripts and projects when no agent provider exists", async () => {
    const runEditorScript = vi.fn(() => "executed" as const);
    const switchEditorProject = vi.fn(async () => true);
    const all = ports({ runEditorScript, switchEditorProject });

    expect(await executePaletteIntent({ kind: "runScript", scriptKey: "k" }, all)).toBe("close");
    expect(await executePaletteIntent({ kind: "switchProject", projectKey: "/p" }, all)).toBe("close");
    expect(runEditorScript).toHaveBeenCalledWith("k");
    expect(switchEditorProject).toHaveBeenCalledWith("/p");
  });

  it("does nothing for notice rows and page intents", async () => {
    expect(await executePaletteIntent({ kind: "none" }, ports())).toBe("stay");
    expect(await executePaletteIntent({ kind: "page", page: "theme" }, ports())).toBe("stay");
  });
});
```

`CommandPalettePage.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { plainText, type PaletteGroup } from "../../domain/commandPalette/paletteItem";
import { palettePageCopy } from "../../domain/commandPalette/palettePages";
import { CommandSurface } from "../../ui/foundation/CommandList";
import { click, mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { CommandPalettePage, type CommandPalettePageProps } from "./CommandPalettePage";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

const groups: readonly PaletteGroup[] = [
  {
    key: "actions",
    label: "Actions",
    items: [
      { key: "a", intent: { kind: "command", commandId: "agent.newThread" }, icon: { kind: "glyph", glyph: "newThread" }, title: { text: "New thread", ranges: [{ start: 0, end: 3 }], style: "token" }, description: null, timestamp: null, shortcut: "⌘N", current: false, disabled: false },
      { key: "b", intent: { kind: "page", page: "switchProject" }, icon: { kind: "glyph", glyph: "folder" }, title: plainText("Switch project"), description: null, timestamp: null, shortcut: null, current: false, disabled: false },
    ],
  },
  {
    key: "recent",
    label: "Recent Threads",
    items: [
      { key: "t", intent: { kind: "openThread", threadId: "t1" }, icon: { kind: "glyph", glyph: "message" }, title: plainText("Idempotency keys"), description: plainText("orders-api · Current thread"), timestamp: "4m", shortcut: null, current: false, disabled: false },
    ],
  },
];

function props(overrides: Partial<CommandPalettePageProps> = {}): CommandPalettePageProps {
  return {
    page: "root",
    query: "",
    groups,
    copy: palettePageCopy("root", false),
    canGoBack: false,
    generation: 1,
    onQueryChange: vi.fn(),
    onBack: vi.fn(),
    onExecute: vi.fn(),
    onLocalShortcut: () => false,
    ...overrides,
  };
}

function render(overrides: Partial<CommandPalettePageProps> = {}) {
  const value = props(overrides);
  ui = mountUi();
  ui.render(
    <CommandSurface label="Command palette" onClose={vi.fn()}>
      <CommandPalettePage {...value} />
    </CommandSurface>,
  );
  return value;
}

function input(): HTMLInputElement {
  return document.querySelector(".cv-command-field input") as HTMLInputElement;
}

describe("CommandPalettePage", () => {
  it("renders groups, highlight marks, timestamps, shortcuts and submenu chevrons", () => {
    render();
    expect([...document.querySelectorAll(".cv-command-group__label")].map((node) => node.textContent)).toEqual(["Actions", "Recent Threads"]);
    expect(document.querySelector(".cv-command-item mark")?.textContent).toBe("New");
    expect(document.querySelector(".cv-command-item__timestamp")?.textContent).toBe("4m");
    expect(document.querySelectorAll(".cv-command-item__chevron")).toHaveLength(1);
    expect(input().placeholder).toBe("Search commands, projects, threads, and files…");
  });

  it("executes the active item on Enter and a clicked item", () => {
    const value = render();
    press(input(), "ArrowDown");
    press(input(), "Enter");
    click(document.querySelectorAll('[role="option"]')[2] as Element);
    expect(value.onExecute).toHaveBeenNthCalledWith(1, groups[0]?.items[1]);
    expect(value.onExecute).toHaveBeenNthCalledWith(2, groups[1]?.items[0]);
  });

  it("goes back on Backspace with an empty query and shows the back footer hint", () => {
    const value = render({ page: "switchProject", canGoBack: true, copy: palettePageCopy("switchProject", false) });
    press(input(), "Backspace");
    expect(value.onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cv-command-footer")?.textContent).toContain("Back");
    expect(document.querySelector('button[aria-label="Back"]')).not.toBeNull();
  });

  it("renders the page empty copy when there are no groups", () => {
    render({ groups: [], query: "kubectl rollout" });
    expect(document.querySelector(".cv-command-empty")?.textContent).toBe("No matching commands, projects, threads, or files.");
  });

  it("lets the host consume palette shortcuts before list navigation", () => {
    const onLocalShortcut = vi.fn(() => true);
    const value = render({ onLocalShortcut });
    press(input(), "k", { metaKey: true });
    expect(onLocalShortcut).toHaveBeenCalledTimes(1);
    expect(value.onExecute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/application/commandPalette/executePaletteIntent.test.ts src/components/commandPalette/CommandPalettePage.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `executePaletteIntent.ts`**

```ts
import type { ColorSchemePreference, PaletteId } from "../../domain/appearance";
import type { PaletteIntent } from "../../domain/commandPalette/paletteItem";
import type { FileSearchResult } from "../../domain/workspace";
import {
  executeCommandAndWait,
  type CommandContext,
  type CommandExecutionOutcome,
  type CommandLookup,
} from "../commandRegistry";
import type { AgentPaletteProvider, ComposerPaletteModels } from "./commandPaletteProvider";

export type PaletteExecutionOutcome = "close" | "stay" | "failed";

export interface PaletteIntentPorts {
  readonly commands: CommandLookup;
  readonly context: CommandContext;
  readonly agent: AgentPaletteProvider | null;
  readonly models: ComposerPaletteModels | null;
  openFile(result: FileSearchResult): Promise<void>;
  switchEditorProject(path: string): Promise<boolean>;
  runEditorScript(scriptKey: string): CommandExecutionOutcome;
  switchBranch(name: string, remote: boolean): Promise<void>;
  setPalette(palette: PaletteId): Promise<void>;
  setColorScheme(scheme: ColorSchemePreference): Promise<void>;
}

export async function executePaletteIntent(
  intent: PaletteIntent,
  ports: PaletteIntentPorts,
): Promise<PaletteExecutionOutcome> {
  switch (intent.kind) {
    case "none":
    case "page":
      return "stay";
    case "command":
      return runCommand(intent.commandId, ports);
    case "openThread":
      return settled(ports.agent?.openThread(intent.threadId) ?? false);
    case "newThreadIn":
      return settled(ports.agent?.newThreadIn(intent.projectKey) ?? false);
    case "switchProject":
      if (ports.agent !== null) return settled(ports.agent.switchProject(intent.projectKey));
      return settled(await ports.switchEditorProject(intent.projectKey));
    case "runScript":
      if (ports.agent !== null) return settled(ports.agent.runScript(intent.scriptKey));
      return ports.runEditorScript(intent.scriptKey) === "executed" ? "close" : "failed";
    case "selectModel":
      return settled(ports.models?.selectModel(intent.modelKey) ?? false);
    case "openFile":
      await ports.openFile(intent.result);
      return "close";
    case "switchBranch":
      await ports.switchBranch(intent.name, intent.remote);
      return "close";
    case "setPalette":
      await ports.setPalette(intent.palette);
      return "close";
    case "setColorScheme":
      await ports.setColorScheme(intent.scheme);
      return "close";
    default:
      return unreachableIntent(intent);
  }
}

async function runCommand(
  commandId: string,
  ports: PaletteIntentPorts,
): Promise<PaletteExecutionOutcome> {
  const command = ports.commands.get(commandId);
  if (command === undefined) return "failed";
  const outcome = await executeCommandAndWait(command, ports.context);
  if (outcome === "executed") return "close";
  return "stay";
}

function settled(done: boolean): PaletteExecutionOutcome {
  if (done) return "close";
  return "failed";
}

function unreachableIntent(intent: never): never {
  return intent;
}
```

- [ ] **Step 4: Write `PaletteHighlight.tsx` and `paletteIcons.tsx`**

`PaletteHighlight.tsx`:

```tsx
import type { PaletteText } from "../../domain/commandPalette/paletteItem";

export function PaletteHighlight({ text }: { readonly text: PaletteText }) {
  if (text.ranges.length === 0) return <>{text.text}</>;
  const parts = [];
  let cursor = 0;
  for (const range of text.ranges) {
    if (range.start > cursor) parts.push(text.text.slice(cursor, range.start));
    const hit = text.text.slice(range.start, range.end);
    parts.push(text.style === "fuzzy" ? <b key={range.start}>{hit}</b> : <mark key={range.start}>{hit}</mark>);
    cursor = range.end;
  }
  if (cursor < text.text.length) parts.push(text.text.slice(cursor));
  return <span className={text.style === "fuzzy" ? "cv-palette-fuzzy" : undefined}>{parts}</span>;
}
```

`paletteIcons.tsx`:

```tsx
import {
  Command as CommandIcon,
  Cpu,
  File,
  FileDiff,
  FileSearch,
  Folder,
  FolderPlus,
  GitBranch,
  Keyboard,
  Maximize2,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  PanelBottom,
  PanelRight,
  Play,
  Settings,
  SquarePen,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { PaletteGlyph, PaletteIcon } from "../../domain/commandPalette/paletteItem";

const GLYPHS: Readonly<Record<PaletteGlyph, LucideIcon>> = {
  newThread: SquarePen,
  folder: Folder,
  folderPlus: FolderPlus,
  fileSearch: FileSearch,
  file: File,
  play: Play,
  branch: GitBranch,
  diff: FileDiff,
  terminal: PanelBottom,
  panelRight: PanelRight,
  maximize: Maximize2,
  cpu: Cpu,
  palette: Palette,
  monitor: Monitor,
  sun: Sun,
  moon: Moon,
  keyboard: Keyboard,
  gear: Settings,
  message: MessageSquare,
  command: CommandIcon,
};

export function PaletteIconView({ icon }: { readonly icon: PaletteIcon }) {
  switch (icon.kind) {
    case "glyph": {
      const Glyph = GLYPHS[icon.glyph];
      return <Glyph size={16} />;
    }
    case "monogram":
      return <span className="cv-palette-monogram">{icon.letter}</span>;
    case "swatch":
      return <span className="cv-palette-swatch" style={{ background: icon.color }} />;
    default:
      return unreachableIcon(icon);
  }
}

function unreachableIcon(icon: never): never {
  return icon;
}
```

- [ ] **Step 5: Write `CommandPalettePage.tsx`**

```tsx
import { Check } from "lucide-react";
import { type KeyboardEvent } from "react";
import type { PaletteGroup, PaletteItem } from "../../domain/commandPalette/paletteItem";
import type { PalettePageCopy, PalettePageId } from "../../domain/commandPalette/palettePages";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  commandItemId,
} from "../../ui/foundation/CommandList";
import { useCommandListNavigation } from "../../ui/foundation/useCommandListNavigation";
import { PaletteHighlight } from "./PaletteHighlight";
import { PaletteIconView } from "./paletteIcons";
import "./commandPalette.css";

const LISTBOX_ID = "cv-command-palette-list";

export interface CommandPalettePageProps {
  readonly page: PalettePageId;
  readonly query: string;
  readonly groups: readonly PaletteGroup[];
  readonly copy: PalettePageCopy;
  readonly canGoBack: boolean;
  readonly generation: number;
  onQueryChange(query: string): void;
  onBack(): void;
  onExecute(item: PaletteItem): void;
  onLocalShortcut(event: KeyboardEvent<HTMLInputElement>): boolean;
}

export function CommandPalettePage({
  canGoBack,
  copy,
  generation,
  groups,
  onBack,
  onExecute,
  onLocalShortcut,
  onQueryChange,
  page,
  query,
}: CommandPalettePageProps) {
  const flat = groups.flatMap((group) => group.items);
  const nav = useCommandListNavigation({
    count: flat.length,
    resetKey: `${page}:${generation}:${query}:${flat.length}`,
    homeEndEnabled: query === "",
    onExecute: (index) => {
      const item = flat[index];
      if (item === undefined || item.disabled) return;
      onExecute(item);
    },
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (onLocalShortcut(event)) return;
    if (event.key === "Backspace" && query === "" && canGoBack) {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }
    nav.handleKeyDown(event);
  };
  let index = -1;
  return (
    <>
      <CommandInput
        activeDescendantId={nav.activeIndex < 0 ? null : commandItemId(LISTBOX_ID, nav.activeIndex)}
        label={copy.placeholder}
        lead={canGoBack ? "back" : "search"}
        listboxId={LISTBOX_ID}
        onBack={onBack}
        onChange={onQueryChange}
        onKeyDown={handleKeyDown}
        placeholder={copy.placeholder}
        value={query}
      />
      <CommandPanel>
        {flat.length === 0 ? (
          <CommandEmpty>{copy.empty}</CommandEmpty>
        ) : (
          <CommandList id={LISTBOX_ID} label="Results">
            {groups.map((group) => (
              <CommandGroup key={group.key} label={group.label}>
                {group.items.map((item) => {
                  index += 1;
                  const position = index;
                  return (
                    <CommandItem
                      active={position === nav.activeIndex}
                      description={item.description === null ? undefined : <PaletteHighlight text={item.description} />}
                      disabled={item.disabled}
                      icon={item.icon === null ? undefined : <PaletteIconView icon={item.icon} />}
                      id={commandItemId(LISTBOX_ID, position)}
                      key={item.key}
                      onHover={() => nav.setActiveIndex(position)}
                      onSelect={() => onExecute(item)}
                      shortcut={item.shortcut ?? undefined}
                      submenu={item.intent.kind === "page"}
                      timestamp={item.timestamp ?? undefined}
                      title={<PaletteHighlight text={item.title} />}
                      trailing={item.current ? <Check aria-label="Current" size={16} /> : undefined}
                    />
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        )}
      </CommandPanel>
      <CommandFooter>
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        {copy.enterLabel === null ? null : <CommandFooterHint keys={["Enter"]} label={copy.enterLabel} />}
        {canGoBack ? <CommandFooterHint keys={["Backspace"]} label="Back" /> : null}
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </>
  );
}
```

`let index = -1` is mutated during render only to assign flat positions deterministically. It is local, not state, so the render stays pure.

- [ ] **Step 6: Write `commandPalette.css`**

```css
.cv-command-item mark {
  background: transparent;
  color: var(--cv-fg-strong);
  font-weight: 600;
}

.cv-palette-fuzzy {
  color: var(--cv-fg-muted);
}

.cv-palette-fuzzy b {
  color: var(--cv-fg-strong);
  font-weight: 600;
}

.cv-palette-monogram {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: var(--cv-r-xs);
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
  font: 600 var(--cv-t-2xs) / 1 var(--cv-font-ui);
}

.cv-palette-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin: 0 3px;
  border-radius: 50%;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/application/commandPalette/executePaletteIntent.test.ts src/components/commandPalette/CommandPalettePage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/application/commandPalette/executePaletteIntent.ts src/application/commandPalette/executePaletteIntent.test.ts src/components/commandPalette/PaletteHighlight.tsx src/components/commandPalette/paletteIcons.tsx src/components/commandPalette/CommandPalettePage.tsx src/components/commandPalette/CommandPalettePage.test.tsx src/components/commandPalette/commandPalette.css
git commit -m "feat(palette): add palette page view and typed intent execution"
```

---

### Task 8: Restyle Quick Open as the palette files page

**Files:**
- Modify: `src/components/QuickOpen.tsx` (render section lines ~199-317; props interface lines ~17-28)
- Modify: `src/components/QuickOpen.test.tsx`

**Interfaces:**
- Consumes: Task 1 primitives.
- Produces: the `QuickOpen` props gain `readonly canGoBack: boolean`, `onBack(): void`, `readonly groupLabel: string`, `onLocalShortcut(event: KeyboardEvent<HTMLInputElement>): boolean`. `QuickOpen` no longer renders a backdrop or a surface; the host wraps it in `CommandSurface`.

- [ ] **Step 1: Update the tests first**

In `src/components/QuickOpen.test.tsx`:

1. Wrap every render in the foundation surface and pass the new props. Add this helper near the top and route all existing renders through it:

```tsx
import { CommandSurface } from "../ui/foundation/CommandList";

function renderQuickOpen(root: Root, props: ComponentProps<typeof QuickOpen>) {
  act(() =>
    root.render(
      <CommandSurface label="Command palette" onClose={props.onClose}>
        <QuickOpen {...props} />
      </CommandSurface>,
    ),
  );
}
```

Add `canGoBack: false, onBack: vi.fn(), groupLabel: "orders-api", onLocalShortcut: () => false` to the shared default props object.

2. Update the selectors:
   - `.quick-open-result` -> `[role="option"]`
   - `.quick-open-result.active` -> `[role="option"][aria-selected="true"]`
   - `.quick-open-state` -> `.cv-command-empty, .cv-palette-files-state`
   - `input[aria-label="Search files"]` stays (keep that label)
   - The "footer hint row" test asserts `.cv-command-footer` contains "Navigate", "Open file", "Close"
   - The "accessible compact syntax hint" test asserts the element with `aria-label` "Quick Open syntax: …" still exists inside `.cv-command-footer__end`

3. Add two tests:

```tsx
  it("shows a back lead and goes back on Backspace with an empty query when nested", () => {
    const onBack = vi.fn();
    renderQuickOpen(root, { ...defaultProps, canGoBack: true, onBack, query: "" });
    const input = document.querySelector('input[aria-label="Search files"]') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace" }));
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector('button[aria-label="Back"]')).not.toBeNull();
  });

  it("labels the result group with the workspace name", () => {
    renderQuickOpen(root, { ...defaultProps, groupLabel: "orders-api" });
    expect(document.querySelector(".cv-command-group__label")?.textContent).toBe("orders-api");
  });
```

The defaults object in the file may be named differently (`baseProps`, `props`, etc.). Read `sed -n 1,62p src/components/QuickOpen.test.tsx` and use its real name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/QuickOpen.test.tsx`
Expected: FAIL (new props are unknown, the old classes are still rendered, and there is no back lead).

- [ ] **Step 3: Restyle the render section of `QuickOpen.tsx`**

Keep every hook, effect, the capture listener, IME handling, `openResult`, `openCurrentFileLocation`, `rowCount` and `safeActiveIndex` unchanged. Add the props to the interface and the destructuring:

```ts
  canGoBack: boolean;
  groupLabel: string;
  onBack(): void;
  onLocalShortcut(event: KeyboardEvent<HTMLInputElement>): boolean;
```

(Import `type KeyboardEvent` from `react`. The existing capture listener uses the DOM `KeyboardEvent` type, so alias the React one: `import type { KeyboardEvent as ReactKeyboardEvent } from "react";` and use `ReactKeyboardEvent<HTMLInputElement>` in the prop.)

In the capture listener `interceptEditorKeydown`, the existing `Backspace` branch edits the query. Leave it as is: it runs only when the event target is not the input.

Replace everything from `if (!isOpen) { return null; }` to the end of the component with:

```tsx
  if (!isOpen) {
    return null;
  }

  const listboxId = "cv-quick-open-list";
  const activeId =
    currentFileLocation !== null
      ? commandItemId(listboxId, 0)
      : safeActiveIndex >= 0
        ? commandItemId(listboxId, safeActiveIndex)
        : null;
  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (onLocalShortcut(event)) return;
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "Backspace" && query === "" && canGoBack) {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(rowCount - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && currentFileLocation) {
      event.preventDefault();
      openCurrentFileLocation();
      return;
    }
    if (event.key === "Enter" && activeResult) {
      event.preventDefault();
      openResult(activeResult);
    }
  };

  return (
    <>
      <CommandInput
        activeDescendantId={activeId}
        inputRef={inputRef}
        label="Search files"
        lead={canGoBack ? "back" : "search"}
        listboxId={listboxId}
        onBack={onBack}
        onChange={(value) => {
          if (!composingRef.current) onChangeQuery(value);
        }}
        onCompositionEnd={(value) => {
          composingRef.current = false;
          onChangeQuery(value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onKeyDown={handleInputKeyDown}
        placeholder="Search files…"
        value={query}
      />
      <CommandPanel>
        {isLoading ? <div className="cv-palette-files-state">Searching…</div> : null}
        {isTruncated ? <div className="cv-palette-files-state">Results truncated</div> : null}
        {!isLoading && !isTruncated && results.length === 0 && !currentFileLocation ? (
          <CommandEmpty>No matching files.</CommandEmpty>
        ) : null}
        {currentFileLocation || results.length > 0 ? (
          <CommandList id={listboxId} label="Files">
            <CommandGroup label={groupLabel}>
              {currentFileLocation ? (
                <CommandItem
                  active
                  description={currentFileLocation.column ? `Column ${currentFileLocation.column}` : undefined}
                  icon={<FileCode2 size={16} />}
                  id={commandItemId(listboxId, 0)}
                  onHover={() => undefined}
                  onSelect={openCurrentFileLocation}
                  title={`Go to line ${currentFileLocation.line}`}
                />
              ) : (
                results.map((result, index) => (
                  <CommandItem
                    active={index === safeActiveIndex}
                    description={<HighlightedText className="cv-palette-file-match" query={query} text={result.relativePath} />}
                    hint={result.path}
                    icon={<FileCode2 size={16} />}
                    id={commandItemId(listboxId, index)}
                    key={result.path}
                    onHover={() => setActiveIndex(index)}
                    onSelect={() => openResult(result)}
                    title={<HighlightedText className="cv-palette-file-match" query={query} text={result.name} />}
                  />
                ))
              )}
            </CommandGroup>
          </CommandList>
        ) : null}
      </CommandPanel>
      <CommandFooter
        end={
          <span
            aria-label="Quick Open syntax: greater-than commands, at-sign file symbols, hash workspace symbols, path colon line and optional column"
            className="cv-palette-files-syntax"
            role="note"
          >
            &gt; commands · @ symbols · # workspace · path:line
          </span>
        }
      >
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        <CommandFooterHint keys={["Enter"]} label="Open file" />
        {canGoBack ? <CommandFooterHint keys={["Backspace"]} label="Back" /> : null}
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </>
  );
```

Replace the imports: remove `Search` and `PaletteFooter`, keep `FileCode2` and `HighlightedText`, and add:

```ts
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  commandItemId,
} from "../ui/foundation/CommandList";
import "./commandPalette/commandPalette.css";
```

Add to `src/components/commandPalette/commandPalette.css`:

```css
.cv-palette-files-state {
  padding: 8px 16px 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-palette-file-match {
  background: transparent;
  color: var(--cv-fg-strong);
  font-weight: 600;
}

.cv-palette-files-syntax {
  color: var(--cv-fg-subtle);
  font-weight: 400;
}
```

The old nested ternary `currentFileLocation !== null ? … : safeActiveIndex >= 0 ? … : null` breaks the no-else rule in spirit. Write it as a small helper function with guards instead:

```ts
function activeOptionId(listboxId: string, hasLocation: boolean, index: number): string | null {
  if (hasLocation) return commandItemId(listboxId, 0);
  if (index < 0) return null;
  return commandItemId(listboxId, index);
}
```

Then use `const activeId = activeOptionId(listboxId, currentFileLocation !== null, safeActiveIndex);`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/QuickOpen.test.tsx src/application/useWorkbenchQuickOpen.test.tsx src/application/useQuickOpenPrefixDispatch.test.tsx`
Expected: PASS. The focus-reclaim test ("reclaims focus after an editor steals it back") must pass unchanged. `inputRef` is still the element that the layout effect focuses.

- [ ] **Step 5: Commit**

```bash
git add src/components/QuickOpen.tsx src/components/QuickOpen.test.tsx src/components/commandPalette/commandPalette.css
git commit -m "refactor(quick-open): render quick open as the palette files page"
```

---

### Task 9: Palette host, session, editor sources, root files, branches and App wiring

**Files:**
- Create: `src/components/commandPalette/useCommandPaletteSession.ts` (+ `useCommandPaletteSession.test.tsx`)
- Create: `src/components/commandPalette/editorPaletteSources.ts` (+ `editorPaletteSources.test.ts`)
- Create: `src/application/commandPalette/usePaletteRootFiles.ts` (+ `usePaletteRootFiles.test.tsx`)
- Create: `src/application/commandPalette/usePaletteBranches.ts` (+ `usePaletteBranches.test.tsx`)
- Create: `src/components/commandPalette/CommandPaletteHost.tsx` (+ `CommandPaletteHost.test.tsx`)
- Create: `src/components/commandPalette/WorkbenchCommandPalette.tsx`
- Modify: `src/components/appLazySurfaces.tsx:98-103,156-165`
- Modify: `src/App.tsx:34,39,105,1226,1236-1238` (line numbers shift by about -80 after P2)
- Delete: `src/components/CommandPalette.tsx`, `src/components/CommandPalette.test.tsx`, `src/components/CommandPalette.quickInput.test.tsx`, `src/components/commandPaletteProps.ts`, `src/components/quickOpenProps.ts`
- Modify: `src/App.quickOpen.integration.test.tsx`, `src/App.commandRouting.test.tsx` (selectors only)

**Interfaces:**
- Consumes: everything above; controller members `paletteOpen`, `setPaletteOpen`, `commandPaletteInitialQuery`, `quickOpenOpen`, `setQuickOpenOpen`, `quickOpen*`, `setQuickOpenQuery`, `openSearchResult`, `openCurrentFileLocation`, `commands`, `commandContext`, `runCommand`, `reportCommandError`, `appSettings`, `workspaceSettings`, `workspaceTrust`, `saveWorkbenchSettings`, `workspaceRoot`, `workspaceTabs`, `activateWorkspaceTab`, `nodePackageScripts`, `refreshGitBranches`, `gitBranchEntries`, `gitRemoteBranchEntries`, `switchGitBranch`, `checkoutRemoteBranch`, `agentModeActive`; `workspaceGateways.fileSearch` from `workbenchComposition`.
- Produces:
  - `useCommandPaletteSession(options): CommandPaletteSession`
  - `editorPaletteProjects(tabs, root)`, `editorPaletteScripts(scripts, commandEnabled)`, `editorBranchSource(workbench)`
  - `usePaletteRootFiles({gateway, root, query, enabled})`
  - `usePaletteBranches({source, enabled})`
  - `CommandPaletteHost(props: CommandPaletteHostProps)`
  - `useCommandPaletteHostProps(workbench, fileSearch)`, `WorkbenchCommandPalette({workbench, fileSearch})`, `openPaletteFile(workbench, result, location?)` (the single file-open path; P7 hooks it)

- [ ] **Step 1: Write the failing tests**

`useCommandPaletteSession.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandPaletteLaunch } from "../../application/commandPalette/commandPaletteLaunch";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useCommandPaletteSession, type CommandPaletteSession } from "./useCommandPaletteSession";

let ui: MountedUi | null = null;
let session: CommandPaletteSession | null = null;
let flags: { palette: boolean; quick: boolean; setPalette(open: boolean): void; setQuick(open: boolean): void } | null = null;
const launch = createCommandPaletteLaunch();

function Harness({ initialQuery }: { initialQuery: string }) {
  const [palette, setPalette] = useState(false);
  const [quick, setQuick] = useState(false);
  flags = { palette, quick, setPalette, setQuick };
  session = useCommandPaletteSession({
    paletteOpen: palette,
    quickOpenOpen: quick,
    initialQuery,
    setPaletteOpen: setPalette,
    setQuickOpenOpen: setQuick,
    launch,
  });
  return null;
}

afterEach(() => {
  ui?.unmount();
  ui = null;
  session = null;
  flags = null;
});

describe("useCommandPaletteSession", () => {
  it("opens the root in actions mode for legacy commands.show and the > handoff", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="tog" />);
    act(() => flags?.setPalette(true));
    expect(session?.page).toBe("root");
    expect(session?.query).toBe(">tog");
  });

  it("honours an explicit launch request", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => {
      launch.request({ page: "shortcuts", query: "" });
      flags?.setPalette(true);
    });
    expect(session?.page).toBe("shortcuts");
    expect(session?.canGoBack).toBe(true);
  });

  it("opens the files page alone for Cmd+P and switches flags when pushing and popping files", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => flags?.setQuick(true));
    expect(session?.page).toBe("files");
    expect(session?.canGoBack).toBe(false);

    act(() => session?.close());
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    act(() => session?.push("files"));
    expect(flags?.palette).toBe(false);
    expect(flags?.quick).toBe(true);
    expect(session?.page).toBe("files");
    expect(session?.canGoBack).toBe(true);

    act(() => session?.pop());
    expect(flags?.palette).toBe(true);
    expect(flags?.quick).toBe(false);
    expect(session?.page).toBe("root");
  });

  it("replaces the page when a launch request arrives while open", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    act(() => launch.request({ page: "shortcuts", query: "" }));
    expect(session?.page).toBe("shortcuts");
  });

  it("does not swallow the next real open after a same-surface launch while open", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    act(() => launch.request({ page: "shortcuts", query: "" }));
    act(() => session?.close());
    act(() => {
      launch.request({ page: "root", query: "" });
      flags?.setPalette(true);
    });
    expect(session?.page).toBe("root");
    expect(session?.query).toBe("");
  });

  it("closes both flags", () => {
    ui = mountUi();
    ui.render(<Harness initialQuery="" />);
    act(() => flags?.setPalette(true));
    act(() => session?.close());
    expect(flags?.palette).toBe(false);
    expect(flags?.quick).toBe(false);
    expect(session?.visible).toBe(false);
  });
});
```

`usePaletteRootFiles.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchGateway, FileSearchResponse } from "../../domain/workspace";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { usePaletteRootFiles } from "./usePaletteRootFiles";

let ui: MountedUi | null = null;
let latest: readonly { path: string }[] = [];

function Harness(props: { gateway: FileSearchGateway; root: string | null; query: string }) {
  latest = usePaletteRootFiles({ ...props, enabled: true });
  return null;
}

function deferred() {
  let resolve: (value: FileSearchResponse) => void = () => undefined;
  const promise = new Promise<FileSearchResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  ui?.unmount();
  ui = null;
  latest = [];
  vi.useRealTimers();
});

describe("usePaletteRootFiles", () => {
  it("debounces, requests five results and drops responses for a stale query or root", async () => {
    const first = deferred();
    const second = deferred();
    const searchFilesWithMetadata = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const gateway: FileSearchGateway = { searchFiles: vi.fn(), searchFilesWithMetadata };
    ui = mountUi();

    ui.render(<Harness gateway={gateway} query="ord" root="/a" />);
    await act(async () => vi.advanceTimersByTime(100));
    ui.render(<Harness gateway={gateway} query="ord" root="/b" />);
    await act(async () => vi.advanceTimersByTime(100));
    await act(async () => {
      first.resolve({ requestGeneration: "1", results: [{ name: "a.ts", path: "/a/a.ts", relativePath: "a.ts" }], truncated: false });
    });
    expect(latest).toEqual([]);
    await act(async () => {
      second.resolve({ requestGeneration: "2", results: [{ name: "b.ts", path: "/b/b.ts", relativePath: "b.ts" }], truncated: false });
    });
    expect(latest.map((file) => file.path)).toEqual(["/b/b.ts"]);
    expect(searchFilesWithMetadata).toHaveBeenCalledWith("/b", "ord", 5, expect.any(String));
  });

  it("does not search for an empty or prefixed query", async () => {
    const searchFilesWithMetadata = vi.fn();
    const gateway: FileSearchGateway = { searchFiles: vi.fn(), searchFilesWithMetadata };
    ui = mountUi();
    ui.render(<Harness gateway={gateway} query="  " root="/a" />);
    ui.render(<Harness gateway={gateway} query=">tog" root="/a" />);
    await act(async () => vi.advanceTimersByTime(200));
    expect(searchFilesWithMetadata).not.toHaveBeenCalled();
  });
});
```

`usePaletteBranches.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaletteBranch, PaletteBranchSource } from "./commandPaletteProvider";
import type { PaletteBranchesView } from "../../components/commandPalette/commandPalettePresenter";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { usePaletteBranches } from "./usePaletteBranches";

let ui: MountedUi | null = null;
let view: PaletteBranchesView = { status: "idle" };

function Harness({ source }: { source: PaletteBranchSource | null }) {
  view = usePaletteBranches({ source, enabled: true, unavailableReason: "Branch switching for this project is not available here." });
  return null;
}

function source(key: string, load: () => Promise<readonly PaletteBranch[]>): PaletteBranchSource {
  return { scopeKey: key, scopeLabel: key, load, switchTo: vi.fn(async () => undefined) };
}

afterEach(() => {
  ui?.unmount();
  ui = null;
});

describe("usePaletteBranches", () => {
  it("drops a late list from a replaced source", async () => {
    let resolveA: (value: readonly PaletteBranch[]) => void = () => undefined;
    const a = source("a", () => new Promise((resolve) => { resolveA = resolve; }));
    const b = source("b", async () => [{ name: "main", current: true, remote: false }]);
    ui = mountUi();
    ui.render(<Harness source={a} />);
    expect(view.status).toBe("loading");
    await act(async () => ui?.render(<Harness source={b} />));
    await act(async () => resolveA([{ name: "stale", current: false, remote: false }]));
    expect(view).toEqual({ status: "ready", scopeLabel: "b", branches: [{ name: "main", current: true, remote: false }] });
  });

  it("reports unavailable without a source and a bounded error message on failure", async () => {
    ui = mountUi();
    ui.render(<Harness source={null} />);
    expect(view).toEqual({ status: "unavailable", reason: "Branch switching for this project is not available here." });
    await act(async () => ui?.render(<Harness source={source("c", async () => Promise.reject(new Error("x".repeat(900))))} />));
    expect(view.status).toBe("error");
    expect(view.status === "error" ? view.message.length : 0).toBeLessThanOrEqual(300);
  });
});
```

`editorPaletteSources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { editorPaletteProjects, editorPaletteScripts } from "./editorPaletteSources";

describe("editor palette sources", () => {
  it("turns workspace tabs into projects and marks the active root", () => {
    expect(editorPaletteProjects(["/u/orders-api", "/u/web-dashboard/"], "/u/orders-api")).toEqual([
      { key: "/u/orders-api", label: "orders-api", path: "/u/orders-api", current: true },
      { key: "/u/web-dashboard/", label: "web-dashboard", path: "/u/web-dashboard/", current: false },
    ]);
  });

  it("describes node scripts with their package manager and runnable state", () => {
    const scripts = editorPaletteScripts(
      [{ key: "k", manifestRelativePath: "package.json", packageName: null, packageManager: "pnpm", packageRootRelativePath: "", scriptName: "test" }],
      (commandId) => commandId === "script.node.k",
    );
    expect(scripts).toEqual([{ key: "k", name: "test", detail: "pnpm run test", runnable: true }]);
  });
});
```

`CommandPaletteHost.test.tsx`. This covers the root flow, `@`, Backspace back, a local ⌘K toggle, closing on workspace change, the pending-command guard ported from `CommandPalette.test.tsx`, the rejected command ported from the same file, and the quick-input scenario ported from `CommandPalette.quickInput.test.tsx`. Before writing the last scenario, read `src/components/CommandPalette.quickInput.test.tsx` and port its `New File` flow verbatim with the new host props.

```tsx
// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../../application/commandRegistry";
import { __resetKeymapPlatformCacheForTests, defaultKeymapSettings } from "../../domain/keymap";
import { DEFAULT_APPEARANCE } from "../../domain/appearance";
import { click, mountUi, press, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { CommandPaletteHost, type CommandPaletteHostProps } from "./CommandPaletteHost";

let ui: MountedUi | null = null;
beforeEach(() => {
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  __resetKeymapPlatformCacheForTests();
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
  __resetKeymapPlatformCacheForTests();
});

const context: CommandContext = { hasWorkspace: true, hasActiveDocument: false, activeDocumentDirty: false };

function command(id: string, title: string, run: Command["run"] = vi.fn()): Command {
  return { id, title, category: "Workbench", isEnabled: () => true, run };
}

function hostProps(overrides: Partial<CommandPaletteHostProps> = {}): CommandPaletteHostProps {
  return {
    paletteOpen: true,
    quickOpenOpen: false,
    initialQuery: "",
    setPaletteOpen: vi.fn(),
    setQuickOpenOpen: vi.fn(),
    commands: [command("agent.newThread", "New Thread"), command("workbench.openSettings", "Open Settings"), command("panel.showProblems", "Show Problems")],
    commandContext: context,
    reportCommandError: vi.fn(),
    keymap: defaultKeymapSettings("mac"),
    appearance: DEFAULT_APPEARANCE,
    saveAppearance: vi.fn(async () => undefined),
    workspaceRoot: "/u/orders-api",
    workspaceTabs: ["/u/orders-api"],
    activateWorkspaceTab: vi.fn(async () => undefined),
    nodePackageScripts: [],
    nodePackageScriptsTruncated: false,
    branchSource: null,
    fileSearch: { searchFiles: vi.fn(), searchFilesWithMetadata: vi.fn(async () => ({ requestGeneration: "", results: [], truncated: false })) },
    openSearchResult: vi.fn(async () => undefined),
    agentModeActive: false,
    quickOpen: null,
    ...overrides,
  };
}

function input(): HTMLInputElement {
  return document.querySelector(".cv-command-field input") as HTMLInputElement;
}

function type(value: string) {
  act(() => {
    const element = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CommandPaletteHost", () => {
  it("renders the root with actions for an empty query", () => {
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ initialQuery: "" })} />);
    type("");
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Command palette");
    expect(document.querySelector(".cv-command-group__label")?.textContent).toBe("Actions");
  });

  it("jumps to the files page when @ is typed at the root", () => {
    const setPaletteOpen = vi.fn();
    const setQuickOpenOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen, setQuickOpenOpen })} />);
    type("@");
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
    expect(setQuickOpenOpen).toHaveBeenCalledWith(true);
  });

  it("closes itself when ⌘K is pressed inside the palette", () => {
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen })} />);
    press(input(), "k", { metaKey: true });
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("closes when the workspace root changes while open", () => {
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen })} />);
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen, workspaceRoot: "/u/web-dashboard" })} />);
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("runs a pending command once and ignores Enter while it is pending", async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ setPaletteOpen, initialQuery: "problems", commands: [command("panel.showProblems", "Show Problems", run)] })} />);
    press(input(), "Enter");
    press(input(), "Enter");
    expect(run).toHaveBeenCalledTimes(1);
    expect(setPaletteOpen).not.toHaveBeenCalledWith(false);
    await act(async () => finish());
    expect(setPaletteOpen).toHaveBeenCalledWith(false);
  });

  it("reports a rejected command and stays open", async () => {
    const reportCommandError = vi.fn();
    const failing = command("panel.showProblems", "Show Problems", () => Promise.reject(new Error("boom")));
    const setPaletteOpen = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ reportCommandError, setPaletteOpen, initialQuery: "problems", commands: [failing] })} />);
    await act(async () => press(input(), "Enter"));
    expect(reportCommandError).toHaveBeenCalledTimes(1);
    expect(setPaletteOpen).not.toHaveBeenCalledWith(false);
  });

  it("reports a stale selection instead of closing", async () => {
    const reportCommandError = vi.fn();
    ui = mountUi();
    ui.render(<CommandPaletteHost {...hostProps({ reportCommandError, initialQuery: "" })} />);
    type("zzz-not-a-command");
    press(input(), "Enter");
    expect(reportCommandError).not.toHaveBeenCalled();
    expect(document.querySelector(".cv-command-empty")).not.toBeNull();
  });
});
```

The legacy path uses `initialQuery: "problems"` and opens the root at `">problems"`, so the only row is the "Show Problems" command, and Enter runs it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/commandPalette src/application/commandPalette`
Expected: FAIL for the five new files.

- [ ] **Step 3: Write `useCommandPaletteSession.ts`**

```ts
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { CommandPaletteLaunch } from "../../application/commandPalette/commandPaletteLaunch";
import {
  INITIAL_PALETTE_NAVIGATION,
  currentPalettePage,
  reducePaletteNavigation,
} from "../../domain/commandPalette/paletteNavigation";
import { paletteSurfaceForPage, type PalettePageId } from "../../domain/commandPalette/palettePages";

export interface CommandPaletteSessionOptions {
  readonly paletteOpen: boolean;
  readonly quickOpenOpen: boolean;
  readonly initialQuery: string;
  readonly launch: CommandPaletteLaunch;
  setPaletteOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
}

export interface CommandPaletteSession {
  readonly visible: boolean;
  readonly page: PalettePageId;
  readonly query: string;
  readonly generation: number;
  readonly canGoBack: boolean;
  setQuery(query: string): void;
  push(page: PalettePageId): void;
  pop(): void;
  open(page: PalettePageId, query: string): void;
  close(): void;
}

export function useCommandPaletteSession({
  initialQuery,
  launch,
  paletteOpen,
  quickOpenOpen,
  setPaletteOpen,
  setQuickOpenOpen,
}: CommandPaletteSessionOptions): CommandPaletteSession {
  const [state, dispatch] = useReducer(reducePaletteNavigation, INITIAL_PALETTE_NAVIGATION);
  const internal = useRef(false);
  const previous = useRef({ paletteOpen: false, quickOpenOpen: false });
  const visible = paletteOpen || quickOpenOpen;
  const page = currentPalettePage(state);

  const syncFlags = useCallback(
    (target: PalettePageId) => {
      const files = paletteSurfaceForPage(target) === "files";
      if (paletteOpen === !files && quickOpenOpen === files) return;
      internal.current = true;
      setPaletteOpen(!files);
      setQuickOpenOpen(files);
    },
    [paletteOpen, quickOpenOpen, setPaletteOpen, setQuickOpenOpen],
  );

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { paletteOpen, quickOpenOpen };
    if (internal.current) {
      internal.current = false;
      return;
    }
    if (paletteOpen && !before.paletteOpen && !before.quickOpenOpen) {
      const request = launch.take();
      dispatch(request === null ? { type: "open", page: "root", query: `>${initialQuery}` } : { type: "open", ...request });
      return;
    }
    if (quickOpenOpen && !before.quickOpenOpen) dispatch({ type: "open", page: "files", query: "" });
  }, [initialQuery, launch, paletteOpen, quickOpenOpen]);

  useEffect(() => {
    if (!visible) return undefined;
    return launch.subscribe(() => {
      const request = launch.take();
      if (request === null) return;
      dispatch({ type: "open", ...request });
      syncFlags(request.page);
    });
  }, [launch, syncFlags, visible]);

  const push = useCallback(
    (target: PalettePageId) => {
      dispatch({ type: "push", page: target });
      if (paletteSurfaceForPage(target) === paletteSurfaceForPage(page)) return;
      syncFlags(target);
    },
    [page, syncFlags],
  );
  const pop = useCallback(() => {
    const parent = state.stack[state.stack.length - 2];
    if (parent === undefined) return;
    dispatch({ type: "pop" });
    if (paletteSurfaceForPage(parent) === paletteSurfaceForPage(page)) return;
    syncFlags(parent);
  }, [page, state.stack, syncFlags]);
  const open = useCallback(
    (target: PalettePageId, query: string) => {
      dispatch({ type: "open", page: target, query });
      syncFlags(target);
    },
    [syncFlags],
  );
  const close = useCallback(() => {
    internal.current = false;
    setPaletteOpen(false);
    setQuickOpenOpen(false);
  }, [setPaletteOpen, setQuickOpenOpen]);
  const setQuery = useCallback((query: string) => dispatch({ type: "setQuery", query }), []);

  return {
    visible,
    page,
    query: state.query,
    generation: state.generation,
    canGoBack: state.stack.length > 1,
    setQuery,
    push,
    pop,
    open,
    close,
  };
}
```

The single-line ternary inside `dispatch(...)` selects a value, not a branch of control flow, and is allowed. If the reviewer objects, extract `openAction(request, initialQuery)`.

The "Cmd+P while the root is visible" case: `file.quickOpen` calls `setQuickOpenOpen(true)` only, so both flags are true. The layout effect dispatches `open files`. The host renders the files page whenever `page === "files"`. The stale `paletteOpen` stays true until close, and `close()` clears both flags. This is acceptable because both flags close together.

- [ ] **Step 4: Write `usePaletteRootFiles.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import { parsePaletteRootQuery } from "../../domain/commandPalette/paletteRootQuery";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";

const ROOT_FILE_LIMIT = 5;
const ROOT_FILE_DEBOUNCE_MS = 80;
const EMPTY: readonly FileSearchResult[] = [];

export interface PaletteRootFilesOptions {
  readonly gateway: FileSearchGateway;
  readonly root: string | null;
  readonly query: string;
  readonly enabled: boolean;
}

export function usePaletteRootFiles({
  enabled,
  gateway,
  query,
  root,
}: PaletteRootFilesOptions): readonly FileSearchResult[] {
  const [result, setResult] = useState<{ key: string; files: readonly FileSearchResult[] }>({ key: "", files: EMPTY });
  const generation = useRef(0);
  const parsed = parsePaletteRootQuery(query);
  const text = parsed.kind === "search" ? parsed.text.trim() : "";
  const key = JSON.stringify([root, text]);

  useEffect(() => {
    generation.current += 1;
    const owned = generation.current;
    if (!enabled || root === null || text === "") return undefined;
    const timer = window.setTimeout(() => {
      const request = gateway.searchFilesWithMetadata
        ? gateway.searchFilesWithMetadata(root, text, ROOT_FILE_LIMIT, `palette-${owned}`).then((response) => response.results)
        : gateway.searchFiles(root, text, ROOT_FILE_LIMIT);
      void request
        .then((files) => {
          if (generation.current !== owned) return;
          setResult({ key, files: files.slice(0, ROOT_FILE_LIMIT) });
        })
        .catch(() => {
          if (generation.current !== owned) return;
          setResult({ key, files: EMPTY });
        });
    }, ROOT_FILE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, gateway, key, root, text]);

  if (result.key !== key) return EMPTY;
  return result.files;
}
```

The file hook bumps `generation` on every dependency change, so the root-change test drops the `/a` response. The debounce means the `/a` request was already dispatched after 100 ms. Its result is ignored because `generation` moved on.

- [ ] **Step 5: Write `usePaletteBranches.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import type { PaletteBranchesView } from "../../components/commandPalette/commandPalettePresenter";
import type { PaletteBranchSource } from "./commandPaletteProvider";

const MAX_ERROR_CHARS = 300;

export interface PaletteBranchesOptions {
  readonly source: PaletteBranchSource | null;
  readonly enabled: boolean;
  readonly unavailableReason: string;
}

export function usePaletteBranches({
  enabled,
  source,
  unavailableReason,
}: PaletteBranchesOptions): PaletteBranchesView {
  const [loaded, setLoaded] = useState<{ source: PaletteBranchSource; view: PaletteBranchesView } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const owned = generation.current;
    if (!enabled || source === null) return;
    void source
      .load()
      .then((branches) => {
        if (generation.current !== owned) return;
        setLoaded({ source, view: { status: "ready", scopeLabel: source.scopeLabel, branches } });
      })
      .catch((error: unknown) => {
        if (generation.current !== owned) return;
        setLoaded({ source, view: { status: "error", message: boundedMessage(error) } });
      });
  }, [enabled, source]);

  if (source === null) return { status: "unavailable", reason: unavailableReason };
  if (!enabled) return { status: "idle" };
  if (loaded === null || loaded.source !== source) return { status: "loading" };
  return loaded.view;
}

function boundedMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Could not load branches.";
  const clean = raw.replace(/[\x00-\x1f\x7f]/g, " ").trim();
  if (clean === "") return "Could not load branches.";
  return clean.slice(0, MAX_ERROR_CHARS);
}
```

The component type import (`PaletteBranchesView`) points from application to components, which violates the dependency direction. Move the `PaletteBranchesView` type declaration into `src/application/commandPalette/commandPaletteProvider.ts`, and in `commandPalettePresenter.ts` replace its declaration with `export type { PaletteBranchesView } from "../../application/commandPalette/commandPaletteProvider";`. Update the Task 6 import accordingly. Do this move in this step, and rerun Task 6 tests.

- [ ] **Step 6: Write `editorPaletteSources.ts`**

```ts
import type {
  PaletteBranch,
  PaletteBranchSource,
  PaletteProject,
  PaletteScript,
} from "../../application/commandPalette/commandPaletteProvider";
import type { GitBranch } from "../../domain/git";
import type { NodePackageScript } from "../../domain/nodePackageScripts";

export function editorPaletteProjects(
  tabs: readonly string[],
  root: string | null,
): readonly PaletteProject[] {
  return tabs.map((path) => ({ key: path, label: folderName(path), path, current: path === root }));
}

export function editorPaletteScripts(
  scripts: readonly NodePackageScript[],
  commandEnabled: (commandId: string) => boolean,
): readonly PaletteScript[] {
  return scripts.map((script) => ({
    key: script.key,
    name: script.scriptName,
    detail: scriptDetail(script),
    runnable: commandEnabled(`script.node.${script.key}`),
  }));
}

export interface EditorBranchPorts {
  readonly root: string;
  refreshGitBranches(): Promise<void>;
  readLocal(): readonly GitBranch[];
  readRemote(): readonly GitBranch[];
  switchGitBranch(name: string): Promise<void>;
  checkoutRemoteBranch(name: string): Promise<void>;
}

export function editorBranchSource(ports: EditorBranchPorts): PaletteBranchSource {
  return {
    scopeKey: ports.root,
    scopeLabel: folderName(ports.root),
    async load() {
      await ports.refreshGitBranches();
      const local: PaletteBranch[] = ports.readLocal().map((branch) => ({ name: branch.name, current: branch.isCurrent, remote: false }));
      const remote: PaletteBranch[] = ports.readRemote().map((branch) => ({ name: branch.name, current: false, remote: true }));
      return [...local, ...remote];
    },
    async switchTo(branch) {
      if (branch.remote) {
        await ports.checkoutRemoteBranch(branch.name);
        return;
      }
      await ports.switchGitBranch(branch.name);
    },
  };
}

function scriptDetail(script: NodePackageScript): string {
  const command = `${script.packageManager} run ${script.scriptName}`;
  if (script.packageRootRelativePath === "") return command;
  return `${command} · ${script.packageRootRelativePath}`;
}

function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || trimmed;
}
```

`readLocal`/`readRemote` read the controller's latest `gitBranchEntries`/`gitRemoteBranchEntries` through a ref. `refreshGitBranches` only sets state, so the latest entries are visible only after React commits. In `load()`, await `refreshGitBranches()`, then `await new Promise((resolve) => setTimeout(resolve, 0))` before reading the refs. Otherwise the first open reads the previous list. Add a test in `editorPaletteSources.test.ts` whose `readLocal` returns different arrays before and after refresh. Verified facts: `GitBranch = { isCurrent: boolean; name: string }` (`src/domain/git.ts:150`), `checkoutRemoteBranch: (name: string) => Promise<void>` (`useGitBranchPanel.ts:31`).

- [ ] **Step 7: Write `CommandPaletteHost.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { availablePaletteActions } from "../../application/commandPalette/commandPaletteActions";
import { workbenchCommandPaletteLaunch } from "../../application/commandPalette/commandPaletteLaunch";
import {
  workbenchAgentPaletteProvider,
  workbenchComposerPaletteModels,
  type PaletteBranchSource,
} from "../../application/commandPalette/commandPaletteProvider";
import { executePaletteIntent } from "../../application/commandPalette/executePaletteIntent";
import { usePaletteBranches } from "../../application/commandPalette/usePaletteBranches";
import { usePaletteRootFiles } from "../../application/commandPalette/usePaletteRootFiles";
import type { Command, CommandContext } from "../../application/commandRegistry";
import { usePrefersLightTheme } from "../../application/usePrefersLightTheme";
import {
  resolveColorScheme,
  type AppearanceSettings,
  type ColorSchemePreference,
  type PaletteId,
} from "../../domain/appearance";
import type { PaletteItem } from "../../domain/commandPalette/paletteItem";
import { palettePageCopy } from "../../domain/commandPalette/palettePages";
import { parsePaletteRootQuery } from "../../domain/commandPalette/paletteRootQuery";
import {
  detectKeymapPlatform,
  matchesShortcut,
  shortcutForCommand,
  type KeymapSettings,
} from "../../domain/keymap";
import type { NodePackageScript } from "../../domain/nodePackageScripts";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";
import { CommandSurface } from "../../ui/foundation/CommandList";
import { QuickOpen } from "../QuickOpen";
import { buildPaletteGroups } from "./commandPalettePresenter";
import { CommandPalettePage } from "./CommandPalettePage";
import { editorPaletteProjects, editorPaletteScripts } from "./editorPaletteSources";
import { formatShortcutLabel, paletteShortcutGroups } from "./paletteShortcuts";
import { useCommandPaletteSession } from "./useCommandPaletteSession";
import type { ComponentProps } from "react";

const UNAVAILABLE_BRANCHES = "Branch switching for this project is not available here.";

export type QuickOpenPageProps = Omit<
  ComponentProps<typeof QuickOpen>,
  "canGoBack" | "onBack" | "groupLabel" | "onLocalShortcut" | "isOpen" | "onClose"
>;

export interface CommandPaletteHostProps {
  readonly paletteOpen: boolean;
  readonly quickOpenOpen: boolean;
  readonly initialQuery: string;
  setPaletteOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
  readonly commands: readonly Command[];
  readonly commandContext: CommandContext;
  reportCommandError(error: unknown): void;
  readonly keymap: KeymapSettings;
  readonly appearance: AppearanceSettings;
  saveAppearance(next: AppearanceSettings): Promise<void>;
  readonly workspaceRoot: string | null;
  readonly workspaceTabs: readonly string[];
  activateWorkspaceTab(path: string): Promise<void>;
  readonly nodePackageScripts: readonly NodePackageScript[];
  readonly nodePackageScriptsTruncated: boolean;
  readonly branchSource: PaletteBranchSource | null;
  readonly fileSearch: FileSearchGateway;
  openSearchResult(result: FileSearchResult): Promise<void>;
  readonly agentModeActive: boolean;
  readonly quickOpen: QuickOpenPageProps | null;
}

export function CommandPaletteHost(props: CommandPaletteHostProps) {
  const session = useCommandPaletteSession({
    paletteOpen: props.paletteOpen,
    quickOpenOpen: props.quickOpenOpen,
    initialQuery: props.initialQuery,
    launch: workbenchCommandPaletteLaunch,
    setPaletteOpen: props.setPaletteOpen,
    setQuickOpenOpen: props.setQuickOpenOpen,
  });
  const openedRoot = useRef(props.workspaceRoot);
  const { close } = session;

  useEffect(() => {
    if (!session.visible) {
      openedRoot.current = props.workspaceRoot;
      return;
    }
    if (openedRoot.current === props.workspaceRoot) return;
    openedRoot.current = props.workspaceRoot;
    close();
  }, [close, props.workspaceRoot, session.visible]);

  if (!session.visible) return null;
  return (
    <CommandSurface label="Command palette" onClose={close}>
      <CommandPaletteBody {...props} session={session} />
    </CommandSurface>
  );
}

function CommandPaletteBody(
  props: CommandPaletteHostProps & { readonly session: ReturnType<typeof useCommandPaletteSession> },
) {
  const { session } = props;
  const platform = detectKeymapPlatform();
  const agentPublished = useSyncExternalStore(workbenchAgentPaletteProvider.subscribe, workbenchAgentPaletteProvider.current);
  const models = useSyncExternalStore(workbenchComposerPaletteModels.subscribe, workbenchComposerPaletteModels.current);
  const agent = props.agentModeActive ? agentPublished : null;
  const prefersLight = usePrefersLightTheme();
  const pending = useRef<object | null>(null);
  const [nowMs] = useState(() => Date.now());
  const commandsById = useMemo(() => new Map(props.commands.map((command) => [command.id, command])), [props.commands]);
  const commandEnabled = useCallback(
    (command: Command) => {
      try {
        return command.isEnabled(props.commandContext);
      } catch {
        return false;
      }
    },
    [props.commandContext],
  );
  const commandState = useCallback(
    (id: string) => {
      const command = commandsById.get(id);
      if (command === undefined) return "missing" as const;
      return commandEnabled(command) ? ("enabled" as const) : ("disabled" as const);
    },
    [commandEnabled, commandsById],
  );
  const branchSource = useMemo(() => {
    if (props.branchSource === null) return null;
    if (agent === null) return props.branchSource;
    const active = agent.projects.find((project) => project.key === agent.activeProjectKey);
    if (active === undefined || active.path !== props.workspaceRoot) return null;
    return props.branchSource;
  }, [agent, props.branchSource, props.workspaceRoot]);
  const rootSearch = session.page === "root" && parsePaletteRootQuery(session.query).kind === "search";
  const rootFiles = usePaletteRootFiles({
    gateway: props.fileSearch,
    root: props.workspaceRoot,
    query: session.query,
    enabled: rootSearch,
  });
  const branches = usePaletteBranches({
    source: branchSource,
    enabled: session.page === "switchBranch" || rootSearch,
    unavailableReason: UNAVAILABLE_BRANCHES,
  });
  const actions = useMemo(
    () => availablePaletteActions({ commandState, agentProvider: agent !== null, composerModels: models !== null }),
    [agent, commandState, models],
  );
  const shortcutGroups = useMemo(() => paletteShortcutGroups(props.keymap, platform), [platform, props.keymap]);
  const groups = useMemo(
    () =>
      buildPaletteGroups({
        page: session.page,
        query: session.query,
        actions,
        commands: props.commands,
        commandEnabled,
        agent,
        editorProjects: editorPaletteProjects(props.workspaceTabs, props.workspaceRoot),
        editorScripts: editorPaletteScripts(props.nodePackageScripts, (id) => commandState(id) === "enabled"),
        editorScriptsTruncated: props.nodePackageScriptsTruncated,
        rootFiles,
        branches,
        models,
        appearance: props.appearance,
        resolvedScheme: resolveColorScheme(props.appearance.colorScheme, prefersLight),
        shortcutGroups,
        nowMs,
        canAddProject: commandState("project.add") === "enabled",
        shortcutLabel: (id) => formatShortcutLabel(shortcutForCommand(props.keymap, id as never, platform), platform),
        rawShortcutLabel: (shortcut) => formatShortcutLabel(shortcut, platform),
      }),
    [actions, agent, branches, commandEnabled, commandState, models, nowMs, platform, prefersLight, props.appearance, props.commands, props.keymap, props.nodePackageScripts, props.nodePackageScriptsTruncated, props.workspaceRoot, props.workspaceTabs, rootFiles, session.page, session.query, shortcutGroups],
  );

  const onLocalShortcut = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    const native = event.nativeEvent;
    if (matchesShortcut(native, shortcutForCommand(props.keymap, "palette.open", platform), platform)) {
      event.preventDefault();
      event.stopPropagation();
      session.close();
      return true;
    }
    if (matchesShortcut(native, shortcutForCommand(props.keymap, "file.quickOpen", platform), platform)) {
      event.preventDefault();
      event.stopPropagation();
      if (session.page === "files") {
        session.close();
        return true;
      }
      session.push("files");
      return true;
    }
    if (!matchesShortcut(native, shortcutForCommand(props.keymap, "palette.shortcuts", platform), platform)) return false;
    event.preventDefault();
    event.stopPropagation();
    session.push("shortcuts");
    return true;
  };

  const execute = (item: PaletteItem): void => {
    if (item.intent.kind === "page") {
      session.push(item.intent.page);
      return;
    }
    if (pending.current !== null) return;
    const token = {};
    pending.current = token;
    void executePaletteIntent(item.intent, {
      commands: { get: (id) => commandsById.get(id) },
      context: props.commandContext,
      agent,
      models,
      openFile: props.openSearchResult,
      switchEditorProject: async (path) => {
        await props.activateWorkspaceTab(path);
        return true;
      },
      runEditorScript: (key) => (commandState(`script.node.${key}`) === "enabled" ? executeRegistered(commandsById.get(`script.node.${key}`), props.commandContext) : "disabled"),
      switchBranch: async (name, remote) => {
        await branchSource?.switchTo({ name, remote, current: false });
      },
      setPalette: (palette: PaletteId) => props.saveAppearance({ ...props.appearance, palette }),
      setColorScheme: (colorScheme: ColorSchemePreference) => props.saveAppearance({ ...props.appearance, colorScheme }),
    })
      .then((outcome) => {
        if (pending.current !== token) return;
        if (outcome === "close") session.close();
        if (outcome === "failed") props.reportCommandError(new Error(`"${item.title.text}" is no longer available.`));
      })
      .catch((error: unknown) => {
        if (pending.current !== token) return;
        props.reportCommandError(error);
      })
      .finally(() => {
        if (pending.current === token) pending.current = null;
      });
  };

  const setRootQuery = (query: string): void => {
    if (session.page === "root" && parsePaletteRootQuery(query).kind === "files") {
      session.push("files");
      return;
    }
    session.setQuery(query);
  };

  if (session.page === "files") {
    if (props.quickOpen === null) return null;
    return (
      <QuickOpen
        {...props.quickOpen}
        canGoBack={session.canGoBack}
        groupLabel={props.workspaceRoot === null ? "Files" : folderLabel(props.workspaceRoot)}
        isOpen
        onBack={session.pop}
        onClose={session.close}
        onLocalShortcut={onLocalShortcut}
      />
    );
  }
  return (
    <CommandPalettePage
      canGoBack={session.canGoBack}
      copy={palettePageCopy(session.page, session.query.startsWith(">"))}
      generation={session.generation}
      groups={groups}
      onBack={session.pop}
      onExecute={execute}
      onLocalShortcut={onLocalShortcut}
      onQueryChange={setRootQuery}
      page={session.page}
      query={session.query}
    />
  );
}

function executeRegistered(command: Command | undefined, context: CommandContext) {
  if (command === undefined) return "missing" as const;
  void command.run(context);
  return "executed" as const;
}

function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}
```

Implementation notes:
- `matchesShortcut(event, shortcut, platform)` exists in `keymap.ts` (scout). Check its parameter type with `sed -n 1306,1330p src/domain/keymap.ts`. If it takes a DOM `KeyboardEvent`-like shape, `event.nativeEvent` is correct.
- Split `CommandPaletteHost.tsx` if it passes 400 lines: move `execute` and the ports into `usePaletteExecution.ts` in the same folder, returning `execute(item)`. Update the Ownership list in the commit message body if you split.
- `executeRegistered` + `runEditorScript` can reuse `commandsById`. The one-line ternary is a value select. `executeCommandAndReport` is not used because the host reports errors itself.
- `(id as never)` in `shortcutLabel` is a type-escape. Replace it with a proper narrow: `isKeymapCommandId(id) ? shortcutForCommand(props.keymap, id, platform) : ""`, where `isKeymapCommandId` is a new 3-line exported guard in `keymap.ts` (`return keymapCommands.some((command) => command.id === value);`). Add that guard in this step and a one-line test in `keymap.test.ts`.

- [ ] **Step 8: Write `WorkbenchCommandPalette.tsx`**

```ts
import { useMemo, useRef } from "react";
import type { useWorkbenchController } from "../../application/useWorkbenchController";
import type { FileSearchGateway } from "../../domain/workspace";
import type { CommandPaletteHostProps } from "./CommandPaletteHost";
import { editorBranchSource } from "./editorPaletteSources";

type Workbench = ReturnType<typeof useWorkbenchController>;

export function useCommandPaletteHostProps(
  workbench: Workbench,
  fileSearch: FileSearchGateway,
): CommandPaletteHostProps {
  const latest = useRef(workbench);
  latest.current = workbench;
  const root = workbench.workspaceRoot;
  const branchSource = useMemo(
    () =>
      root === null
        ? null
        : editorBranchSource({
            root,
            refreshGitBranches: () => latest.current.refreshGitBranches(),
            readLocal: () => latest.current.gitBranchEntries,
            readRemote: () => latest.current.gitRemoteBranchEntries,
            switchGitBranch: (name) => latest.current.switchGitBranch(name),
            checkoutRemoteBranch: (name) => latest.current.checkoutRemoteBranch(name),
          }),
    [root],
  );
  return {
    paletteOpen: workbench.paletteOpen,
    quickOpenOpen: workbench.quickOpenOpen,
    initialQuery: workbench.commandPaletteInitialQuery,
    setPaletteOpen: workbench.setPaletteOpen,
    setQuickOpenOpen: workbench.setQuickOpenOpen,
    commands: workbench.commands,
    commandContext: workbench.commandContext,
    reportCommandError: workbench.reportCommandError,
    keymap: workbench.appSettings.keymap,
    appearance: workbench.appSettings.appearance,
    saveAppearance: async (appearance) => {
      const current = latest.current;
      await current.saveWorkbenchSettings(
        { ...current.appSettings, appearance },
        current.workspaceSettings,
        current.workspaceTrust?.trusted ?? null,
      );
    },
    workspaceRoot: root,
    workspaceTabs: workbench.workspaceTabs,
    activateWorkspaceTab: workbench.activateWorkspaceTab,
    nodePackageScripts: workbench.nodePackageScripts.scripts,
    nodePackageScriptsTruncated: workbench.nodePackageScripts.truncated === true,
    branchSource,
    fileSearch,
    openSearchResult: (result) => openPaletteFile(latest.current, result),
    agentModeActive: workbench.agentModeActive,
    quickOpen: {
      isLoading: workbench.quickOpenLoading,
      isTruncated: workbench.quickOpenTruncated,
      onChangeQuery: workbench.setQuickOpenQuery,
      onOpen: (result, location) => void openPaletteFile(latest.current, result, location),
      onOpenCurrentFileLocation: workbench.openCurrentFileLocation,
      query: workbench.quickOpenQuery,
      request: workbench.quickOpenRequest,
      results: workbench.quickOpenResults,
    },
  };
}
```

`root === null ? null : editorBranchSource(...)` is a value select inside `useMemo`. Check `nodePackageScripts.truncated` and `.scripts` exist on the controller value with `grep -n "truncated" src/application/useNodePackageScriptWorkbench.ts | head`. The discovery spread provides `scripts` and `truncated`. If `truncated` is absent, pass `false` and drop the field from this mapper.

Because this mapper uses hooks, it cannot be called inline in App's JSX like the old `commandPaletteProps`. Wrap it in a thin component that App renders with the same line count:

```tsx
export function WorkbenchCommandPalette({ fileSearch, workbench }: { readonly workbench: Workbench; readonly fileSearch: FileSearchGateway }) {
  const props = useCommandPaletteHostProps(workbench, fileSearch);
  return <CommandPaletteHost {...props} />;
}
```

Every file the palette opens (the root "Files" group, `@`, ⌘P / Go to file, `path:line`) goes through one exported function in the same file. P7 adds its "reveal editor surface" hunk here (agreement with P7):

```ts
export async function openPaletteFile(
  workbench: Workbench,
  result: FileSearchResult,
  location?: QuickOpenLocation,
): Promise<void> {
  await workbench.openSearchResult(result, location);
}
```

(imports: `type FileSearchResult` from `../../domain/workspace`, `type QuickOpenLocation` from `../../domain/quickOpenQuery`). `onOpenCurrentFileLocation` (bare `:line` in the active file) does not open a new document and stays mapped to `workbench.openCurrentFileLocation`.

Both the hook above and this wrapper live in `src/components/commandPalette/WorkbenchCommandPalette.tsx` (add `import { CommandPaletteHost } from "./CommandPaletteHost";`).

- [ ] **Step 9: Wire the lazy host and App**

`src/components/appLazySurfaces.tsx`: point `LazyCommandPalette` to the new wrapper. Keep the existing `retryableLazy` call shape from lines 98-103:

```ts
export const LazyCommandPalette = retryableLazy(() =>
  import("./commandPalette/WorkbenchCommandPalette").then((module) => ({
    default: module.WorkbenchCommandPalette,
  })),
);
```

Delete `LazyQuickOpen`, and update `LazyCommandPaletteHost` to take `active` + `ComponentProps<typeof LazyCommandPalette>` (unchanged signature).

`src/App.tsx`:
- Delete the imports `commandPaletteProps`, `quickOpenProps` and `LazyQuickOpen`.
- Replace:

```tsx
      <LazyCommandPaletteHost active={workbench.paletteOpen} {...commandPaletteProps(workbench)} />
```

with

```tsx
      <LazyCommandPaletteHost
        active={workbench.paletteOpen || workbench.quickOpenOpen}
        fileSearch={workspaceGateways.fileSearch}
        workbench={workbench}
      />
```

- Delete the three lines `<LazySurfaceHost active={workbench.quickOpenOpen} label="Quick Open">`, `<LazyQuickOpen {...quickOpenProps(workbench)} />` and `</LazySurfaceHost>`.
- `workspaceGateways` is already destructured from `workbenchComposition` at `App.tsx:171-176`.

Then delete the replaced files:

```bash
git rm src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx src/components/CommandPalette.quickInput.test.tsx src/components/commandPaletteProps.ts src/components/quickOpenProps.ts
```

- [ ] **Step 10: Update the App integration tests**

In `src/App.quickOpen.integration.test.tsx` and `src/App.commandRouting.test.tsx`, replace selectors of the old surfaces:
- `section[aria-label="Quick open"]` / `.quick-open` -> `[role="dialog"][aria-label="Command palette"]`
- `.command-palette` -> `[role="dialog"][aria-label="Command palette"]`
- `.palette-command` -> `[role="option"]`
- `input[placeholder="Run command"]` -> `.cv-command-field input`

List every occurrence with `grep -n "quick-open\|command-palette\|palette-command\|Run command\|Quick open" src/App.quickOpen.integration.test.tsx src/App.commandRouting.test.tsx`. Test "routes a command prefix through the real controller into Command Palette" must now assert that the input value is `">"` + the typed text, and that the matching command row is present.

- [ ] **Step 11: Run the focused suites**

Run: `npx vitest run src/components/commandPalette src/application/commandPalette src/components/QuickOpen.test.tsx src/App.quickOpen.integration.test.tsx src/App.commandRouting.test.tsx src/application/useFloatingSurfaces.test.tsx`
Expected: PASS.

Run: `npm run check && npm run size:hotspots`
Expected: both exit 0. `App.tsx` tokens are at or below the baseline (net decrease). If `size:hotspots` reports `App.tsx` above the baseline, the hunk added tokens. Inline the three `LazyCommandPaletteHost` props onto the existing line shape rather than raising the baseline.

- [ ] **Step 12: Commit**

```bash
git add -A src/components/commandPalette src/application/commandPalette src/components/appLazySurfaces.tsx src/App.tsx src/App.quickOpen.integration.test.tsx src/App.commandRouting.test.tsx src/domain/keymap.ts src/domain/keymap.test.ts
git commit -m "feat(palette): mount the unified command palette for editor and agent mode"
```

`git add -A` is scoped to the listed paths only. Never run it on the repository root, because of the concurrent Codex session and dirty docs.

---

### Task 10: Agent provider, composer models and maximize command

**Files:**
- Create: `src/components/agentMode/useAgentCommandPaletteProvider.ts` (+ `useAgentCommandPaletteProvider.test.tsx`)
- Create: `src/components/agentMode/agentModelProviderState.ts`
- Create: `src/components/agentMode/useComposerPaletteBinding.ts` (+ `useComposerPaletteBinding.test.tsx`)
- Modify: `src/components/agentMode/AgentModeView.tsx` (one hunk after `useAgentViewCommands(viewCommands, commandHandlers);`)
- Modify: `src/components/agentMode/AgentLaunchControls.tsx` (extract `selectModel`, add the binding call)
- Modify: `src/components/agentMode/AgentModelPicker.tsx:490-540` (move the helpers out)
- Modify: `src/application/workbenchAgentCommands.ts` (+ `.test.ts`): append `panel.toggleMaximized`

**Interfaces:**
- Consumes:
  - `workbenchAgentPaletteProvider`, `workbenchComposerPaletteModels`, `AgentPaletteProvider`, `ComposerPaletteModels` (Task 5)
  - `AgentThreadView` (`src/application/agentThreadPorts.ts`), `AgentProjectDescriptor` (`src/domain/agentProject.ts`), `AgentThreadScriptsSurface` (`src/application/useAgentThreadScripts.ts`)
  - `agentThreadDisplayTitle` (`agentModePresentation.ts`), `agentModelRows`, `agentLaunchEffectiveModel`, `agentModelProviderName`, `type AgentModelChoice` (`agentLaunchPresentation.ts`)
  - P2's `layoutCommand` in `workbenchAgentCommands.ts`
- Produces:
  - `useAgentCommandPaletteProvider(options): void`
  - `useComposerPaletteBinding(options): void`
  - `providerIsEnabled`, `configuredProviderModel`, `configuredProviderVersion`, `providerAvailabilityReason`
  - registry command `panel.toggleMaximized`

- [ ] **Step 1: Write the failing tests**

`useAgentCommandPaletteProvider.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useAgentCommandPaletteProvider, type AgentCommandPaletteProviderOptions } from "./useAgentCommandPaletteProvider";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function view(id: string, title: string, rootKey: string, updated: number, lifecycle: "running" | "settled" | "archived" = "settled") {
  return {
    thread: { threadId: id, title, updatedAtEpochMs: updated, owner: { rootKey, ownerId: "o", repositoryRoot: "/r" } },
    lifecycle,
    repositoryLabel: "repo",
  } as never;
}

function options(overrides: Partial<AgentCommandPaletteProviderOptions> = {}): AgentCommandPaletteProviderOptions {
  return {
    threads: [view("t1", "Idempotency", "orders", 10), view("t2", "Old", "orders", 5, "archived")],
    projects: [{ rootKey: "orders", rootPath: "/u/orders-api", label: "orders-api" } as never],
    selectedThreadId: "t1",
    activeProjectKey: "orders",
    selectThread: vi.fn(),
    setProjectScope: vi.fn(() => true),
    newThread: vi.fn(),
    scripts: { entries: [{ key: "s", label: "test", detail: "vitest run", availability: { kind: "available" } }], truncated: false, runScript: vi.fn(() => true) },
    ...overrides,
  };
}

function Harness(props: AgentCommandPaletteProviderOptions) {
  useAgentCommandPaletteProvider(props);
  return null;
}

describe("useAgentCommandPaletteProvider", () => {
  it("publishes projects, non-archived threads and scripts while mounted", () => {
    ui = mountUi();
    ui.render(<Harness {...options()} />);
    const provider = workbenchAgentPaletteProvider.current();
    expect(provider?.projects).toEqual([{ key: "orders", label: "orders-api", path: "/u/orders-api", current: true }]);
    expect(provider?.threads.map((thread) => thread.id)).toEqual(["t1"]);
    expect(provider?.threads[0]).toMatchObject({ projectLabel: "orders-api", current: true, updatedAtMs: 10 });
    expect(provider?.scripts).toEqual([{ key: "s", name: "test", detail: "vitest run", runnable: true }]);
    ui.unmount();
    ui = null;
    expect(workbenchAgentPaletteProvider.current()).toBeNull();
  });

  it("fails closed for vanished threads and projects and starts a thread in a project", () => {
    const selectThread = vi.fn();
    const setProjectScope = vi.fn(() => true);
    const newThread = vi.fn();
    ui = mountUi();
    ui.render(<Harness {...options({ selectThread, setProjectScope, newThread })} />);
    const provider = workbenchAgentPaletteProvider.current();

    expect(provider?.openThread("missing")).toBe(false);
    expect(provider?.openThread("t2")).toBe(false);
    expect(provider?.openThread("t1")).toBe(true);
    expect(provider?.switchProject("missing")).toBe(false);
    expect(provider?.newThreadIn("orders")).toBe(true);
    expect(selectThread).toHaveBeenCalledWith("t1");
    expect(setProjectScope).toHaveBeenCalledWith("orders");
    expect(newThread).toHaveBeenCalledTimes(1);
  });

  it("reads the latest data at call time after a rerender", () => {
    const selectThread = vi.fn();
    ui = mountUi();
    ui.render(<Harness {...options({ selectThread })} />);
    ui.render(<Harness {...options({ selectThread, threads: [view("t9", "New", "orders", 20)] })} />);
    const provider = workbenchAgentPaletteProvider.current();
    expect(provider?.openThread("t1")).toBe(false);
    expect(provider?.openThread("t9")).toBe(true);
  });
});
```

`useComposerPaletteBinding.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { workbenchComposerPaletteModels } from "../../application/commandPalette/commandPaletteProvider";
import { BUNDLED_CLAUDE_MODEL_MANIFEST } from "../../domain/claudeModelCatalog";
import { defaultAgentComposerLaunch } from "./agentComposerLaunch";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { useComposerPaletteBinding, type ComposerPaletteBindingOptions } from "./useComposerPaletteBinding";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function Harness(props: ComposerPaletteBindingOptions) {
  useComposerPaletteBinding(props);
  return null;
}

describe("useComposerPaletteBinding", () => {
  it("publishes the current provider models with the current one marked and selects by key", () => {
    const selectModel = vi.fn();
    const launch = defaultAgentComposerLaunch("claudeCode");
    ui = mountUi();
    ui.render(
      <Harness catalog={BUNDLED_CLAUDE_MODEL_MANIFEST} disabled={false} launch={launch} providerEnabled={null} providerManagement={null} providerSwitchable={false} selectModel={selectModel} />,
    );
    const models = workbenchComposerPaletteModels.current();
    expect(models?.options.length).toBeGreaterThan(0);
    expect(models?.options.filter((option) => option.current)).toHaveLength(1);
    const target = models?.options.find((option) => !option.current);
    expect(target).toBeDefined();
    expect(models?.selectModel(target?.key ?? "")).toBe(true);
    expect(selectModel).toHaveBeenCalledTimes(1);
    expect(models?.selectModel("nope")).toBe(false);
  });

  it("does not publish while disabled", () => {
    ui = mountUi();
    ui.render(
      <Harness catalog={BUNDLED_CLAUDE_MODEL_MANIFEST} disabled launch={defaultAgentComposerLaunch("claudeCode")} providerEnabled={null} providerManagement={null} providerSwitchable={false} selectModel={vi.fn()} />,
    );
    expect(workbenchComposerPaletteModels.current()).toBeNull();
  });
});
```

Import paths (verified 2026-09-24): `BUNDLED_CLAUDE_MODEL_MANIFEST` and `ClaudeModelManifest` come from `src/domain/claudeModelCatalog.ts`, and `defaultAgentComposerLaunch` from `src/components/agentMode/agentComposerLaunch.ts`. `createDoubleShiftDetector(...)` in `src/domain/doubleShiftDetector.ts` may take arguments. Copy the call from the existing `useWorkbenchKeyboardShortcuts.test.tsx` harness.

Append to `src/application/workbenchAgentCommands.test.ts`, following P2's existing layout-command test for `agent.toggleSidebar`: assert that the command list contains `panel.toggleMaximized` and that running it dispatches `{ kind: "toggleMaximized" }` to the layout port. Copy P2's test body and change the id and the action kind.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/useAgentCommandPaletteProvider.test.tsx src/components/agentMode/useComposerPaletteBinding.test.tsx src/application/workbenchAgentCommands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `useAgentCommandPaletteProvider.ts`**

```ts
import { useEffect, useRef } from "react";
import {
  workbenchAgentPaletteProvider,
  type AgentPaletteProvider,
} from "../../application/commandPalette/commandPaletteProvider";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentThreadScriptsSurface } from "../../application/useAgentThreadScripts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentThreadDisplayTitle } from "./agentModePresentation";

export interface AgentCommandPaletteProviderOptions {
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedThreadId: string | null;
  readonly activeProjectKey: string | null;
  readonly scripts: Pick<AgentThreadScriptsSurface, "entries" | "truncated" | "runScript">;
  selectThread(threadId: string): void;
  setProjectScope(projectRootKey: string): boolean;
  newThread(): void;
}

export function useAgentCommandPaletteProvider(options: AgentCommandPaletteProviderOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const snapshot = paletteSnapshot(options, latest);

  useEffect(() => workbenchAgentPaletteProvider.publish(snapshot), [snapshot]);
}

function paletteSnapshot(
  options: AgentCommandPaletteProviderOptions,
  latest: { readonly current: AgentCommandPaletteProviderOptions },
): AgentPaletteProvider {
  const labels = new Map(options.projects.map((project) => [project.rootKey, project.label]));
  const live = () => latest.current.threads.filter((view) => view.lifecycle !== "archived");
  const knownProject = (key: string) => latest.current.projects.some((project) => project.rootKey === key);
  return {
    projects: options.projects.map((project) => ({
      key: project.rootKey,
      label: project.label,
      path: project.rootPath,
      current: project.rootKey === options.activeProjectKey,
    })),
    threads: options.threads
      .filter((view) => view.lifecycle !== "archived")
      .map((view) => ({
        id: view.thread.threadId,
        title: agentThreadDisplayTitle(view.thread),
        projectLabel: labels.get(view.thread.owner.rootKey) ?? view.repositoryLabel,
        updatedAtMs: view.thread.updatedAtEpochMs,
        current: view.thread.threadId === options.selectedThreadId,
      })),
    scripts: options.scripts.entries.map((entry) => ({
      key: entry.key,
      name: entry.label,
      detail: entry.detail,
      runnable: entry.availability.kind === "available",
    })),
    scriptsTruncated: options.scripts.truncated,
    activeProjectKey: options.activeProjectKey,
    openThread(threadId) {
      if (!live().some((view) => view.thread.threadId === threadId)) return false;
      latest.current.selectThread(threadId);
      return true;
    },
    switchProject(projectKey) {
      if (!knownProject(projectKey)) return false;
      return latest.current.setProjectScope(projectKey);
    },
    newThreadIn(projectKey) {
      if (!knownProject(projectKey)) return false;
      if (!latest.current.setProjectScope(projectKey)) return false;
      latest.current.newThread();
      return true;
    },
    runScript(scriptKey) {
      return latest.current.scripts.runScript(scriptKey);
    },
  };
}
```

Performance: `paletteSnapshot` runs on every AgentModeView render and republishes, which notifies `useSyncExternalStore` subscribers (the host only while it is open). Memoise the snapshot with `useMemo` over `[options.threads, options.projects, options.selectedThreadId, options.activeProjectKey, options.scripts.entries, options.scripts.truncated]`, so a publish happens only when the data changes:

```ts
  const snapshot = useMemo(
    () => paletteSnapshot(latest.current, latest),
    [options.threads, options.projects, options.selectedThreadId, options.activeProjectKey, options.scripts.entries, options.scripts.truncated],
  );
```

`react-hooks/exhaustive-deps` will flag `latest.current` usage. Pass `options` fields explicitly into a pure builder instead: `paletteSnapshot({threads, projects, selectedThreadId, activeProjectKey, scripts}, latest)`, with those destructured values as the deps. Run `npm run lint:exhaustive-deps` after this step. The budget must not grow.

- [ ] **Step 4: Wire it in `AgentModeView.tsx`** (the P2-reserved hunk)

Right after `useAgentViewCommands(viewCommands, commandHandlers);`:

```ts
  useAgentCommandPaletteProvider({
    threads: presentationThreads,
    projects,
    selectedThreadId,
    activeProjectKey: navigation.railScope?.projectRootKey ?? null,
    scripts,
    selectThread: navigation.selectThread,
    setProjectScope: navigation.setProjectScope,
    newThread: newProjectThread,
  });
```

Add the import `import { useAgentCommandPaletteProvider } from "./useAgentCommandPaletteProvider";`. `selectedThreadId`, `presentationThreads`, `projects`, `scripts`, `navigation` and `newProjectThread` are all in scope at that point (scouted lines 221-660). Check with `grep -n "const selectedThreadId\|const presentationThreads\|const newProjectThread" src/components/agentMode/AgentModeView.tsx`.

- [ ] **Step 5: Move the model helpers and write `useComposerPaletteBinding.ts`**

Create `agentModelProviderState.ts` by moving `providerIsEnabled`, `configuredProviderModel`, `configuredProviderVersion`, `providerAvailabilityReason` and its `unsupportedAdmissionDisposition` verbatim from `AgentModelPicker.tsx:490-540` (add `export` to the first four). In `AgentModelPicker.tsx`, delete those functions and add:

```ts
import {
  configuredProviderModel,
  configuredProviderVersion,
  providerAvailabilityReason,
  providerIsEnabled,
} from "./agentModelProviderState";
```

Also move the imports those helpers need (`AgentProviderManagementSurface`, `AgentCliKind`).

`useComposerPaletteBinding.ts`:

```ts
import { useEffect, useMemo, useRef } from "react";
import {
  workbenchComposerPaletteModels,
  type PaletteModelOption,
} from "../../application/commandPalette/commandPaletteProvider";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentLaunchEffectiveModel,
  agentModelProviderName,
  agentModelRows,
  type AgentModelChoice,
  type AgentModelRow,
} from "./agentLaunchPresentation";
import { configuredProviderModel, configuredProviderVersion, providerIsEnabled } from "./agentModelProviderState";

const PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];

export interface ComposerPaletteBindingOptions {
  readonly launch: AgentLaunchOptions;
  readonly catalog: Parameters<typeof agentModelRows>[3];
  readonly providerManagement: AgentProviderManagementSurface | null;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>> | null;
  readonly providerSwitchable: boolean;
  readonly disabled: boolean;
  selectModel(model: AgentModelChoice, provider: AgentCliKind): void;
}

export function useComposerPaletteBinding(options: ComposerPaletteBindingOptions): void {
  const { catalog, disabled, launch, providerEnabled, providerManagement, providerSwitchable } = options;
  const select = useRef(options.selectModel);
  select.current = options.selectModel;
  const rows = useMemo(
    () =>
      PROVIDERS.filter((provider) => providerIsEnabled(providerEnabled, provider))
        .filter((provider) => providerSwitchable || provider === launch.provider)
        .flatMap((provider) =>
          agentModelRows(
            provider,
            configuredProviderModel(providerManagement, provider),
            configuredProviderVersion(providerManagement, provider),
            catalog,
          ).filter((row) => row.isLegacy !== true),
        ),
    [catalog, launch.provider, providerEnabled, providerManagement, providerSwitchable],
  );
  const selected = agentLaunchEffectiveModel(launch, configuredProviderModel(providerManagement, launch.provider), catalog);

  useEffect(() => {
    if (disabled) return undefined;
    const byKey = new Map(rows.map((row) => [rowKey(row), row]));
    const options: readonly PaletteModelOption[] = rows.map((row) => ({
      key: rowKey(row),
      group: agentModelProviderName(row.provider),
      label: row.label,
      current: row.provider === launch.provider && row.value === selected,
    }));
    return workbenchComposerPaletteModels.publish({
      options,
      selectModel(key) {
        const row = byKey.get(key);
        if (row === undefined) return false;
        select.current(row.value, row.provider);
        return true;
      },
    });
  }, [disabled, launch.provider, rows, selected]);
}

function rowKey(row: AgentModelRow): string {
  return `${row.provider}:${String(row.value)}`;
}
```

Prefer `import type { ClaudeModelManifest } from "../../domain/claudeModelCatalog";` and `readonly catalog: ClaudeModelManifest;` over `Parameters<typeof agentModelRows>[3]`.

- [ ] **Step 6: Wire the binding in `AgentLaunchControls.tsx`** (the P9-reserved hunk)

After `const configuredModel = configuredModelFor(effectiveLaunch.provider);`, add:

```ts
  const selectModel = (model: AgentModelChoice, provider: AgentCliKind = effectiveLaunch.provider) =>
    onLaunchChange(
      agentLaunchWithModel(
        provider === effectiveLaunch.provider ? effectiveLaunch : defaultAgentComposerLaunch(provider),
        model,
        configuredModelFor(provider),
        catalog,
      ),
    );
  useComposerPaletteBinding({
    launch: effectiveLaunch,
    catalog,
    providerManagement,
    providerEnabled,
    providerSwitchable,
    disabled,
    selectModel,
  });
```

Replace the inline `onSelect={(model, provider = effectiveLaunch.provider) => onLaunchChange(...)}` with `onSelect={selectModel}`. Import `useComposerPaletteBinding` and `type AgentModelChoice` if not already imported.

- [ ] **Step 7: Append the maximize command in `workbenchAgentCommands.ts`**

After P2's `layoutCommand("agent.toggleSidebar", …)` array element:

```ts
    layoutCommand("panel.toggleMaximized", "Toggle Maximized Panel", { kind: "toggleMaximized" }),
```

This uses P2's helper signature exactly as P2 defines it. Check with `grep -n "function layoutCommand" -A12 src/application/workbenchAgentCommands.ts`. This dispatches the plain `toggleMaximized` layout action, which P2 confirmed is correct for the docked case. The narrow-viewport responsive restore stays on the header button (Open Question 3).

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/components/agentMode/useAgentCommandPaletteProvider.test.tsx src/components/agentMode/useComposerPaletteBinding.test.tsx src/components/agentMode/AgentModelPicker.test.tsx src/components/agentMode/AgentModeView.test.tsx src/application/workbenchAgentCommands.test.ts`
Expected: PASS. Then run `npm run lint:exhaustive-deps` (expected: budget unchanged) and `npm run check`.

- [ ] **Step 9: Commit**

```bash
git add src/components/agentMode/useAgentCommandPaletteProvider.ts src/components/agentMode/useAgentCommandPaletteProvider.test.tsx src/components/agentMode/useComposerPaletteBinding.ts src/components/agentMode/useComposerPaletteBinding.test.tsx src/components/agentMode/agentModelProviderState.ts src/components/agentMode/AgentModelPicker.tsx src/components/agentMode/AgentLaunchControls.tsx src/components/agentMode/AgentModeView.tsx src/application/workbenchAgentCommands.ts src/application/workbenchAgentCommands.test.ts
git commit -m "feat(palette): publish agent threads, projects, scripts and models to the palette"
```

---

### Task 11: Wrap-up - gates, independent review, QA build, Computer Use QA, commit

**Files:** none new. This task verifies and fixes only.

- [ ] **Step 1: Run all repository gates with real exit codes (no pipes that mask failures)**

```bash
cd /Users/matusmockor/Developer/editor
set -o pipefail
npm run check
npm run lint -- --max-warnings 0
npm run lint:exhaustive-deps
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
cd src-tauri
cargo check --all-targets
cargo test --lib
cargo test --tests
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cd ..
git diff --check
```

Expected: every command exits 0. Run the Node watch tests sequentially. If port 9229 is held by an orphaned node process from a previous run, free it before rerunning (`lsof -ti :9229 | xargs kill`). If `format:check:changed` flags a P5 file, run `npx prettier --write <that file>` only. Never format a directory.

- [ ] **Step 2: Performance evidence**

Measure the palette's per-keystroke work before declaring done:
- In a scratch Vitest bench (not committed) under `/tmp`, call `buildPaletteGroups` with 500 threads, 50 projects, 400 scripts, 300 registry commands and 200 branches, for queries `""`, `"o"`, `"orders api"` and `">"`. Record the median time.
- Expected: < 4 ms per call on this machine. Record the numbers in the commit message body.
- If a call exceeds that, cap the thread search set (for example the 500 most recent) and state the cap in the presenter as a constant.

- [ ] **Step 3: Independent read-only review (Opus 5.5)**

Dispatch a separate read-only reviewer agent (model opus) with this prompt:

> Review the P5 command palette changes on `main` (commits from "feat(ui): add command list foundation primitives" to HEAD) against `docs/superpowers/plans/2026-09-24-redesign-p5-command-palette.md` and spec §3.1.2/§3.1.7/§3.3 F10. Read-only: no edits, no git mutations. Check:
> (1) ⌘K / ⌘/ focus scoping versus Monaco chords and comment toggle, and conflict detection;
> (2) workspace A→B→A and stale async results (root files, branches, providers), fail-closed selection;
> (3) no capability lost from the old CommandPalette/QuickOpen (`>`, `@`, `#`, path:line, IME, focus reclaim, pending guard, disabled/rejected commands);
> (4) layering: domain has no React/IO imports, application does not import components, and tokens only in CSS;
> (5) hook correctness (effect cleanup, deps, no stale closures), accessibility (combobox/listbox/aria-activedescendant, focus restore), and bounded work per keystroke.
> Report P0/P1/P2 findings with file:line and a concrete fix.

Fix every valid P0/P1 finding, rerun the affected tests and then the gates from Step 1.

- [ ] **Step 4: QA build and launch**

```bash
cd /Users/matusmockor/Developer/editor
npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'
open "src-tauri/target/debug/bundle/macos/Codevo QA.app"
osascript -e 'tell application "Codevo QA" to activate'
```

Expected: "Codevo QA" launches. Leave "Codevo Editor" untouched.

- [ ] **Step 5: Codex Computer Use QA**

Run the orchestrator with this prompt (write it to `/tmp/p5-qa-prompt.md` first):

```bash
python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py --prompt-file /tmp/p5-qa-prompt.md
```

`/tmp/p5-qa-prompt.md`:

> ATTACH ONLY to the already-running app "Codevo QA" (bundle id dev.mockor.editor.qa). Never launch, quit or restart any app. Never touch or focus "Codevo Editor". Do not edit code. Before EVERY screenshot, run `osascript -e 'tell application "Codevo QA" to activate'` so the QA window is frontmost. Compare every state with `docs/redesign/v3-command-palette.html` (open it in a browser only if you need a reference; states Open, Typing, Files, No results, Shortcuts).
> Do these steps in palette "Graphite · Teal" Dark, then Light (switch via the palette itself), then once in "Zinc · Orange" Dark:
> 1. Focus the agent composer, press ⌘K. Expect a centered 576px glass dialog, input "Search commands, projects, threads, and files…", "Actions" group then "Recent Threads" with ages on the right, footer "↑ ↓ Navigate · Esc Close". Screenshot.
> 2. Type "ord". Expect groups among Projects/Threads/Scripts/Files/Branches with bold/marked matches. Screenshot.
> 3. Clear, type "@". Expect the files page with a Back arrow, placeholder "Search files…", group labelled with the project name. Type "idm" and screenshot. Press Backspace twice; expect the root again.
> 4. Press Esc. Press ⌘P; expect the files page without a Back arrow. Press ⌘P again; expect it to close.
> 5. Press ⌘/ with focus outside the editor; expect the Keyboard shortcuts page grouped Workbench, Agent, … with ⌘ glyphs. Screenshot. Type "toggle"; expect filtered rows.
> 6. Open ⌘K → "Change theme" → pick "Zinc · Orange"; expect the whole app recolours and the palette closes. Open ⌘K → "Change appearance" → "Light". Screenshot.
> 7. ⌘K → "Switch project" and "New thread in…": expect project rows with monogram, the current one checked, and "Add project…" last on Switch project.
> 8. ⌘K → "Change model": expect provider groups with the current model checked; pick another and confirm the composer model label changed.
> 9. ⌘K → "Switch branch": expect the branch list with the current branch checked, or the message "Branch switching for this project is not available here."
> 10. Type "kubectl rollout" at the root; expect "No matching commands, projects, threads, or files." Screenshot.
> 11. Open a file in the editor (right panel), click into the editor text, press ⌘/ and confirm it toggles a line comment and the palette does NOT open. Press ⌘K then ⌘\ quickly; confirm the editor splits down and the palette does NOT open.
> Report per step: worked/failed, what differed from the mockup (sizes, spacing, copy, contrast), and attach the screenshots.

Fix every failed step that is in P5 scope, rebuild the QA app, and rerun only the failed steps. Report steps that depend on other phases (for example the shell or sidebar) as residual gaps, not P5 failures.

- [ ] **Step 6: Final commit on main (no push, no tag, no AI attribution)**

Stage only the files listed in the Ownership section that changed since the last task commit (review fixes). Check `git status --short` first: it must not include files owned by concurrently running phases, the dirty spec, or `docs/redesign/PLANNER-BRIEF.md`.

```bash
git add <exact P5 paths changed by review/QA fixes>
git commit -m "fix(palette): address review and QA findings for the command palette"
```

Do not `git push`. Do not create a tag. Do not add any `Co-Authored-By` or AI attribution line.

---

## Self-review

1. **Spec coverage:**
   - ⌘K (Task 4/5/9), ⌘P files (Task 8/9), ⌘/ cheatsheet (Task 4/5/6)
   - sub-pages new thread in / switch project / go to file / run script / switch branch / change model / theme / appearance / shortcuts (Task 6 builders, Task 9 host, Task 10 providers)
   - actions + recent threads (Task 5/6)
   - fuzzy projects/threads/files/branches/scripts with match highlight (Tasks 2, 6, 7)
   - `@` file prefix (Task 3 parser, Task 9 host)
   - command list base component (Task 1)
   - editor mode and agent mode share one palette (Task 9 mount, Task 10 providers)
   - registry reuse (Task 5 actions + `>` mode)
   - no capability lost (Tasks 7/8/9 port tests)
   - tokens only (Tasks 1/7)
   - hotspots flat (Task 9 Step 11)
   - QA (Task 11)
2. **Placeholders:** none. Where a live file must be read to match an existing helper (P2's `layoutCommand`, exact test harness names, glyph order), the step names the exact command to read it, and the exact code to write around it.
3. **Type consistency:**
   - `PaletteItem`, `PaletteIntent` and `PaletteGroup` from `paletteItem.ts` are used everywhere.
   - `PaletteBranchesView` moves to `commandPaletteProvider.ts` in Task 9 Step 5, and Task 6 re-exports it.
   - `AgentPaletteProvider.activeProjectKey` is used by the host branch gating and by the provider hook.
   - `QuickOpen` gets its new props in Task 8 and receives them from the host in Task 9.
   - `WorkbenchCommandPalette.tsx` holds the props hook and the lazy wrapper (Task 9 Step 8).
4. **Review Focus:** all five lines have owning tests (Tasks 2, 4, 7, 8, 9, 10).

## Open questions for the owner

1. **Cmd+K chords outside the editor.** With this plan, `Cmd+K Cmd+\`, `Cmd+K Cmd+ArrowRight/Left`, `Cmd+K Cmd+Shift+ArrowRight/Left` and `Cmd+K W` work only while the caret is in the editor text. Elsewhere ⌘K opens the palette instantly. The alternative is to keep the chords global, which makes ⌘K open the palette only after the 2 s chord timeout outside the editor. Recommended: this plan's scoping.
2. **Sidebar "Search ⌘K" button** from the palette mockup vs P4's inline sidebar search (spec §3.1.5). Recommended: keep P4's inline search. The palette opens via ⌘K only.
3. **Maximize from the palette** uses the plain `toggleMaximized` layout action, which is correct in the normal docked layout. In the narrow responsive layout, the header button's `toggleResponsivePanel` behavior is not replicated. Should the palette command route through the responsive-aware handler (needs a P2 bridge hook)?
4. **Agent-mode branch source** is not bound in P5 or P9 (P10 follow-up). Until then, "Switch branch" in agent mode works only when the agent project is the open workspace.

## Lead decisions on open questions (2026-09-24)

1. Accept the focus scoping: ⌘K chords fire only inside editor text; outside it ⌘K opens the palette instantly.
2. Keep P4's inline sidebar search; the sidebar does not get a "Search ⌘K" palette trigger.
3. "Toggle maximized panel" from the palette must reuse the same narrow-window handling as the header
   button (share one helper) - add this to Task 10 with a test.
4. Accept: agent-mode "Switch branch" only works when the agent project is the open workspace until the
   P10 follow-up binds the agent branch source; the palette must say so truthfully instead of failing silently.
