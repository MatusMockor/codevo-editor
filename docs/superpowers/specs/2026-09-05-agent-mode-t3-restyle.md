# Agent Mode T3 Restyle Design (variant D "T3 Code")

Date: 2026-09-05

Status: Proposed design, awaiting approval

## Goal

Restyle agent mode to the approved mock D (`design-agents.html#v-d`): T3 Code
0.0.34 tokens and spacing become the default look, dark and light. Structure
changes only where tokens cannot reach: rail cards, header actions, thread body
column, composer send button, empty state. Builds on slices 4-5
(`2026-08-25-agent-sidebar-t3-parity-design.md`,
`2026-08-25-agent-workbench-chrome-design.md`), which already adopted the T3 DOM;
this slice adopts the T3 skin and finishes the remaining structural gaps.

## Non-goals

- New behaviour: no keybinding, store, IPC, Rust, or provider changes.
- Attachments, "Add action", T3 update toast, T3 wordmark in the rail chrome.
- Re-tuning the graphite/paper/studio variants against the new base.
- Bundle/hotspot baseline changes (`scripts/hotspot-size-baseline.json`).

## Reference inventory (verified)

T3 compiled stylesheet (`t3/app/.../index-DSuALXPn.css`) and bundle
(`index-r4LjKDJR.js`), cross-checked against `t3-window.png`:

- Root: `--radius: .625rem`, `--control-radius: .5rem`,
  `--sidebar-content-inset: .5rem`, `--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`,
  `--font-mono: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`.
- Dark sidebar (`[data-app-sidebar]:is(.dark)`): `--background:#000`,
  `--foreground:#f1f3f7`, `--accent:#191a1d`, `--accent-foreground:#f7f9ff`,
  `--muted:#0a0a0a`, `--muted-foreground:#a3a3a3`, `--border:#ffffff14` (8 %),
  `--input:#ffffff2e` (18 %), rows hover/active/selected = contrast-foreground
  8 % / 11 % / 7 %. Canvas `#0e0e0e`, composer `#181818` (+4 %) measured on the
  live window (mock comment, lines 657-661).
- Light: zinc scale (`--background: zinc-25`, `--sidebar: zinc-50`,
  `--accent: zinc-100`, `--border: zinc-200`, `--input: zinc-300`,
  `--primary: oklch(48.8% .217 264)`, rows hover zinc-25, active/selected white).
- Semantics: `--message-surface: var(--accent)` (user bubble),
  `--message-action: var(--primary)`, `--secondary-label: var(--muted-foreground)`.
- Send button (bundle): `flex size-8 shrink-0 items-center justify-center rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover disabled:opacity-30`.
  T3 hover is `primary 90 % + background` and disabled is 30 %; the brief
  binds hover **lighter** (`primary 88 % + #fff`) and disabled **50 %**. Brief wins.
- Empty state (bundle): `What should we build in {project}?`; placeholder
  `Ask for changes, send follow-ups, or attach images` (not adopted, no attachments).
- Turn fold (bundle): `Worked for ${duration}` / `Worked`.
- Mock D CSS (`design-agents.html:662-961`) is the binding pixel reference; the
  `--t3-*` block (lines 663-703 dark, 760-787 light) is copied verbatim.

## Verified starting point (ours)

- `src/components/agentMode/agentMode.css` (5254 lines, one file, imported from
  `src/App.css:1`). Tokens `.workbench-frame {}` at `:9-96`; ambient gradient +
  scanline `:44-51`; variant blocks `:3022-3180` (token-only, graphite/paper/studio
  with light overrides for `data-theme="light"|"catppuccinLatte"|"oneLight"` and a
  `@media (prefers-color-scheme: light)` block `:3007`).
- `WorkbenchShellFrame.tsx:56` sets `data-agent-variant` from
  `appSettings.agentAppearanceVariant`; enum `agentSettings.ts:21-23`
  (`current|graphite|paper|studio`, default `current`); options
  `AgentsSettingsSection.tsx:30-37`.
- `workbenchShellFrame.css:47-51`: `--agent-rail-width: 272px`,
  `--agent-rail-inset: 8px`, `--agent-center-min-width: 360px`.
