# Codevo redesign, deferred fixes and new features - design

Date: 2026-09-23
Status: approved 2026-09-24

## 1. Goal

Rebuild Codevo's UI so it looks and behaves very close to t3code (pingdotgg/t3code): calm,
minimal, content-first, agent-first. Codevo keeps its own identity only through details: the
6-palette token system (each with dark and light) and small proportions, never through extra
elements or decoration. In the same program, fix the bugs deferred during this session and add
the new features the owner approved.

Success means:
- every screen in `docs/redesign/v3-*.html` exists in the real app with the same structure,
  sizes, copy and interactions, in all 6 palettes x dark/light;
- no existing capability is lost (agent workflows, editor, debugging, git, scripts, terminals,
  settings, remote execution);
- each deferred bug has a regression test and is verified in the running app;
- all repository gates from `CLAUDE.md` pass after every phase.

## 2. Source of truth

- Approved mockups: `docs/redesign/index.html` and the v3 screens:
  - `v3-monolith-clean.html` - conversation, composer, attachments, states, shared tokens
    (`<style id="codevo-base">`) and base script.
  - `v3-command-palette.html`, `v3-sidebar-agents.html`, `v3-right-panel.html`,
    `v3-editor.html`, `v3-projects-clone.html`, `v3-settings-pickers.html`.
