# Agent Sidebar T3 Code Parity and Thread Search Design (Slice 4)

Date: 2026-08-25

Status: Proposed design, awaiting approval

## Goal

Make the agent-mode thread rail look and behave like the T3 Code sidebar the
user runs (T3 Code v0.0.33, `pingdotgg/t3code`, `apps/web/src/components/Sidebar.tsx`
at tag `v0.0.33`) and add search across chat history: thread titles and turn
content (user prompts, assistant text, results), with keyboard result
navigation in three surfaces: the rail search field, a global palette, and an
in-thread find bar.

Builds on slices 1-3 (`2026-08-24-agent-conversational-threads-design.md`,
`2026-08-25-agent-git-flow-design.md`, `2026-08-25-agent-composer-sidebar-design.md`)
and supersedes the "Sidebar" section of slice 3 where the two conflict
(nested project/repository sections, attention bands, per-repo "+ New thread"
rows and the inline trust prompt are removed).

## Reference inventory (T3 Code v0.0.33, source verified)

GitHub was accessible. Sources fetched raw from `pingdotgg/t3code` at tag
`v0.0.33` (`Sidebar.tsx` 3693 lines, `Sidebar.logic.ts`, `ThreadStatusIndicators.tsx`,
`threadActionMenu.logic.ts`, `CommandPalette*.tsx`, `ui/sidebar.tsx`,
`index.css`, `packages/shared/src/keybindings.ts`, `packages/contracts/src/orchestration.ts`).
`main` (0.0.34 nightly) differs only by pinned drag-reorder and localStorage
shelf state; every class string below is identical in both.

### Binding reference: the user's screenshot of T3 Code 0.0.33 (dark theme)

Observed and confirmed against source: rail about 330 px wide with 15-16 px
type (T3 renders at 16rem = 256 px with 14 px titles at 100% zoom, so the
screenshot is zoom-scaled; we adopt the screenshot proportions, see CSS).
Top-left: a small "collapse sidebar" icon button (panel-left style,
`SidebarTrigger`). Row 1: magnifier + "Search" field, compose (pencil) icon
button at the right. Row 2: folder icon + "All projects" + chevron-down
dropdown, add-project folder-plus icon at the right. Then a FLAT list of
thread cards sorted by recency, no project groups, no band labels, no
per-repo rows. Each card is three lines with about 12 px padding and about
8-10 px radius: line 1 folder icon + project name ("laravel") left, relative
time ("8m", "9m", "10m") right in muted text; line 2 the title, single line,
ellipsis; line 3 the branch ("main", muted) left and the PROVIDER glyph right
(Claude's orange asterisk, `fill-[#d97757]`; OpenAI's mark `fill-black dark:fill-white`
for Codex; `ProviderInstanceIcon` rendered `size-3.5 opacity-60`). The
selected card has a raised lighter surface; the others are transparent. No
status text is visible for idle read threads; per source the time in line 1
is replaced by a status label only while Working (sky, dashed circle +
elapsed), Failed (red) or unread Done (emerald, check circle).

### Layout: a flat list, not nested groups

T3 does not nest threads under project groups. The rail is:

0. Chrome header (`SidebarChromeHeader`): collapse button (`SidebarMenuButton size="icon"`,
   panel-left glyph) at the left; nothing else that we adopt.
1. Fixed header (`SidebarGroup className="relative z-[1] gap-1 p-[var(--sidebar-content-inset)]"`,
   inset `0.5rem`):
   - Row 1: search field + "New thread" icon button.
     Field wrapper: `flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground`;
     `SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80"`;
     `<input type="search" placeholder="Search" aria-label="Search threads" role="combobox" aria-autocomplete="list" aria-expanded aria-controls="sidebar-thread-search-results" aria-activedescendant="sidebar-thread-search-result-{i}">`;
     clear button (`XIcon size-3`, `size="icon-micro" variant="ghost"`) only while searching.
     New thread: `SidebarMenuButton size="icon"` = `size-8 justify-center rounded-[var(--control-radius)] p-0` with `SquarePenIcon`, tooltip "New thread (⌘N)".
   - Row 2: project scope menu (`FolderIcon` or project favicon `size-4`, label
     "All projects" or the scoped project, `ChevronDownIcon -mr-px size-4`) as a
     `SidebarMenuButton` (`h-8 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] py-1.5 text-sm`,
     `font-medium text-sidebar-muted-foreground/80`, hover `bg-sidebar-row-hover`),
     radio items `h-8 min-h-8 py-0 text-sm font-medium`, plus a "New project"
     icon button (`FolderPlusIcon`).
2. Scrollable list `SidebarGroup className="ps-[calc(var(--sidebar-content-inset)+1px)] pe-[var(--sidebar-content-inset)] pb-1 pt-0"`
   containing one `<ul role="list" className="flex flex-col gap-px">`, in order:
   - pinned threads as full cards (`aria-label="Pinned threads"`), then a divider
     `mx-2.5 my-1.5 h-px bg-sidebar-border/60` (no header text; pin glyph carries meaning);
   - active threads as cards;
   - "Snoozed" shelf (not adopted, see below);
   - "Settled" shelf header: `mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left`,
     label `text-xs font-medium text-muted-foreground/50` reading `Settled` when
     expanded or `Settled (N)` when collapsed, rule `h-px flex-1 bg-sidebar-border/60`,
     `ChevronDownIcon size-3 ... transition-transform` rotated 180° when expanded;
     rows are slim; tail paginated by a `h-9` row `PlusIcon size-4` "Show N more"
     (`text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground`);
   - empty state `flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60`
     ("No threads yet" / "No threads in {project} yet" / "No projects yet" + "Add project" outline button).
3. Width: default `16rem`, min `13rem`, resizable (`threadSidebarWidth.ts`).