- Rail: `AgentThreadRow.tsx:114-196` already renders line1 (icon, project only
  when `projectLabel !== null`, pin, status slot), line2 title, line3 branch,
  files, provider glyph; `.agent-row--card` (`agentMode.css:715`) is
  `min-height: 84px; padding: 12px`. Shelf/divider in `AgentThreadList.tsx`.
  `AgentProviderRailFooter.tsx` renders provider glyph + version labels + nav icons.
- Header `AgentThreadHeader.tsx`: breadcrumb, Run/Open/Commit splits
  (`.agent-split` 28 px, `:3659`), status dot + label (`:231-241`),
  Terminal sessions toggle, `AgentPanelLayoutControls`; `.agent-thread-head`
  (`:3496`) has `border-bottom`.
- Body `AgentThreadSession.tsx`: `AgentTurnWork` (`:310-356`, "Worked for"),
  `.agent-tool` (`:486-491`, boxed mono row), `.agent-well` command box,
  `.agent-finale` with "result" microlabel, empty state `:494-526`
  ("Start a thread in X" + figure + hints).
- Composer `AgentComposer.tsx:280-295`: text button `Start agent` + `<kbd>`,
  `submitLabel()` `:429`; footer `:309` hosts the isolation picker
  (`AgentPickerMenu`) or the locked-checkout chip. `AgentLaunchControls.tsx`
  renders model / traits / mode ghost pickers split by `.agent-composer__divider`.
- Surfaces `AgentSurfacePanel.tsx` (`.agent-surface__*`, `:3952-4440`), status
  bar `AgentStatusBar.tsx` (`.status-bar--agent`, base rule `App.css:4569`, is
  rendered **outside** `.workbench-frame`, so it cannot read `--agent-*`).
- Tests: `agentModeTokens.test.ts:5` and `agentModeResponsiveStyles.test.ts:5`
  read `agentMode.css` by path; `:138-141` pins the studio focus ring;
  `AgentComposer.test.tsx:348` asserts `textContent` contains `Starting…`.
- Hotspot gate counts only `.rs/.ts/.tsx` (`check-hotspot-size-budget.mjs:7`);
  CSS is unbudgeted, so the split below is an ownership decision, not a gate fix.
- Dirty worktree (provider slice): `AgentModeView.tsx`, `AgentProviderRailFooter.tsx`,
  `AgentsSettingsSection.tsx`, settings panels, Rust provider files. Must be
  committed or left untouched; every stream rebases onto it.

## Decisions per area (T = token-only, S = structural)

### 1. Tokens (T)

- Add a `--t3-*` block declared on `.app-shell` (dark values, mock 663-703) and
  light overrides on `.app-shell[data-theme="light"], [data-theme="catppuccinLatte"], [data-theme="oneLight"]`
  plus the existing `prefers-color-scheme` branch (mock 760-787). Declaring on
  `.app-shell` lets the status bar (outside the frame) use the same tokens.
- `.workbench-frame` remaps `--agent-*` exactly as mock 705-757 (canvas, rail,
  raised, card, well, fill, hover, hairline, text scale, live, ok/danger/attention,
  status colours, row tokens, radii, fs scale 11/12/12/14/16, `--agent-lh-prose: 1.6`,
  `--agent-tracking-label: .02em`, `--agent-turn-gap: 28px`,
  `--agent-session-gutter: 24px`, CTA tokens). New base tokens: `--agent-sans`,
  `--agent-cta-bg/-fg/-border/-bg-hover/-glow`, `--agent-composer-surface/-outline/-highlight`,
  `--agent-outline-button-bg/-hover`, `--agent-code-background`.
- `--agent-ambient: none`, `--agent-scanline: transparent`; `.agent-mode,
  .agent-surface-host, .agent-usage-layer, .status-bar--agent { font-family: var(--agent-sans) }`.
- `--agent-focus-ring` keeps `0 0 0 1px var(--agent-live)` as first layer
  (tokens test) and adds `0 0 0 3px color-mix(var(--t3-ring) 50%, transparent)`.
