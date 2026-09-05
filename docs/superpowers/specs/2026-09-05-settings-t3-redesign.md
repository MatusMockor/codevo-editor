# Settings Redesign: "D · T3 Code" Full-Page Route

Date: 2026-09-05

## Goal

Replace the modal `SettingsDialog` with a full-page settings surface that behaves like
T3 Code 0.0.34: `⌘,` opens Settings in the main window, the left sidebar swaps to a
section list with a Search row (`/`), the content is one readable column (max 896px)
of flat rows (title 14px medium, description 13px muted, control right), and `Esc`
returns to the previous editor/agent view. Draft autosave semantics, workspace-owner
rekeying, and provider persistence authority are preserved. Visuals use new
`--settings-*` tokens derived from Codevo `--color-*` tokens so all ten themes work.

## References

- Approved mock: scratchpad `design-settings.html`, section `#dir-d` (rows, provider
  card states, search-on-save tile, expanded provider, keybindings grid, legend).
- T3 live window: scratchpad `t3-window.png`; T3 bundle `index-r4LjKDJR.js` confirms:
  search index entries `{id,title,to,targetId,keywords?}`, search input is
  `role="combobox"` with `aria-activedescendant`, target handling =
  `scrollIntoView({block:"center", behavior: reducedMotion ? "auto" : "smooth"})` +
  `focus({preventScroll:true})` + pulse class removed on blur, page scroller marked
  `data-settings-page-scroll`.
- Prior specs: `2026-08-27-agent-providers-design.md` (persistence authority),
  `2026-08-25-agent-workbench-chrome-design.md` (shell frame slots, hidden editor).

## Current state inventory (verified)

Shell and route state
- `src/App.tsx:577-579` `openSettings` -> `runCommand("workbench.openSettings")`;
  `:1076-1086` `WorkbenchNavigationChrome`; `:1089-1195` `WorkbenchShellFrame`
  slots (`agent`, `bottom`, `chrome`, `editor`); `:1479-1485` `WorkbenchAppUpdaterHost`
  mounted outside the frame. Baseline 1490 lines / 7355 tokens (exact, no headroom).
- `src/components/WorkbenchNavigationChrome.tsx:32` returns null in agent mode;
  `:36-50` renders `WorkbenchActivityBar` (gear at `WorkbenchActivityBar.tsx:40-45`)
  + `WorkbenchSidebar` (`.sidebar`, `App.css:971`).
- `src/components/WorkbenchShellFrame.tsx:20-27` props; `:72-84` editor slot is kept
  mounted and hidden via `hidden` (Monaco single-mount invariant).
  `workbenchShellFrame.css:99-101` hides `[data-slot][hidden]`.
- `src/components/workbenchShellPlacement.ts:32-43,94` `editorHidden` derivation.
- `App.css:730` app-shell grid `46px | sidebar | 1fr`; `:745-747`
  `.app-shell--agent-mode` single column.
- `src/application/useWorkbenchController.ts:441-442` `settingsOpen`,
  `settingsInitialSection`; `:1483` closed when symbol panels open; `:2378-2382`
  passed to `useFloatingSurfaces`; `:2801-2819` exposed. Baseline 2848/9934.
- `src/application/useFloatingSurfaces.ts:121-134` `openSettingsSection(section)`
  closes competing overlays; `:215-218` Escape closes settings after
  searchEverywhere/references/hierarchies/chooser/LS setup.
- `src/application/useWorkbenchKeyboardShortcuts.ts:163-173` global Escape ->
  `closeFloatingSurface()`.
- `src/application/useWorkbenchAgents.ts:222-225` opens section "agents".
- `src/application/workbenchAppearanceCommands.ts:74-79` command; `src/domain/keymap.ts:671-675`
  default `Cmd+,`; `src/domain/settings.ts:89-90` `SettingsSection` union
  (general|keymap|php|git|index|snippets|appearance|agents).
- `src/components/WorkbenchAppUpdaterHost.tsx:31-46` lazy-mounts the settings host
  only while `settingsOpen || nodeLaunchConfigurationsOpen`;
  `appLazySurfaces.tsx:113-121` lazy import.