### Row surface (shared by both variants, `Sidebar.tsx:1112`)

```
group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none
active:   bg-sidebar-row-active text-sidebar-foreground
selected: bg-sidebar-row-selected text-sidebar-foreground
recede:   text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground
rest:     bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover
in-flight (not active/selected): opacity-70 transition-opacity hover:opacity-100
```

`shouldRecede = (ready || inFlight) && !unread && !woke && !active && !selected`.
Only rows that need a human (unread Done, Failed, Woke) render at full strength.
Rows use `[content-visibility:auto]` with `[contain-intrinsic-size:auto_96px]`
(card) / `auto_34px` (slim). Tokens (light: `--sidebar-row-hover: zinc-25`,
`--sidebar-row-active: white`, `--sidebar-row-selected: white`; dark:
`row-hover: contrast-foreground 8%`, `row-active: 11%`, `row-selected: 7%`).

### Card variant (pinned + active): `h-[4.875rem]`, `px-[0.625rem] py-[0.5rem]`, `li py-0.5`

- Line 1 (`flex h-5 min-w-0 items-center gap-1.5`): project favicon `size-4`,
  project title `min-w-0 flex-1 truncate text-secondary-label text-xs`
  (`font-medium`, or `font-normal` when receding), pin glyph
  (`PinIcon size-3 text-muted-foreground/65`, button "Unpin thread"), then the
  status slot `ml-auto flex h-5 min-w-8 shrink-0 ... text-xs tabular-nums`:
  status label at rest, hover swaps it (cross-fade, absolute positioning) for
  the Settle action (`CheckIcon size-3.5` + "Settle").
- Status labels (`Sidebar.tsx:848`, `inline-flex items-center gap-1 font-medium`):
  Working `text-sky-600 dark:text-sky-400` (+`opacity-75` unless active),
  `CircleDashedIcon size-4` + elapsed duration (`12s`, `3m`, `1h 2m`, no
  shimmer, no pulse); Monitoring sky, no icon; Approval `text-amber-700 dark:text-amber-300`;
  Input `text-indigo-600 dark:text-indigo-300`; Failed `text-red-700 dark:text-red-300`;
  Woke amber + `AlarmClockIcon`; Done `text-emerald-700 dark:text-emerald-300`
  - `CircleCheckIcon size-4` (unread completion only); otherwise the relative
    time label.
- Line 2 (`mt-1 flex min-w-0`): title `min-w-0 flex-1 text-sm truncate`,
  `font-medium` (or `font-normal` when receding), colour `text-foreground` when
  unread/woke, `text-secondary-label` when receding, `text-foreground/95` failed,
  else `text-foreground/90`; rename swaps in an input
  `rounded-sm border border-input bg-card px-1 text-sm font-medium`.
- Line 3 (`mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs`):
  worktree glyph `FolderGit2Icon size-3 text-muted-foreground/40` + branch
  `min-w-0 flex-1 truncate whitespace-nowrap`; terminal-running `TerminalIcon size-3.5 text-teal-600`
  with `animate-status-pulse` (2s stepped opacity 1 -> 0.5); PR badge `#123`
  (`text-xs tabular-nums hover:underline`, emerald/violet/red by state);
  diff stat `font-mono` (+n emerald / -n red); trailing `ServerIcon size-3.5`
  for remote and provider glyph `size-3.5 opacity-60`.

### Slim variant (settled/snoozed): `flex h-9 items-center gap-2.5 px-2.5`

Favicon (`opacity-40 grayscale`, restored on row hover), title
`truncate group-hover/sidebar-row:text-foreground` (`text-secondary-label/70`,
`text-muted-foreground` when unread, `text-foreground` when active), pin glyph,
terminal icon, PR badge, right slot `ml-auto flex h-6 min-w-8`: settled time
label (`text-xs tabular-nums text-secondary-label`, fades on hover) replaced by
the `Undo2Icon size-3.5` "Un-settle thread" button on hover.

### Search results (rail, title-only in T3) `Sidebar.tsx:1617`

`<ul id="sidebar-thread-search-results" role="listbox" aria-label="Thread search results" className="flex flex-col gap-px">`;
row `<button role="option" tabIndex={-1} aria-selected aria-current="page">`
`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none`,
highlighted/route-active `bg-sidebar-row-active text-sidebar-foreground`, else
`text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground`;
content: favicon `size-4`, title `min-w-0 flex-1 truncate`, time
`shrink-0 text-xs text-muted-foreground/55 tabular-nums`. Empty:
`<p role="status" className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">No threads found</p>`.
Keys (`handleThreadSearchKeyDown`): ArrowDown/ArrowUp wrap, Enter selects and
clears the query, Escape clears. `onMouseMove` highlights. Focus never leaves
the input (`aria-activedescendant`).

### Content search (T3 command palette, ⌘K) `CommandPaletteResults.tsx`

Server search (`OrchestrationSearchThreadsInput`: `query` trimmed, min 2, max
200 chars; `limit` 1..50; match = `{threadId, projectId, source: "user"|"assistant", snippet <= 240 chars, messageCreatedAt}`),
ranked client-side by title/project/branch/snippet. Row: title line
`flex min-w-0 items-center gap-1.5 text-sm text-foreground`, second line
`truncate text-xs text-muted-foreground/85` with prefix `You:` (`text-blue-400`)
or `Agent:` (`text-emerald-400`) and the snippet where every case-insensitive
occurrence of the query is `<mark className="bg-transparent font-semibold text-foreground">`;
timestamp `min-w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70`.

### Context menu (`threadActionMenu.logic.ts`), keybindings (`packages/shared/src/keybindings.ts`)