- Variants a/b/c: **kept verbatim, moved** to `agentModeVariants.css`. They cost
  zero TS (enum, settings, parser untouched), ~160 CSS lines, no new tests, and
  keep persisted settings valid. They are not re-tuned and are excluded from QA;
  the settings labels stay. "current" now means T3.

### 2. Rail (T + S)

- `--agent-rail-width: 256px` (`workbenchShellFrame.css`), inset stays 8 px.
- Chrome 44 px, collapse button only (no wordmark). Head grid
  `minmax(0,1fr) 32px`, gap 4: row 1 search (h-8, radius 8, muted 14/500) +
  "New thread" pencil; row 2 scope trigger (h-8, transparent, muted 80 %) +
  "Add project" folder-plus. All icon buttons 32 px, radius `--t3-control-radius`.
- Card (S): `.agent-row--card { height: 78px; padding: 8px 10px; border-radius: 8px }`,
  line1 h-20 project 12/500 secondary-label, line2 title 14/20 500 (400 when
  receding), line3 12 px branch + files (mono 11) + provider glyph 14 px @ .6.
  Project line is **always** rendered (T3 shows it for one project too).
- Hairline after pinned (`.agent-list__divider`, 60 % border, margin 6 10) kept.
- Archived shelf: `Archived (N)` always with count, 12/500 muted 50 %, rule, chevron.
- Footer (S): icon-only, 44 px, no top rule; provider glyph + version text
  removed from the footer; versions move to the settings button `title` and stay
  in the Usage panel. Nav order: settings, source control, usage, refresh at the right.

### 3. Header (T + S)

- `.agent-thread-head { min-height: 52px; padding: 0 12px 0 16px; border-bottom: 0 }`,
  breadcrumb 14 px, project muted 80 %, title 400 foreground, separator muted 60 %.
- `.agent-split` = T3 outline xs: 24 px, `background: var(--agent-outline-button-bg)`,
  `border: 1px solid var(--agent-hairline-strong)` (18 %), radius 6, 12/500,
  `box-shadow: 0 1px 2px rgba(0,0,0,.05)`, hover bg 12 %.
- `.agent-icon-toggle` 26 px radius 6, pressed = `--agent-fill`. Terminal
  sessions toggle and `AgentPanelLayoutControls` kept.
- Status dot + label removed from the header (S); status lives in the rail row
  and the status bar. Responsive test assertion on `.agent-thread-head__status-label` goes.

### 4. Thread body (T + S)

- `.agent-session { padding: 12px 24px 8px }`,
  `.agent-session__body { width: 100%; max-width: 768px; margin: 0 auto }`.
- User message `.agent-prompt__body`: bg `--agent-fill` (accent), fg
  `--t3-accent-foreground`, radius 18, 14/1.5, `max-width: 85%`.
- "Worked for" `.agent-work`: no border, summary inline
  (`grid-template-columns: auto auto auto; justify-content: start; gap: 6px`),
  muted 12 px, counts 60 %, chevron 12 px.
- Tool call `.agent-tool`: transparent, no inset shadow, `padding: 4px 0`, sans
  13 px, name 500 foreground, input mono 12 muted; `.agent-tool__status` hidden
  except `--bad` (red). DOM unchanged.
- Command `.agent-well`: radius 10, bg `--agent-code-background`, `0 0 0 1px`
  border 8 %, head 8 12 12/foreground, stream 12/1.6 muted.
- Summary `.agent-finale`: "result" microlabel hidden (kept for `--bad`), body 14/1.6.

### 5. Composer (T + S)

- `.agent-composer { padding: 8px 24px 16px; border-top: 0 }`; box
  `max-width: 768px; margin: 0 auto; border-radius: 12px; background: var(--agent-composer-surface); box-shadow: 0 0 0 1px var(--agent-composer-outline), inset 0 1px var(--agent-composer-highlight), var(--agent-shadow-raised)`.
- Textarea 14/1.5, `min-height: 64px; padding: 14px 16px 8px`; row `4px 12px 12px`.
- Ghost pickers (`.agent-picker__trigger--ghost`): 28 px, radius 6, 13/500 muted,
  hover bg `--agent-fill`; `.agent-composer__divider` 16 px, `--agent-hairline-strong` @ .7.