- Briefs: `docs/redesign/BRIEF-v2.md`, `docs/redesign/BRIEF-v3-screens.md`.
- t3code reference source: `apps/web/src` of pingdotgg/t3code (mirrored measurements are
  listed in the mockup files' reports and must be reused, not re-derived).
- Where a mockup and this spec disagree, this spec wins; where this spec is silent, the mockup
  wins.

## 3. Scope

### 3.1 Redesign (all surfaces)

1. **Design tokens and theming**
   - One token module replacing `agentModeTokens.css`, `agentModeVariants.css` and ad-hoc colors:
     surfaces s0-s4, text levels, borders, accent / on-accent, success, danger, warning,
     focus, selection, syntax, diff, shadows, radius, type scale, spacing, motion.
   - 6 palettes (Graphite · Teal default, Slate · Blue, Black · Violet, Ink · Mint,
     Zinc · Orange, Carbon · Lime), each dark + light, values taken from
     `v3-monolith-clean.html` / `direction-a-monolith-palettes.html`. All text pairs WCAG AA.
   - Appearance setting: palette + System/Dark/Light; editor syntax theme defaults to
     "Match palette"; existing classic editor themes remain selectable as syntax themes.
   - `prefers-reduced-motion` respected everywhere.
2. **Base components** (one owner module each, reused by every screen): icon button, button
   sizes, round submit/stop button (t3code arrow path), menu/popover + submenu, dialog, command
   list, kbd badge, switch, checkbox, segmented control, stepper, input/textarea/field hint,
   panel tabs with hover-close, tree row, status label (work/warn/ok/fail), role tag, banner
   attached to the composer, toast, resize handle.
3. **App shell**: macOS window chrome, 52px top bar (breadcrumb, minimal actions), 256px
   sidebar, conversation column max 768px, collapsible right panel (default closed, resizable),
   no status bar (its information moves to hover/tooltips, command palette and settings).
4. **Conversation and composer**: user bubble with image thumbnails + lightbox; work rows,
   thought rows and subagent batches as in t3code; compact "N files changed +a -d" row opening
   the diff; metadata on hover only; round send/stop; attachment tiles; approval, question,
   background-agents and queued-edit states inside/attached to the composer; empty thread.
5. **Sidebar**: threads from all projects in one list with a project filter; pinned / active /
   settled; statuses (working with timer, approval, input, waiting for N agents, unread, done,
   failed); search with match highlight and "You:/Agent:" snippet; context menu
   (new thread on branch, pin, settle, snooze, rename, mark unread, move to, copy, archive,
   delete); inline rename; collapsed mode.
6. **Agents**: subagent batch rows, Agents panel with live timers and recent activity.
7. **Command palette** (⌘K, ⌘P for files, ⌘/ shortcuts): actions, recent threads, fuzzy
   projects/threads/files/branches/scripts, sub-pages (new thread in, switch project, go to
   file, run script, switch branch, change model, theme, appearance, shortcuts).
8. **Right panel surfaces**: Diff (scope: latest turn / turn N / working tree / branch;
   unified/split; wrap; whitespace; file tree), Files (search, tree with git markers,
   preview), Terminal (sessions as tabs, floating toolbar), Git (changes with include
   checkboxes, message with generate, Commit / Commit & push, branch picker with create and
   worktree), Pull request creation form, Scripts (run/stop, running/exit state, project
   actions). Long lines scroll or wrap, never clip.
9. **Editor**: editor in the right panel with maximize/focus mode; tabs (dirty dot, preview
   italic), breadcrumb subheader with hover actions, gutter (breakpoints, git markers, folds),
   hover cards with quick fix, completion, references peek with rename, Problems drawer, find
   widget, Node debugging (debug toolbar, variables, watch, call stack, breakpoints, debug
   console, inline values) in focus mode.
10. **Projects and onboarding**: first-run empty state; add project via command palette
    (open folder, Git URL, GitHub, GitLab, recent folders); one-step clone form with live
    validation; clone progress banner with cancel; clone errors with retry/remove; trust
    dialog; project filter.
11. **Settings and pickers**: General (palettes, appearance, sizes, fonts, syntax theme,
    updates, workspace, editing), Providers (Claude Code / Codex detection, sign-in, versions,
    favorite models, legacy models), Environments, Keybindings (search, edit, modified),
    Index & languages, Snippets, Usage (limit bars), Archive; composer pickers for model,
    effort, access mode, environment and branch; usage limits notice.

### 3.2 Deferred bugs

| # | Bug | Expected |
|---|---|---|
| B1 | Preview of an HTML file linked by an agent shows "The file could not be read." + Retry (observed on `docs/redesign/*.html`, 100-120 KB, well under the 2 MB limit) | Root cause found and fixed; preview opens |
| B2 | Sidebar background label uses the immediate inferred-idle rule, so the thread row can flicker between Working and Working in background | Sidebar uses the same 3 s quiescence resolution as the conversation |
| B3 | Codex subagents render as a generic `details` block with nested tool calls, duplicated with the spawn row | Codex `collabAgentToolCall` mapped to typed events; Codex subagents use the same batch row / Agents panel as Claude, grouped per spawn call with its task title |
| B4 | Diff in the narrow right panel is cramped and clips file names/content | Resolved by the redesigned resizable panel and diff layout (§3.1.8) |
| B5 | Queued-message edit shows image attachments as icons | Thumbnails as in t3code |
| B6 | Usage panel sums Codex app-server `contextTokens` (last request total) as input, not a per-turn sum | Per-turn deltas from thread-cumulative totals; no double counting across old and new events |

### 3.3 New features approved in this session

- F1 All-projects thread list with project filter (behavior change from one project at a time).
- F2 Retry on provider error in the thread error banner.
- F3 Recent folders when adding a project.
- F4 Workspace trust dialog (replaces the one-click trust button).
- F5 Clone destination default `~/code/<name>`, remembering the last parent folder.
- F6 One-step clone form (URL, destination, optional branch) with live validation.
- F7 Update channel Stable / Beta.
- F8 Branch picker in the composer environment area.
- F9 Git, Scripts and Pull request as right-panel tabs; PR creation form.
- F10 Keyboard shortcuts cheatsheet (⌘/), command palette files/branches/scripts results and `@` file prefix.

Out of scope: user-defined thread groups (only Pinned/Active/Settled + project move), GitHub
repository search UI and SSH/HTTPS switching for server clones (existing behavior kept, not
redesigned in this program), PHP-specific settings pages.

## 4. Architecture and boundaries

- Follow `CLAUDE.md` layering. Tokens and base components live in a dedicated UI foundation
  module (`src/ui/` or `src/components/foundation/`), consumed by feature components; no
  feature component defines its own colors.
- Redesign is presentation-level: domain, application and Rust layers change only where a
  feature or bug requires it (F1, F2, F3, F4, F5, F7, F8, F9, B2, B3, B6).
- Hotspot limits: `App.tsx`, `useWorkbenchController.ts`, `AgentThreadSession.tsx` and other
  large files must shrink or stay flat; new surfaces get their own focused modules.
- Old styles are removed as each surface is migrated; no long-lived dual styling.
- Contracts: F1 changes thread views from per-project to all-projects with filter; F9 PR
  creation uses a closed typed command through the existing git/forge boundary; F7 adds an
  updater channel setting with a typed enum on both TS and Rust sides; B3 adds a Codex event
  kind to the TS/Rust wire contracts with tests on both sides.

## 5. Delivery plan (phases)

Each phase gets its own implementation plan (writing-plans), is implemented by Opus 5.5
agents with disjoint file ownership, reviewed by a separate Opus 5.5 read-only agent, passes
all gates, is verified in a separately built QA app, and is committed to `main`.

| Phase | Content | Depends on |
|---|---|---|
| P0 | Bugs B1, B2, B5, B6 (independent, small) | - |
| P1 | Tokens, palettes, appearance setting, base components | - |
| P2 | App shell: window chrome, top bar, sidebar frame, right panel frame | P1 |
| P3 | Conversation, composer, attachments, states | P2 |
| P4 | Sidebar and thread management, F1, F2, Agents panel, B3 | P2 |
| P5 | Command palette, F10 | P2 |
| P6 | Right panel: diff, files, terminal, git, PR, scripts, F9, B4 | P2 |
| P7 | Editor and debugging surfaces | P6 |
| P8 | Projects, clone, onboarding, trust, F3-F6 | P5 |
| P9 | Settings and pickers, F7, F8 | P1, P3 |
| P10 | Full-app QA pass in all palettes, cleanup of dead styles, release | all |

P0 and P1 run in parallel. After P2, P3-P6 can run in parallel where file ownership allows.

## 6. Testing and verification

- Unit/component tests for every new component and changed behavior (React act/waitFor).
- Contract tests on both TS and Rust sides for every wire change.
- Visual verification per phase: QA build with its own bundle id (`dev.mockor.editor.qa`),
  Computer Use QA of the phase's screens in palette 1 dark + light and one other palette,
  compared to the corresponding mockup.
- Accessibility: AA contrast checks for token pairs (scripted), keyboard navigation for
  menus, palette, dialogs and pickers, visible focus rings.
- Performance: no regression in typing latency, transcript scrolling or large-file editing;
  measured before/after on the conversation and editor surfaces.
- Full repository gates after each phase.

## 7. Decisions (owner, 2026-09-24)

1. Implementation and review agents: Opus 5.5 only. UI QA of the running app: Codex with
   Computer Use via `codex app-server` against the QA bundle (`dev.mockor.editor.qa`).
2. Default palette: Graphite · Teal.
3. Release cadence: a single beta release at the end of the program (P10), not per phase.