Menu order: New thread on {branch}; Pin/Unpin; Settle/Un-settle;
Snooze; (separator) Rename, Regenerate title, Mark unread; (separator) Copy >
Path / Branch / Thread ID; (separator) Archive (disabled while running);
Delete (destructive). Keys: `mod+b` sidebar.toggle, `mod+k` commandPalette,
`mod+n` chat.new, `mod+shift+[` / `mod+shift+]` thread.previous/next,
`mod+1..9` thread.jump (jump hint badges appear after 200 ms of holding mod).

## Verified starting point (ours)

- `src/components/agentMode/AgentThreadsSidebar.tsx` (321 lines): header
  "Threads 1/4 running", filter input + status picker, nested
  `AgentProjectSection` -> `AgentRepositorySubsection` -> `agentThreadBands`
  (RUNNING / NEEDS ATTENTION / IDLE labels) -> `AgentThreadRow`, per-repo
  "+ New thread" button, inline trust prompt, orphan list, overflow row.
- `AgentThreadRow.tsx` (85 lines): dot + title + mono meta line
  `Running · 10 minutes ago · model`, absolute pin button at `right: 9px`,
  row padding `8px 34px 8px 30px` (`agentMode.css:508`). The meta line and
  the 30px left inset plus band labels are what overflow at 268px.
- `agentModePresentation.ts` (1270 lines, flagged: below the 2000-line budget
  but a god file; this slice moves sidebar helpers out, it never adds to it).
- `AgentThreadView` (`agentThreadPorts.ts:113`): `thread, lifecycle,
repositoryLabel, projectOrigin, worktreeRemoved, worktreeMissing,
changeSummary, ship, editorAvailability, attention, unread`.
- `AgentThread` (`agentThread.ts:116`): `title, pinned, archived, createdAt,
updatedAtEpochMs, turns[] (prompt, status, events[] of assistantText |
reasoning | toolCall | toolResult | result | error | unknownLine,
startedAt/endedAt, launch), viewedAtEpochMs, integration`. Bounds:
  64 threads/root, 64 turns/thread, 512 events/turn, 16 KiB/event text.
- No settle, snooze, PR, terminal, remote or favicon concepts.
- `SearchEverywhere.tsx` provides the palette shell (`palette-backdrop`,
  `quick-open`, `palette-search`, `quick-open-results`) and
  `useWorkbenchKeyboardShortcuts` + `domain/keymap.ts` the keymap registry
  (`Cmd+K` is a chord prefix in our keymap, so the palette gets its own id).

## Mapping T3 elements to our model

| T3 element                                                              | Ours                                                                                                                                                                                     | Notes                                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project favicon                                                         | `FolderGit2` (worktree) / `Folder` (in place), lucide `size-4`                                                                                                                           | no favicons                                                                                                                                              |
| Project title (card line 1)                                             | `view.repositoryLabel`                                                                                                                                                                   | project label prefixed only when >1 project                                                                                                              |
| Working + duration                                                      | `attention === "running"`; start = running turn `startedAtEpochMs`                                                                                                                       | `CircleDashed` icon                                                                                                                                      |
| Failed (red)                                                            | last turn `failed` or `exited` with code != 0                                                                                                                                            |                                                                                                                                                          |
| Stopped (new, amber)                                                    | last turn `stopped` / `interrupted`                                                                                                                                                      | T3 has no such state; uses the Approval hue                                                                                                              |
| Done (emerald, unread only)                                             | `view.unread && attention === "settled"`                                                                                                                                                 | `CircleCheck` icon                                                                                                                                       |
| time label at rest                                                      | `AgentRelativeTime(updatedAtEpochMs)`                                                                                                                                                    | compact form `3m`, `2h`, `4d`                                                                                                                            |
| Branch line                                                             | `agentShipBranchLabel(view.ship)`; in-place -> "in place" muted                                                                                                                          |                                                                                                                                                          |
| Diff stat                                                               | `view.changeSummary` file count `N files` when loaded                                                                                                                                    | no +/- counts yet                                                                                                                                        |
| Provider glyph (line 3, right, `size-3.5 opacity-60`)                   | `thread.provider.kind`: `claudeCode` -> Claude asterisk `fill: #d97757`; `codex` -> OpenAI mark `fill: currentColor`                                                                     | new `AgentProviderGlyph.tsx` (inline SVG, 14 px, `aria-label="Claude Code"` / `"Codex"`); the user explicitly wants to see which provider ran the thread |
| Unread / attention marker                                               | `agent-row--unread` renders title at full strength plus the `Done` label; failed/stopped render the red/amber label; no band labels, no extra dots                                       | subtle, T3-exact                                                                                                                                         |
| Approval / Input / Monitoring / Snoozed / Woke / PR / terminal / remote | none                                                                                                                                                                                     | not rendered                                                                                                                                             |
| Project-level states (untrusted, background tab, tab closed)            | shown only inside the project dropdown rows: `ShieldAlert` + "Untrusted" (row action "Trust"), `Moon` + "Background", `Unplug` + "Tab closed" (row action "Release")                     | never as badges in the thread list                                                                                                                       |
| Settled shelf                                                           | **Archived** shelf: `thread.archived` threads as slim rows                                                                                                                               | honest label; no un-settle                                                                                                                               |
| Settle hover action                                                     | Archive (`CheckIcon`, "Archive thread", disabled while running)                                                                                                                          |                                                                                                                                                          |
| Un-settle hover action                                                  | none (we have no unarchive); slim row offers Delete in menu only                                                                                                                         |                                                                                                                                                          |
| Pinned block + divider                                                  | `thread.pinned`                                                                                                                                                                          | pin glyph unpins                                                                                                                                         |
| Project scope menu                                                      | entries = repository roots across trusted projects (`{project} / {repo}` when a project has several)                                                                                     | `AgentPickerMenu`                                                                                                                                        |
| New project                                                             | not applicable (workspaces come from editor tabs)                                                                                                                                        | omit button                                                                                                                                              |
| Trust prompt                                                            | moves to the project dropdown row ("Trust" action) and the centre column empty state (`AgentThreadSession` when the scoped repo is untrusted) with the existing "Trust to enable" button | never in the rail list                                                                                                                                   |
| Orphaned worktrees, overflow row                                        | move under the scope menu as a single muted row "N orphaned worktrees" opening the existing list in the info column                                                                      | rail stays a thread list                                                                                                                                 |