- Send (S): `<button class="agent-composer__send" aria-label="Start agent" title="Start agent (⌘↩)" aria-keyshortcuts>` with lucide `ArrowUp` 16 px stroke 2.5;
  32 × 32, `border-radius: 999px`, bg `--agent-cta-bg`, fg `--agent-cta-fg`, no
  border; hover `--agent-cta-bg-hover` (primary 88 % + #fff dark, + #000 light);
  disabled `opacity: .5`; dispatching = `Loader2` spin + `aria-label="Starting…"`
  + `aria-busy`. Follow-up: `aria-label="Send follow-up"`, same glyph. The
  `<kbd>` and visible text are removed; the shortcut survives in `title` and
  `aria-keyshortcuts`. The text alternative from the mock is not adopted.
- Isolation picker kept in `.agent-composer__footer` as the 24 px bordered chip
  (8 % border, radius 6, bg canvas 50 %, 12/500 muted); locked chip same metrics.
- Compact menu (< 620 px) unchanged.

### 6. Right surface panel and status bar (T)

- `.agent-surface__head` 40 px, bg canvas, border 8 %; tabs 28 px 12/500 muted,
  active = accent chip with the close glyph; layout toggles 26 px.
- `.agent-surface__subhead` 32 px; its microlabel becomes sans 12/500, no
  uppercase; file rows 28 px radius 6, active accent; diff add/del tints 10 %.
- `.status-bar--agent`: bg `--t3-background`, border `--t3-border`, colour
  `--t3-muted-foreground`, 11 px, live dot without glow (uses `--t3-*` directly).

### 7. Empty state (S)

`AgentThreadSessionEmpty` renders
`<h2 class="agent-empty__title">What should we build in <span class="agent-empty__project">{label}</span>?</h2>`
(28 px / 1.2 / 400, centred, project underlined: `text-decoration: underline; text-underline-offset: 6px; text-decoration-color: color-mix(currentColor 35%, transparent)`),
sitting at the bottom of the empty body 24 px above the composer. Figure, hints
and copy are removed. `repositoryLabel === null` keeps "No Git repository
detected" + its sentence. `aria-label="New agent thread"` on the section stays.

## Shared contracts

- Token names: the `--t3-*` set (mock 663-703, dark and light) on `.app-shell`;
  `--agent-*` remap on `.workbench-frame`; new `--agent-sans`, `--agent-cta-*`,
  `--agent-composer-*`, `--agent-outline-button-*`, `--agent-code-background`.
  No stream adds a token outside `agentModeTokens.css`.
- Class names: unchanged BEM roots (`agent-rail`, `agent-row`, `agent-thread-head`,
  `agent-split`, `agent-session`, `agent-prompt`, `agent-work`, `agent-tool`,
  `agent-well`, `agent-composer`, `agent-picker`, `agent-surface`, `status-bar--agent`).
  New: `agent-empty__project`, `agent-composer__send--busy`.
- Presenter (`agentSidebarPresentation.ts`):
  ```ts
  export interface AgentThreadRowModel {
    readonly project: string;            // never null: repositoryLabel fallback
    readonly title: string;
    readonly branch: string;             // branch | "worktree" | "in place"
    readonly filesLabel: string | null;
    readonly provider: AgentCliKind;
    readonly status: AgentRowStatus;
    readonly variant: AgentRowVariant;
    readonly recede: boolean;
  }
  export function agentThreadRowModel(view: AgentThreadView, on: boolean): AgentThreadRowModel;
  ```
  `AgentThreadRow` consumes it; `projectLabel` prop becomes required `string`.
- Composer: `submitLabel()` in `AgentComposer.tsx` becomes
  `submitAccessibleName(dispatching, followUp): string` returning
  `Start agent | Send follow-up | Starting…`; `agentControlTooltip(label, shortcut)`
  from `agentThreadHeaderPresentation.ts` builds the `title`.
- Removed: header status element and its CSS; `.agent-empty__figure/hints/chip`;
  `--agent-ambient` gradients; provider version text in the footer.

## CSS decomposition (pure move first)

`agentMode.css` is split by contiguous line ranges, then imported from
`src/App.css` in the original order so the cascade is unchanged:

| File                     | Content (current lines)                                        |
| ------------------------ | -------------------------------------------------------------- |
| `agentModeTokens.css`    | `:1-96` tokens, `:2979-3021` light, `+ --t3-*` block            |
| `agentModeVariants.css`  | `:3022-3180` graphite/paper/studio                              |
| `agentMode.css`          | `:97-289` grid, primitives, notice; `:1879-2358` toolbar/media; `:3289-3495` add-project |
| `agentRail.css`          | `:290-1091` rail/rows/scope/shelf/footer; `:3181-3288` thread search |
| `agentThread.css`        | `:1092-1527` session/body; `:2359-2524` ship; `:3496-3951` header/splits/menus |
| `agentComposer.css`      | `:1528-1878`, `:2525-2978` composer/pickers; `:4441-4867` model picker |
| `agentSurface.css`       | `:3952-4440` surfaces + changes cue                             |
| `agentUsage.css`         | `:4868-5254` usage layer                                        |
| `agentStatusBar.css`     | new: `.status-bar--agent` overrides                             |

Acceptance for the move: concatenating the files in import order equals the
original file byte-for-byte except the per-file header comments. A new
`agentModeCssTestSupport.ts` exports `readAgentModeStyles()` (concatenation in
import order); both existing CSS tests switch to it. Restyling starts only after
the move commit.

## Parallel streams (disjoint ownership)

S0 runs alone first; S1-S5 run in parallel on top of its commit; the lead
integrates, then R reviews.

| Stream | Owns (write)                                                                                                                                                             | Forbidden                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| S0 tokens + split (lead) | `agentMode.css`, `agentModeTokens.css`, `agentModeVariants.css`, empty area files, `App.css` imports, `workbenchShellFrame.css` (256 px), `agentModeCssTestSupport.ts`, `agentModeTokens.test.ts`, `agentModeResponsiveStyles.test.ts` | all `.tsx`                              |
| S1 rail | `agentRail.css`, `AgentThreadRow.tsx`, `AgentThreadRowParts.tsx`, `AgentThreadList.tsx`, `AgentRailHeader.tsx`, `AgentThreadsSidebar.tsx`, `AgentProviderRailFooter.tsx`, `agentSidebarPresentation.ts` + their tests | `AgentPickerMenu.tsx`, `AgentProjectScopeMenu.tsx` (scope styling via `.agent-scope` selectors only) |
| S2 header + body | `agentThread.css`, `AgentThreadHeader.tsx`, `AgentThreadSession.tsx`, `AgentThreadChangesCue.tsx`, `AgentImportedHistory.tsx`, `agentThreadHeaderPresentation.ts` + tests | composer, rail                          |
| S3 composer | `agentComposer.css`, `AgentComposer.tsx`, `AgentLaunchControls.tsx`, `AgentTraitsPicker.tsx`, `AgentModelPicker.tsx`, `AgentComposerCompactMenu.tsx`, `AgentPickerMenu.tsx` + tests | rail, header                            |
| S4 surfaces + status | `agentSurface.css`, `agentUsage.css`, `agentStatusBar.css`, `AgentSurfacePanel.tsx`, `AgentSurfaceEmptyState.tsx`, `AgentSurfaceDiff.tsx`, `AgentSurfaceFileTree.tsx`, `AgentStatusBar.tsx`, `AgentUsagePanel.tsx` + tests | `App.css`                               |
| S5 cross-area tests + QA | new `agentModeT3Styles.test.ts`, `agentModeT3Roles.test.tsx`; built-app QA run (codex-computer-use) and report | every production file                   |
| R review | read-only adversarial review of the integrated diff (not the authors)                                                                                                    | everything                              |

`AgentModeView.tsx` is not owned by any stream (dirty from the provider slice);
if the rail chrome needs a change, S1 requests it from the lead.

Validation per stream: `npm test -- --run src/components/agentMode/<owned>`,
`npm run lint -- --max-warnings 0`, `npm run format:check:changed`. Lead: all
gates from CLAUDE.md, `npm run size:hotspots`, `git diff --check`.

## Test plan

- Token contract (S0, existing tests + new): every `--t3-*` referenced is
  declared on `.app-shell`; every `--agent-*` still declared inside the frame
  scope; `--agent-ambient` is `none`; `--agent-rail-width: 256px`; light
  overrides exist for all three light theme selectors and define
  `--t3-background`, `--t3-primary`, `--t3-border`; no cycles.
- CSS assertions (S5, `rule()` helper style): `.agent-row--card` `height: 78px`;
  `.agent-thread-head` has no `border-bottom`; `.agent-session__body`
  `max-width: 768px`; `.agent-composer__box` `border-radius: 12px` and
  `inset 0 1px`; `.agent-composer__send` `border-radius: 999px`, `width: 32px`;
  `.agent-composer__send:disabled` `opacity: 0.5`; `.agent-tool` has no
  `box-shadow`; `.status-bar--agent` uses `var(--t3-background)`.
- Roles/labels (S1-S4 + S5): send button accessible name `Start agent` /
  `Send follow-up` / `Starting…`, `title` contains `⌘↩`, no `<kbd>`;
  `AgentComposer.test.tsx:348` switches to `aria-label`; card renders the project
  line for a single project; shelf text `Archived (N)`; header has no
  `agent-thread-head__status`; footer has no version text but keeps
  `Open provider settings`, `Open Source Control`, `Open Usage`, `Refresh …`;
  empty heading `What should we build in playablemaker?` with
  `.agent-empty__project`; `section[aria-label="New agent thread"]` unchanged.
- Responsive (S0): keep every existing assertion except the removed status
  label; add `.agent-mode__center` unchanged rows; rail narrow rule stays 248 px.
- Variant file: `agentModeVariants.css` still declares the studio `0 0 0 4px` ring.

## Light theme

Zinc set from mock 760-791 applied through the same three selectors the
variants use (`agentMode.css:3056-3058`) plus the `prefers-color-scheme`
branch. Checks: canvas `oklch(99.2% 0 0)`, rail `oklch(98.5% 0 0)`, accent
bubble `oklch(96.7% ...)` with dark text, primary `oklch(48.8% .217 264)` on
white, composer white with `0 6px 18px rgba(0,0,0,.06)`, outline buttons white
with zinc-300 border, hover CTA `primary 88% + #000`. Contrast: muted text
`oklch(55.2%)` on white passes 4.5:1; verify the underlined project and shelf
label (50 % muted) meet 3:1 as non-text UI or raise to 60 %.

## QA checklist (built app, dark and light)

1. Rail is 256 px, sidebar `#000` (dark) / zinc-50 (light), hairline 8 %.
2. Cards are 78 px: project · time/status, title, branch + provider glyph;
   hover 8 %, active 11 %; pinned divider; `Archived (N)` shelf; no section labels.
3. Header: no rule, 14 px breadcrumb, 24 px outline Run/Open/Commit, Terminal
   sessions and panel toggles present, no status pill.
4. Thread: 768 px centred column, user bubble on accent, "Worked for" fold
   muted, bare tool rows, bordered command box, summary text.
5. Composer: radius 12 box lighter than canvas with top highlight; ghost
   pickers split by hairlines; isolation chip; round blue arrow at rest,
   lighter on hover, 50 % when disabled, spinner while starting; `⌘↩` still
   submits; focus ring visible on the round button; tooltip shows the shortcut.
6. Empty thread: `What should we build in <project>?` with underlined project.
7. Right panel Files/Diff/Terminal tabs on accent chips; status bar in T3 tones.
8. Window at 1180 px and 720 px: rail narrows/collapses, header labels
   collapse, composer compact menu appears; nothing overlaps.
9. Fonts render as SF Pro on macOS; no ambient gradient or scanline.
10. Settings > Agents appearance still lists Current/Graphite/Paper/Studio and
    switching does not throw; "Current" is the T3 look.
11. Side-by-side with `t3-window.png` (rail, header, composer, send button).

## Open questions

- Should the underlined project in the empty state open the project scope menu
  (T3 behaviour)? Default: static span this slice.
- Keep the round send with `size-8` at all widths or grow to 36 px on touch
  (`@media (hover: none)`)? Default: 32 px everywhere.