- `src/components/WorkbenchSettingsDialogHost.tsx:15-38` `WorkbenchSettingsModel`;
  `:49-93` wires `SettingsDialog` + `NodeLaunchConfigurationsDialog`.

Dialog and sections
- `src/components/SettingsDialog.tsx` (1246 lines, baseline 1246/5611): `:66-103`
  draft state + reset on open; `:128-167` backdrop, `.settings-dialog`, `.settings-nav`
  tab buttons; `:169-560` section switch (general 169, keymap 400, php 415, git 454,
  index 475, snippets 508, agents 520, appearance 536); `:637-1113` `GeneralSettings`
  incl. 21 JS/TS rows and ESLint/Prettier rows; `:1115-1131` `statusBarItems`;
  `:1146-1246` `GitMappingsSettings`.
- `settingsDialogModel.ts:4-15` section list/order; `settingsDialogTypes.ts:8-31`
  props; `settingsDialogDraftPersistence.ts:16-44` autosave on every change;
  `settingsSectionPresentation.ts`, `SettingsSectionHeader.tsx` (trivial).
- `GeneralAppUpdateSettings.tsx:8-70` + presentation `:73-110`;
  `AppearanceSettingsSection.tsx:58-126`; `IndexSettingsSection.tsx:28-96`;
  `PhpSettingsSection.tsx:31-125`; `SnippetsSettingsSection.tsx:33-117`.
- `KeymapSettingsPanel.tsx:40-42` filter/pendingChord state; `:96-106` filter box;
  `:112-141` categories + conflicts (`findKeymapSequenceConflicts`); `:142-250`
  per-command field, capture, reset. Keymap API: `keymap.ts:1197-1226`
  `findKeymapConflicts`, `:1257` `shortcutFromKeyboardEvent`, `:1384` `parseShortcut`;
  3 commands are `rebindable: false`; there is no when-clause model.
- Agents: `AgentSettingsDialogSection.tsx:10-24` controls props, `:38-72` provider
  intent persistence (kept); `AgentsSettingsPanel.tsx:51-145` two cards + section;
  `AgentsSettingsSection.tsx:94-250` rows (Agent CLI, appearance, favorites, max
  concurrent, isolation); `AgentProviderSettingsCard.tsx:86-232` markup, `:457-660`
  label/relative-age/failure presentation helpers (kept, moved).
  `agentMode/AgentProviderGlyph.tsx:16-40` glyph; `useAgentProviderManagement.ts:87-121`
  view + surface; `domain/agentProviderHealth.ts:63-78` health union;
  `domain/appUpdater.ts:31-50` updater union.
- CSS: `App.css:1-3` `@import` precedent; `:4800` `.palette-backdrop` (shared,
  stays); `:6718-7171` `.settings-*`, `.keymap-*`, `.snippet-editor` block;
  `:7988-8103` `.agent-provider-*` block. `agentMode.css:10-95` `--agent-*` tokens
  derived from `--color-*`; `:2987-2989` light-theme selector list
  (`light`, `catppuccinLatte`, `oneLight`).
- Search helpers: `src/domain/matchHighlight.ts:6,42` `splitQueryHighlight`,
  `matchesQuery`.
- Tests to port: `SettingsDialog.test.tsx` (44 cases), `WorkbenchSettingsDialogHost.test.tsx`
  (3), `AgentProviderSettingsCard.test.tsx` (23), `AgentsSettingsPanel.test.tsx` (6),
  `AgentSettingsDialogSection.test.tsx` (3), `AgentsSettingsSection.test.tsx` (10),
  `GeneralAppUpdateSettings.test.tsx` (3), `App.commandRouting.test.tsx:510,525`.

## Target design

### Surface hosting (decision: full-page workbench surface, not a tab)

A tab would be workspace-scoped, lost on workspace switch, and would fight editor
groups; T3 semantics are a window-level route. Hosting:

- `WorkbenchShellFrame` gains a `settings: ReactNode` slot and a
  `surface: "workbench" | "settings"` prop. When `settings`, the frame stamps
  `data-surface="settings"`, renders `<div data-slot="settings">` and sets `hidden`
  on `agent`, `editor`, `bottom` and `chrome` slots. Editor stays mounted (same
  mechanism as `editorHidden`, `WorkbenchShellFrame.tsx:72-84`).
- Editor mode: `.app-shell--settings` collapses the sidebar column
  (`grid-template-columns: 46px minmax(0,1fr)`); `WorkbenchNavigationChrome`
  renders only the activity bar (gear `aria-pressed`). Agent mode is already single
  column. The settings screen owns its two-column layout in both modes.
- Route state stays `settingsOpen` / `settingsInitialSection` in the controller
  (no controller edits). `settingsOpen` now means "settings surface shown".
- App.tsx must not grow: extract `LanguageServerSetup` + `WorkbenchAppUpdaterHost`
  JSX into `WorkbenchOverlayDialogsHost.tsx` (net -8 lines) and add the
  `surface`/`settings` props (+5). Settings screen is lazy via
  `LazyWorkbenchSettingsHost` inside `LazySurfaceHost active={settingsOpen}`; the
  Node launch dialog keeps living in the settings host (fixed-position).
- Workspace rekey: the screen is keyed by `workspaceIdentityDescriptor.workspaceId`
  so drafts reset on A -> B -> A (preserves current host test).

### Section registry (single source for nav, search index, content)

`src/components/settings/settingsRegistry.ts`:

```ts
type SettingsSectionId = "general" | "appearance" | "agents" | "keymap" | "index" | "php" | "snippets";
interface SettingsSectionDescriptor { id; label; icon: LucideIcon; description; }
interface SettingsRowDescriptor {
  readonly id: SettingsRowId;           // "general.formatOnSave" (as const union)
  readonly section: SettingsSectionId;
  readonly title: string; readonly description: string | null;
  readonly keywords: ReadonlyArray<string>;
  readonly availability: "always" | "workspace";
}
```

Nav order: General, Appearance, Agents, Keybindings, Index & languages, PHP,
Snippets. The `git` (Directory Mappings) section merges into Index & languages; the
domain `SettingsSection` union keeps `"git"` as a deep-link alias resolved by
`resolveSettingsRoute(section) -> { section: "index", row: "index.gitDirectoryMappings" }`.
`SettingsRow` reads title/description from the registry by id, so content, nav and
search cannot drift. A parity test mounts every page and asserts the set of
`data-settings-row` ids equals the registry for that section (and vice versa).
Keybinding commands are not registry rows; the Keybindings page has its own filter.

### Search behaviour

- Sidebar first row is `SettingsSearch` (`role="combobox"`, `aria-autocomplete="list"`,
  `aria-controls`, `aria-activedescendant`), placeholder "Search", trailing kbd `/`.
- `/` focuses the search when settings is open and the active element is not
  editable/Monaco. Typing filters registry rows with `matchesQuery` over
  title + description + keywords, ranked title-prefix > title > description, capped
  at 50 results, grouped label "Section" under each title (`SettingsSearchResults`,
  `role="listbox"`). Availability `workspace` rows are hidden without a workspace.
- Arrow keys move, Enter activates: sets section and `targetRowId`; Esc with a query
  clears it (first press); Esc with empty query closes settings.
- `SettingsTargetContext { targetRowId, onTargetHandled }`: the matching `SettingsRow`
  scrolls to center (reduced-motion aware), focuses with `preventScroll`, adds
  `is-target` (pulse) and removes it on blur or after 1600ms, then reports handled.

### Row and section primitives (`src/components/settings/primitives/`)