### Removed from the current sidebar (must not survive the rewrite)

`agent-rail__title` "Threads" heading and the "1/4 running" counter (the
count moves to `AgentStatusBar`, already there); the text filter + status
picker row (`agent-rail__filters`); `AgentProjectSection` /
`AgentRepositorySubsection` nested groups with chevrons and counts; the
BACKGROUND / TAB CLOSED origin badges (`agentProjectOriginBadge`) and the
"N live" pills; the inline `agent-trust` prompt; attention bands with
RUNNING / NEEDS ATTENTION / IDLE labels (`agentThreadBands`, `agent-band*`);
per-repository "+ New thread" buttons; the mono meta line
`Running · 10 minutes ago · model`; the always-present absolute pin button;
the orphan list and overflow row inside the list; the "Release project"
button (moves to the dropdown row). Helpers that become unused
(`agentThreadBands`, `agentThreadAttentionLabel` as band text,
`agentProjectOriginBadge`, `applyAgentThreadListQuery`, `agentThreadStatusCounts`,
`AGENT_THREAD_STATUS_FILTERS`) are deleted from `agentModePresentation.ts`
together with their tests, not left dead.

## Target DOM (ours)

```
<aside class="agent-rail" aria-label="Agent threads">
  <div class="agent-rail__chrome">
    <button class="agent-iconbutton" aria-label="Collapse sidebar" aria-expanded="true"><PanelLeftClose size=16/></button>
  </div>
  <div class="agent-rail__head">
    <div class="agent-rail__row">
      <div class="agent-search" data-active>
        <Search size=16/>
        <input class="agent-search__input" type="search" role="combobox" aria-label="Search threads"
               aria-autocomplete="list" aria-expanded aria-controls="agent-rail-search-results"
               aria-activedescendant="agent-rail-search-result-{i}" placeholder="Search" maxlength=200/>
        <button class="agent-search__clear" aria-label="Clear thread search"><X size=12/></button>
      </div>
      <button class="agent-iconbutton" aria-label="New thread" title="New thread (⌘N)"><SquarePen size=16/></button>
    </div>
    <div class="agent-rail__row">
      <AgentPickerMenu class="agent-scope" ... />         // "All projects" / scoped repo; no "new project" button
      // dropdown rows (radio, h 32): <Folder/> label, then optional state chip on the right:
      //   <ShieldAlert/> Untrusted  [Trust]   |   <Moon/> Background   |   <Unplug/> Tab closed  [Release]
    </div>
  </div>
  <div class="agent-rail__scroll">
    <!-- searching -->
    <ul id="agent-rail-search-results" role="listbox" aria-label="Thread search results" class="agent-list">
      <li><button id="agent-rail-search-result-0" role="option" aria-selected class="agent-row agent-row--slim agent-row--hit">
        <Folder/> <span class="agent-row__title">…</span>
        <span class="agent-row__snippet"><span class="agent-row__who agent-row__who--user">You:</span> …<mark>query</mark>…</span>
        <span class="agent-row__time agent-num">3m</span>
      </button></li>
    </ul>
    <p role="status" class="agent-rail__empty">No threads found</p>
    <!-- not searching -->
    <ul role="list" class="agent-list">
      <li class="agent-card-slot"><div role="button" tabindex data-thread-id class="agent-row agent-row--card [--on|--selected|--recede|--inflight]">
        <div class="agent-row__line1"><FolderGit2/> <span class="agent-row__project">repo</span>
          <button class="agent-row__pin" aria-label="Unpin thread"><Pin size=12/></button>
          <span class="agent-row__slot">
            <span class="agent-row__time agent-num">8m</span>                      // at rest (idle, read)
            <span class="agent-row__status agent-row__status--working"><CircleDashed/>Working <time>12s</time></span> // replaces time while working / failed / stopped / unread done
            <span class="agent-row__actions"><button aria-label="Archive thread"><Check/>Archive</button></span></span></div>
        <div class="agent-row__line2"><span class="agent-row__title">…</span></div>
        <div class="agent-row__line3"><span class="agent-row__branch">main</span><span class="agent-row__files">3 files</span>
          <span class="agent-row__provider agent-row__provider--claude" aria-label="Claude Code"><svg …/></span></div>
      </div></li>
      <li aria-hidden class="agent-list__divider"/>              // only when pinned > 0
      … active cards …
      <li><button class="agent-shelf" aria-expanded>Archived (4) <span class="agent-shelf__rule"/><ChevronDown size=12/></button></li>
      … <div class="agent-row agent-row--slim"> … <span class="agent-row__time">4d</span>
      <li><button class="agent-row agent-row--slim agent-row--more"><Plus size=16/>Show 20 more</button></li>
    </ul>
    <div class="agent-rail__empty-state">No threads yet</div>
  </div>
</aside>
```

## CSS (token-based, `agentMode.css` rail section rewritten)

New rail tokens on `.agent-mode` (all derived from existing primitives):
`--agent-rail-inset: 8px; --agent-rail-row-inset: 10px; --agent-rail-gap: 8px;
--agent-row-hover: var(--agent-hover); --agent-row-active: var(--agent-fill);
--agent-row-selected: color-mix(in srgb, var(--agent-fill) 70%, transparent);
--agent-row-radius: 6px; --agent-status-working: var(--agent-live);
--agent-status-done: var(--agent-ok); --agent-status-failed: var(--agent-danger);
--agent-status-stopped: var(--agent-attention); --agent-mark: color-mix(in srgb, var(--agent-live) 25%, transparent)`.

Scale: the screenshot is the binding size reference, so the rail is
`--agent-rail-width: 320px` (min 240 px), cards use `padding: 12px`,
`border-radius: 8px`, title `15px/20px`, project/branch/time `13px`, glyphs
16 px (line 1) and 14 px (provider). T3 source values at 100% zoom are
256 px / 10 px inset / 6 px radius / 14 px / 12 px; the ratios below are
T3's, the absolute numbers follow the screenshot. Provider colours:
`.agent-row__provider--claude { color: #d97757 }` (brand constant, not a
theme token, identical in T3), `.agent-row__provider--codex { color: var(--agent-text-strong) }`,
both `opacity: .6`, full opacity on the active card.

Rules (T3 ratios; px values already scaled as described above):

- `.agent-rail__head { padding: 8px; display: grid; gap: 4px }`,
  `.agent-rail__row { display: flex; align-items: center; gap: 4px }`.
- `.agent-search { flex: 1; min-width: 0; height: 32px; display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 6px; font-size: 14px; font-weight: 500; color: var(--agent-text-muted) } .agent-search:hover, .agent-search:focus-within { background: var(--agent-row-hover); color: var(--agent-text-strong) }`,
  `.agent-search__input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; font: inherit; color: var(--agent-text-strong) }`.
- `.agent-iconbutton { width: 32px; height: 32px; border-radius: 6px; display: inline-flex; justify-content: center; align-items: center; color: var(--agent-text-subtle) } :hover { background: var(--agent-row-hover); color: var(--agent-text-strong) }`.
- `.agent-scope` = picker trigger stretched `width: 100%; height: 32px; padding-inline: 10px; font-size: 14px; font-weight: 500`.
- `.agent-rail__scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 4px 9px }`,
  `.agent-list { display: flex; flex-direction: column; gap: 1px; list-style: none; margin: 0; padding: 0 }`.
- `.agent-row { position: relative; width: 100%; border-radius: 6px; text-align: left; cursor: pointer; overflow: hidden; color: var(--agent-text-strong); background: transparent; transition: background-color, color, opacity var(--agent-motion-hover) } .agent-row:hover { background: var(--agent-row-hover) } .agent-row--selected { background: var(--agent-row-selected) } .agent-row--on { background: var(--agent-row-active) } .agent-row--recede { color: color-mix(in srgb, var(--agent-text-muted) 75%, transparent) } .agent-row--inflight:not(.agent-row--on) { opacity: .7 } .agent-row--inflight:hover { opacity: 1 }`.
- `.agent-card-slot { padding: 2px 0; content-visibility: auto; contain-intrinsic-size: auto 96px }`,
  `.agent-row--card { min-height: 84px; padding: 12px; border-radius: 8px }`,
  `.agent-row__line1 { display: flex; align-items: center; gap: 6px; height: 20px; min-width: 0 }`,
  `.agent-row__project { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; color: var(--agent-text-muted) }`,
  `.agent-row__slot { margin-left: auto; position: relative; display: flex; height: 20px; min-width: 32px; justify-content: flex-end; font-size: 12px; font-variant-numeric: tabular-nums }`,
  `.agent-row__status { display: inline-flex; align-items: center; gap: 4px; font-weight: 500; transition: opacity } .agent-row:hover .agent-row__status { position: absolute; right: 0; opacity: 0; pointer-events: none }`,
  `.agent-row__actions { position: absolute; inset-block: 0; right: 0; display: flex; opacity: 0; pointer-events: none } .agent-row:hover .agent-row__actions, .agent-row__actions:has(:focus-visible) { position: static; opacity: 1; pointer-events: auto }`,
  status colours: `--working { color: var(--agent-status-working) } .agent-row:not(.agent-row--on) .agent-row__status--working { opacity: .75 }`, `--done { color: var(--agent-status-done) }`, `--failed { color: var(--agent-status-failed) }`, `--stopped { color: var(--agent-status-stopped) }`.
- `.agent-row__line2 { margin-top: 4px; display: flex; min-width: 0 }`,
  `.agent-row__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500 } .agent-row--recede .agent-row__title { font-weight: 400; color: var(--agent-text-muted) } .agent-row--unread .agent-row__title { color: var(--agent-text-strong) }`.
- `.agent-row__line3 { margin-top: 2px; display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; color: var(--agent-text-muted) }`,
  `.agent-row__branch { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`.
- `.agent-row--slim { height: 36px; display: flex; align-items: center; gap: 10px; padding: 0 10px; font-size: 14px; content-visibility: auto; contain-intrinsic-size: auto 34px } .agent-row--slim .agent-row__title { font-weight: 400; color: color-mix(in srgb, var(--agent-text-muted) 70%, transparent) } .agent-row--slim:hover .agent-row__title, .agent-row--slim.agent-row--on .agent-row__title { color: var(--agent-text-strong) } .agent-row--slim .agent-row__icon { opacity: .4; filter: grayscale(1) } .agent-row--slim:hover .agent-row__icon { opacity: 1; filter: none }`,
  `.agent-row__time { margin-left: auto; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--agent-text-subtle) }`.