| Primitive | Class | Notes |
|---|---|---|
| `SettingsSectionHeading` | `.settings-section__head` | h2 18px/600, `-0.025em`; right slot for micro actions |
| `SettingsRow` | `.settings-row` | grid `minmax(0,1fr) minmax(10rem,auto)`, gap 32, padding 12/16, radius 14; no borders; `data-settings-row` |
| `SettingsSwitch` | `.settings-switch` | `<button role="switch" aria-checked>` 30x18 |
| `SettingsSelect` | `.settings-select` | native select, 28px, widths 160/224 |
| `SettingsNumberField` | `.settings-numfield` | −/+ stepper, tabular value, unit label, clamps |
| `SettingsTextField` / `SettingsTextArea` | `.settings-input` | mono variant, placeholder for "Auto" |
| `SettingsSegmented` | `.settings-segmented` | radio group |
| `SettingsChipGroup` | `.settings-chips` | multi-toggle chips (status bar, on-save actions) |
| `SettingsButton` | `.settings-btn--{primary,outline,ghost,ghostMuted}` sizes `micro/xsq/compact/sm` | |
| `SettingsKbd` | `.settings-kbd` | |
| `SettingsPopover` | `.settings-popover` | anchored, Esc/outside-click close, focus trap; reuse `agentPopover.ts` anchoring |

Each primitive is a label-associated control (`useId`), keyboard reachable, and
under 120 lines. Sections compose only these; `settings-field`/`settings-toggle`
classes are deleted.

### Pages

- General: Application updates (version rows, Check now, Download/Install by
  updater state); Workspace (root readout, Mode segmented, Trusted, Reveal active
  file, Background IDE engines, Terminal shell integration); Editing (Auto save,
  Format on save, Format on paste, Optimize imports, Indentation); Status bar chips.
- Appearance: Theme (select + swatches), Agent appearance segmented, Editor font
  (family + Refresh list, size stepper, ligatures, minimap, word wrap).
- Agents: heading actions "Checked N ago" (oldest of both providers via existing
  `providerCheckedLabel`) + refresh micro. Rows: Health check interval and Check CLI
  updates apply to both providers (`sharedProviderPreference()` shows the Claude
  value; when providers differ the description notes it until the next change).
  Provider cards (below). Section "Defaults for new threads": Default provider
  (enabled providers only), Favorite models (count + Clear), Max concurrent tasks
  stepper, Workspace isolation policy select.
- Keybindings, Index & languages (Index limits, JS/TS rows, ESLint, Prettier, Git
  directory mappings), PHP (engine, level, paths, analysis, detected readouts),
  Snippets (list rows + inline editor) keep today's fields, re-rendered as rows.

### Provider card behaviour