- `.agent-row__pin { display: inline-flex; color: color-mix(in srgb, var(--agent-text-muted) 65%, transparent); border-radius: 2px } :hover { color: var(--agent-text-strong) }`; pinned cards only (no hover-reveal pin on unpinned rows: pinning is a context-menu action, as in T3).
- `.agent-list__divider { margin: 6px 10px; height: 1px; background: color-mix(in srgb, var(--agent-hairline) 60%, transparent) }`.
- `.agent-shelf { margin: 12px 0 4px; display: flex; width: 100%; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px; font-weight: 500; color: color-mix(in srgb, var(--agent-text-muted) 50%, transparent) } .agent-shelf__rule { flex: 1; height: 1px; background: color-mix(in srgb, var(--agent-hairline) 60%, transparent) } .agent-shelf[aria-expanded="true"] svg { transform: rotate(180deg) }`.
- `.agent-row__snippet { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: color-mix(in srgb, var(--agent-text-muted) 85%, transparent) } .agent-row__who--user { color: var(--agent-live) } .agent-row__who--agent { color: var(--agent-ok) } .agent-row__snippet mark { background: transparent; font-weight: 600; color: var(--agent-text-strong) }`;
  search hit rows are `height: auto; min-height: 36px; padding: 6px 10px; display: grid; grid-template-columns: auto 1fr auto; row-gap: 2px` so the snippet sits under the title.
- `.agent-rail__empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 8px; text-align: center; font-size: 12px; color: color-mix(in srgb, var(--agent-text-muted) 60%, transparent) }`.
- Removed: `.agent-project*`, `.agent-group*`, `.agent-band*`, `.agent-trust` (moves to centre), `.agent-thread*`, `.agent-rail__filters`, `.agent-rail__title/__count`. Variants A/B/C keep working because only tokens are consumed. `--agent-rail-width` becomes 320px with `min-width: 240px` (fixed this slice; resizer is open question 1).

## States and keyboard / a11y

Row states: `on` (route-active thread), `selected` (multi-select is out of scope; class reserved), `recede`, `inflight`, `unread`, `pinned`. Exhaustive status mapping lives in `agentSidebarPresentation.ts`:

```ts
export type AgentRowStatus =
  | { kind: "working"; startedAtEpochMs: number }
  | { kind: "failed" }
  | { kind: "stopped" }
  | { kind: "done" }
  | { kind: "none" };
export function agentRowStatus(view: AgentThreadView): AgentRowStatus;
export function agentRowRecedes(
  view: AgentThreadView,
  status: AgentRowStatus,
  on: boolean,
): boolean;
export function agentRailSections(
  views,
  scope: AgentRailScope,
  archivedExpanded,
  archivedShown,
): AgentRailSections; // { pinned, active, archived, hiddenArchivedCount }
export function agentRailScopeEntries(groups): ReadonlyArray<AgentRailScopeEntry>;
```

Ordering: pinned by `updatedAtEpochMs` desc; active by `updatedAtEpochMs` desc
(T3 sorts the inbox by activity; no attention bands); archived by
`updatedAtEpochMs` desc, page size 20 (`ARCHIVED_PAGE_COUNT`).

Keyboard (rail): list keeps the existing roving tabindex (`ArrowUp/Down`,
`Home/End`, `Enter`/`Space` select, `p` pin, `Escape` focuses search).
New: `⌘N` new thread (new keymap command `agent.newThread`), `⌘⇧[` / `⌘⇧]`
previous/next thread (`agent.previousThread` / `agent.nextThread`),
`⌘1..9` jump (`agent.jumpToThread.N`) with the T3 jump badge
(`agent-row__jump`, shown after holding ⌘ 200 ms, `THREAD_JUMP_HINT_SHOW_DELAY_MS`).
Context menu (right-click, `AgentThreadRowMenu` reusing `AgentPickerMenu`
list styles): Pin/Unpin, Rename, Mark unread (sets `viewedAtEpochMs: null`
via a new `threadMarkedUnread` action), Copy > Path / Branch / Thread ID,
Archive (disabled while running), Delete. All labels copy T3 verbatim.

Search field: `role="combobox"`; results `role="listbox"` + `aria-activedescendant`;
Enter opens the highlighted hit and clears the query; Escape clears (second
Escape blurs); `onMouseMove` highlights; `aria-live` status "N results".
Palette: same as `SearchEverywhere` (`ArrowUp/Down`, Enter, Escape). Find bar:
Enter / `⇧Enter` next/previous, Escape closes and returns focus to the
session scroll container; count `3 of 12` in `aria-live="polite"`.

## Search feature

### Domain (`src/domain/agentThreadSearch.ts`, new, pure, <= 260 lines)

```ts
export const MIN_THREAD_SEARCH_QUERY_CHARS = 2; // T3
export const MAX_THREAD_SEARCH_QUERY_CHARS = 200; // T3
export const MAX_THREAD_SEARCH_RESULTS = 50; // T3 limit max
export const MAX_THREAD_SEARCH_SNIPPET_CHARS = 240; // T3
export const MAX_THREAD_SEARCH_DOC_BYTES = 64 * 1024; // per thread, newest turns first
export const MAX_THREAD_SEARCH_SEGMENTS = 512; // per thread

export type AgentThreadSearchSource = "title" | "user" | "assistant";
export interface AgentThreadSearchSegment {
  readonly source: AgentThreadSearchSource;
  readonly turnId: string | null;
  readonly eventIndex: number | null;
  readonly text: string;
  readonly lower: string;
}
export interface AgentThreadSearchDocument {
  readonly threadId: string;
  readonly updatedAtEpochMs: number;
  readonly titleLower: string;
  readonly segments: ReadonlyArray<AgentThreadSearchSegment>;
  readonly truncated: boolean;
}
export interface AgentThreadSearchMatch {
  readonly threadId: string;
  readonly source: AgentThreadSearchSource;
  readonly turnId: string | null;
  readonly eventIndex: number | null;
  readonly snippet: string;
  readonly ranges: ReadonlyArray<{ start: number; end: number }>;
  readonly score: number;
}
export interface AgentThreadSearchResult {
  readonly query: string;
  readonly matches: ReadonlyArray<AgentThreadSearchMatch>;
  readonly truncated: boolean;
}

export function normalizeThreadSearchQuery(raw: string): string | null; // trim, clip 200, lower, null when < 2
export function buildAgentThreadSearchDocument(thread: AgentThread): AgentThreadSearchDocument; // title + per turn: prompt (user), assistantText + result (assistant); tool/reasoning/raw excluded
export function searchAgentThreadDocuments(
  docs: ReadonlyArray<AgentThreadSearchDocument>,
  query: string,
  limit?: number,
): AgentThreadSearchResult; // one best match per thread, ranked
export function threadSearchSnippet(
  segment: AgentThreadSearchSegment,
  index: number,
  queryLength: number,
): { snippet: string; ranges }; // 240 chars centred on the hit, ellipses
export function findInThread(thread: AgentThread, query: string): ReadonlyArray<AgentThreadFindHit>; // { turnId, eventIndex | "prompt", start, end } capped at 500
```

Ranking (ported from `searchRanking.ts`): title exact 0, title prefix 100 +
length penalty, title includes 200 + 2*index, content includes 400 +
recency tiebreak (`updatedAtEpochMs` desc), then `threadId`. Insert into a
bounded sorted array (`insertRankedSearchResult`, limit 50). Case folding is
`toLowerCase()` once at document build time; matching is `indexOf` on the
folded text (no regex, no user-derived patterns).

### Application (`src/application/useAgentThreadSearch.ts`, new, <= 220 lines)

```ts
export interface AgentThreadSearchSurface {
  readonly query: string; // raw input, clipped
  readonly active: boolean; // normalized query !== null
  readonly result: AgentThreadSearchResult | null;
  readonly pending: boolean;
  setQuery(raw: string): void;
  clear(): void;
}
export function useAgentThreadSearch(
  views: ReadonlyArray<AgentThreadView>,
  options?: { debounceMs?: number; limit?: number },
): AgentThreadSearchSurface;
```

- Incremental index: a `Map<threadId, AgentThreadSearchDocument>` in a ref;
  on every `views` change rebuild only threads whose `updatedAtEpochMs` or
  object identity changed and drop ids no longer present. Never rebuilds all
  documents per keystroke.
- Debounce 120 ms (`useDeferredValue` for the input echo, timer for the
  search); each run captures a generation and the current id set; when the
  timer fires it runs `searchAgentThreadDocuments` synchronously (worst case
  64 threads x 64 KiB = 4 MiB `indexOf`, measured target < 8 ms) and publishes
  only if the generation is still current. Results referencing ids not in the
  latest `views` are dropped (fail closed) before publish.
- Owner isolation: `views` are already the exact-owner projection built by
  `useAgentThreads` (leased roots only); the hook holds no cross-workspace
  state, and `AgentModeScreen` keys `AgentModeView` on the workspace root it
  receives (`key={workspaceRoot}`), so every switch (including A -> B -> A)
  remounts the view, resetting rail scope, selection, search and find state
  and dropping the index. A test asserts a result
  for a thread removed between debounce and publish never appears.
- Memory: index bytes <= 64 threads x roots x 64 KiB; documents are dropped
  with the thread.

### UI

1. Rail (`AgentThreadsSidebar.tsx` + `AgentThreadSearchResults.tsx`): field
   in the header; when `search.active`, the list is replaced by the results
   listbox (title hits show only the title; content hits add the
   `You:`/`Agent:` snippet line with `<mark>`). Enter/click selects the
   thread and, for content hits, asks the session to reveal the hit
   (`onSelectThread(threadId, { reveal: { turnId, eventIndex, start, end } })`).
2. Palette (`AgentThreadSearchPalette.tsx`, new, <= 220 lines): opened by
   `agent.searchThreads` (default `Cmd+Shift+K` in agent mode; `Cmd+K` stays a
   chord prefix in our keymap) and by the workbench `Search Everywhere` while
   agent mode is active. Reuses `palette-backdrop` / `quick-open` /
   `palette-search` / `quick-open-results` classes plus one section "Threads"
   with the T3 palette row (`quick-open-row agent-palette-row`: title line,
   snippet line, time). Same `useAgentThreadSearch` instance as the rail
   (lifted into `AgentModeView`) so both stay consistent and one index exists.
3. In-thread find (`AgentThreadFindBar.tsx`, new, <= 160 lines): `Cmd+F`
   while focus is inside `.agent-session` (command `agent.findInThread`);
   bar docked under the session header (`agent-find`: input, `N of M`,
   prev/next `ChevronUp/Down` buttons, close). `findInThread` runs on the
   selected thread only (debounced 80 ms, <= 500 hits); the session renders
   `<mark class="agent-find__hit" data-hit-index>` inside prompt bodies and
   assistant paragraphs via a `highlightRanges` prop on `AgentTurnRecord`,
   and scrolls the current hit into view (`scrollIntoView({ block: "center" })`,
   `agent-find__hit--current`). Reveal requests from search open the bar
   pre-filled with the query and jump to that hit.

### Bounds and failure modes

Query < 2 chars: inactive (no results, no state change). Query > 200 chars:
clipped at the input (`maxLength`). Documents > 64 KiB or > 512 segments:
`truncated: true`, oldest turns dropped first, rail shows "Older messages not
searched" under the results (T3 shows nothing here; we expose the bound).
More than 50 matching threads: `truncated: true`, footer "Showing first 50".
Thread deleted/archived mid-search: removed on next publish; a reveal for a
missing turn is ignored. Search never touches IPC, the filesystem or Rust.
Case folding uses `toLowerCase()` on the whole segment; for the rare code
points whose lowercase form changes string length (for example U+0130 "İ"
lowercases to two UTF-16 units) offsets in the folded text drift from the
original, so a snippet range or reveal offset after such a character can be
off by the length difference. Accepted limitation; no code compensates for it.