`AgentProviderCard` head: `AgentProviderGlyph` with status dot (ready+signedIn:
success; ready+signedOut/unknown: warning; notConfigured/failed: danger; checking:
spinner; disabled: dimmed), name, version in mono (`installedVersion`), update arrow
(`.settings-btn--micro.is-update`, bounce animation, hidden under reduced motion)
only when `update.kind === "available"`, reset micro when path/preference differ
from defaults. Description line: "Authenticated as {label} · {plan}" / "Not
authenticated - Sign in via the CLI to authenticate again." / "Not found - CLI not
detected on PATH." / failure labels from existing helpers. Side: Codevo `Sign in`
outline button (only when signedOut and `providerSignIn` available; spinner while
starting/running; blocked reason as title), chevron (`aria-expanded`), enable switch.
Expandable details: Executable path (mono input, placeholder from PATH), discovery
status, policy status, per-provider interval override readout, and the install hint
with copy for notFound. Update arrow opens `AgentProviderUpdatePopover`: title,
"install vX", `Update now` primary (calls `management.update`; disabled with reason
when `liveTurnCount > 0`, installer unknown, or checks disabled), "or, update
manually using" + command (`npm install -g <pkg>@latest` / `brew upgrade --cask
<cask>` / `claude update` / `codex update`) with copy, `Skip this version` ghost
(`dismissUpdate`). Update progress and result reuse `ProviderUpdateResult` moved to
`agentProviderCardPresentation.ts`. No "Add provider" action: the provider set is
closed.

### Keybindings table

Real `<table>` with columns Command (label + muted id) / Keybinding / When / Status.
Keybinding cell: kbd chips from `parseShortcut` (⌘ ⇧ ⌥ ⌃, "then" between chord
strokes); hover reveals `EDIT`; click enters recording (`.settings-input--rec`,
"Press shortcut", `readOnly`, captures via `shortcutFromKeyboardEvent`, two-stroke
via existing pending chord logic, Save/Cancel, Esc cancels and stops propagation so
the surface does not close). When: read-only "Always" (muted) or "Reserved" for
`rebindable: false`; Codevo has no when-clause dispatch, so the column is static.
Status: warning triangle listing exact/prefix conflicts (title + `role="img"`),
"Modified" dot when current != default, `⋯` menu with Reset to default / Unbind.
Header: "N bindings", filter input (label, id, category, current/default shortcut).
Rows grouped by category with sticky category rows; no virtualization needed (< 200).

### CSS strategy

New `src/components/settings/settings.css`, `@import`ed from `App.css:1-3`.
Tokens on `.settings-screen`, derived from app tokens so every theme resolves:
`--settings-bg: var(--color-app)`, `--settings-fg: var(--color-text-strong)`,
`--settings-muted-fg: var(--color-text-muted)`, `--settings-border: var(--color-border)`,
`--settings-input: var(--color-border-strong)`, `--settings-primary: var(--color-accent)`,
`--settings-primary-fg: var(--color-app)` (light themes: `#fff`), `--settings-success/
warning/danger: var(--color-success/--color-warning/--color-error)`,
`--settings-sidebar: var(--color-sidebar)`, `--settings-row-hover: var(--color-hover)`,
`--settings-row-selected: var(--color-hover-strong)`, `--settings-selected-ring:
transparent` (light: `var(--settings-border)`), `--settings-popover: var(--color-modal)`,
radii 4/6/8/10/14, `--settings-mono: var(--agent-mono)`, shadows. Light overrides use
the same selector list as `agentMode.css:2987`. Agent chrome tokens are reused only
for `--agent-mono`, `--agent-focus-ring` and provider glyph colours. Legacy blocks
`App.css:6718-7171` and `:7988-8103` are deleted when
`grep -rn "settings-field\|settings-toggle\|settings-dialog\|agent-provider-card" src`
is empty. Layout: sidebar column `minmax(180px, var(--sidebar-width, 300px))`, page
`max-width: 896px`, `gap: 48px` between sections; below 720px the row grid collapses
to one column (control under text).

### Keyboard and accessibility

`⌘,` opens (no toggle); `Esc` order: popover/menu -> recording -> search query ->
close settings (via existing `closeFloatingSurface`, `useFloatingSurfaces.ts:215`).
On open focus the page `h1` ("Settings") with `tabIndex=-1`; on close restore focus to
the previously active element if still connected. Sidebar nav is `role="tablist"`
with arrow-key movement; page is `role="tabpanel"` labelled by the section. All
controls have visible focus rings (`--agent-focus-ring`). `prefers-reduced-motion`
disables pulse/bounce/smooth scroll.

### State persistence

`settingsDialogDraftPersistence` is renamed `settingsDraftPersistence.ts` unchanged:
every change publishes the draft and calls `onSave` immediately; provider-affecting
changes continue through `persistProviderIntent` (moved to
`agentProviderSettingsPersistence.ts`). No Save button. Drafts reset when the host
remounts (close/open or workspace rekey).

### Hotspot-safe decomposition

`SettingsDialog.tsx` is deleted (baseline entry removed). No new file above 400
lines; `App.tsx` and `useWorkbenchController.ts` must report equal or reduced sizes.

## Contracts (S0)

```ts
// src/components/settings/settingsRegistry.ts
export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSectionDescriptor>;
export const SETTINGS_ROWS: ReadonlyArray<SettingsRowDescriptor>;
export type SettingsRowId = (typeof SETTINGS_ROWS)[number]["id"];
export function settingsRowsForSection(id: SettingsSectionId): ReadonlyArray<SettingsRowDescriptor>;
export function resolveSettingsRoute(section: SettingsSection): { section: SettingsSectionId; row: SettingsRowId | null };
// src/components/settings/settingsSearch.ts (pure)
export function searchSettingsRows(query: string, rows, hasWorkspace: boolean, limit = 50): ReadonlyArray<SettingsSearchHit>;
// src/components/settings/settingsTargetContext.ts
export const SettingsTargetContext: Context<{ targetRowId: SettingsRowId | null; onTargetHandled(): void }>;
// src/components/settings/settingsPageProps.ts
export interface SettingsPageProps { draft: SettingsDraft; actions: SettingsDraftActions; env: SettingsEnvironment; }
// WorkbenchShellFrame: surface?: "workbench" | "settings"; settings?: ReactNode
```

## Implementation streams (disjoint ownership)

- S0 (lead, sequential, first): registry, `SettingsRowId`, primitives (all files in
  `settings/primitives/`), `settingsPageProps.ts`, `settingsTargetContext.ts`,
  `settingsSearch.ts` signature + stub, stub pages `settings/pages/*Page.tsx` that
  render registry rows with placeholder controls, `settingsPages.tsx` switch, frame
  `settings` slot + `data-surface`, `.app-shell--settings`, `settings.css` with
  tokens + class name skeleton. Gate: `npm run check`, primitives tests.
- A Host/route: `WorkbenchSettingsScreen.tsx`, `SettingsSectionSidebar.tsx`,
  `SettingsSearch.tsx`, `SettingsSearchResults.tsx`, `useSettingsSearch.ts`,
  `useSettingsKeyboard.ts`, `WorkbenchSettingsHost.tsx` (replaces
  `WorkbenchSettingsDialogHost.tsx`), `WorkbenchOverlayDialogsHost.tsx`,
  `WorkbenchAppUpdaterHost.tsx`, `WorkbenchNavigationChrome.tsx`, `appLazySurfaces.tsx`,
  `App.tsx` (slot props only), `settingsPages.tsx`, `resolveSettingsRoute`.
  Forbidden: pages, provider files, CSS beyond `@import`. Validate:
  `npx vitest run src/components/settings/WorkbenchSettingsScreen src/components/WorkbenchSettingsHost src/App.commandRouting`.
- B General + Appearance: `pages/GeneralSettingsPage.tsx`, `GeneralAppUpdateRows.tsx`,
  `GeneralWorkspaceRows.tsx`, `GeneralEditingRows.tsx`, `GeneralStatusBarRows.tsx`,
  `pages/AppearanceSettingsPage.tsx`, `ThemeSwatches.tsx`; delete
  `GeneralAppUpdateSettings.tsx`, `AppearanceSettingsSection.tsx`. Forbidden:
  host, other pages, CSS. Validate: `npx vitest run src/components/settings/pages/General src/components/settings/pages/Appearance`.
- C Agents: `pages/AgentsSettingsPage.tsx`, `AgentProviderCard.tsx`,
  `AgentProviderCardDetails.tsx`, `AgentProviderUpdatePopover.tsx`,
  `agentProviderCardPresentation.ts`, `AgentThreadDefaultsRows.tsx`,
  `agentProviderSettingsPersistence.ts`; delete `AgentProviderSettingsCard.tsx`,
  `AgentsSettingsPanel.tsx`, `AgentsSettingsSection.tsx`, `AgentSettingsDialogSection.tsx`
  (+ port their 42 tests). Forbidden: host, other pages, CSS.
  Validate: `npx vitest run src/components/settings/pages/Agents src/components/settings/AgentProvider`.
- D Keybindings + Index + PHP + Snippets: `pages/KeybindingsSettingsPage.tsx`,
  `KeybindingsTable.tsx`, `KeybindingRow.tsx`, `useKeybindingRecorder.ts`,
  `keybindingsPresentation.ts`, `pages/IndexLanguagesSettingsPage.tsx`,
  `JavaScriptTypeScriptRows.tsx`, `GitDirectoryMappingsRows.tsx`,
  `pages/PhpSettingsPage.tsx`, `pages/SnippetsSettingsPage.tsx`; delete
  `KeymapSettingsPanel.tsx`, `IndexSettingsSection.tsx`, `PhpSettingsSection.tsx`,
  `SnippetsSettingsSection.tsx`, and the General/Git internals of `SettingsDialog.tsx`
  (D deletes `SettingsDialog.tsx` + `settingsDialog*.ts` once B/C ports are merged;
  ports SettingsDialog.test cases for its pages). Forbidden: host, agents, CSS.
  Validate: `npx vitest run src/components/settings/pages/Keybindings src/components/settings/pages/Index src/components/settings/pages/Php src/components/settings/pages/Snippets`.
- E CSS: `settings.css` full styling (dark + light), `App.css` legacy block removal
  (final task, after B/C/D land and the grep gate is empty), `workbenchShellFrame.css`
  `data-surface="settings"` rules. Forbidden: all `.tsx`. Validate: `npm run build`,
  visual QA checklist.
- F Independent read-only review (different model from every author): registry
  parity, Escape ordering, Monaco single-mount, provider persistence authority,
  hotspot budgets, a11y roles, grep gates.

Ordering: S0 -> A, B, C, D, E in parallel -> D deletes `SettingsDialog.tsx` after B/C
merge -> E deletes legacy CSS -> F review -> lead runs full gates and commits.

## Test plan

- Registry: parity test (rows rendered == registry per section), unique ids, every
  section has >= 1 row, `resolveSettingsRoute("git")` -> index row.
- Search: pure ranking, keyword match, limit 50, workspace-only rows hidden; UI:
  combobox aria, arrow/Enter/Esc, target scroll + focus + pulse (jsdom
  `scrollIntoView` mock), `/` focus only when not editable.
- Host: lazy mount on `settingsOpen`, frame slots hidden with `hidden`, editor stays
  mounted, sidebar column collapsed in editor mode, agent mode swap, workspace rekey
  A -> B -> A resets drafts, focus return, `App.commandRouting` still maps gear ->
  `workbench.openSettings`.
- Pages: port all 44 `SettingsDialog.test` cases (autosave per field, normalization,
  status bar chips, git mappings add/remove, JS/TS service, keymap capture/conflict/
  reset/chord/reserved), 42 agents cases (state matrix, sign-in, interval bounds,
  update admission, dismiss, copy install), 3 updater cases.
- Primitives: switch role/aria-checked, label association, stepper clamps, popover
  Esc/outside close and focus trap.
- Gates: `npm run check`, `lint`, `build`, `size:hotspots` (SettingsDialog entry
  removed, App/controller not grown), `format:check`, `test -- --run`,
  `git diff --check`, grep gates above.

## QA checklist (built app)

1. `⌘,` in editor mode: sidebar becomes section list + Search, editor area becomes
   page, tabs/toolbar/bottom panel hidden; `Esc` restores exactly; cursor/scroll kept.
2. Same in agent mode (threads rail swapped, thread body hidden, status bar intact).
3. `/` focuses Search; typing "on save" lists Format on save, Optimize imports,
   ESLint fix on save, PHPStan analyse; Enter scrolls and pulses the row; Esc clears.
4. Every section reachable by click and arrow keys; heading 18px, rows without borders.
5. Toggle a switch, close, reopen: value persisted; change theme Dark -> Light live.
6. Agents: cards show correct dot/headline for ready, signed out, not found; Sign in
   opens the CLI sign-in; update arrow popover shows Update now + manual command +
   copy; Skip hides the arrow; refresh updates "Checked N ago".
7. Keybindings: hover EDIT, record `⌘⇧P`, conflict triangle appears, reset restores,
   Esc during recording does not close settings.
8. Narrow window (< 720px): rows stack, no horizontal scroll except keybindings.
9. No console warnings; `npm run build` chunk for settings remains lazy.

## Risks

- App.tsx is at its exact baseline; overlay-host extraction must land with the slot.
- Escape ordering across popover/recorder/search/close is easy to regress; covered
  by explicit tests.
- Shared provider rows over per-provider preferences can mislead if values differ;
  the divergence note keeps it truthful.
- `--color-accent` as primary button background needs `--settings-primary-fg`
  per light theme for contrast.
- Hidden Monaco slot plus large page scroll: verify no layout thrash on open/close.

## Out of scope

T3 sections Integrations, Source Control, Connections, Archive; persisted defaults
for model/effort/access; when-clause contexts; `keybindings.json` export; provider
display name, environment variables, model list editing, add provider; deep links to
rows from notices; Windows/Linux glyph audit beyond current placeholders.