## What we will NOT copy (T3 product model we lack)

Environments/remote servers (`ServerIcon`, environment labels), project
favicons, settle/snooze/woke lifecycle and their shelves (only an Archived
shelf), pull request badges and linking, terminal-running indicator,
Approval/Input/Plan Ready/Monitoring states, drafts block, multi-select and
bulk actions, drag-reorder of pinned threads, title regeneration, "New project"
button, jump hints when only one thread exists, provider instance badges.
Each is listed so nobody fakes it with placeholder UI.

## File ownership and implementation streams (disjoint write scopes)

S0 (lead, first, sequential): create `src/domain/agentThreadSearch.ts` with
the exported types and stub bodies, add `AgentRowStatus` + section types to a
new `src/components/agentMode/agentSidebarPresentation.ts`, add the
`threadMarkedUnread` action to `agentThread.ts` (+ reducer + wire test), add
keymap ids `agent.newThread`, `agent.previousThread`, `agent.nextThread`,
`agent.jumpToThread.1..9`, `agent.searchThreads`, `agent.findInThread` to
`domain/keymap.ts`, extend `AgentThreadsSidebarProps` with `search`, `scope`
and menu handlers so `npm run check` passes before parallel work.

Then in parallel:

- **A: Domain search** - `src/domain/agentThreadSearch.ts` + `agentThreadSearch.test.ts`
  (normalisation, document bounds, ranking order, snippet centring, surrogate
  pair safety, truncation flags, `findInThread` cap). Forbidden: application,
  components. Validate: `npx vitest run src/domain/agentThreadSearch`.
- **B: Application search hook** - `src/application/useAgentThreadSearch.ts`
  - test (incremental rebuild counts via a spy on `buildAgentThreadSearchDocument`,
    debounce with fake timers, stale-generation drop, removed-thread fail
    closed, `act`/`waitFor`). Forbidden: domain (consumes A's contract),
    components. Validate: `npx vitest run src/application/useAgentThreadSearch`, `npm run check`.
- **C: Sidebar UI** - `AgentThreadsSidebar.tsx` (shell, header, scope,
  keyboard; <= 300), `AgentThreadList.tsx` (replaces `AgentThreadsSidebarGroups.tsx`:
  pinned/active/archived sections, divider, shelf, pagination, empty state;
  <= 260), `AgentThreadRow.tsx` (card + slim variants, status slot, hover
  actions, context menu trigger; <= 260), `AgentThreadRowMenu.tsx` (<= 140),
  `agentSidebarPresentation.ts` (+ test; helpers moved out of
  `agentModePresentation.ts`, which only loses code), rail section of
  `agentMode.css`, `AgentThreadsSidebar.test.tsx` rewritten (flat list,
  ordering, recede rules, status labels, shelf toggle, pagination, hover
  action visibility via class, keyboard, jump badges, context menu).
  Forbidden: search files, `AgentThreadSession.tsx`, `AgentModeView.tsx`
  beyond prop plumbing agreed in S0. Validate: `npx vitest run src/components/agentMode/AgentThreadsSidebar src/components/agentMode/agentSidebarPresentation`,
  `npm run lint -- --max-warnings 0`, `npm run size:hotspots`.
- **D: Search UI** - `AgentThreadSearchResults.tsx` (rail listbox; <= 160),
  `AgentThreadSearchPalette.tsx`, `AgentThreadFindBar.tsx`, `highlightRanges`
  support in `AgentThreadSession.tsx` (+ tests), search/find CSS block
  appended to `agentMode.css` under a `/* Thread search */` banner (C owns
  the rail block; D appends only), keymap wiring in
  `workbenchAgentCommands.ts`. Validate: `npx vitest run src/components/agentMode/AgentThreadSearch src/components/agentMode/AgentThreadFindBar src/components/agentMode/AgentThreadSession`.
- **E: Integration (lead)** - `AgentModeView.tsx` (lift `useAgentThreadSearch`,
  scope state, trust notice relocation, reveal plumbing), `App.tsx` command
  wiring, preview playground update (`src/preview/agentPreview.tsx`).
- **F: Review (read-only, different model)** - adversarial review of A-E
  against this spec: overflow at 208 px rail width, long titles/branches,
  100-thread lists, rapid typing, workspace A -> B -> A, archived-while-
  searching, reveal of a truncated turn.

Full gates before "done": `npm run check`, `npm run lint -- --max-warnings 0`,
`npm run size:hotspots`, `npm run format:check`, `npm run format:check:changed`,
`npm test -- --run`, `git diff --check`; Rust gates unchanged but run
(`cargo check --all-targets`, `cargo test --lib`, `cargo test --tests`,
`cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`)
because `agentThread.ts` gains an action mirrored nowhere in Rust (confirm no
wire change; `viewedAtEpochMs: null` already serialises).

## Performance evidence required

- Benchmark test: 64 threads x 64 turns with 16 KiB assistant text; document
  build < 50 ms total, incremental rebuild of one thread < 2 ms, search of a
  2-char query < 8 ms (skipped under CI slowness, logged locally).
- Rail render: 200 rows with `content-visibility: auto`; typing in the search
  field must not rerender `AgentThreadSession` (assert render count via test
  wrapper) and status ticks stay inside `AgentRelativeTime`/`WorkingDuration`.

## Open questions

1. Rail width persistence (T3 stores it): keep fixed 256 px this slice or add
   `agentRailWidth` to workspace UI state? Default: fixed.
2. Should "Archived" also hide from the palette results as T3 hides archived
   threads from its palette? Default: yes, unless the query is typed in the
   rail while the Archived shelf is expanded.
3. `Cmd+Shift+K` vs reusing `Search Everywhere` only. Default: both.
