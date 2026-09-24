# Redesign P4 - Sidebar, thread management, Agents panel, F1, F2, B3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the agent sidebar, thread management, subagent batch rows and Agents panel to match `docs/redesign/v3-sidebar-agents.html`. Ship F1 (one thread list across all projects, with a project filter), F2 (Retry in the thread error banner) and B3 (Codex `collabAgentToolCall` spawns become typed events and use the same batch row and Agents panel as Claude).

**Architecture:** Presentation stays in focused React components under `src/components/agentMode/`. They consume P1 tokens (`--cv-*`) and P1 foundation components (`src/ui/foundation`). F1 adds a pure filter model (`agentRailFilter.ts`) next to the existing "active project" (`railScope`) in `useAgentThreadNavigation`. The active project keeps its authority and generation capture unchanged. F2 adds a pure retry plan (domain) and a retry coordinator hook (application) that reuses `AgentThreadsSurface.sendFollowUp`, so admission, authority and generation checks stay where they are. B3 adds one Codex protocol item, one NDJSON event and one persisted `AgentTurnEvent` kind (`subagentSpawn`), all mirrored on the TS and Rust sides with contract tests. The existing subagent lifecycle builder then turns spawns into batch members with task titles.

**Tech Stack:** React 19 + TypeScript (Vitest, @testing-library style `act`/`waitFor` helpers already used in the repo), Rust (serde, Tauri 2), lucide-react icons, P1 tokens `src/ui/tokens/*.css` and foundation `src/ui/foundation/*`.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1.5 Sidebar, §3.1.6 Agents, §3.2 B3, §3.3 F1/F2, §4 contracts, §5 P4, §6 testing, §7 decisions). Mockup: `docs/redesign/v3-sidebar-agents.html` (states: default, search, menu, rename, collapsed, subagents, agents, approval, question, error). Filter popover: `docs/redesign/v3-projects-clone.html` (`#scopePop`, the "Projects" state). Shell: `docs/superpowers/plans/2026-09-24-redesign-p2-app-shell.md`.

## Global Constraints

- The approved mockups are the source of truth. Where a mockup and the spec disagree, the spec wins; where the spec is silent, the mockup wins (spec §2).
- Feature CSS uses only `--cv-*` tokens from `src/ui/tokens/`. No colour literals and no `--codevo-*` or `--color-*` reads in new or rewritten rules (spec §3.1.1, §4).
- Sizes are copied verbatim from the mockup: sidebar `var(--cv-sidebar-w)` (256px); card row height 78px with 8px/10px padding and `var(--cv-r-control)` radius; search field 32px; settled shelf 36px; menu items 28px, min-width 224px (submenu 176px); Agents panel 400px; agents row 62px; agents footer 32px; spawn header min-height 26px; thread error banner as wide as `var(--cv-column)` (768px).
- All 6 palettes × dark/light must stay readable, and every text pair must meet WCAG AA (spec §3.1.1). QA covers Graphite · Teal dark + light and one other palette (spec §6).
- `prefers-reduced-motion`: every new transition and animation (`cv-pulse`, `cv-spin`, the opacity fades) uses `var(--cv-motion-*)` or is disabled under the media query (spec §3.1.1).
- Hotspots: production files stay under 2000 lines and 10000 structural tokens (`npm run size:hotspots`). `AgentModeView.tsx` and `AgentThreadSession.tsx` must shrink or stay flat, and new surfaces get their own modules (spec §4). `src/domain/agentThread.ts` is at 9248/10000 tokens, so new event types go in a new domain module.
- Wire contracts: B3 adds a Codex event kind to the TS/Rust wire contracts, with tests on both sides (spec §4). The IPC payloads stay closed and bounded, and unknown fields and variants are rejected fail-closed (CLAUDE.md).
- Workspace isolation: capture the owner or generation before every await, revalidate after it, and let late or foreign results fail closed (CLAUDE.md "Workspace and async isolation").
- Implementation and review agents are Opus 5.5 only. UI QA uses Codex Computer Use against the QA bundle `dev.mockor.editor.qa` (spec §7.1).
- No code comments. The only exceptions are tool-required annotations with no prose (user global rule).
- Tests exercise real collaborators. Fakes are allowed only for Tauri/IPC gateways, which are the external boundary. React tests settle with `act`/`waitFor`; never silence warnings (CLAUDE.md).
- Never use CodeRabbit. Review is done by a separate read-only Opus 5.5 agent (CLAUDE.md, memory).
- Subagents never run mutating git commands. The lead commits on `main` with no AI attribution and does not push or tag (CLAUDE.md, memory "Subagents: read-only git").
- Check verification exit codes directly (`echo $?` or `set -o pipefail`), never through `| tail` (memory "Verify exit codes not pipes").
- Run `prettier --write` only on files this phase owns (memory "Prettier write only owned files").

## Review Focus

1. **Codex spawn whose receivers arrive only on `item/completed`, a spawn that fails, or two spawns in a row.** Expected: one member per child with the spawn's task title, no duplicate member, no "Subagent" placeholder left behind after the child is known, and a failed spawn shows as one failed member. Pinned by Task 4, test "merges a spawn placeholder into the child thread entry once receivers are known" and its siblings.
2. **All-projects list while projects come and go.** A filtered project is closed or removed, a thread is selected from another project through the palette, or the user goes workspace A → B → A. Expected: the filter falls back to All projects when its project disappears, reveals the selected thread's project when needed, and bulk actions never touch threads whose owner changed. Pinned by Task 7 (`agentRailFilter.test.ts`, `agentThreadBulkAction.test.ts`) and Task 8 (`useAgentThreadNavigation.filter.test.tsx`).
3. **Retry pressed twice, or pressed after the thread started running or a newer turn arrived.** Expected: exactly one `sendFollowUp`, sent only when the failed turn is still the thread's last turn and the thread is idle. Otherwise nothing is sent and the banner disappears or stays truthful. Pinned by Task 13 (`useAgentTurnRetry.test.tsx`).
4. **Sidebar Approval/Input statuses with more than 8 running threads, a stale turn, and thread switching.** Expected: bounded polling (at most 8 threads, one thread at a time, every 2 s), no status left on a row whose running turn changed, and no request after unmount. Pinned by Task 10 (`useAgentPendingInteractions.test.tsx`).
5. **Keyboard-only thread management.** Shift+F10 or the ContextMenu key on a focused row opens the context menu at the row. Arrow keys, submenus, Escape, rename with Enter/Escape and the delete confirmation all work without a pointer, and focus returns to the row. Pinned by Task 11 (`AgentThreadContextMenu.test.tsx`).

---

## Current code (mapped 2026-09-24)

- **Scoping:** `useAgentThreadStore` loads threads for every open project into one map. `AgentModeView` builds `groups` for all projects. `useAgentThreadNavigation` holds `railScope`, which is one project with authority `{ownerId, generation}`. That scope drives the composer target (`composerScope`), New thread (`agentRailNewThreadTarget`), search (`useAgentThreadSearch(scopedViews)`), ⌘1-9 and next/prev (`orderedRailThreadIds`), and the sidebar list (`agentRailSections(views, scope, …)` filters through `scopeIncludes`). `selectThread` switches `railScope` to the selected thread's project. No data is per-project except this filter, so F1 is a navigation-level change.
- **Sidebar:** `AgentThreadsSidebar.tsx` (596 lines), `AgentRailHeader.tsx` (search, New thread, `AgentProjectScopeMenu`, Add project, scope-state row, notes), `AgentThreadList.tsx` (sections, drag markers, archived shelf, empty states), `AgentThreadRow.tsx` (card/slim variants, right-click menu at the cursor, inline rename, pin button, Archive hover action, provider glyph), `AgentThreadRowParts.tsx` (`StatusSlot`, `RenameInput`), `AgentThreadRowMenu.tsx` (custom menu, Move up/down, snooze picker, two-click delete), `AgentThreadSearchResults.tsx` (You:/Agent: snippets with `<mark>`), `agentSidebarPresentation.ts` (1181 lines: row status, menu entries, sections, scope, project menu, provider footer). `useAgentThreadMenuCommands.ts` executes the commands. `agentRail.css` (1451 lines) uses `--codevo-*`.
- **Statuses today:** Working (with background/monitoring variants), Failed, Stopped, Done. Approval, Input and "N agents" do not exist. Approvals and questions are polled only for the open thread (`useAgentApprovals`/`useAgentQuestions`, 1 s).
- **Errors:** there is no thread-level error banner. Failed turns render inline (`AgentTurnView` "run failed" finale, `AgentProviderErrorHint`, `agentTurnEndMarker`). `agentProviderErrorHeadline` already produces "<Provider> could not complete this run.". Nothing supports retrying: `sendFollowUp(request)` is the only entry point, and admission, authority and generation checks live in `useAgentTurnDispatch`/`agentTurnAdmission`.
- **Codex subagents:** `collabAgentToolCall` is in `IGNORED_THREAD_ITEM_TAGS`, so it is dropped. Children arrive as `subAgentActivity` (whose item `id` equals the spawn call id), `subagentItem`, `usage{scope:subagent}` and `subagentTurnCompleted`. In TS, `agentSubagentDisclosureEntries` puts every Codex child into batch `"turn"` titled by the last `agentPath` segment. `agentTurnProjection` also pushes a `subagentGroup` item that `AgentTurnItemView` renders as `<details class="agent-reasoning">` with the child's nested tool calls, so every child renders twice.
- **Agents panel:** `useAgentThreadAgents` (called inside `AgentThreadSession`) computes per-turn groups and owns the open state. `AgentAgentsDock` renders `AgentAgentsPanel` docked or as an overlay inside the session.
- **Shared contracts:** `src/domain/fixtures/agent-turn-event-kinds.json` (18 kinds) is checked by `agentThreadWire.test.ts` and `src-tauri/src/agent_thread_store_event_wire_tests.rs`. `contracts/agent-subagent-lifecycle-wire.json` is checked by `agentThreadWire.subagentLifecycle.test.ts` and `agent_subagent_lifecycle.rs` tests. The Rust NDJSON golden files are read by `src/domain/agentOutput/codexAppServer.test.ts`.

## Key decisions

1. **F1 separates the filter from the active project.** `railFilter: {kind:"all"} | {kind:"project", projectRootKey}` (default `all`) decides which threads the list, search, ⌘1-9 and next/prev see. `railScope` stays the active project: it is the composer and New thread target and follows the selected thread. Its authority capture is unchanged. Choosing a project in the filter sets both. Choosing "All projects" changes only the filter. `setProjectScope` moves a single-project filter to the new project, and `selectThread` widens the filter to reveal the selected thread. The filter is kept in the navigation session (per window, survives remounts). It is not persisted to disk, because t3code persists it in a UI store and our navigation session is the equivalent owner.
2. **Ordering across projects** keeps `compareAgentThreadOrder`, which is deterministic. Drag and Move up/down still reorder only within one project and section, because `agentThreadReorderPlan` rejects foreign owners. A drop onto another project's row is a no-op, and the drop marker is not shown for it.
3. **Bulk actions across projects:** `AgentThreadBulkRequest` swaps `ownerKey: string` for `ownerKeys: ReadonlyMap<threadId, rootKey>`, captured when the selection is committed. `agentThreadBulkPlan` skips any thread whose owner changed (`foreignOwner`).
4. **Move to > Project:** no code path can move a thread record, its worktree, turn log and provider session between project roots safely. Moving a thread would break resume, because Claude sessions are keyed by cwd. The submenu therefore lists the thread's own project as checked and the other projects as disabled items with the reason "Moving threads between projects is not supported yet." This is reported as a remaining gap, not claimed.
5. **Row line 3** shows `N files`, not `+a −d`. No line counts exist for thread change summaries (`AgentTaskChangeSummary.files: GitChangedFile[]`), and inventing them would be a false claim. Remaining gap.
6. **Sidebar search stays inline thread search** (spec §3.1.5 and the mockup "search" state). The command palette (P5) opens with ⌘K only. P5 agreed.
7. **Sidebar statuses:** Approval and Input come from a bounded application poller over running local threads, reusing the existing gateways. "N agents" comes from the running turn's retained `subagentLifecycle` (at most 32 entries, O(1) per update). Remote threads get no Approval/Input status, which is truthful because remote interactions are not polled.
8. **B3 wire:** Rust maps only `tool: spawnAgent` on the root thread to NDJSON `{"t":"subagentSpawn"}`. It carries the call id, status, task title (first non-empty prompt line, whitespace-collapsed, at most 480 bytes), model (at most 64 bytes), reasoning effort (closed set) and receiver thread ids (at most 32). Other collab tools (`wait`, `sendInput`, `closeAgent`, …) and nested spawns from child threads stay dropped. TS persists it as `AgentTurnEvent` kind `subagentSpawn`. The lifecycle builder merges it into the child's `thread:<id>` entry (task title, batch key, model, effort). Consecutive spawns share one batch, which is exactly Claude's `openBatchKey` rule. The lifecycle contract gains optional `model` (64 bytes) and `effort` (16 bytes).
9. **B3 duplicate removal:** the `subagentGroup` item and `AgentSubagentGroupView` are deleted. Codex child output is visible in the batch member body (last answer) and in the Agents panel (recent activity). Sidebar search and in-thread find stop indexing `subagentEvent` content, because the transcript no longer renders it and a hit could not be revealed.
10. **Agents panel placement:** it becomes P6's right-panel surface kind `"agents"`. P4 supplies `<AgentAgentsPanelSurface />` and a context bridge. `AgentAgentsDock`, which `AgentThreadSession` still mounts unchanged, only publishes the thread's agents into that context and renders the screen-reader announcer.
11. **F2 Retry** re-sends the failed turn's prompt with the same launch options, or the project's last-used launch if the turn has none, as a new follow-up turn through `sendFollowUp`. Retry is unavailable, and says why, when the prompt was clipped, the turn carried image or file attachments (only `reference` attachments can be re-sent), there is no launch, the thread is archived, or the thread is running. `dangerousLaunchConfirmed` is never set, so admission keeps its confirmation rule. Dismissal is kept per window for `threadId + turnId`, at most 64 entries.
12. **The archived shelf and the Usage popover stay** so no capability is lost between phases. They are extracted into `AgentThreadArchivedShelf.tsx` and `AgentRailUsagePopover.tsx`, which P9 deletes when Settings > Archive and Settings > Usage land (agreed with P9).

## Ownership

**P4 creates:**
- `src-tauri/src/codex_turn_event_collab.rs`
- `src/domain/agentSubagentSpawn.ts` (+ `agentSubagentSpawn.test.ts`)
- `src/domain/agentPendingInteraction.ts` (+ test)
- `src/domain/agentTurnRetry.ts` (+ test)
- `src/application/useAgentPendingInteractions.ts` (+ test)
- `src/application/useAgentTurnRetry.ts` (+ test)
- `src/components/agentMode/agentRailFilter.ts` (+ test)
- `src/components/agentMode/agentProjectMenuPresentation.ts` (+ test)
- `src/components/agentMode/agentThreadRowStatus.ts` (+ test)
- `src/components/agentMode/agentThreadContextMenuModel.ts` (+ test)
- `src/components/agentMode/AgentProjectFilterMenu.tsx` (+ test)
- `src/components/agentMode/AgentThreadContextMenu.tsx` (+ test)
- `src/components/agentMode/AgentThreadDeleteDialog.tsx`
- `src/components/agentMode/AgentThreadSnoozeDialog.tsx`
- `src/components/agentMode/AgentThreadArchivedShelf.tsx`
- `src/components/agentMode/AgentRailUsagePopover.tsx`
- `src/components/agentMode/agentSidebar.css` (+ `agentSidebarStyles.test.ts`)
- `src/components/agentMode/agents/agentAgentsPanelContext.tsx` (+ test)
- `src/components/agentMode/agents/AgentAgentsPanelSurface.tsx`
- `src/components/agentMode/agents/AgentAgentsToggleButton.tsx`
- `src/components/agentMode/AgentThreadErrorBanner.tsx` (+ test)
- `src/components/agentMode/agentThreadErrorBannerPresentation.ts` (+ test)
- `src/components/agentMode/agentThreadErrorBanner.css`

**P4 modifies (sole owner during P4):**
- Rust:
  - `src-tauri/src/codex_app_server_protocol.rs` + `_tests.rs`
  - `src-tauri/src/codex_turn_event.rs`, `codex_turn_event_items.rs`, `codex_turn_event_tests.rs`
  - `src-tauri/tests/fixtures/codex_app_server/thread_item.schema.json` (unchanged content, verified), `string_unions.schema.json`
  - `src-tauri/src/agent_thread_store.rs` (event enum + text accounting only), `agent_thread_store_appserver.rs`, `agent_thread_store_event_wire_tests.rs`, `agent_turn_log/payload.rs`, `agent_subagent_lifecycle.rs`
- Contracts and TS domain:
  - `contracts/agent-subagent-lifecycle-wire.json`
  - `src/domain/fixtures/agent-turn-event-kinds.json`
  - `src/domain/agentThread.ts` (one union member + import)
  - `src/domain/agentThreadWire.ts` (+ tests), `agentThreadTailCap.ts`, `agentTurnEventSupersession.ts`, `agentThreadSearch.ts` (+ test), `agentSubagentLifecycle.ts` (+ tests), `agentThreadBulkAction.ts` (+ test), `agentThreadOrganization.ts` (+ test)
  - `src/domain/agentOutput/codexAppServer.ts` (+ test)
  - `src/components/remoteRunner/remoteRunnerOutput.ts`
  - `src/test/agentTurnEventStreams.ts`
- Agent mode UI:
  - `src/components/agentMode/`: `agentAppServerGroups.test.ts`, `agentSubagentDisclosurePresentation.ts` (+ test), `agentRuntimeSubagentPresentation.ts` (+ tests), `agentSubagentSummaryPresentation.ts`, `AgentSubagentDisclosure.tsx` (+ test), `agentSubagents.css` (+ `agentSubagentsStyles.test.ts`), `AgentAgentsPanel.tsx` (+ test), `AgentAgentsDock.tsx`, `agentAgentsPanelPresentation.ts` (+ test), `useAgentThreadAgents.tsx`, `AgentSubagentAnnouncer.tsx`
  - `src/components/agentMode/`: `AgentThreadsSidebar.tsx` (+ test), `AgentRailHeader.tsx`, `AgentThreadList.tsx`, `AgentThreadRow.tsx` (+ test), `AgentThreadRowParts.tsx` (+ test), `AgentThreadSearchResults.tsx` (+ test), `agentSidebarPresentation.ts` (+ test), `agentModeNavigation.ts`, `useAgentThreadNavigation.ts` (+ tests), `useAgentThreadMenuCommands.ts` (+ test), `useAgentThreadSelection.ts`, `useAgentThreadDrag.tsx`, `AgentProjectMenu.tsx`, `agentClock.tsx`, `useAgentThreadFind.ts`, `agentRail.css` (thread-list rules only), `agentThreadOrganization.css`
- **Deleted by P4:** `AgentThreadRowMenu.tsx`, `AgentProjectScopeMenu.tsx` (+ its test), `AgentThreadSnoozePicker.tsx` (its content moves into `AgentThreadSnoozeDialog.tsx`), and `AgentThreadOrganizationMenu.test.tsx`, which is replaced by `AgentThreadContextMenu.test.tsx`.

**Reserved hunks in files owned by other phases (agreed):**
- **P3 owns `AgentTurnItemView.tsx`, `agentTurnProjection.ts` and `AgentThreadSession.test.tsx`.** P4 gets one delete-only hunk as its FIRST task (Task 1), in the same slice as B3:
  - remove `case "subagentGroup"`, `AgentSubagentGroupView` and their imports
  - remove the `subagentGroup` emission, the `agentSubagentGroupSettlement` export and the dead `agentTurnWorkFold` clause
  - make the renderable filter drop Codex child events
  - in Task 3, add `event.kind === "subagentSpawn"` to that same filter
  - replace the Codex child `<details>` test (~:988-1008) in `AgentThreadSession.test.tsx`
  P3 never touches those lines. P3 publishes `.cv-work-row*` and `.cv-live-row*` in `src/components/agentMode/conversation/agentWorkRows.css` (P3 Task 1), plus `.cv-conversation-column`; P4 uses them if they exist when its task runs.
  P3 later (P3 Task 14) adds an optional 7th parameter `keyOf` to `agentTurnProjection` and changes the single line `const key = agentTurnItemKey(offset, firstEventOffset);`. P4 must not reformat that line.
  P3 stops importing `agentSubagents.css` from `AgentBackgroundActivity.tsx`, so P4 Task 5 deletes the then-dead `.agent-background-row*` rules. Run `rg -n "agent-background-row" src --glob '!*.css'` first; delete only if nothing references them.
- **P2 owns `AgentModeView.tsx`, `AgentWorkbenchScreen.tsx`, `AgentThreadHeader.tsx`, `AgentProviderRailFooter.tsx` and the `.agent-rail`/`.agent-rail-resize*`/`.agent-rail__chrome*` rules.** P4 hunks reserved in `AgentModeView.tsx`:
  - (a) the `<AgentThreadsSidebar …>` prop list (Task 9, Task 10)
  - (b) one `<AgentThreadErrorBanner …/>` mount between `AgentThreadHeader` and `AgentThreadSession` (Task 13)
  - (c) `agentsPanel={<AgentAgentsPanelSurface />}` on `<AgentSurfaceHost>` (Task 6)
  - (d) the `<AgentAgentsPanelProvider>` wrap plus `trailingExtras={<AgentAgentsToggleButton />}` on `<AgentThreadHeader>` (Task 6)
  - (e) one `useAgentPendingInteractions(…)` call, plus `awaiting={…}` on P3's `<AgentThreadSession>` element (P3 exposes the prop `awaiting?: AgentThreadAwaiting`) (Task 10). P2 confirmed (e) in its plan's Ownership section.
  P4 keeps P2's `collapseShortcut` and `footerActivity` props on `AgentThreadsSidebar` and P2's `<TopBar region="sidebar">` chrome row.
- **P6 owns `AgentSurfaceKind`, `AgentSurfacePanel`, `AgentSurfaceHost` and `useAgentSurfaceLayout`.** P6 adds the kind `"agents"` (transient, not in the add menu), the prop `agentsPanel?: ReactNode`, and `surface.openSurface(kind)`, `surface.toggleSurface(kind)`, `surface.isSurfaceOpen(kind)`. P4 only passes the node and calls those.
- **P8:** P4 includes P8's two changes in `agentProjectMenuPresentation.ts`: a "Trust project…" entry for untrusted local projects, and the "Not trusted" label. P8 does not touch the sidebar files and only changes `onTrustProject`/`onAddProject` at the composition root. P4 keeps the `AgentRailCloneRow` mount and its props.
- **P9:** after P4 is committed, P9 deletes the `<AgentRailUsagePopover/>` mount, the `<AgentThreadArchivedShelf/>` mount and both files. P9 owns `AgentUsagePanel.tsx`, `useWorkbenchAgents.ts` and the settings sections.
- **P5:** read-only use of `useAgentThreadNavigation.ts`, `agentModeNavigation.ts`, `useAgentThreadSearch.ts`, `AgentThreadSearchResults.tsx` and `agentThreadSearch.ts`. `setProjectScope` reconciles the filter itself, so P5 calls nothing new.

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/codex_turn_event_collab.rs` | Pure projection of a root `collabAgentToolCall` (`spawnAgent`) into `CodexTurnEvent::SubagentSpawn`; title/model/effort bounding |
| `src/domain/agentSubagentSpawn.ts` | Closed spawn status/effort sets, limits, `AgentSubagentSpawnEvent` type, strict parser shared by wire + decoder |
| `src/domain/agentPendingInteraction.ts` | Pure `approval`/`input` derivation from approval and question request lists |
| `src/domain/agentTurnRetry.ts` | Pure retry plan for a thread's failed last turn (ready or unavailable + reason) |
| `src/application/useAgentPendingInteractions.ts` | Bounded poller: running local threads → pending interaction per thread, owner-checked |
| `src/application/useAgentTurnRetry.ts` | Retry coordinator: in-flight guard, revalidation before send, `sendFollowUp` |
| `src/components/agentMode/agentRailFilter.ts` | F1 filter type, inclusion, reconciliation, labels, project monogram |
| `src/components/agentMode/agentProjectMenuPresentation.ts` | Project actions menu entries and project state label (moved out of `agentSidebarPresentation.ts`) |
| `src/components/agentMode/agentThreadRowStatus.ts` | Row status union, derivation, labels, status tone, elapsed `m:ss` label (moved out and extended) |
| `src/components/agentMode/agentThreadContextMenuModel.ts` | Pure thread context menu tree (items, submenus, choices) |
| `src/components/agentMode/AgentProjectFilterMenu.tsx` | Filter button + popover (search projects, All projects, per-project rows, gear → project actions) |
| `src/components/agentMode/AgentThreadContextMenu.tsx` | Renders the menu model with foundation `Menu`/`Submenu`/`MenuItem` at a cursor or row anchor |
| `src/components/agentMode/AgentThreadDeleteDialog.tsx` | Delete confirmation dialog |
| `src/components/agentMode/AgentThreadSnoozeDialog.tsx` | Custom snooze date/time dialog |
| `src/components/agentMode/AgentThreadArchivedShelf.tsx` | Archived shelf (temporary, P9 removes) |
| `src/components/agentMode/AgentRailUsagePopover.tsx` | Usage trigger + popover (temporary, P9 removes) |
| `src/components/agentMode/agentSidebar.css` | All redesigned sidebar rules (`.cv-sb-*`, `.cv-card-row*`, `.cv-sr*`, `.cv-filter*`) |
| `src/components/agentMode/agents/agentAgentsPanelContext.tsx` | Provider, external store, `usePublishAgentThreadAgents`, `useAgentAgentsPanelControls` |
| `src/components/agentMode/agents/AgentAgentsPanelSurface.tsx` | Right-panel body: reads the published agents and renders `AgentAgentsPanel` |
| `src/components/agentMode/agents/AgentAgentsToggleButton.tsx` | Top-bar "Toggle agents panel" icon button |
| `src/components/agentMode/AgentThreadErrorBanner.tsx` | F2 banner container + view (title, body, Retry, Dismiss) |
| `src/components/agentMode/agentThreadErrorBannerPresentation.ts` | Pure banner model from the selected thread |
| `src/components/agentMode/agentThreadErrorBanner.css` | Banner styles (mockup `.alert`) |

---

## Execution order and parallel streams

Run Task 1 first, alone and early, because P3 rebases on it. After that, run four streams with disjoint write scopes. Each stream has one Opus 5.5 implementer. The lead integrates.

- **Stream A, B3 wire (Rust + TS domain wire):** Task 2, then Task 3.
- **Stream B, subagent UI:** Task 4 (starts after Task 3 lands), Task 5, Task 6.
- **Stream C, sidebar F1:** Task 7, then Task 8, Task 9, Task 10, Task 11, Task 12, in that order because they share `AgentThreadsSidebar.tsx`.
- **Stream D, F2:** Task 13. It can start immediately.

Then run Task 14 (gates), Task 15 (independent review), Task 16 (QA) and Task 17 (commits), in that order.

Focused test commands use Vitest (`npx vitest run <file>`) and cargo (`cd src-tauri && cargo test --lib <filter>`). Before any suite that touches Node debug or watch tests, run `lsof -ti tcp:9229 | xargs -r kill` (memory "Node watch tests and port 9229").

---

### Task 1: B3 - remove the duplicate Codex child `<details>` group (reserved P3 hunk)

**Files:**
- Modify: `src/components/agentMode/agentTurnProjection.ts`: import block (:1-5), `AgentTurnItem` union (:33), `agentSubagentGroupSettlement` (:130-138), `agentTurnProjection` (:236-321), `agentTurnWorkFold` (:334)
- Modify: `src/components/agentMode/AgentTurnItemView.tsx`: the `case "subagentGroup"` (:66-78), `AgentSubagentGroupView` (:136-213), and the imports only it uses
- Modify: `src/domain/agentThreadSearch.ts` (`eventSegment`, :365-366)
- Modify: `src/components/agentMode/useAgentThreadFind.ts` (`eventSource`, :230)
- Test: `src/components/agentMode/agentAppServerGroups.test.ts` (rewrite), `src/components/agentMode/agentTranscriptPresentation.test.ts` (delete the `agentSubagentGroupSettlement` case at :61-68 and its import), `src/components/agentMode/AgentThreadSession.test.tsx` (replace the test at ~:988-1008), `src/domain/agentThreadSearch.test.ts` (update expectations at :221-236)

**Interfaces:**
- Consumes: nothing new.
- Produces: `AgentTurnItem` no longer has a `"subagentGroup"` member. `agentSubagentGroupSettlement` is removed. `appServerGroups`/`appServerGroupId` in `agentAppServerGroups.ts` keep their signatures, because `agentSubagentDisclosurePresentation.ts` still uses them.

- [ ] **Step 1: Write the failing tests**

Replace the whole body of `src/components/agentMode/agentAppServerGroups.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { appServerGroups } from "./agentAppServerGroups";
import { agentTurnProjection } from "./agentTurnProjection";

describe("app-server child threads", () => {
  it("never renders Codex child thread events as transcript items", () => {
    const events: AgentTurnEvent[] = [
      { kind: "assistantText", text: "Parent response" },
      {
        kind: "subagentActivity",
        activity: "started",
        agentThreadId: "child",
        agentPath: "/root/explorer",
      },
      {
        kind: "subagentEvent",
        agentThreadId: "child",
        event: { kind: "toolCall", toolId: "c1", name: "shell", inputSummary: "rg createOrder" },
      },
      { kind: "subagentTurnDone", agentThreadId: "child", durationMs: 1200, isError: false },
    ];
    const projected = agentTurnProjection(events);
    expect(projected.items.map((item) => item.kind)).toEqual(["assistantText"]);
    expect(projected.hiddenCount).toBe(0);
  });

  it("keeps grouping child events for the subagent batch row", () => {
    const events: AgentTurnEvent[] = Array.from({ length: 40 }, (_, index) => ({
      kind: "subagentEvent",
      agentThreadId: `child-${index}`,
      event: { kind: "assistantText", text: `response ${index}` },
    }));
    const groups = appServerGroups(events);
    expect(groups.size).toBeGreaterThan(0);
    expect([...groups.values()][0]?.agentThreadId).toBe("child-0");
  });
});
```

In `src/components/agentMode/AgentThreadSession.test.tsx`, replace the test `"reveals and highlights an old subagent event within bounded group windows"` with:

```tsx
  it("renders Codex child threads only through the subagent batch row", () => {
    const events: AgentTurnEvent[] = [
      {
        kind: "subagentActivity",
        activity: "started",
        agentThreadId: "child-1",
        agentPath: "/root/explorer",
      },
      {
        kind: "subagentEvent",
        agentThreadId: "child-1",
        event: { kind: "toolCall", toolId: "c1", name: "shell", inputSummary: "rg createOrder" },
      },
      {
        kind: "subagentEvent",
        agentThreadId: "child-1",
        event: { kind: "assistantText", text: "createOrder is reached from 2 places" },
      },
    ];
    render({
      thread: threadView({
        turns: [turn("agt-1-t1", "Map order creation paths", { kind: "running" }, events)],
      }),
    });
    expect(host.querySelector("details.agent-reasoning")).toBeNull();
    expect(host.textContent).not.toContain("subagent events hidden");
    expect(host.querySelector(".agent-spawn")).not.toBeNull();
  });
```

In `src/domain/agentThreadSearch.test.ts`, test `"indexes steering and subagent answers with their outer event positions"`: rename it to `"indexes steering answers and skips Codex child thread content"`. Then change the expected segment list to:

```ts
    ).toEqual([
      { source: "title", eventIndex: null, text: "other" },
      { source: "user", eventIndex: null, text: "initial" },
      { source: "user", eventIndex: 0, text: "find needle" },
    ]);
```

In the same test, replace the `"child"` search assertion and the `findInThread(subject, "needle")` assertion with:

```ts
    expect(searchAgentThreadDocuments([doc], "child").matches).toEqual([]);
    expect(findInThread(subject, "needle")).toEqual([
      { scope: "turn", turnId: "agt-1-0001", eventIndex: 0, start: 5, end: 11 },
    ]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/agentAppServerGroups.test.ts src/domain/agentThreadSearch.test.ts src/components/agentMode/AgentThreadSession.test.tsx -t "child"`
Expected: FAIL. The projection still yields a `subagentGroup` item, `details.agent-reasoning` exists, and child text is still indexed.

- [ ] **Step 3: Implement the deletion**

In `agentTurnProjection.ts`:
- Change the import to `import { appServerGroupId } from "./agentAppServerGroups";`.
- Delete the union member `| { readonly kind: "subagentGroup"; readonly key: string; readonly group: AgentAppServerGroup }`.
- Delete `agentSubagentGroupSettlement`.
- Replace the head of `agentTurnProjection` down to `const visible = …` with:

```ts
  const limit = agentRenderedEventLimit(renderedLimit);
  const renderable = events
    .map((event, offset) => ({ event, offset }))
    .filter(({ event }) => {
      if (event.kind === "subagent") return false;
      if (isSubagentNarration(event)) return false;
      return appServerGroupId(event) === null;
    });
  const hiddenCount = Math.max(0, renderable.length - limit);
  const revealPosition =
    revealEventIndex === null
      ? -1
      : renderable.findIndex(({ offset }) => offset === revealEventIndex);
  const firstVisible =
    revealPosition >= 0 && revealPosition < hiddenCount
      ? Math.max(0, revealPosition - Math.floor(limit / 2))
      : hiddenCount;
```

Inside the `for (const { event, offset } of visible)` loop, delete the `const groupId = appServerGroupId(event); if (groupId !== null) { … continue; }` block. In `agentTurnWorkFold`, change the guard to:

```ts
  if (items.some((item) => item.kind === "userMessage")) return null;
```

In `AgentTurnItemView.tsx`:
- Delete `case "subagentGroup": return (<AgentSubagentGroupView … />);` and the whole `function AgentSubagentGroupView(…) { … }`.
- Delete every import that becomes unused: `AgentAppServerGroup`, `agentSubagentTokensLabel`, `agentSubagentGroupSettlement`, and `agentTurnProjection`/`AgentActivityItems` if nothing else in the file uses them. `npx tsc --noEmit` and `npx eslint` report the leftovers.
- Keep `groupHighlight` in `AgentTurnItemViewProps` so P3's callers still compile. If it is now unread, remove it only from the destructuring.

In `src/domain/agentThreadSearch.ts` `eventSegment`: delete `case "subagentEvent": return eventSegment(event.event, turnId, eventIndex);` and add `case "subagentEvent":` to the list of cases that fall through to `return null;`.

In `src/components/agentMode/useAgentThreadFind.ts` `eventSource`: delete the line `if (event?.kind === "subagentEvent") return eventSource(event.event);`.

In `agentTranscriptPresentation.test.ts`, delete the `agentSubagentGroupSettlement` import and the test `"settles a subagent group from its own state before falling back to the parent turn"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/agentAppServerGroups.test.ts src/components/agentMode/agentTranscriptPresentation.test.ts src/domain/agentThreadSearch.test.ts src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/useAgentThreadFind.test.tsx`
Expected: PASS.
Run: `npm run check` then `echo $?`
Expected: `0`.

- [ ] **Step 5: Checkpoint**

Run: `npx eslint src/components/agentMode/agentTurnProjection.ts src/components/agentMode/AgentTurnItemView.tsx src/domain/agentThreadSearch.ts src/components/agentMode/useAgentThreadFind.ts --max-warnings 0`
Expected: exit 0. Tell the lead that Task 1 is ready, so P3 can re-read `AgentTurnItemView.tsx` and `agentTurnProjection.ts` before editing. Do not commit (Task 17).

---

### Task 2: B3 - decode `collabAgentToolCall` and project spawns to NDJSON `subagentSpawn` (Rust)

**Files:**
- Modify: `src-tauri/src/codex_app_server_protocol.rs`: new enums and struct next to `SubAgentActivityItem` (:932); the `ThreadItem` variant (:942-964); `IGNORED_THREAD_ITEM_TAGS` (:966-977); the deserializer match (:979-1008)
- Create: `src-tauri/src/codex_turn_event_collab.rs`
- Modify: `src-tauri/src/codex_turn_event.rs`: the `CodexTurnEvent` enum (:248-303), `Serialize` (:357-470), `item()` (:654-689), the module declarations (:994-1010)
- Modify: `src-tauri/src/codex_turn_event_items.rs` (`project_item`, :20-37)
- Test: `src-tauri/src/codex_app_server_protocol_tests.rs` (`PROJECTED_THREAD_ITEM_TAGS` :5-15, plus new tests), `src-tauri/src/codex_turn_event_tests.rs` (replace the test at :779, plus new tests)

**Interfaces:**
- Consumes: `CodexItemPhase`, `CodexTurnProjection::role()`, `bounded_identity`, `clipped_text` and `register_subagent` from `codex_turn_event.rs`. They stay private, and the child module reaches them through `super::`.
- Produces: the NDJSON line `{"v":1,"t":"subagentSpawn","callId":string,"status":"inProgress"|"completed"|"failed"|"interrupted","taskTitle":string|null,"model":string|null,"reasoningEffort":"none"|"minimal"|"low"|"medium"|"high"|"xhigh"|null,"agentThreadIds":string[]}`. The key order is exactly as written, and it is consumed by Task 3's decoder. Also `pub enum CodexSpawnStatus { InProgress, Completed, Failed, Interrupted }`.

- [ ] **Step 1: Write the failing protocol tests**

In `codex_app_server_protocol_tests.rs`, add `"collabAgentToolCall"` to `PROJECTED_THREAD_ITEM_TAGS`, keeping the list sorted. Then append:

```rust
#[test]
fn collab_agent_tool_calls_decode_to_a_typed_item() {
    let item: ThreadItem = serde_json::from_value(serde_json::json!({
        "type": "collabAgentToolCall",
        "id": "call_spawn_1",
        "tool": "spawnAgent",
        "status": "completed",
        "senderThreadId": "01a0a011-d4d5-7361-90a5-5d46f0e147c4",
        "receiverThreadIds": ["01a0a011-eda9-7000-8000-000000000001"],
        "prompt": "Review idempotency middleware\nLook for races",
        "model": "gpt-5.6-luna",
        "reasoningEffort": "medium",
        "agentsStates": { "01a0a011-eda9-7000-8000-000000000001": { "status": "pendingInit" } }
    }))
    .expect("collab item must decode");
    let ThreadItem::CollabAgentToolCall(call) = item else {
        panic!("expected a collab tool call");
    };
    assert_eq!(call.id, "call_spawn_1");
    assert_eq!(call.tool, CollabAgentTool::SpawnAgent);
    assert_eq!(call.status, Some(CollabAgentToolCallStatus::Completed));
    assert_eq!(
        call.receiver_thread_ids,
        Some(vec!["01a0a011-eda9-7000-8000-000000000001".to_string()])
    );
    assert_eq!(call.model.as_deref(), Some("gpt-5.6-luna"));
    assert_eq!(call.reasoning_effort.as_deref(), Some("medium"));
}

#[test]
fn a_minimal_or_unknown_collab_tool_still_decodes() {
    let item: ThreadItem = serde_json::from_value(serde_json::json!({
        "type": "collabAgentToolCall", "id": "call-1", "tool": "summonDragons",
        "receiverThreadIds": null
    }))
    .expect("minimal collab item must decode");
    let ThreadItem::CollabAgentToolCall(call) = item else {
        panic!("expected a collab tool call");
    };
    assert_eq!(
        call.tool,
        CollabAgentTool::Unrecognized {
            tag: "summonDragons".to_string()
        }
    );
    assert_eq!(call.status, None);
    assert_eq!(call.receiver_thread_ids, None);
}
```

- [ ] **Step 2: Write the failing projection tests**

In `codex_turn_event_tests.rs`, replace `echoed_user_messages_and_collab_tool_calls_are_dropped_rather_than_counted` with:

```rust
fn spawn_item(id: &str, status: &str, receivers: &[&str], prompt: Option<&str>) -> Value {
    json!({
        "type": "collabAgentToolCall",
        "id": id,
        "tool": "spawnAgent",
        "status": status,
        "senderThreadId": ROOT_THREAD,
        "receiverThreadIds": receivers,
        "prompt": prompt,
        "model": "gpt-5.6-luna",
        "reasoningEffort": "medium",
        "agentsStates": {}
    })
}

#[test]
fn echoed_user_messages_and_non_spawn_collab_calls_are_dropped_rather_than_counted() {
    let mut projection = rooted();
    let user_message = json!({ "type": "userMessage", "id": "user-1", "content": [] });
    let wait = json!({ "type": "collabAgentToolCall", "id": "call-1", "tool": "wait" });

    let echoed = project(&mut projection, "item/started", item_params(ROOT_THREAD, user_message));
    let waiting = project(&mut projection, "item/started", item_params(ROOT_THREAD, wait));

    assert_eq!(echoed, Vec::new());
    assert_eq!(waiting, Vec::new());
    assert_eq!(projection.unknown_frames_emitted(), 0);
}

#[test]
fn a_root_spawn_projects_to_a_typed_subagent_spawn_line() {
    let mut projection = rooted();
    let started = project(
        &mut projection,
        "item/started",
        item_params(
            ROOT_THREAD,
            spawn_item("call-spawn", "inProgress", &[], Some("  Review   idempotency\tmiddleware \nsecond line")),
        ),
    );
    let completed = project(
        &mut projection,
        "item/completed",
        item_params(
            ROOT_THREAD,
            spawn_item("call-spawn", "completed", &[SUB_THREAD], Some("Review idempotency middleware")),
        ),
    );

    assert_eq!(
        lines(&started),
        format!(
            "{}\n",
            r#"{"v":1,"t":"subagentSpawn","callId":"call-spawn","status":"inProgress","taskTitle":"Review idempotency middleware","model":"gpt-5.6-luna","reasoningEffort":"medium","agentThreadIds":[]}"#
        )
    );
    assert_eq!(
        lines(&completed),
        format!(
            "{}\n",
            format!(
                r#"{{"v":1,"t":"subagentSpawn","callId":"call-spawn","status":"completed","taskTitle":"Review idempotency middleware","model":"gpt-5.6-luna","reasoningEffort":"medium","agentThreadIds":["{SUB_THREAD}"]}}"#
            )
        )
    );
    assert_eq!(projection.unknown_frames_emitted(), 0);
}

#[test]
fn a_completed_spawn_registers_receivers_so_child_items_stay_nested() {
    let mut projection = rooted();
    project(
        &mut projection,
        "item/completed",
        item_params(ROOT_THREAD, spawn_item("call-spawn", "completed", &[SUB_THREAD], None)),
    );
    let child = project(
        &mut projection,
        "item/completed",
        item_params(
            SUB_THREAD,
            json!({ "type": "agentMessage", "id": "m1", "text": "done" }),
        ),
    );

    assert!(matches!(child.as_slice(), [CodexTurnEvent::SubagentItem { .. }]));
}

#[test]
fn spawn_bounds_titles_models_efforts_and_receivers() {
    let mut projection = rooted();
    let receivers: Vec<String> = (0..40).map(|index| format!("child-thread-{index:04}")).collect();
    let receiver_refs: Vec<&str> = receivers.iter().map(String::as_str).collect();
    let long_prompt = "é".repeat(400);
    let mut item = spawn_item("call-big", "completed", &receiver_refs, Some(long_prompt.as_str()));
    item["model"] = json!("m".repeat(65));
    item["reasoningEffort"] = json!("ludicrous");

    let events = project(&mut projection, "item/completed", item_params(ROOT_THREAD, item));

    let [CodexTurnEvent::SubagentSpawn { task_title, model, reasoning_effort, agent_thread_ids, .. }] =
        events.as_slice()
    else {
        panic!("expected one spawn event, got {events:?}");
    };
    assert!(task_title.as_deref().is_some_and(|title| title.len() <= 480));
    assert_eq!(model, &None);
    assert_eq!(reasoning_effort, &None);
    assert_eq!(agent_thread_ids.len(), MAX_SUBAGENT_THREADS_PER_TURN);
}

#[test]
fn spawns_from_child_threads_and_unknown_statuses_fail_closed() {
    let mut projection = with_subagent();
    let nested = project(
        &mut projection,
        "item/started",
        item_params(SUB_THREAD, spawn_item("call-nested", "inProgress", &[], None)),
    );
    let mut odd = spawn_item("call-odd", "exploded", &[], None);
    odd["senderThreadId"] = json!(ROOT_THREAD);
    let unknown = project(&mut projection, "item/started", item_params(ROOT_THREAD, odd));

    assert_eq!(nested, Vec::new());
    assert!(matches!(unknown.as_slice(), [CodexTurnEvent::UnknownFrame { .. }]));
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib codex_ 2>&1 | grep -E "test result|error\[" ; echo "exit ${PIPESTATUS[0]}"`
Expected: compile errors (`CollabAgentTool`, `CodexTurnEvent::SubagentSpawn` do not exist), non-zero exit.

- [ ] **Step 4: Implement the protocol item**

In `codex_app_server_protocol.rs`, after `SubAgentActivityItem`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollabAgentTool {
    SpawnAgent,
    SendInput,
    ResumeAgent,
    Wait,
    CloseAgent,
    SendMessage,
    FollowupTask,
    InterruptAgent,
    ListAgents,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for CollabAgentTool {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        string_tag(
            deserializer,
            |tag| match tag {
                "spawnAgent" => Some(Self::SpawnAgent),
                "sendInput" => Some(Self::SendInput),
                "resumeAgent" => Some(Self::ResumeAgent),
                "wait" => Some(Self::Wait),
                "closeAgent" => Some(Self::CloseAgent),
                "sendMessage" => Some(Self::SendMessage),
                "followupTask" => Some(Self::FollowupTask),
                "interruptAgent" => Some(Self::InterruptAgent),
                "listAgents" => Some(Self::ListAgents),
                _ => None,
            },
            |tag| Self::Unrecognized { tag },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollabAgentToolCallStatus {
    InProgress,
    Completed,
    Failed,
    Interrupted,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for CollabAgentToolCallStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        string_tag(
            deserializer,
            |tag| match tag {
                "inProgress" => Some(Self::InProgress),
                "completed" => Some(Self::Completed),
                "failed" => Some(Self::Failed),
                "interrupted" => Some(Self::Interrupted),
                _ => None,
            },
            |tag| Self::Unrecognized { tag },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabAgentToolCallItem {
    pub id: String,
    pub tool: CollabAgentTool,
    #[serde(default)]
    pub status: Option<CollabAgentToolCallStatus>,
    #[serde(default)]
    pub receiver_thread_ids: Option<Vec<String>>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}
```

Add `CollabAgentToolCall(CollabAgentToolCallItem),` to `ThreadItem` after `SubAgentActivity`. Add `"collabAgentToolCall" => Ok(Self::CollabAgentToolCall(tagged_payload::<D, _>(value)?)),` to the deserializer match. Remove `"collabAgentToolCall",` from `IGNORED_THREAD_ITEM_TAGS`; the list stays sorted.

In `codex_turn_event_items.rs` `project_item`, add the arm `ThreadItem::CollabAgentToolCall(_) => CodexItemOutcome::Dropped,`.

- [ ] **Step 5: Implement the projection module**

Create `src-tauri/src/codex_turn_event_collab.rs`:

```rust
use super::super::codex_app_server_protocol::{
    CollabAgentTool, CollabAgentToolCallItem, CollabAgentToolCallStatus,
};
use super::{
    bounded_identity, clipped_text, CodexItemPhase, CodexSpawnStatus, CodexTurnEvent,
    MAX_CODEX_THREAD_ID_BYTES, MAX_CODEX_TOOL_ID_BYTES, MAX_SUBAGENT_THREADS_PER_TURN,
};

pub const MAX_CODEX_SPAWN_TITLE_BYTES: usize = 480;
pub const MAX_CODEX_SPAWN_MODEL_BYTES: usize = 64;
const REASONING_EFFORTS: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];

pub(super) enum CollabOutcome {
    Spawn(CodexTurnEvent),
    Dropped,
    Unknown,
}

pub(super) fn project_collab(item: &CollabAgentToolCallItem, phase: CodexItemPhase) -> CollabOutcome {
    if item.tool != CollabAgentTool::SpawnAgent {
        return CollabOutcome::Dropped;
    }
    let Some(call_id) = bounded_identity(item.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CollabOutcome::Unknown;
    };
    let Some(status) = spawn_status(item.status.as_ref(), phase) else {
        return CollabOutcome::Unknown;
    };
    let mut agent_thread_ids: Vec<String> = Vec::new();
    for receiver in item.receiver_thread_ids.iter().flatten() {
        let Some(receiver) = bounded_identity(receiver.as_str(), MAX_CODEX_THREAD_ID_BYTES) else {
            return CollabOutcome::Unknown;
        };
        if agent_thread_ids.contains(&receiver) {
            continue;
        }
        if agent_thread_ids.len() >= MAX_SUBAGENT_THREADS_PER_TURN {
            break;
        }
        agent_thread_ids.push(receiver);
    }
    CollabOutcome::Spawn(CodexTurnEvent::SubagentSpawn {
        call_id,
        status,
        task_title: item.prompt.as_deref().and_then(spawn_title),
        model: item.model.as_deref().and_then(spawn_model),
        reasoning_effort: item.reasoning_effort.as_deref().and_then(reasoning_effort),
        agent_thread_ids,
    })
}

fn spawn_status(
    status: Option<&CollabAgentToolCallStatus>,
    phase: CodexItemPhase,
) -> Option<CodexSpawnStatus> {
    match status {
        None => Some(match phase {
            CodexItemPhase::Started => CodexSpawnStatus::InProgress,
            CodexItemPhase::Completed => CodexSpawnStatus::Completed,
        }),
        Some(CollabAgentToolCallStatus::InProgress) => Some(CodexSpawnStatus::InProgress),
        Some(CollabAgentToolCallStatus::Completed) => Some(CodexSpawnStatus::Completed),
        Some(CollabAgentToolCallStatus::Failed) => Some(CodexSpawnStatus::Failed),
        Some(CollabAgentToolCallStatus::Interrupted) => Some(CodexSpawnStatus::Interrupted),
        Some(CollabAgentToolCallStatus::Unrecognized { .. }) => None,
    }
}

fn spawn_title(prompt: &str) -> Option<String> {
    let line = prompt.lines().find(|line| !line.trim().is_empty())?;
    let collapsed = line
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>();
    let clipped = clipped_text(collapsed.as_str(), MAX_CODEX_SPAWN_TITLE_BYTES);
    (!clipped.text.is_empty()).then_some(clipped.text)
}

fn spawn_model(model: &str) -> Option<String> {
    let model = model.trim();
    if model.is_empty()
        || model.len() > MAX_CODEX_SPAWN_MODEL_BYTES
        || model.chars().any(char::is_control)
    {
        return None;
    }
    Some(model.to_string())
}

fn reasoning_effort(value: &str) -> Option<String> {
    REASONING_EFFORTS
        .contains(&value)
        .then(|| value.to_string())
}
```

If `CodexItemPhase` is not `Copy` or has no `Started`/`Completed` variants under those names, use the existing names from `item_method(phase)` in `codex_turn_event.rs` and keep the same mapping.

- [ ] **Step 6: Wire the event into `codex_turn_event.rs`**

After `CodexSubagentKind`, add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexSpawnStatus {
    InProgress,
    Completed,
    Failed,
    Interrupted,
}

impl CodexSpawnStatus {
    fn wire_status(self) -> &'static str {
        match self {
            Self::InProgress => "inProgress",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
        }
    }
}
```

Add this variant to `CodexTurnEvent`, after `SubagentItem`:

```rust
    SubagentSpawn {
        call_id: String,
        status: CodexSpawnStatus,
        task_title: Option<String>,
        model: Option<String>,
        reasoning_effort: Option<String>,
        agent_thread_ids: Vec<String>,
    },
```

Add this arm to the `Serialize` match, after `SubagentItem`:

```rust
            Self::SubagentSpawn {
                call_id,
                status,
                task_title,
                model,
                reasoning_effort,
                agent_thread_ids,
            } => {
                map.serialize_entry("t", "subagentSpawn")?;
                map.serialize_entry("callId", call_id)?;
                map.serialize_entry("status", status.wire_status())?;
                map.serialize_entry("taskTitle", task_title)?;
                map.serialize_entry("model", model)?;
                map.serialize_entry("reasoningEffort", reasoning_effort)?;
                map.serialize_entry("agentThreadIds", agent_thread_ids)?;
            }
```

In `item()`, directly after the `SubAgentActivity` early return:

```rust
        if let ThreadItem::CollabAgentToolCall(call) = &payload.item {
            if !matches!(role, CodexThreadRole::Root) {
                return Vec::new();
            }
            return match collab::project_collab(call, phase) {
                collab::CollabOutcome::Spawn(event) => {
                    if let CodexTurnEvent::SubagentSpawn {
                        status: CodexSpawnStatus::Completed,
                        agent_thread_ids,
                        ..
                    } = &event
                    {
                        for receiver in agent_thread_ids {
                            self.register_subagent(receiver.as_str(), "");
                        }
                    }
                    vec![event]
                }
                collab::CollabOutcome::Dropped => Vec::new(),
                collab::CollabOutcome::Unknown => self.unknown_frame(method),
            };
        }
```

Next to `#[path = "codex_turn_event_items.rs"] mod items;`, add:

```rust
#[path = "codex_turn_event_collab.rs"]
mod collab;
```

If `register_subagent` returns `bool` and is marked `#[must_use]`, write `let _ = self.register_subagent(…)`. Clippy `-D warnings` rejects an unused must-use value.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib codex_ ; echo "exit $?"`
Expected: all `codex_*` tests pass, including `every_schema_thread_item_tag_decodes_to_a_variant_or_is_ignored` and both golden tests. The golden files contain only `wait` calls, which are still dropped, so they stay byte-identical. The last line prints `exit 0`.
Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 8: Checkpoint**

Run: `cd src-tauri && cargo fmt --all -- --check ; echo "exit $?"`
Expected: `exit 0`. Do not commit.

---
### Task 3: B3 - persisted `subagentSpawn` turn event (TS ⇄ Rust wire) and the NDJSON decoder

**Files:**
- Create: `src/domain/agentSubagentSpawn.ts`, `src/domain/agentSubagentSpawn.test.ts`
- Modify: `src/domain/agentThread.ts` (import + one `AgentTurnEvent` union member, :138-240)
- Modify: `src/domain/agentThreadWire.ts`: serialize switch (~:364), parse switch (~:1011), kind guard (~:1300)
- Modify: `src/domain/agentThreadTailCap.ts` (:469), `src/domain/agentTurnEventSupersession.ts` (:59), `src/domain/agentThreadSearch.ts` (`eventSegment`), `src/components/remoteRunner/remoteRunnerOutput.ts` (:30)
- Modify: `src/components/agentMode/agentTurnProjection.ts` (reserved hunk: the renderable filter from Task 1)
- Modify: `src/domain/agentOutput/codexAppServer.ts` (`parseEvent`)
- Modify: `src/domain/fixtures/agent-turn-event-kinds.json` (`kinds` + `variants`)
- Modify (Rust): `src-tauri/src/agent_thread_store.rs` (enum ~:441-500, text accounting ~:1298), `src-tauri/src/agent_thread_store_appserver.rs` (new enums, `validate_event` ~:166), `src-tauri/src/agent_turn_log/payload.rs` (`event_kind_code`), `src-tauri/src/agent_thread_store_event_wire_tests.rs` (`EXPECTED_EVENT_KINDS`, `turn_event_kind`)
- Test: `src/domain/agentThreadWire.test.ts` (`REQUIRED_EVENT_KINDS` :690), `src/domain/agentOutput/codexAppServer.test.ts`, the Rust wire tests above

**Interfaces:**
- Consumes: the Task 2 NDJSON line `{"v":1,"t":"subagentSpawn",…}`.
- Produces:
  - In `src/domain/agentSubagentSpawn.ts`: `export interface AgentSubagentSpawnEvent { readonly kind: "subagentSpawn"; readonly callId: string; readonly status: AgentSubagentSpawnStatus; readonly taskTitle: string | null; readonly model: string | null; readonly reasoningEffort: AgentSubagentSpawnEffort | null; readonly agentThreadIds: ReadonlyArray<string> }`. It is a member of `AgentTurnEvent`.
  - `export function parseAgentSubagentSpawnFields(value: Readonly<Record<string, unknown>>): AgentSubagentSpawnEvent`, which throws `TypeError`.
  - Constants: `MAX_AGENT_SUBAGENT_SPAWN_TITLE_BYTES = 480`, `MAX_AGENT_SUBAGENT_SPAWN_MODEL_BYTES = 64`, `MAX_AGENT_SUBAGENT_SPAWN_THREADS = 32`.
  - Rust: `AgentTurnEvent::SubagentSpawn { call_id, status: SubagentSpawnStatus, task_title: Option<String>, model: Option<String>, reasoning_effort: Option<SubagentSpawnEffort>, agent_thread_ids: Vec<String> }`.

- [ ] **Step 1: Write the failing domain tests**

Create `src/domain/agentSubagentSpawn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_SUBAGENT_SPAWN_THREADS,
  parseAgentSubagentSpawnFields,
} from "./agentSubagentSpawn";

const valid = {
  kind: "subagentSpawn",
  callId: "call_spawn_0001",
  status: "completed",
  taskTitle: "Review idempotency middleware",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  agentThreadIds: ["agt-sub-0001"],
};

describe("parseAgentSubagentSpawnFields", () => {
  it("accepts a complete spawn and a minimal in-progress spawn", () => {
    expect(parseAgentSubagentSpawnFields(valid)).toEqual(valid);
    expect(
      parseAgentSubagentSpawnFields({
        ...valid,
        status: "inProgress",
        taskTitle: null,
        model: null,
        reasoningEffort: null,
        agentThreadIds: [],
      }),
    ).toMatchObject({ status: "inProgress", taskTitle: null, agentThreadIds: [] });
  });

  it.each([
    ["an unknown status", { status: "exploded" }],
    ["an unknown effort", { reasoningEffort: "ludicrous" }],
    ["an empty call id", { callId: "" }],
    ["a control character in the title", { taskTitle: "a\u0007b" }],
    ["an empty title", { taskTitle: "" }],
    ["an oversize title", { taskTitle: "é".repeat(241) }],
    ["an oversize model", { model: "m".repeat(65) }],
    ["duplicate receivers", { agentThreadIds: ["a-thread", "a-thread"] }],
    [
      "too many receivers",
      {
        agentThreadIds: Array.from(
          { length: MAX_AGENT_SUBAGENT_SPAWN_THREADS + 1 },
          (_, index) => `thread-${index}`,
        ),
      },
    ],
    ["a non-array receiver list", { agentThreadIds: "agt-sub-0001" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => parseAgentSubagentSpawnFields({ ...valid, ...patch })).toThrow(TypeError);
  });
});
```

In `src/domain/agentThreadWire.test.ts`, add `subagentSpawn: true,` to `REQUIRED_EVENT_KINDS` after `subagentEvent: true,`.

In `src/domain/agentOutput/codexAppServer.test.ts`, add:

```ts
describe("subagentSpawn lines", () => {
  it("maps a spawn line to a typed subagentSpawn turn event", () => {
    const parsed = parseCodexAppServerLine(
      '{"v":1,"t":"subagentSpawn","callId":"call-spawn","status":"completed","taskTitle":"Review idempotency middleware","model":"gpt-5.6-luna","reasoningEffort":"medium","agentThreadIds":["01a0a011-eda9-7000-8000-000000000001"]}',
    );
    expect(parsed).toEqual({
      kind: "events",
      sessionId: null,
      events: [
        {
          kind: "subagentSpawn",
          callId: "call-spawn",
          status: "completed",
          taskTitle: "Review idempotency middleware",
          model: "gpt-5.6-luna",
          reasoningEffort: "medium",
          agentThreadIds: ["01a0a011-eda9-7000-8000-000000000001"],
        },
      ],
    });
  });

  it("rejects extra fields and unknown statuses fail-closed", () => {
    expect(
      parseCodexAppServerLine(
        '{"v":1,"t":"subagentSpawn","callId":"c","status":"completed","taskTitle":null,"model":null,"reasoningEffort":null,"agentThreadIds":[],"prompt":"secret"}',
      ).kind,
    ).toBe("unknown");
    expect(
      parseCodexAppServerLine(
        '{"v":1,"t":"subagentSpawn","callId":"c","status":"exploded","taskTitle":null,"model":null,"reasoningEffort":null,"agentThreadIds":[]}',
      ).kind,
    ).toBe("unknown");
  });
});
```

Add to `src/domain/fixtures/agent-turn-event-kinds.json` under `kinds`, after `"subagentEvent"`:

```json
    "subagentSpawn": {
      "kind": "subagentSpawn",
      "callId": "call_spawn_0001",
      "status": "completed",
      "taskTitle": "Review idempotency middleware",
      "model": "gpt-5.6-luna",
      "reasoningEffort": "medium",
      "agentThreadIds": ["agt-sub-0001"]
    },
```

Append this item to `variants`:

```json
    {
      "kind": "subagentSpawn",
      "callId": "call_spawn_0002",
      "status": "inProgress",
      "taskTitle": null,
      "model": null,
      "reasoningEffort": null,
      "agentThreadIds": []
    }
```

In `src-tauri/src/agent_thread_store_event_wire_tests.rs`, change `EXPECTED_EVENT_KINDS: [&str; 18]` to `[&str; 19]`, insert `"subagentSpawn",` after `"subagentEvent",`, and add the arm `AgentTurnEvent::SubagentSpawn { .. } => "subagentSpawn",` to `turn_event_kind`. Also append:

```rust
#[test]
fn a_subagent_spawn_rejects_oversize_titles_and_duplicate_receivers() {
    let spawn = |title: Option<String>, ids: Vec<String>| AgentTurnEvent::SubagentSpawn {
        call_id: "call_spawn_0001".to_string(),
        status: SubagentSpawnStatus::Completed,
        task_title: title,
        model: Some("gpt-5.6-luna".to_string()),
        reasoning_effort: Some(SubagentSpawnEffort::Medium),
        agent_thread_ids: ids,
    };
    let valid = spawn(Some("Review".to_string()), vec!["agt-sub-0001".to_string()]);
    let long_title = spawn(Some("é".repeat(241)), vec![]);
    let duplicate = spawn(None, vec!["a".to_string(), "a".to_string()]);
    let too_many = spawn(None, (0..33).map(|index| format!("thread-{index}")).collect());

    validate_agent_thread_document(ROOT_KEY, &document_with_events(vec![valid]))
        .expect("a bounded spawn is valid");
    for event in [long_title, duplicate, too_many] {
        assert!(validate_agent_thread_document(ROOT_KEY, &document_with_events(vec![event])).is_err());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/agentSubagentSpawn.test.ts src/domain/agentThreadWire.test.ts src/domain/agentOutput/codexAppServer.test.ts`
Expected: FAIL, because the module does not exist and the fixture has an unknown kind.
Run: `cd src-tauri && cargo test --lib agent_thread_store_event_wire ; echo "exit $?"`
Expected: a compile error and a non-zero exit.

- [ ] **Step 3: Implement the TS domain module**

Create `src/domain/agentSubagentSpawn.ts`:

```ts
export const AGENT_SUBAGENT_SPAWN_STATUSES = [
  "inProgress",
  "completed",
  "failed",
  "interrupted",
] as const;
export type AgentSubagentSpawnStatus = (typeof AGENT_SUBAGENT_SPAWN_STATUSES)[number];

export const AGENT_SUBAGENT_SPAWN_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export type AgentSubagentSpawnEffort = (typeof AGENT_SUBAGENT_SPAWN_EFFORTS)[number];

export const MAX_AGENT_SUBAGENT_SPAWN_ID_BYTES = 256;
export const MAX_AGENT_SUBAGENT_SPAWN_TITLE_BYTES = 480;
export const MAX_AGENT_SUBAGENT_SPAWN_MODEL_BYTES = 64;
export const MAX_AGENT_SUBAGENT_SPAWN_THREADS = 32;

export interface AgentSubagentSpawnEvent {
  readonly kind: "subagentSpawn";
  readonly callId: string;
  readonly status: AgentSubagentSpawnStatus;
  readonly taskTitle: string | null;
  readonly model: string | null;
  readonly reasoningEffort: AgentSubagentSpawnEffort | null;
  readonly agentThreadIds: ReadonlyArray<string>;
}

const encoder = new TextEncoder();
const CONTROL = /\p{Cc}/u;

export function parseAgentSubagentSpawnFields(
  value: Readonly<Record<string, unknown>>,
): AgentSubagentSpawnEvent {
  const ids = value.agentThreadIds;
  if (!Array.isArray(ids) || ids.length > MAX_AGENT_SUBAGENT_SPAWN_THREADS) fail("agentThreadIds");
  const agentThreadIds = ids.map((id) => boundedText(id, MAX_AGENT_SUBAGENT_SPAWN_ID_BYTES, "id"));
  if (new Set(agentThreadIds).size !== agentThreadIds.length) fail("agentThreadIds");
  return {
    kind: "subagentSpawn",
    callId: boundedText(value.callId, MAX_AGENT_SUBAGENT_SPAWN_ID_BYTES, "callId"),
    status: member(value.status, AGENT_SUBAGENT_SPAWN_STATUSES, "status"),
    taskTitle: nullable(value.taskTitle, (title) =>
      boundedText(title, MAX_AGENT_SUBAGENT_SPAWN_TITLE_BYTES, "taskTitle"),
    ),
    model: nullable(value.model, (model) =>
      boundedText(model, MAX_AGENT_SUBAGENT_SPAWN_MODEL_BYTES, "model"),
    ),
    reasoningEffort: nullable(value.reasoningEffort, (effort) =>
      member(effort, AGENT_SUBAGENT_SPAWN_EFFORTS, "reasoningEffort"),
    ),
    agentThreadIds,
  };
}

function boundedText(value: unknown, maxBytes: number, field: string): string {
  if (typeof value !== "string" || value === "" || CONTROL.test(value)) fail(field);
  if (encoder.encode(value).length > maxBytes) fail(field);
  return value;
}

function member<T extends string>(value: unknown, allowed: ReadonlyArray<T>, field: string): T {
  if (typeof value !== "string" || !(allowed as ReadonlyArray<string>).includes(value)) fail(field);
  return value as T;
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function fail(field: string): never {
  throw new TypeError(`Invalid subagent spawn field: ${field}.`);
}
```

In `src/domain/agentThread.ts`, add `import type { AgentSubagentSpawnEvent } from "./agentSubagentSpawn";` and the union member `| AgentSubagentSpawnEvent` right after the `subagentEvent` member.

- [ ] **Step 4: Wire every TS switch**

`agentThreadWire.ts`:
- Serialize arm, before `case "subagentTurnDone":`:

```ts
    case "subagentSpawn":
      return {
        kind: event.kind,
        callId: event.callId,
        status: event.status,
        taskTitle: event.taskTitle,
        model: event.model,
        reasoningEffort: event.reasoningEffort,
        agentThreadIds: [...event.agentThreadIds],
      };
```

- Parse arm, before `case "subagentTurnDone":`:

```ts
    case "subagentSpawn":
      exactKeys(
        event,
        ["kind", "callId", "status", "taskTitle", "model", "reasoningEffort", "agentThreadIds"],
        path,
      );
      try {
        return parseAgentSubagentSpawnFields(event);
      } catch {
        return invalid(path, "a bounded subagent spawn");
      }
```

- Kind guard: add `value !== "subagentSpawn" &&`.
- Import `parseAgentSubagentSpawnFields` from `./agentSubagentSpawn`.

`agentThreadTailCap.ts`: add `case "subagentSpawn":` to the `return null;` group next to `case "subagentActivity":`.

`agentTurnEventSupersession.ts`: add:

```ts
    case "subagentSpawn":
      return { kind: "barrier", targets: [SUBAGENT_SCOPE] };
```

`agentThreadSearch.ts` `eventSegment`: add `case "subagentSpawn":` to the `return null` group.

`remoteRunnerOutput.ts`: add `case "subagentSpawn":` to the `break;` group.

`agentTurnProjection.ts` (reserved hunk), in the renderable filter:

```ts
      if (event.kind === "subagent" || event.kind === "subagentSpawn") return false;
```

`codexAppServer.ts`: import `parseAgentSubagentSpawnFields`, then add to `parseEvent`'s switch:

```ts
    case "subagentSpawn": {
      keys(value, [
        "v",
        "t",
        "callId",
        "status",
        "taskTitle",
        "model",
        "reasoningEffort",
        "agentThreadIds",
      ]);
      try {
        return parseAgentSubagentSpawnFields(value);
      } catch {
        throw UNKNOWN;
      }
    }
```

Run `npm run check`. Any remaining "not all code paths" or `never` errors are exhaustive switches over `AgentTurnEvent["kind"]`. For each, add `case "subagentSpawn":` next to `case "subagentActivity":` with the same non-rendering behaviour. If `src/test/agentTurnEventStreams.ts` holds a per-kind record, add the fixture event there too.

- [ ] **Step 5: Implement the Rust side**

In `agent_thread_store_appserver.rs`, next to `SubagentActivity`:

```rust
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubagentSpawnStatus {
    InProgress,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SubagentSpawnEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}
```

Re-export both from `agent_thread_store.rs` by adding them to the existing `pub use appserver::{…}` line. Add this variant to `AgentTurnEvent`, after `SubagentEvent`:

```rust
    #[serde(rename_all = "camelCase")]
    SubagentSpawn {
        call_id: String,
        status: SubagentSpawnStatus,
        #[serde(deserialize_with = "appserver::nullable_required")]
        task_title: Option<String>,
        #[serde(deserialize_with = "appserver::nullable_required")]
        model: Option<String>,
        #[serde(deserialize_with = "appserver::nullable_required")]
        reasoning_effort: Option<SubagentSpawnEffort>,
        agent_thread_ids: Vec<String>,
    },
```

In the text-byte accounting match (~:1298), add `AgentTurnEvent::SubagentSpawn { task_title, .. } => (optional_len(task_title), 0),`. `optional_len` is the helper already used for compaction messages; if its signature takes `&Option<String>`, pass `task_title` as is.

In `validate_event` (`agent_thread_store_appserver.rs`), add:

```rust
        AgentTurnEvent::SubagentSpawn {
            call_id,
            task_title,
            model,
            agent_thread_ids,
            ..
        } => {
            identifier(call_id, false)?;
            if let Some(title) = task_title {
                bounded_identifier(title, false, 480)?;
            }
            if let Some(model) = model {
                bounded_identifier(model, false, 64)?;
            }
            if agent_thread_ids.len() > 32 {
                return Err("Agent subagent spawn lists too many agents.".to_string());
            }
            let mut seen = std::collections::HashSet::new();
            for id in agent_thread_ids {
                identifier(id, false)?;
                if !seen.insert(id.as_str()) {
                    return Err("Agent subagent spawn repeats an agent.".to_string());
                }
            }
            Ok(())
        }
```

In `agent_turn_log/payload.rs` `event_kind_code`, add `AgentTurnEvent::SubagentSpawn { .. } => 19,`. The SQLite `kind` column is an unconstrained `INTEGER`, so no migration is needed.

Run `cd src-tauri && cargo check --all-targets`. If `agent_thread_store_v1_compat_tests/shipped_store.rs` (~:1254) matches the live `AgentTurnEvent`, add `| AgentTurnEvent::SubagentSpawn { .. }` to its non-text arm. Never add the variant to that file's own frozen shipped enum.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/domain/agentSubagentSpawn.test.ts src/domain/agentThreadWire.test.ts src/domain/agentOutput/codexAppServer.test.ts src/domain/agentThreadTailCap.test.ts src/domain/agentTurnEventSupersession.test.ts src/domain/agentThreadSearch.test.ts`
Expected: PASS.
Run: `cd src-tauri && cargo test --lib agent_thread_store ; echo "exit $?"` then `cargo test --lib agent_turn_log ; echo "exit $?"`
Expected: `exit 0` for both.
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 7: Checkpoint**

Run: `cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings ; echo "exit $?"`
Expected: `exit 0`. Do not commit.

---
### Task 4: B3 - lifecycle merges Codex spawns into batch members with task titles, model and effort

**Files:**
- Modify: `src/domain/agentSubagentLifecycle.ts`: entry type (:13-31), `retainAgentSubagentLifecycle` (:209-370), `parseAgentSubagentLifecycle` (:448)
- Modify: `src/domain/agentSubagentLifecycleLegacy.ts` (`agentSubagentLifecycleHasRetainedDetail`, `legacyEntry`)
- Modify: `contracts/agent-subagent-lifecycle-wire.json` (limits, `valid.retained`, `invalidEntryPatches`)
- Modify: `src-tauri/src/agent_subagent_lifecycle.rs`: allowed keys (:51-68), bounds (:112-122), `RETAINED_ENTRY_KEYS`, contract test limit count (6 → 7)
- Modify: `src/components/agentMode/agentSubagentDisclosurePresentation.ts` (entry type)
- Modify: `src/components/agentMode/agentRuntimeSubagentPresentation.ts` (`agentTurnRuntimeSubagents`, `entryRole`)
- Test: `src/domain/agentSubagentLifecycle.test.ts`, `src/domain/agentThreadWire.subagentLifecycle.test.ts`, `src/components/agentMode/agentRuntimeSubagentPresentation.test.ts`

**Interfaces:**
- Consumes: `AgentSubagentSpawnEvent` (Task 3).
- Produces: `AgentSubagentLifecycleEntry` gains `readonly model?: string; readonly effort?: AgentSubagentSpawnEffort;`. `MAX_SUBAGENT_MODEL_BYTES = 64` is exported from `agentSubagentLifecycle.ts`. Codex runtime subagents get `batchId = "spawn:<first callId of the batch>"`, `title = taskTitle`, `role = last agentPath segment`, `model = "<model> · <effort>"`.

- [ ] **Step 1: Write the failing lifecycle tests**

Append to `src/domain/agentSubagentLifecycle.test.ts`:

```ts
describe("Codex subagent spawns", () => {
  const spawn = (
    callId: string,
    status: "inProgress" | "completed" | "failed",
    agentThreadIds: ReadonlyArray<string>,
    taskTitle: string | null = "Review idempotency middleware",
  ): AgentTurnEvent => ({
    kind: "subagentSpawn",
    callId,
    status,
    taskTitle,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    agentThreadIds,
  });
  const started = (agentThreadId: string, agentPath: string): AgentTurnEvent => ({
    kind: "subagentActivity",
    activity: "started",
    agentThreadId,
    agentPath,
  });

  it("merges a spawn placeholder into the child thread entry once receivers are known", () => {
    const lifecycle = retainAgentSubagentLifecycle(undefined, [
      spawn("call-a", "inProgress", []),
      started("child-a", "/root/reviewer"),
      spawn("call-a", "completed", ["child-a"]),
    ]);
    expect(lifecycle?.entries).toHaveLength(1);
    expect(lifecycle?.entries[0]).toMatchObject({
      toolId: "call-a",
      agentThreadId: "child-a",
      name: "/root/reviewer",
      taskTitle: "Review idempotency middleware",
      batchKey: "spawn:call-a",
      model: "gpt-5.6-luna",
      effort: "medium",
      state: "running",
    });
  });

  it("groups consecutive spawns into one batch and starts a new batch after narration", () => {
    const lifecycle = retainAgentSubagentLifecycle(undefined, [
      spawn("call-a", "completed", ["child-a"], "Map order creation paths"),
      spawn("call-b", "completed", ["child-b"], "Write retry tests"),
      { kind: "assistantText", text: "Both agents are running." },
      spawn("call-c", "completed", ["child-c"], "Audit routes"),
    ]);
    const batches = lifecycle?.entries.map((entry) => [entry.taskTitle, entry.batchKey]);
    expect(batches).toEqual([
      ["Map order creation paths", "spawn:call-a"],
      ["Write retry tests", "spawn:call-a"],
      ["Audit routes", "spawn:call-c"],
    ]);
  });

  it("keeps a failed spawn without receivers as one failed member", () => {
    const lifecycle = retainAgentSubagentLifecycle(undefined, [
      spawn("call-x", "inProgress", []),
      spawn("call-x", "failed", []),
    ]);
    expect(lifecycle?.entries).toEqual([
      expect.objectContaining({ toolId: "call-x", state: "failed", taskTitle: expect.any(String) }),
    ]);
  });

  it("never lets a later spawn overwrite a known task title and never duplicates a child", () => {
    const lifecycle = retainAgentSubagentLifecycle(undefined, [
      started("child-a", "/root/explorer"),
      spawn("call-a", "completed", ["child-a"], "First title"),
      spawn("call-a", "completed", ["child-a"], "Second title"),
    ]);
    expect(lifecycle?.entries).toHaveLength(1);
    expect(lifecycle?.entries[0]?.taskTitle).toBe("First title");
  });
});
```

Add `import type { AgentTurnEvent } from "./agentThread";` if the file does not import it already.

Add to `contracts/agent-subagent-lifecycle-wire.json`:
- in `limits`: `"modelBytes": 64,`
- in `valid.retained.entries[0]` (the `toolu_parent` entry): `"model": "claude-sonnet-5", "effort": "medium",`
- in `invalidEntryPatches`: `{ "model": "" }`, `{ "model": 5 }`, `{ "effort": "ludicrous" }`, and `{ "model": "<65 × m>" }`, written out literally as `"mmmm…"` with 65 characters.

In `src/domain/agentThreadWire.subagentLifecycle.test.ts`, extend the destructuring in "keeps retained detail read from an existing file in memory and rewrites the file in the v1 shape" with `model: _model, effort: _effort,`.

- [ ] **Step 2: Write the failing presentation test**

Append to `src/components/agentMode/agentRuntimeSubagentPresentation.test.ts`:

```ts
describe("Codex spawn batches", () => {
  it("shows Codex children as one titled batch with role, model and effort", () => {
    const events: AgentTurnEvent[] = [
      {
        kind: "subagentSpawn",
        callId: "call-a",
        status: "completed",
        taskTitle: "Map order creation paths",
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
        agentThreadIds: ["child-a"],
      },
      {
        kind: "subagentActivity",
        activity: "started",
        agentThreadId: "child-a",
        agentPath: "/root/explorer",
      },
      {
        kind: "subagentSpawn",
        callId: "call-b",
        status: "completed",
        taskTitle: "Write retry tests",
        model: "gpt-5.6-luna",
        reasoningEffort: null,
        agentThreadIds: ["child-b"],
      },
      {
        kind: "subagentActivity",
        activity: "started",
        agentThreadId: "child-b",
        agentPath: "/root/tester",
      },
    ];
    const subagents = agentTurnRuntimeSubagents({
      events,
      status: { kind: "running" },
      subagentLifecycle: undefined,
    });
    expect(subagents.batches).toHaveLength(1);
    expect(subagents.batches[0]?.id).toBe("spawn:call-a");
    expect(
      subagents.batches[0]?.agents.map((agent) => [agent.title, agent.role, agent.model]),
    ).toEqual([
      ["Map order creation paths", "explorer", "gpt-5.6-luna · medium"],
      ["Write retry tests", "tester", "gpt-5.6-luna"],
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/domain/agentSubagentLifecycle.test.ts src/domain/agentThreadWire.subagentLifecycle.test.ts src/components/agentMode/agentRuntimeSubagentPresentation.test.ts`
Expected: FAIL, because spawns are ignored and `model`/`effort` are unknown lifecycle keys.
Run: `cd src-tauri && cargo test --lib agent_subagent_lifecycle ; echo "exit $?"`
Expected: FAIL. The limits count is 7, and the retained sample now has unknown keys.

- [ ] **Step 4: Implement the lifecycle**

In `agentSubagentLifecycle.ts`:
- Add `import type { AgentSubagentSpawnEffort, AgentSubagentSpawnEvent } from "./agentSubagentSpawn";` and `import { AGENT_SUBAGENT_SPAWN_EFFORTS } from "./agentSubagentSpawn";`.
- Add `export const MAX_SUBAGENT_MODEL_BYTES = 64;`.
- Add `readonly model?: string; readonly effort?: AgentSubagentSpawnEffort;` to `AgentSubagentLifecycleEntry`.

In `retainAgentSubagentLifecycle`, directly after the `openBatchKey` closing block and before the nested-spawn branch, add:

```ts
    if (event.kind === "subagentSpawn") {
      const retained = retainSpawn(entries, event, openBatchKey);
      openBatchKey = retained.openBatchKey;
      if (retained.truncated) truncated = true;
      changed = true;
      continue;
    }
```

Add these module functions:

```ts
function retainSpawn(
  entries: Map<string, AgentSubagentLifecycleEntry>,
  event: AgentSubagentSpawnEvent,
  openBatchKey: string | undefined,
): { readonly openBatchKey: string | undefined; readonly truncated: boolean } {
  if (!validId(event.callId)) return { openBatchKey, truncated: true };
  const batchKey = openBatchKey ?? spawnBatchKey(event.callId);
  const receivers = event.agentThreadIds.filter(validId);
  const targets: ReadonlyArray<SubagentEventIdentity> =
    receivers.length === 0
      ? [{ toolId: event.callId }]
      : receivers.map((agentThreadId, index) =>
          index === 0 ? { toolId: event.callId, agentThreadId } : { agentThreadId },
        );
  let truncated = false;
  for (const identity of targets) {
    const childName =
      identity.agentThreadId === undefined
        ? undefined
        : [...entries.values()].find((entry) => entry.agentThreadId === identity.agentThreadId)
            ?.name;
    const found = resolveAlias(entries, identity);
    if (found === undefined && entries.size >= MAX_RETAINED_SUBAGENTS) {
      truncated = true;
      continue;
    }
    const base: AgentSubagentLifecycleEntry = found ?? {
      id: identity.agentThreadId === undefined ? `tool:${event.callId}` : `thread:${identity.agentThreadId}`,
      name: "subagent",
      description: "",
      state: "running",
    };
    const named = childName === undefined ? base : { ...base, name: childName };
    const next = spawnDetails({ ...named, ...identity }, event, batchKey);
    entries.set(next.id, next);
  }
  return { openBatchKey: batchKey, truncated };
}

function spawnDetails(
  entry: AgentSubagentLifecycleEntry,
  event: AgentSubagentSpawnEvent,
  batchKey: string | undefined,
): AgentSubagentLifecycleEntry {
  const taskTitle = entry.taskTitle ?? taskTitleOf(event.taskTitle ?? undefined);
  const model = entry.model ?? (event.model === null ? undefined : clip(event.model, MAX_SUBAGENT_MODEL_BYTES));
  const effort = entry.effort ?? event.reasoningEffort ?? undefined;
  const telemetryState =
    event.status === "failed"
      ? "failed"
      : event.status === "interrupted" && (entry.telemetryState ?? "running") === "running"
        ? "interrupted"
        : entry.telemetryState;
  const settled: AgentSubagentLifecycleEntry = {
    ...entry,
    ...(taskTitle === undefined ? {} : { taskTitle }),
    ...(entry.batchKey !== undefined || batchKey === undefined ? {} : { batchKey }),
    ...(model === undefined || model === "" ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(telemetryState === undefined ? {} : { telemetryState }),
  };
  return { ...settled, state: lifecycleState(settled) };
}

function lifecycleState(entry: AgentSubagentLifecycleEntry): AgentSubagentLifecycleState {
  if (entry.resultState === "failed" || entry.telemetryState === "failed") return "failed";
  return entry.telemetryState ?? entry.resultState ?? "running";
}
```

`childName` is required because `resolveAlias` → `mergeAliases` keeps the fields of the entry inserted first, and that is the `"subagent"` placeholder. The child's `agentPath` name from `subagentActivity` must survive the merge. The existing tail of the loop computes `state` inline with the same rule. Replace that inline expression with `lifecycleState(entry)` so the rule lives in one place.

In `parseAgentSubagentLifecycle`:
- Add `"model", "effort"` to `fields`.
- Add these to the returned entry:

```ts
      ...(entry.model === undefined
        ? {}
        : { model: presentText(entry.model, MAX_SUBAGENT_MODEL_BYTES) }),
      ...(entry.effort === undefined
        ? {}
        : {
            effort: (AGENT_SUBAGENT_SPAWN_EFFORTS as ReadonlyArray<unknown>).includes(entry.effort)
              ? (entry.effort as AgentSubagentSpawnEffort)
              : fail(),
          }),
```

In `agentSubagentLifecycleLegacy.ts`, add `entry.model !== undefined || entry.effort !== undefined ||` to `agentSubagentLifecycleHasRetainedDetail`, and add `model: _model, effort: _effort,` to the destructuring in `legacyEntry`.

In `src-tauri/src/agent_subagent_lifecycle.rs`:
- Add `const MAX_MODEL_BYTES: usize = 64;` and `const EFFORTS: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];`.
- Add `| "model" | "effort"` to the allowed entry keys.
- Add `("model", MAX_MODEL_BYTES)` to the non-empty bounded list.
- After it, add:

```rust
        if fields.contains_key("effort")
            && !fields
                .get("effort")
                .and_then(Value::as_str)
                .is_some_and(|effort| EFFORTS.contains(&effort))
        {
            return false;
        }
```

- Change `RETAINED_ENTRY_KEYS` to `[&str; 6] = ["taskTitle", "batchKey", "nestedCount", "parentToolId", "model", "effort"]`.
- In `shared_wire_contract_roundtrips_and_rejects_invalid_patches`, change `Some(6)` to `Some(7)` and add `assert_eq!(wire["limits"]["modelBytes"], json!(MAX_MODEL_BYTES));`.

- [ ] **Step 5: Implement the presentation**

In `agentSubagentDisclosurePresentation.ts`, add `readonly model?: string; readonly effort?: string;` to `AgentSubagentDisclosureEntry`.

In `agentRuntimeSubagentPresentation.ts` `agentTurnRuntimeSubagents`, change the `sources` mapping:

```ts
    const title = entry.taskTitle ?? observation?.title ?? codexTitle(entry);
    return {
      id: entry.toolId,
      batchId: entryBatchId(entry, settlement),
      observedState: entry.state,
      resumable: entryThreadId(entry) !== undefined && settlement === "running",
      activityOrder: observation?.order ?? index - entries.length,
      ...present("title", title),
      ...present("role", entryRole(entry)),
      ...present("model", entryModel(entry)),
      ...present("progress", observation?.progress ?? carriedProgress(entry, title)),
      ...present("lastToolName", observation?.lastToolName ?? entry.lastToolName),
      ...present("outcome", entry.detail),
      ...present("durationMs", entry.durationMs),
      ...present("totalTokens", entry.totalTokens),
      ...present("toolUses", entry.steps),
      ...present("nestedCount", entry.nestedCount),
      ...present("recentActivity", observation?.recentActivity),
    };
```

Replace `entryRole` with:

```ts
function entryRole(entry: AgentSubagentDisclosureEntry): string | undefined {
  if (entryThreadId(entry) !== undefined) {
    if (entry.taskTitle === undefined) return undefined;
    const role = codexTitle(entry);
    return role === undefined || FALLBACK_ROLE_NAMES.has(role) ? undefined : role;
  }
  const name = entry.subagentType ?? entry.name;
  if (isAgentSubagentSpawnToolName(name) || FALLBACK_ROLE_NAMES.has(name)) return undefined;
  return name;
}

function entryModel(entry: AgentSubagentDisclosureEntry): string | undefined {
  if (entry.model === undefined) return undefined;
  return entry.effort === undefined ? entry.model : `${entry.model} · ${entry.effort}`;
}
```

`agentRuntimeSubagentBody` still appends `agent.model` to the member body, which matches the mockup line "Sonnet 5 · medium".

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/domain/agentSubagentLifecycle.test.ts src/domain/agentSubagentLifecycle.retention.test.ts src/domain/agentSubagentLifecycleLegacy.test.ts src/domain/agentThreadWire.subagentLifecycle.test.ts src/components/agentMode/agentRuntimeSubagentPresentation.test.ts src/components/agentMode/agentRuntimeSubagentPresentation.retention.test.ts src/components/agentMode/agentSubagentDisclosurePresentation.test.ts`
Expected: PASS.
Run: `cd src-tauri && cargo test --lib agent_subagent_lifecycle ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 7: Checkpoint**

Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`. Do not commit.

---
### Task 5: Subagent batch row redesign (t3code AgentSpawnRow / AgentSpawnMemberRow)

**Files:**
- Modify: `src/components/agentMode/AgentSubagentDisclosure.tsx` (full rewrite; the props stay source-compatible)
- Modify: `src/components/agentMode/agentSubagents.css`: delete every `.agent-spawn*` and `.agent-spawn-member*` rule; add the `.cv-spawn*` rules below; delete the `.agent-background-row*` rules only if `rg -n "agent-background-row" src --glob '!*.css'` finds no reference (P3 retires them)
- Test: `src/components/agentMode/AgentSubagentDisclosure.test.tsx`, `src/components/agentMode/agentSubagentsStyles.test.ts`

**Interfaces:**
- Consumes: `AgentRuntimeSubagents` (Task 4 titles, roles and models), and `agentSpawnLeadLabel`, `agentSpawnStatusLabel`, `agentRuntimeSubagentMemberLabel`, `agentRuntimeSubagentActivityLine` and `agentRuntimeSubagentBody` from `agentRuntimeSubagentPresentation.ts`. Also `RoleTag` from `src/ui/foundation/RoleTag`.
- Produces: `AgentSubagentDisclosure({ subagents, onOpenAgents?, memberRenderProbe? })`, unchanged, rendered by P3's `AgentTurnView`. DOM classes are `.cv-spawn`, `.cv-spawn__head` (button, `aria-expanded`), `.cv-spawn__members`, `.cv-spawn-member`, `.cv-spawn-member__head`, `.cv-spawn-member__meta`, `.cv-spawn-member__activity`, `.cv-spawn-member__body` and `.cv-spawn__open`.

- [ ] **Step 1: Write the failing component tests**

Replace the assertions in `AgentSubagentDisclosure.test.tsx` that target `.agent-spawn*` classes. Keep the file's existing `render`/`source` helpers and add:

```tsx
  it("opens a live batch by default with titled members, role tags and the panel link", () => {
    const onOpenAgents = vi.fn();
    render(
      subagents([
        source({ id: "a", batchId: "spawn:call-a", title: "Map order creation paths", role: "explorer", observedState: "completed", durationMs: 48_000, totalTokens: 12_400 }),
        source({ id: "b", batchId: "spawn:call-a", title: "Review idempotency middleware", role: "reviewer", progress: "Read src/middleware/idempotency.ts" }),
      ]),
      onOpenAgents,
    );
    const head = host.querySelector<HTMLButtonElement>(".cv-spawn__head");
    expect(head?.getAttribute("aria-expanded")).toBe("true");
    expect(head?.textContent).toContain("Kicked off 2 subagents");
    expect(head?.textContent).toContain("1 working");
    const members = [...host.querySelectorAll(".cv-spawn-member")];
    expect(members.map((member) => member.querySelector(".cv-spawn-member__title")?.textContent)).toEqual([
      "Map order creation paths",
      "Review idempotency middleware",
    ]);
    expect(members[0]?.querySelector(".cv-role")?.textContent).toBe("explorer");
    expect(members[0]?.querySelector(".cv-spawn-member__meta")?.textContent).toBe("48s · 12.4k tok");
    expect(members[1]?.querySelector(".cv-spawn-member__meta")?.textContent).toBe("Working");
    act(() => host.querySelector<HTMLButtonElement>(".cv-spawn__open")?.click());
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });

  it("keeps a settled batch collapsed until the user opens it", () => {
    render(subagents([source({ id: "a", batchId: "spawn:call-a", title: "Audit routes", observedState: "completed" })]));
    const head = host.querySelector<HTMLButtonElement>(".cv-spawn__head");
    expect(head?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".cv-spawn__members")).toBeNull();
    act(() => head?.click());
    expect(host.querySelector(".cv-spawn__members")).not.toBeNull();
  });
```

If the existing file has no `subagents(...)` or `source(...)` helper with these names, write them at the top of the test:

```tsx
function source(overrides: Partial<AgentRuntimeSubagentSource> & { readonly id: string }): AgentRuntimeSubagentSource {
  return { batchId: "spawn:call-a", observedState: "running", resumable: true, activityOrder: 0, ...overrides };
}

function subagents(sources: ReadonlyArray<AgentRuntimeSubagentSource>): AgentRuntimeSubagents {
  return projectAgentRuntimeSubagents(sources, false);
}
```

In `agentSubagentsStyles.test.ts`, change the token assertion to accept `--cv-*` (`expect(name, name).toMatch(/^--(cv-|agent-|ease-standard$)/)`). Replace `".agent-spawn__row"` with `".cv-spawn__head"` in "keeps the chat row and the indicator quiet". Add:

```ts
  it("mirrors the mockup spawn row geometry and honours reduced motion", () => {
    expect(declaration(".cv-spawn__head", "min-height")).toBe("26px");
    expect(declaration(".cv-spawn__members", "margin")).toBe("2px 0 0 28px");
    expect(declaration(".cv-spawn__open", "height")).toBe("22px");
    expect(sheet.source).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cv-spawn\[data-live="true"\] \.cv-spawn__lead[\s\S]*animation: none/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/AgentSubagentDisclosure.test.tsx src/components/agentMode/agentSubagentsStyles.test.ts`
Expected: FAIL, because the `.cv-spawn*` classes do not exist yet.

- [ ] **Step 3: Rewrite the component**

Replace `src/components/agentMode/AgentSubagentDisclosure.tsx` with:

```tsx
import { ChevronRight, Users } from "lucide-react";
import { memo, useId, useMemo } from "react";
import {
  summarizeAgentRuntimeSubagents,
  type AgentRuntimeSubagent,
  type AgentRuntimeSubagentBatch,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import { RoleTag } from "../../ui/foundation/RoleTag";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import {
  agentRuntimeSubagentActivityLine,
  agentRuntimeSubagentBody,
  agentRuntimeSubagentMemberLabel,
  agentSpawnBatchOrigin,
  agentSpawnLeadLabel,
  agentSpawnStatusLabel,
} from "./agentRuntimeSubagentPresentation";
import "./agentSubagents.css";

export const AgentSubagentDisclosure = memo(function AgentSubagentDisclosure({
  subagents,
  onOpenAgents,
  memberRenderProbe,
}: {
  readonly subagents: AgentRuntimeSubagents;
  readonly onOpenAgents?: () => void;
  readonly memberRenderProbe?: (agentId: string) => void;
}) {
  if (subagents.batches.length === 0) return null;
  return (
    <div className="cv-spawn-list">
      {subagents.batches.map((batch) => (
        <AgentSpawnBatchRow
          batch={batch}
          key={batch.id}
          memberRenderProbe={memberRenderProbe}
          onOpenAgents={onOpenAgents}
        />
      ))}
    </div>
  );
});

const AgentSpawnBatchRow = memo(function AgentSpawnBatchRow({
  batch,
  onOpenAgents,
  memberRenderProbe,
}: {
  readonly batch: AgentRuntimeSubagentBatch;
  readonly onOpenAgents?: () => void;
  readonly memberRenderProbe?: (agentId: string) => void;
}) {
  const disclosure = useAgentToolDisclosure(batch.id);
  const membersId = useId();
  const summary = useMemo(() => summarizeAgentRuntimeSubagents(batch.agents), [batch]);
  const origin = agentSpawnBatchOrigin(batch.id);
  const expanded = summary.live ? !disclosure.expanded : disclosure.expanded;

  return (
    <div
      className="cv-spawn"
      data-live={summary.live ? "true" : undefined}
      data-origin={origin}
      data-tone={summary.tone}
    >
      <button
        aria-controls={membersId}
        aria-expanded={expanded}
        className="cv-spawn__head"
        onClick={disclosure.toggle}
        type="button"
      >
        <span aria-hidden="true" className="cv-spawn__icon">
          <Users size={16} />
        </span>
        <span className="cv-spawn__lead">{agentSpawnLeadLabel(summary, origin)}</span>
        <span className="cv-spawn__status">· {agentSpawnStatusLabel(summary)}</span>
        <ChevronRight aria-hidden="true" className="cv-spawn__chevron" size={14} />
      </button>
      {expanded && (
        <>
          <ul aria-label="Subagents" className="cv-spawn__members" id={membersId}>
            {batch.agents.map((agent) => (
              <li key={agent.id}>
                <AgentSpawnMember agent={agent} renderProbe={memberRenderProbe} />
              </li>
            ))}
          </ul>
          {onOpenAgents !== undefined && (
            <button className="cv-spawn__open" onClick={onOpenAgents} type="button">
              Open Agents panel ›
            </button>
          )}
        </>
      )}
    </div>
  );
});

const AgentSpawnMember = memo(function AgentSpawnMember({
  agent,
  renderProbe,
}: {
  readonly agent: AgentRuntimeSubagent;
  readonly renderProbe?: (agentId: string) => void;
}) {
  renderProbe?.(agent.id);
  const disclosure = useAgentToolDisclosure(agent.id);
  const bodyId = useId();
  const body = agentRuntimeSubagentBody(agent);
  const activityLine = agentRuntimeSubagentActivityLine(agent);
  const head = (
    <>
      <span className="cv-spawn-member__title">{agent.title}</span>
      {agent.role !== null && <RoleTag>{agent.role}</RoleTag>}
      <span className="cv-spawn-member__meta">{agentRuntimeSubagentMemberLabel(agent)}</span>
    </>
  );
  const titleState = agent.titleKnown ? undefined : "unknown";

  if (body === null) {
    return (
      <div className="cv-spawn-member" data-status={agent.status} data-title={titleState}>
        <div className="cv-spawn-member__head">{head}</div>
        {activityLine !== null && <p className="cv-spawn-member__activity">{activityLine}</p>}
      </div>
    );
  }

  return (
    <div className="cv-spawn-member" data-status={agent.status} data-title={titleState}>
      <button
        aria-controls={bodyId}
        aria-expanded={disclosure.expanded}
        className="cv-spawn-member__head"
        onClick={disclosure.toggle}
        type="button"
      >
        {head}
      </button>
      {!disclosure.expanded && activityLine !== null && (
        <p className="cv-spawn-member__activity">{activityLine}</p>
      )}
      {disclosure.expanded && (
        <div className="cv-spawn-member__body" id={bodyId}>
          <pre>{body}</pre>
        </div>
      )}
    </div>
  );
});
```

A live batch is expanded by default, as in the mockup "subagents" state. The shared disclosure toggle inverts that default, so a user's collapse survives live updates, and the batch collapses when it settles unless the user opened it.

- [ ] **Step 4: Replace the CSS**

In `agentSubagents.css`, delete every rule whose selector list contains `.agent-spawn` or `.agent-spawn-member`. When a rule mixes those selectors with `.agent-background-row__action`, keep the rule and drop only the spawn selectors. Then add:

```css
@keyframes cv-spawn-pulse {
  0%,
  40% {
    opacity: 1;
  }
  50%,
  90% {
    opacity: 0.5;
  }
  100% {
    opacity: 1;
  }
}

.cv-spawn-list {
  display: grid;
  gap: 2px;
}

.cv-spawn {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-bottom: 8px;
}

.cv-spawn__head {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 6px 0 2px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-subtle);
  cursor: pointer;
  font: inherit;
  font-size: var(--cv-t-sm);
  line-height: var(--cv-lh-prose);
  text-align: left;
}

.cv-spawn__head:hover {
  background: var(--cv-tint-1);
  color: var(--cv-fg-strong);
}

.cv-spawn__head:focus-visible,
.cv-spawn-member__head:focus-visible,
.cv-spawn__open:focus-visible {
  box-shadow: var(--cv-ring-focus);
  outline: none;
}

.cv-spawn__icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
}

.cv-spawn__chevron {
  transition: transform var(--cv-motion-base) var(--cv-ease);
}

.cv-spawn__head[aria-expanded="true"] .cv-spawn__chevron {
  transform: rotate(90deg);
}

.cv-spawn[data-live="true"] .cv-spawn__lead {
  animation: cv-spawn-pulse 2s steps(6) infinite;
}

.cv-spawn__members {
  display: flex;
  flex-direction: column;
  margin: 2px 0 0 28px;
  padding: 0;
  list-style: none;
}

.cv-spawn-member {
  display: flex;
  flex-direction: column;
  padding: 3px 6px;
  border-radius: var(--cv-r-sm);
}

.cv-spawn-member:hover {
  background: var(--cv-tint-1);
}

.cv-spawn-member__head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--cv-fg);
  font: inherit;
  font-size: var(--cv-t-sm);
  line-height: 22px;
  text-align: left;
}

button.cv-spawn-member__head {
  cursor: pointer;
}

.cv-spawn-member__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-spawn-member__meta {
  flex: none;
  margin-left: auto;
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-2xs);
  font-variant-numeric: tabular-nums;
}

.cv-spawn-member[data-status="working"] .cv-spawn-member__meta {
  color: var(--cv-accent);
}

.cv-spawn-member[data-status="failed"] .cv-spawn-member__meta {
  color: var(--cv-danger);
}

.cv-spawn-member__activity {
  margin: 0;
  overflow: hidden;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-spawn-member__body {
  margin: 4px 0 2px;
  padding: 8px 12px;
  border-radius: var(--cv-r-sm);
  background: var(--cv-tint-2);
}

.cv-spawn-member__body pre {
  margin: 0;
  color: var(--cv-fg);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.cv-spawn__open {
  align-self: flex-start;
  height: 22px;
  margin: 4px 0 0 26px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-subtle);
  cursor: pointer;
  font: inherit;
  font-size: var(--cv-t-xs);
}

.cv-spawn__open:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

@media (prefers-reduced-motion: reduce) {
  .cv-spawn[data-live="true"] .cv-spawn__lead {
    animation: none;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/AgentSubagentDisclosure.test.tsx src/components/agentMode/agentSubagentsStyles.test.ts src/components/agentMode/AgentThreadSession.test.tsx`
Expected: PASS. If any `AgentThreadSession` test asserts `.agent-spawn*`, change only that selector to the `.cv-spawn*` equivalent. That file is P3-owned; this selector-only edit is the Task 1 reserved-hunk follow-up, so tell P3.

- [ ] **Step 6: Checkpoint**

Run: `npx eslint src/components/agentMode/AgentSubagentDisclosure.tsx --max-warnings 0 ; echo "exit $?"`
Expected: `exit 0`. Do not commit.

---

### Task 6: Agents panel as the right-panel surface "agents" (This turn / Earlier, live timers, recent activity)

**Files:**
- Create: `src/components/agentMode/agents/agentAgentsPanelContext.tsx`, `agentAgentsPanelContext.test.tsx`
- Create: `src/components/agentMode/agents/AgentAgentsPanelSurface.tsx`, `src/components/agentMode/agents/AgentAgentsToggleButton.tsx`
- Modify: `src/components/agentMode/agentAgentsPanelPresentation.ts`: model; delete `AgentAgentsDockMode`, `agentAgentsDockMode`, `AGENTS_DOCK_MIN_WIDTH`
- Modify: `src/components/agentMode/AgentAgentsPanel.tsx` (rewrite body; delete header, close, modal and focus trap, which now belong to the P6 frame)
- Modify: `src/components/agentMode/AgentAgentsDock.tsx` (publisher + announcer only)
- Modify: `src/components/agentMode/useAgentThreadAgents.tsx` (memoised result, `ticker`, `openPanel` through context; delete open state and `panel`)
- Modify: `src/components/agentMode/agentSubagents.css`: delete `.agents-panel*` and the `.agents-dock[data-agents=…]` overlay/docked rules; keep `.agents-dock` and `.agents-dock__main` as a flex column; add `.cv-agents*`
- Modify (reserved hunks c, d): `src/components/agentMode/AgentModeView.tsx`
- Test: `src/components/agentMode/AgentAgentsPanel.test.tsx`, `src/components/agentMode/agentAgentsPanelPresentation.test.ts`

**Interfaces:**
- Consumes: from P6, `surface.openSurface(kind: AgentSurfaceKind): void`, `surface.toggleSurface(kind: AgentSurfaceKind): void`, `surface.isSurfaceOpen(kind: AgentSurfaceKind): boolean`, and `AgentSurfaceHost` prop `agentsPanel?: ReactNode`. From P2, `AgentThreadHeader` prop `trailingExtras?: ReactNode`.
- Produces:
  - `AgentAgentsPanelProvider({ isOpen, onOpen, onToggle, children })`
  - `usePublishAgentThreadAgents(agents: AgentThreadAgents): void`
  - `useAgentThreadAgentsSnapshot(): AgentThreadAgents | null`
  - `useAgentAgentsPanelControls(): { readonly isOpen: boolean; readonly working: number; readonly names: ReadonlyArray<string>; open(): void; toggle(): void }`, which P3's composer banner may use
  - `AgentAgentsPanelSurface()`, `AgentAgentsToggleButton()`
  - `AgentThreadAgents` gains `readonly ticker: AgentElapsedTicker` and loses `panel`
  - `agentAgentsPanelModel(groups)` returns `{ current, earlier, notice, truncated, working, idle, settled, totalTokens }`
  - `agentWorkingAgentNames(groups): ReadonlyArray<string>`

- [ ] **Step 1: Write the failing model tests**

Append to `agentAgentsPanelPresentation.test.ts`, reusing its existing `group`/`source` helpers:

```ts
describe("agents panel sections", () => {
  it("puts the latest turn with agents under This turn and older turns under Earlier", () => {
    const model = agentAgentsPanelModel([
      group("t1", [
        source({ id: "a", title: "Old A", observedState: "completed", durationMs: 30_000, totalTokens: 10_000 }),
        source({ id: "b", title: "Old B", observedState: "completed", durationMs: 65_000, totalTokens: 21_000 }),
      ]),
      group("t2", []),
      group("t3", [
        source({ id: "c", title: "Review", role: "reviewer", progress: "Read src/app.ts" }),
        source({ id: "d", title: "Map", observedState: "completed", durationMs: 48_000 }),
      ]),
    ]);
    expect(model.current.map((row) => row.agent.title)).toEqual(["Review", "Map"]);
    expect(model.earlier).toEqual([
      expect.objectContaining({
        key: "t1",
        label: "Ran 2 subagents",
        summary: "2 agents · 31.0k tok · 1m 05s",
        tone: "completed",
      }),
    ]);
    expect(model.working).toBe(1);
    expect(model.settled).toBe(3);
  });

  it("names the working agents by role, falling back to the title", () => {
    expect(
      agentWorkingAgentNames([
        group("t1", [
          source({ id: "a", title: "Review", role: "reviewer" }),
          source({ id: "b", title: "Write retry tests" }),
          source({ id: "c", title: "Done", observedState: "completed" }),
        ]),
      ]),
    ).toEqual(["reviewer", "Write retry tests"]);
  });
});
```

- [ ] **Step 2: Write the failing context tests**

Create `src/components/agentMode/agents/agentAgentsPanelContext.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_AGENT_RUNTIME_SUBAGENTS } from "../../../domain/agentRuntimeSubagent";
import { createAgentElapsedTicker } from "../agentElapsedTicker";
import type { AgentThreadAgents } from "../useAgentThreadAgents";
import {
  AgentAgentsPanelProvider,
  useAgentAgentsPanelControls,
  usePublishAgentThreadAgents,
} from "./agentAgentsPanelContext";

function agents(threadId: string, working: number): AgentThreadAgents {
  return {
    threadId,
    groups: [],
    tracked: working > 0,
    working,
    counts: { working, idle: 0, completed: 0, failed: 0, stopped: 0, unknown: 0 },
    truncated: false,
    ticker: createAgentElapsedTicker(),
    openPanel: () => undefined,
    subagentsFor: () => EMPTY_AGENT_RUNTIME_SUBAGENTS,
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Publisher({ value }: { readonly value: AgentThreadAgents | null }) {
  return value === null ? null : <Publish value={value} />;
}
function Publish({ value }: { readonly value: AgentThreadAgents }) {
  usePublishAgentThreadAgents(value);
  return null;
}
function Reader() {
  const controls = useAgentAgentsPanelControls();
  return (
    <button onClick={controls.toggle} type="button">
      {`${controls.isOpen}:${controls.working}`}
    </button>
  );
}

describe("agents panel context", () => {
  it("publishes the session's agents to the top bar and unpublishes on unmount", () => {
    const toggle = vi.fn();
    const render = (value: AgentThreadAgents | null) =>
      act(() =>
        root.render(
          <AgentAgentsPanelProvider isOpen={false} onOpen={() => undefined} onToggle={toggle}>
            <Publisher value={value} />
            <Reader />
          </AgentAgentsPanelProvider>,
        ),
      );
    render(agents("thread-a", 2));
    expect(host.textContent).toBe("false:2");
    render(agents("thread-b", 0));
    expect(host.textContent).toBe("false:0");
    render(null);
    expect(host.textContent).toBe("false:0");
    act(() => host.querySelector("button")?.click());
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("is inert outside a provider", () => {
    act(() => root.render(<Reader />));
    expect(host.textContent).toBe("false:0");
    act(() => host.querySelector("button")?.click());
  });
});
```

Update `AgentAgentsPanel.test.tsx`:
- Delete the tests "closes from the button and Escape, and takes focus only for a user-initiated open" and "becomes a focus-trapped dialog only as a modal overlay", because the frame owns closing and focus.
- Change the `.agents-panel__*` selectors to the `.cv-agents*` names used in Step 5: `__row` → `.cv-agents-row`, `__name` → `.cv-agents-row__name`, `__role` → `.cv-role`, `__elapsed` → `.cv-agents-row__elapsed`, `__activity` → `.cv-agents-row__activity`, `__metrics` → `.cv-agents-row__metrics`, `__foot` → `.cv-agents__foot`, `__empty-title` → `.cv-agents__empty-title`.
- In "renders the three-line row anatomy in stable spawn order across turns", expect the rows of `t2` under `.cv-agents__section[data-section="current"]`, and one `.cv-agents-earlier` button for `t1`, labelled "Ran 1 subagent".
- In "renders a collapsed recent activity history…", replace `details`/`summary` with `button[aria-controls]` and `ol`, and keep the "stays open across live updates" assertion.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/agentAgentsPanelPresentation.test.ts src/components/agentMode/agents/agentAgentsPanelContext.test.tsx src/components/agentMode/AgentAgentsPanel.test.tsx`
Expected: FAIL (the module is missing and the model shape is new).

- [ ] **Step 4: Implement the model and the context**

In `agentAgentsPanelPresentation.ts`, delete `AGENTS_DOCK_MIN_WIDTH`, `AgentAgentsDockMode` and `agentAgentsDockMode`. Replace `AgentAgentsPanelModel` and `agentAgentsPanelModel` with:

```ts
export interface AgentAgentsPanelEarlierGroup {
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly tone: "completed" | "failed" | "inactive";
  readonly rows: ReadonlyArray<AgentAgentsPanelRow>;
}

export interface AgentAgentsPanelModel {
  readonly current: ReadonlyArray<AgentAgentsPanelRow>;
  readonly earlier: ReadonlyArray<AgentAgentsPanelEarlierGroup>;
  readonly notice: string | null;
  readonly truncated: boolean;
  readonly working: number;
  readonly idle: number;
  readonly settled: number;
  readonly totalTokens: number;
}

export function agentAgentsPanelModel(
  groups: ReadonlyArray<AgentAgentsPanelGroup>,
): AgentAgentsPanelModel {
  const populated = groups.filter((group) => group.subagents.agents.length > 0);
  const all = populated.flatMap((group) => rowsOf(group));
  const kept = new Set(all.slice(-MAX_AGENTS_PANEL_ROWS).map((row) => row.key));
  const latest = populated[populated.length - 1];
  const current = latest === undefined ? [] : rowsOf(latest).filter((row) => kept.has(row.key));
  const earlier = populated
    .slice(0, -1)
    .reverse()
    .map((group) => earlierGroup(group, kept))
    .filter((group) => group.rows.length > 0);
  const working = all.filter((row) => row.agent.status === "working").length;
  const idle = all.filter((row) => row.agent.status === "idle").length;
  const truncated = groups.some((group) => group.subagents.truncated);
  return {
    current,
    earlier,
    notice: panelNotice(kept.size, all.length, truncated),
    truncated,
    working,
    idle,
    settled: all.length - working - idle,
    totalTokens: all.reduce((total, row) => total + (row.agent.totalTokens ?? 0), 0),
  };
}

export function agentWorkingAgentNames(
  groups: ReadonlyArray<AgentAgentsPanelGroup>,
): ReadonlyArray<string> {
  const names = groups.flatMap((group) =>
    group.subagents.agents
      .filter((agent) => agent.status === "working")
      .map((agent) => agent.role ?? agent.title),
  );
  return [...new Set(names)];
}

function rowsOf(group: AgentAgentsPanelGroup): ReadonlyArray<AgentAgentsPanelRow> {
  return group.subagents.agents.map((agent) => ({
    key: agentAgentsPanelRowKey(group.key, agent.id),
    agent,
  }));
}

function earlierGroup(
  group: AgentAgentsPanelGroup,
  kept: ReadonlySet<string>,
): AgentAgentsPanelEarlierGroup {
  const rows = rowsOf(group).filter((row) => kept.has(row.key));
  const agents = group.subagents.agents;
  const tokens = agents.reduce((total, agent) => total + (agent.totalTokens ?? 0), 0);
  const longest = agents.reduce(
    (max, agent) => (agent.elapsed.kind === "settled" ? Math.max(max, agent.elapsed.durationMs) : max),
    0,
  );
  const count = agents.length;
  const plural = count === 1 ? "" : "s";
  const summary = [
    `${count} agent${plural}`,
    tokens === 0 ? null : `${agentTokenCountLabel(tokens)} tok`,
    longest === 0 ? null : agentElapsedLabel(longest),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const failed = agents.some((agent) => agent.status === "failed");
  const completed = agents.every((agent) => agent.status === "completed");
  return {
    key: group.key,
    label: `Ran ${count} subagent${plural}`,
    summary,
    tone: failed ? "failed" : completed ? "completed" : "inactive",
    rows,
  };
}
```

Import `agentElapsedLabel` and `agentTokenCountLabel` from `./agentRuntimeSubagentPresentation`. If that creates an import cycle, which `npm run check` or the lint rule `import/no-cycle` reports, move both label helpers into `agentAgentsPanelPresentation.ts` unchanged and re-point their importers. `agentElapsedLabel(65_000)` returns `"1m 05s"`, which the test expects.

Create `src/components/agentMode/agents/agentAgentsPanelContext.tsx`:

```tsx
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { agentWorkingAgentNames } from "../agentAgentsPanelPresentation";
import type { AgentThreadAgents } from "../useAgentThreadAgents";

interface AgentAgentsStore {
  getSnapshot(): AgentThreadAgents | null;
  subscribe(listener: () => void): () => void;
  publish(agents: AgentThreadAgents | null): void;
}

interface AgentAgentsPanelContextValue {
  readonly store: AgentAgentsStore;
  readonly isOpen: boolean;
  open(): void;
  toggle(): void;
}

export interface AgentAgentsPanelControls {
  readonly isOpen: boolean;
  readonly working: number;
  readonly names: ReadonlyArray<string>;
  open(): void;
  toggle(): void;
}

const AgentAgentsPanelContext = createContext<AgentAgentsPanelContextValue | null>(null);
const NOOP = (): void => undefined;
const NO_SUBSCRIPTION = (): (() => void) => NOOP;
const NO_AGENTS = (): AgentThreadAgents | null => null;
const EMPTY_NAMES: ReadonlyArray<string> = [];

function createAgentAgentsStore(): AgentAgentsStore {
  let current: AgentThreadAgents | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(agents) {
      if (agents === current) return;
      current = agents;
      for (const listener of [...listeners]) listener();
    },
  };
}

export function AgentAgentsPanelProvider({
  children,
  isOpen,
  onOpen,
  onToggle,
}: {
  readonly children: ReactNode;
  readonly isOpen: boolean;
  onOpen(): void;
  onToggle(): void;
}) {
  const [store] = useState(createAgentAgentsStore);
  const value = useMemo(
    () => ({ store, isOpen, open: onOpen, toggle: onToggle }),
    [isOpen, onOpen, onToggle, store],
  );
  return (
    <AgentAgentsPanelContext.Provider value={value}>{children}</AgentAgentsPanelContext.Provider>
  );
}

export function usePublishAgentThreadAgents(agents: AgentThreadAgents): void {
  const context = useContext(AgentAgentsPanelContext);
  useLayoutEffect(() => {
    if (context === null) return;
    context.store.publish(agents);
    return () => {
      if (context.store.getSnapshot() === agents) context.store.publish(null);
    };
  }, [agents, context]);
}

export function useAgentThreadAgentsSnapshot(): AgentThreadAgents | null {
  const context = useContext(AgentAgentsPanelContext);
  return useSyncExternalStore(
    context?.store.subscribe ?? NO_SUBSCRIPTION,
    context?.store.getSnapshot ?? NO_AGENTS,
  );
}

export function useAgentAgentsPanelOpener(): () => void {
  return useContext(AgentAgentsPanelContext)?.open ?? NOOP;
}

export function useAgentAgentsPanelControls(): AgentAgentsPanelControls {
  const context = useContext(AgentAgentsPanelContext);
  const agents = useAgentThreadAgentsSnapshot();
  return useMemo(
    () => ({
      isOpen: context?.isOpen ?? false,
      working: agents?.working ?? 0,
      names: agents === null ? EMPTY_NAMES : agentWorkingAgentNames(agents.groups),
      open: context?.open ?? NOOP,
      toggle: context?.toggle ?? NOOP,
    }),
    [agents, context],
  );
}
```

In `useAgentThreadAgents.tsx`:
- Delete `OpenAgentsPanel`, the `open` state, `closePanel`, `panelOpen`, `panel` and the `AgentAgentsPanelProps` import.
- Add `readonly ticker: AgentElapsedTicker;` and remove `panel` from `AgentThreadAgents`.
- Set `const openPanel = useAgentAgentsPanelOpener();`.
- Return:

```ts
  return useMemo(
    () => ({ subagentsFor, threadId, groups, tracked, working, counts, truncated, openPanel, ticker }),
    [subagentsFor, threadId, groups, tracked, working, counts, truncated, openPanel, ticker],
  );
```

Replace `AgentAgentsDock.tsx` with:

```tsx
import type { ReactNode } from "react";
import { usePublishAgentThreadAgents } from "./agents/agentAgentsPanelContext";
import { AgentSubagentAnnouncer } from "./AgentSubagentAnnouncer";
import type { AgentThreadAgents } from "./useAgentThreadAgents";
import "./agentSubagents.css";

export function AgentAgentsDock({
  agents,
  children,
}: {
  readonly agents: AgentThreadAgents;
  readonly children: ReactNode;
}) {
  usePublishAgentThreadAgents(agents);
  return (
    <div className="agents-dock">
      <div className="agents-dock__main">{children}</div>
      {agents.tracked && (
        <AgentSubagentAnnouncer
          key={agents.threadId}
          counts={agents.counts}
          truncated={agents.truncated}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite the panel, surface and toggle**

Rewrite `AgentAgentsPanel.tsx`:
- Keep `ElapsedTickerContext`, the ticker registration effect, the stale and description refs, and `renderProbe`, all unchanged in `AgentsPanelRow`.
- Use this markup:

```tsx
export interface AgentAgentsPanelProps {
  readonly groups: ReadonlyArray<AgentAgentsPanelGroup>;
  readonly ticker?: AgentElapsedTicker;
  readonly rowRenderProbe?: (agentId: string) => void;
}

export function AgentAgentsPanel({ groups, ticker: sharedTicker, rowRenderProbe }: AgentAgentsPanelProps) {
  const model = useMemo(() => agentAgentsPanelModel(groups), [groups]);
  const [ownTicker] = useState(() => (sharedTicker === undefined ? createAgentElapsedTicker() : null));
  const ticker = sharedTicker ?? ownTicker;
  useEffect(() => () => ownTicker?.dispose(), [ownTicker]);
  const empty = model.current.length === 0 && model.earlier.length === 0;
  return (
    <section aria-label="Agents" className="cv-agents">
      <div className="cv-agents__body">
        {model.notice !== null && <p className="cv-agents__notice">{model.notice}</p>}
        {empty && <AgentsPanelEmpty />}
        <ElapsedTickerContext.Provider value={ticker}>
          {model.current.length > 0 && (
            <section className="cv-agents__section" data-section="current">
              <h3 className="cv-agents__label">This turn</h3>
              <ul aria-label="This turn" className="cv-agents__list">
                {model.current.map((row) => (
                  <AgentsPanelRow agent={row.agent} key={row.key} renderProbe={rowRenderProbe} tickerKey={row.key} />
                ))}
              </ul>
            </section>
          )}
          {model.earlier.length > 0 && (
            <section className="cv-agents__section" data-section="earlier">
              <h3 className="cv-agents__label">Earlier</h3>
              {model.earlier.map((group) => (
                <AgentsPanelEarlier group={group} key={group.key} renderProbe={rowRenderProbe} />
              ))}
            </section>
          )}
        </ElapsedTickerContext.Provider>
      </div>
      {!empty && (
        <footer className="cv-agents__foot">
          <span>
            {model.working > 0 && <span className="cv-agents__working">● {model.working} working</span>}
            {model.settled > 0 && <span>{`${model.settled} settled`}</span>}
          </span>
          <span>Σ {agentTokenCountLabel(model.totalTokens)} tok</span>
        </footer>
      )}
    </section>
  );
}

function AgentsPanelEarlier({
  group,
  renderProbe,
}: {
  readonly group: AgentAgentsPanelEarlierGroup;
  readonly renderProbe?: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="cv-agents-earlier-group">
      <button
        aria-controls={listId}
        aria-expanded={open}
        className="cv-agents-earlier"
        data-tone={group.tone}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="cv-agents-earlier__dot" />
        <span>{group.label}</span>
        <span className="cv-agents-earlier__summary">
          {group.summary}
          <ChevronRight aria-hidden="true" size={12} />
        </span>
      </button>
      {open && (
        <ul aria-label={group.label} className="cv-agents__list" id={listId}>
          {group.rows.map((row) => (
            <AgentsPanelRow agent={row.agent} key={row.key} renderProbe={renderProbe} tickerKey={row.key} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

`AgentsPanelRow` markup, keeping its hooks as they are:

```tsx
    <li className="cv-agents-item">
      <div className="cv-agents-row" data-status={agent.status} data-title={agent.titleKnown ? undefined : "unknown"}>
        <span aria-hidden="true" className="cv-agents-row__dot" />
        <span className="cv-agents-row__title">
          <span className="cv-agents-row__name">{agent.title}</span>
          {agent.role !== null && <RoleTag>{agent.role}</RoleTag>}
        </span>
        <span className="cv-agents-row__elapsed">
          {elapsed.kind === "settled" && <span>{agentElapsedLabel(elapsed.durationMs)}</span>}
          {elapsed.kind === "live" && (
            <span aria-hidden="true" ref={clockRef}>
              {agentElapsedLabel(elapsed.observedDurationMs)}
            </span>
          )}
          {agent.status === "completed" && <Check aria-hidden="true" size={12} />}
        </span>
        <span className="cv-agents-row__activity">
          <span className="cv-agents-row__activity-text">{agentRuntimeSubagentActivityLine(agent) ?? statusLabel}</span>
          {elapsed.kind === "live" && <span className="cv-agents-row__stale" ref={staleRef} />}
        </span>
        <span className="cv-agents-row__metrics">{agentRuntimeSubagentMetricsLabel(agent)}</span>
        <span className="agent-visually-hidden">{statusLabel}</span>
        {elapsed.kind === "live" && <span className="agent-visually-hidden" ref={descriptionRef} />}
      </div>
      <AgentsPanelRecentActivity entries={agent.recentActivity} />
    </li>
```

`AgentsPanelRecentActivity` becomes a button disclosure (mockup `.recent`), with state local to the row so it survives live updates:

```tsx
function AgentsPanelRecentActivity({ entries }: { readonly entries: ReadonlyArray<string> }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (entries.length === 0) return null;
  return (
    <div className="cv-agents-recent">
      <button aria-controls={listId} aria-expanded={open} onClick={() => setOpen((current) => !current)} type="button">
        <ChevronRight aria-hidden="true" size={12} />
        {agentRecentActivityLabel(entries.length)}
      </button>
      {open && (
        <ol aria-label="Recent activity" id={listId}>
          {entries.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

`AgentsPanelEmpty` keeps its copy with the classes `.cv-agents__empty` and `.cv-agents__empty-title`.

Create `src/components/agentMode/agents/AgentAgentsPanelSurface.tsx`:

```tsx
import { AgentAgentsPanel } from "../AgentAgentsPanel";
import type { AgentAgentsPanelGroup } from "../agentAgentsPanelPresentation";
import { useAgentThreadAgentsSnapshot } from "./agentAgentsPanelContext";

const NO_GROUPS: ReadonlyArray<AgentAgentsPanelGroup> = [];

export function AgentAgentsPanelSurface() {
  const agents = useAgentThreadAgentsSnapshot();
  if (agents === null) return <AgentAgentsPanel groups={NO_GROUPS} />;
  return <AgentAgentsPanel groups={agents.groups} key={agents.threadId} ticker={agents.ticker} />;
}
```

Create `src/components/agentMode/agents/AgentAgentsToggleButton.tsx`:

```tsx
import { Users } from "lucide-react";
import { IconButton } from "../../../ui/foundation/IconButton";
import { useAgentAgentsPanelControls } from "./agentAgentsPanelContext";

export function AgentAgentsToggleButton() {
  const controls = useAgentAgentsPanelControls();
  return (
    <IconButton
      icon={<Users size={16} />}
      label="Toggle agents panel"
      onClick={controls.toggle}
      pressed={controls.isOpen}
      title={controls.working > 0 ? `Agents · ${controls.working} working` : "Agents"}
    />
  );
}
```

CSS: add to `agentSubagents.css`. The values are copied from the mockup `.ag*`, `.recent`, `.wf` and `.ag-foot` rules:

```css
.agents-dock,
.agents-dock__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.cv-agents {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.cv-agents__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding: 4px 8px 12px;
}

.cv-agents__label {
  margin: 0;
  padding: 4px 6px 2px;
  color: var(--cv-fg-subtle);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.cv-agents__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cv-agents-row {
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr) auto;
  grid-template-rows: 20px 18px 16px;
  column-gap: 8px;
  align-items: center;
  height: 62px;
  padding: 4px 6px;
  border-radius: var(--cv-r-sm);
}

.cv-agents-row__dot {
  grid-row: 1;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cv-accent);
}

.cv-agents-row[data-status="completed"] .cv-agents-row__dot {
  background: var(--cv-ok);
}

.cv-agents-row[data-status="failed"] .cv-agents-row__dot {
  background: var(--cv-danger);
}

.cv-agents-row[data-status="stopped"] .cv-agents-row__dot,
.cv-agents-row[data-status="unknown"] .cv-agents-row__dot,
.cv-agents-row[data-status="idle"] .cv-agents-row__dot {
  background: var(--cv-fg-subtle);
}

.cv-agents-row__title {
  grid-column: 2;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.cv-agents-row__name {
  min-width: 0;
  overflow: hidden;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-agents-row__elapsed {
  grid-column: 3;
  grid-row: 1;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 56px;
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-2xs);
  font-variant-numeric: tabular-nums;
}

.cv-agents-row__elapsed svg {
  color: var(--cv-ok);
}

.cv-agents-row__activity {
  grid-column: 2 / 4;
  grid-row: 2;
  display: flex;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  white-space: nowrap;
}

.cv-agents-row__activity-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cv-agents-row__metrics {
  grid-column: 2 / 4;
  grid-row: 3;
  overflow: hidden;
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-2xs);
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-agents-recent {
  margin: 0 6px 4px 20px;
}

.cv-agents-recent > button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  margin-left: -4px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-subtle);
  cursor: pointer;
  font: inherit;
  font-size: var(--cv-t-xs);
}

.cv-agents-recent > button:hover {
  color: var(--cv-fg-strong);
}

.cv-agents-recent > button svg {
  transition: transform var(--cv-motion-base) var(--cv-ease);
}

.cv-agents-recent > button[aria-expanded="true"] svg {
  transform: rotate(90deg);
}

.cv-agents-recent ol {
  margin: 2px 0 0;
  padding: 6px 0;
  border-left: 1px solid var(--cv-hair-strong);
  list-style: none;
}

.cv-agents-recent li {
  padding: 1px 0 1px 10px;
  overflow: hidden;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-agents-earlier {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg);
  cursor: pointer;
  font: inherit;
  font-size: var(--cv-t-sm);
}

.cv-agents-earlier:hover {
  background: var(--cv-tint-1);
}

.cv-agents-earlier__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cv-fg-subtle);
}

.cv-agents-earlier[data-tone="completed"] .cv-agents-earlier__dot {
  background: var(--cv-ok);
}

.cv-agents-earlier[data-tone="failed"] .cv-agents-earlier__dot {
  background: var(--cv-danger);
}

.cv-agents-earlier__summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-2xs);
}

.cv-agents__foot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 12px;
  border-top: 1px solid var(--cv-hair);
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-2xs);
  font-variant-numeric: tabular-nums;
}

.cv-agents__foot > span:first-child {
  display: inline-flex;
  gap: 12px;
}

.cv-agents__working {
  color: var(--cv-accent);
}

.cv-agents__notice,
.cv-agents__empty {
  margin: 0;
  padding: 8px 6px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-agents__empty-title {
  margin: 0 0 4px;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-sm);
  font-weight: 500;
}
```

- [ ] **Step 6: AgentModeView reserved hunks (c) and (d)**

In `AgentModeView.tsx` (post-P2 tree), import `AgentAgentsPanelProvider`, `AgentAgentsPanelSurface` and `AgentAgentsToggleButton`. Next to the other `useAgentLatestCallback` lines, add:

```tsx
  const openAgentsSurface = useAgentLatestCallback(() => surface.openSurface("agents"));
  const toggleAgentsSurface = useAgentLatestCallback(() => surface.toggleSurface("agents"));
```

- Replace the root fragment `<>` … `</>` of `LocalAgentModeView`'s return with `<AgentAgentsPanelProvider isOpen={surface.isSurfaceOpen("agents")} onOpen={openAgentsSurface} onToggle={toggleAgentsSurface}>` … `</AgentAgentsPanelProvider>`. This is a two-line change and nothing is re-indented.
- Add `trailingExtras={<AgentAgentsToggleButton />}` to `<AgentThreadHeader …>`.
- Add `agentsPanel={<AgentAgentsPanelSurface />}` to `<AgentSurfaceHost …>`.

If P6's `surface` methods are not merged yet when this step runs, stop this step and report to the lead. Do not stub the methods.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/agentAgentsPanelPresentation.test.ts src/components/agentMode/agents src/components/agentMode/AgentAgentsPanel.test.tsx src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/AgentModeView.test.tsx`
Expected: PASS. If an `AgentThreadSession`/`AgentModeView` test opened the old inline panel through `.agent-spawn__open` or `.agents-panel`, change it to assert that clicking "Open Agents panel ›" calls the provider's `onOpen`. Render those tests inside `<AgentAgentsPanelProvider isOpen={false} onOpen={spy} onToggle={() => undefined}>`.
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 8: Checkpoint**

Do not commit.

---
### Task 7: F1 pure model - rail filter, project menu extraction, filter-agnostic sections, per-thread bulk owners

**Files:**
- Create: `src/components/agentMode/agentRailFilter.ts`, `src/components/agentMode/agentRailFilter.test.ts`
- Create: `src/components/agentMode/agentProjectMenuPresentation.ts`, `src/components/agentMode/agentProjectMenuPresentation.test.ts`
- Modify: `src/components/agentMode/agentSidebarPresentation.ts`:
  - delete `scopeIncludes`
  - make `agentRailSections` take pre-filtered views
  - move the project-menu block (:502-506 `AgentRailScopeState`, :570-626) to the new module
  - `usable` becomes `agentProjectUsable`, imported back
- Modify: `src/components/agentMode/agentModeNavigation.ts` (`orderedRailThreadIds`), `src/components/agentMode/AgentThreadsSidebar.tsx` (`sections` memo, `runBulkAction`), `src/components/agentMode/AgentProjectMenu.tsx`, `AgentProjectScopeMenu.tsx`, `AgentRailHeader.tsx`, `useAgentThreadMenuCommands.ts` (import paths only)
- Modify: `src/domain/agentThreadBulkAction.ts` (+ test)
- Test: `src/components/agentMode/agentSidebarPresentation.test.ts` (update `agentRailSections` calls and the moved project-menu tests)

**Interfaces:**
- Produces:
  - `type AgentRailFilter = { readonly kind: "all" } | { readonly kind: "project"; readonly projectRootKey: string }`
  - `ALL_PROJECTS_FILTER`, `ALL_PROJECTS_LABEL = "All projects"`
  - `agentRailFilterKey(filter): string`
  - `agentThreadsInFilter(views, filter, entries): ReadonlyArray<AgentThreadView>`
  - `reconcileAgentRailFilter(filter, entries): AgentRailFilter`
  - `agentRailFilterFollowingProject(filter, projectRootKey, entries): AgentRailFilter`
  - `agentRailFilterLabel(filter, entries): string`
  - `agentProjectMonogram(label): string`
  - `agentRailSections(views, archivedExpanded, archivedShown, now?)`, with no scope parameter
  - `agentProjectUsable(entry: AgentRailScopeEntry | null): boolean`
  - `AgentThreadBulkRequest = { action; threadIds; missingIds; ownerKeys: ReadonlyMap<string, string> }`

- [ ] **Step 1: Write the failing filter tests**

Create `src/components/agentMode/agentRailFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  ALL_PROJECTS_FILTER,
  agentProjectMonogram,
  agentRailFilterFollowingProject,
  agentRailFilterKey,
  agentRailFilterLabel,
  agentThreadsInFilter,
  reconcileAgentRailFilter,
  type AgentRailFilter,
} from "./agentRailFilter";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

function entry(projectRootKey: string, label: string, members?: ReadonlyArray<string>): AgentRailScopeEntry {
  return {
    memberProjectRootKeys: members,
    value: projectRootKey,
    label,
    projectRootKey,
    repositoryRoot: projectRootKey,
    trust: "trusted",
    origin: "active-tab",
    rootPath: projectRootKey,
    repositoryCount: 1,
  };
}

function view(threadId: string, rootKey: string): AgentThreadView {
  return { thread: { threadId, owner: { rootKey, ownerId: "w", repositoryRoot: rootKey } } } as AgentThreadView;
}

const entries = [entry("/orders", "orders-api"), entry("/web", "web-dashboard", ["/web", "/web/packages/ui"])];
const views = [view("a", "/orders"), view("b", "/web/packages/ui"), view("c", "/gone")];
const orders: AgentRailFilter = { kind: "project", projectRootKey: "/orders" };

describe("agentRailFilter", () => {
  it("lists every thread of every open project for All projects and hides detached ones", () => {
    expect(agentThreadsInFilter(views, ALL_PROJECTS_FILTER, entries).map((v) => v.thread.threadId)).toEqual(["a", "b"]);
  });

  it("narrows to one project including grouped member roots", () => {
    expect(agentThreadsInFilter(views, orders, entries).map((v) => v.thread.threadId)).toEqual(["a"]);
    expect(
      agentThreadsInFilter(views, { kind: "project", projectRootKey: "/web" }, entries).map((v) => v.thread.threadId),
    ).toEqual(["b"]);
  });

  it("falls back to All projects when the filtered project disappears", () => {
    expect(reconcileAgentRailFilter(orders, entries)).toBe(orders);
    expect(reconcileAgentRailFilter(orders, [entry("/web", "web-dashboard")])).toBe(ALL_PROJECTS_FILTER);
  });

  it("follows the active project only when a single project is filtered", () => {
    expect(agentRailFilterFollowingProject(ALL_PROJECTS_FILTER, "/web", entries)).toBe(ALL_PROJECTS_FILTER);
    expect(agentRailFilterFollowingProject(orders, "/web/packages/ui", entries)).toEqual({
      kind: "project",
      projectRootKey: "/web",
    });
    expect(agentRailFilterFollowingProject(orders, "/orders", entries)).toBe(orders);
    expect(agentRailFilterFollowingProject(orders, "/unknown", entries)).toBe(orders);
  });

  it("labels, keys and monograms", () => {
    expect(agentRailFilterLabel(ALL_PROJECTS_FILTER, entries)).toBe("All projects");
    expect(agentRailFilterLabel(orders, entries)).toBe("orders-api");
    expect(agentRailFilterKey(orders)).toBe("project:/orders");
    expect(agentRailFilterKey(ALL_PROJECTS_FILTER)).toBe("all");
    expect(agentProjectMonogram("orders-api")).toBe("O");
    expect(agentProjectMonogram("  .9lives")).toBe("9");
    expect(agentProjectMonogram("---")).toBe("?");
  });
});
```

Create `src/components/agentMode/agentProjectMenuPresentation.test.ts`. Move every `agentProjectMenuEntries` / `agentRailScopeState` / `agentProjectClosable` test out of `agentSidebarPresentation.test.ts` into it, then add the two P8 expectations:

```ts
import { describe, expect, it } from "vitest";
import { agentProjectMenuEntries, agentRailScopeState } from "./agentProjectMenuPresentation";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

const untrusted: AgentRailScopeEntry = {
  value: "/orders",
  label: "orders-api",
  projectRootKey: "/orders",
  repositoryRoot: "/orders",
  trust: "untrusted",
  origin: "active-tab",
  rootPath: "/orders",
  repositoryCount: 1,
};

describe("project menu", () => {
  it("offers Trust project… first for an untrusted local project", () => {
    expect(agentProjectMenuEntries(untrusted)[0]).toEqual({
      id: "trust",
      label: "Trust project…",
      command: "trust",
      disabled: false,
    });
    expect(agentProjectMenuEntries({ ...untrusted, rootPath: null }).some((e) => e.command === "trust")).toBe(false);
  });

  it("labels an untrusted project Not trusted", () => {
    expect(agentRailScopeState(untrusted)).toEqual({ label: "Not trusted", action: null });
  });
});
```

In `src/domain/agentThreadBulkAction.test.ts`, change the `request` helper to:

```ts
function request(
  overrides: Partial<Omit<AgentThreadBulkRequest, "ownerKeys">> & {
    readonly ownerKeys?: ReadonlyMap<string, string>;
  } = {},
): AgentThreadBulkRequest {
  const threadIds = overrides.threadIds ?? [];
  return {
    action: "archive",
    missingIds: [],
    ...overrides,
    threadIds,
    ownerKeys: overrides.ownerKeys ?? new Map(threadIds.map((id) => [id, OWNER])),
  };
}
```

and add:

```ts
  it("applies across projects but skips a thread whose owner changed after marking", () => {
    const plan = agentThreadBulkPlan(
      request({
        threadIds: ["a", "b"],
        ownerKeys: new Map([
          ["a", "/orders"],
          ["b", "/web"],
        ]),
      }),
      [candidate("a", { ownerKey: "/orders" }), candidate("b", { ownerKey: "/elsewhere" })],
    );
    expect(plan.applyIds).toEqual(["a"]);
    expect(plan.skipped).toEqual([{ threadId: "b", reason: "foreignOwner" }]);
  });
```

Update the existing "fails closed on ids … owned by another project" case to pass `ownerKeys` explicitly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/agentRailFilter.test.ts src/components/agentMode/agentProjectMenuPresentation.test.ts src/domain/agentThreadBulkAction.test.ts`
Expected: FAIL (the modules are missing and `ownerKeys` is unknown).

- [ ] **Step 3: Implement `agentRailFilter.ts`**

```ts
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

export type AgentRailFilter =
  | { readonly kind: "all" }
  | { readonly kind: "project"; readonly projectRootKey: string };

export const ALL_PROJECTS_FILTER: AgentRailFilter = Object.freeze({ kind: "all" });
export const ALL_PROJECTS_LABEL = "All projects";

export function agentRailFilterKey(filter: AgentRailFilter): string {
  return filter.kind === "all" ? "all" : `project:${filter.projectRootKey}`;
}

export function agentThreadsInFilter(
  views: ReadonlyArray<AgentThreadView>,
  filter: AgentRailFilter,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): ReadonlyArray<AgentThreadView> {
  return views.filter((view) => {
    const owner = owningEntry(entries, view.thread.owner.rootKey);
    if (owner === null) return false;
    return filter.kind === "all" || owner.projectRootKey === filter.projectRootKey;
  });
}

export function reconcileAgentRailFilter(
  filter: AgentRailFilter,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): AgentRailFilter {
  if (filter.kind === "all") return filter;
  return entries.some((entry) => entry.projectRootKey === filter.projectRootKey)
    ? filter
    : ALL_PROJECTS_FILTER;
}

export function agentRailFilterFollowingProject(
  filter: AgentRailFilter,
  projectRootKey: string,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): AgentRailFilter {
  if (filter.kind === "all") return filter;
  const owner = owningEntry(entries, projectRootKey);
  if (owner === null || owner.projectRootKey === filter.projectRootKey) return filter;
  return { kind: "project", projectRootKey: owner.projectRootKey };
}

export function agentRailFilterLabel(
  filter: AgentRailFilter,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): string {
  if (filter.kind === "all") return ALL_PROJECTS_LABEL;
  return (
    entries.find((entry) => entry.projectRootKey === filter.projectRootKey)?.label ??
    ALL_PROJECTS_LABEL
  );
}

export function agentProjectMonogram(label: string): string {
  const first = [...label].find((character) => /[\p{L}\p{N}]/u.test(character));
  return first === undefined ? "?" : first.toLocaleUpperCase();
}

function owningEntry(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  rootKey: string,
): AgentRailScopeEntry | null {
  return (
    entries.find(
      (entry) =>
        entry.projectRootKey === rootKey || entry.memberProjectRootKeys?.includes(rootKey) === true,
    ) ?? null
  );
}
```

- [ ] **Step 4: Move the project menu into `agentProjectMenuPresentation.ts`**

Cut `AgentProjectMenuCommand`, `AgentProjectMenuTarget`, `AgentProjectMenuEntry`, `AgentRailScopeState`, `agentRailScopeState`, `agentProjectMenuTarget`, `agentProjectClosable`, `agentProjectCloseLabel`, `agentProjectMenuEntries`, `agentProjectRepositoryCountLabel`, `projectMenuEntry` and `usable` from `agentSidebarPresentation.ts` into the new file. Rename `usable` to `export function agentProjectUsable`. Apply the P8 changes:

```ts
export function agentRailScopeState(entry: AgentRailScopeEntry | null): AgentRailScopeState | null {
  if (entry === null) return null;
  if (entry.trust === "unknown") return { label: "Opening project…", action: null };
  if (entry.trust === "untrusted") return { label: "Not trusted", action: null };
  if (entry.origin === "background-tab") return { label: "Background", action: null };
  if (entry.origin === "closed-tab-live-tasks") return { label: "Tab closed", action: "release" };
  return null;
}

export function agentProjectMenuEntries(
  entry: AgentRailScopeEntry,
): ReadonlyArray<AgentProjectMenuEntry> {
  const entries: AgentProjectMenuEntry[] = [];
  if (entry.trust === "untrusted" && entry.rootPath !== null) {
    entries.push(projectMenuEntry("trust", "Trust project…", "trust", false));
  }
  if (entry.origin === "closed-tab-live-tasks" && entry.rootPath !== null) {
    entries.push(projectMenuEntry("release", "Release project", "release", false));
  }
  if (agentProjectClosable(entry)) {
    entries.push(projectMenuEntry("close", "Close project", "close", false));
  }
  entries.push(
    projectMenuEntry(
      "terminal-sessions",
      "Terminal sessions…",
      "terminalSessions",
      !agentProjectUsable(entry),
    ),
  );
  if (entry.rootPath === null) return entries;
  entries.push(projectMenuEntry("reveal", "Reveal in Finder", "reveal", false));
  entries.push(projectMenuEntry("copy-path", "Copy path", "copyPath", false));
  return entries;
}
```

In `agentSidebarPresentation.ts`, import `agentProjectUsable` for `agentRailNewThreadTarget` and `agentProjectTerminalSessionsTarget`. Re-point every importer of the moved names (`AgentProjectMenu.tsx`, `AgentProjectScopeMenu.tsx`, `AgentRailHeader.tsx`, `AgentThreadsSidebar.tsx`, `useAgentThreadMenuCommands.ts`, the tests) to `./agentProjectMenuPresentation`. Do not leave re-exports behind.

- [ ] **Step 5: Make sections filter-agnostic and bulk owner-exact**

In `agentSidebarPresentation.ts`, delete `scopeIncludes` and change `agentRailSections` to:

```ts
export function agentRailSections(
  views: ReadonlyArray<AgentThreadView>,
  archivedExpanded: boolean,
  archivedShown: number,
  now: number = Date.now(),
): AgentRailSections {
  const settled = views.filter((view) => !view.thread.archived && view.thread.settledAt != null);
```

The rest of the body stays the same, with `scoped` replaced by `views`.

In `agentModeNavigation.ts`:

```ts
export function orderedRailThreadIds(
  views: ReadonlyArray<AgentThreadView>,
): ReadonlyArray<string> {
  const sections = agentRailSections(views, false, 0);
  return [...sections.pinned, ...sections.active].map((view) => view.thread.threadId);
}
```

In `useAgentThreadNavigation.ts`, change the call to `orderedRailThreadIds(scopedPresentationViews)`. In `AgentThreadsSidebar.tsx`, the `sections` memo becomes `agentRailSections(agentThreadsInScope(views, scope), archivedExpanded, archivedShown, Math.max(organizationNow, Date.now()))`. That keeps today's behaviour until Task 9 switches it to the filter. Import `agentThreadsInScope` from `./agentModeNavigation`.

In `src/domain/agentThreadBulkAction.ts`:

```ts
export interface AgentThreadBulkRequest {
  readonly action: AgentThreadBulkAction;
  readonly threadIds: ReadonlyArray<string>;
  readonly missingIds: ReadonlyArray<string>;
  readonly ownerKeys: ReadonlyMap<string, string>;
}
```

and in `agentThreadBulkPlan`, replace the owner check with:

```ts
    if (candidate.ownerKey !== request.ownerKeys.get(threadId)) {
      skipped.push({ threadId, reason: "foreignOwner" });
      continue;
    }
```

In `AgentThreadsSidebar.tsx` `runBulkAction`, build the request as:

```ts
      const owners = new Map(views.map((view) => [view.thread.threadId, view.thread.owner.rootKey]));
      bulkCommand({
        kind: "apply",
        request: {
          action,
          threadIds: commit.ids,
          missingIds: commit.missingIds,
          ownerKeys: new Map(
            commit.ids.flatMap((threadId) => {
              const owner = owners.get(threadId);
              return owner === undefined ? [] : [[threadId, owner] as const];
            }),
          ),
        },
      });
```

Add `views` to its dependency array.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/agentRailFilter.test.ts src/components/agentMode/agentProjectMenuPresentation.test.ts src/components/agentMode/agentSidebarPresentation.test.ts src/domain/agentThreadBulkAction.test.ts src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/useAgentThreadMenuCommands.test.tsx`
Expected: PASS. Update any sidebar test that expected the "Project unavailable" label to "Not trusted".
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 7: Checkpoint**

Do not commit.

---

### Task 8: F1 navigation - all-projects list by default, filter state, reconciliation, search/jump over the filter

**Files:**
- Modify: `src/components/agentMode/useAgentThreadNavigation.ts`: session type (:121-128), state (:216-219), `scopedViews`/`scopedPresentationViews` (:315-322), `selectThread` (:405-437), `setProjectScope` (:451-495), return value (:588-610)
- Create: `src/components/agentMode/useAgentThreadNavigation.filter.test.tsx`

**Interfaces:**
- Consumes: Task 7 `agentRailFilter.ts`.
- Produces: `AgentThreadNavigation` gains `readonly railFilter: AgentRailFilter` and `setRailFilter(filter: AgentRailFilter): void`. `AgentNavigationSession.current` gains `readonly railFilter?: AgentRailFilter`. `search`, `palette.titles`, `commands.previousThread/nextThread/jumpToThread` now follow `railFilter`. `railScope`, `composerScope` and `newThreadTarget()` are unchanged.

- [ ] **Step 1: Write the failing hook tests**

Create `src/components/agentMode/useAgentThreadNavigation.filter.test.tsx`. Reuse the fixtures of the existing `useAgentThreadNavigation.test.tsx` (its thread-view, project-descriptor and group builders); import them if exported, otherwise copy the three builders verbatim into this file. The harness:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useAgentThreadNavigation,
  type AgentNavigationSession,
  type AgentThreadNavigation,
  type AgentThreadNavigationOptions,
} from "./useAgentThreadNavigation";

let host: HTMLDivElement;
let root: Root;
let latest: AgentThreadNavigation | null = null;

function Probe(props: AgentThreadNavigationOptions) {
  latest = useAgentThreadNavigation(props);
  return null;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  latest = null;
});

function navigation(): AgentThreadNavigation {
  expect(latest).not.toBeNull();
  return latest as AgentThreadNavigation;
}
```

Tests, using two projects `/orders` ("orders-api", threads `o1`, `o2`) and `/web` ("web-dashboard", thread `w1`):

```tsx
describe("all-projects thread list", () => {
  it("starts on All projects and searches and jumps across every project", () => {
    act(() => root.render(<Probe {...options()} />));
    expect(navigation().railFilter).toEqual({ kind: "all" });
    act(() => navigation().commands.jumpToThread(3));
    expect(navigation().selectedThreadId).not.toBeNull();
    expect(["o1", "o2", "w1"]).toContain(navigation().selectedThreadId);
  });

  it("narrows next/previous to the filtered project and keeps the active project separate", () => {
    act(() => root.render(<Probe {...options()} />));
    act(() => navigation().setRailFilter({ kind: "project", projectRootKey: "/web" }));
    act(() => navigation().commands.nextThread());
    expect(navigation().selectedThreadId).toBe("w1");
    expect(navigation().railScope?.projectRootKey).toBe("/web");
  });

  it("reveals a thread selected from another project by moving a single-project filter", () => {
    act(() => root.render(<Probe {...options()} />));
    act(() => navigation().setRailFilter({ kind: "project", projectRootKey: "/web" }));
    act(() => navigation().selectThread("o1"));
    expect(navigation().railFilter).toEqual({ kind: "project", projectRootKey: "/orders" });
  });

  it("keeps All projects when switching the active project", () => {
    act(() => root.render(<Probe {...options()} />));
    act(() => {
      navigation().setProjectScope("/web");
    });
    expect(navigation().railFilter).toEqual({ kind: "all" });
    expect(navigation().railScope?.projectRootKey).toBe("/web");
  });

  it("falls back to All projects when the filtered project closes, and restores the filter from the session", () => {
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: null,
        selectedThreadOwnerKey: null,
        scopeState: NO_SCOPE_STATE,
        railFilter: { kind: "project", projectRootKey: "/web" },
      },
    };
    act(() => root.render(<Probe {...options({ session })} />));
    expect(navigation().railFilter).toEqual({ kind: "project", projectRootKey: "/web" });
    act(() => root.render(<Probe {...options({ session, projects: [ordersProject] })} />));
    expect(navigation().railFilter).toEqual({ kind: "all" });
    expect(session.current.railFilter).toEqual({ kind: "all" });
  });

  it("A → B → A: a reopened project with a new generation is a new owner but the same filter key", () => {
    act(() => root.render(<Probe {...options()} />));
    act(() => navigation().setRailFilter({ kind: "project", projectRootKey: "/web" }));
    act(() => root.render(<Probe {...options({ projects: [ordersProject] })} />));
    act(() => root.render(<Probe {...options({ projects: [ordersProject, { ...webProject, generation: webProject.generation + 1 }] })} />));
    expect(navigation().railFilter).toEqual({ kind: "all" });
  });
});
```

`options(overrides)` returns `AgentThreadNavigationOptions` built from the copied builders: `agents: { threads, markThreadViewed: () => undefined, historySearch: undefined, turnLog: null }`, `presentationThreads: threads`, `groups` from the same builder the existing navigation test uses, `projects: [ordersProject, webProject]`, spread with `overrides`. Import `NO_SCOPE_STATE` from `./useAgentThreadNavigation`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/agentMode/useAgentThreadNavigation.filter.test.tsx`
Expected: FAIL (`railFilter` is undefined).

- [ ] **Step 3: Implement**

In `useAgentThreadNavigation.ts`:

```ts
import {
  ALL_PROJECTS_FILTER,
  agentRailFilterFollowingProject,
  agentThreadsInFilter,
  reconcileAgentRailFilter,
  type AgentRailFilter,
} from "./agentRailFilter";
```

- `AgentNavigationSession.current`: add `readonly railFilter?: AgentRailFilter;`.
- `AgentThreadNavigation`: add `readonly railFilter: AgentRailFilter;` and `setRailFilter(filter: AgentRailFilter): void;`.

After `const scopeEntries = useMemo(…)`:

```ts
  const [storedFilter, setStoredFilter] = useState<AgentRailFilter>(
    () => session?.current.railFilter ?? ALL_PROJECTS_FILTER,
  );
  const railFilter = reconcileAgentRailFilter(storedFilter, scopeEntries);
  if (railFilter !== storedFilter) setStoredFilter(railFilter);
```

In the session write-back inside the existing `useLayoutEffect`, add `railFilter,` to the object assigned to `session.current`, and add `railFilter` to that effect's dependency list.

Replace the two scoped-view memos with:

```ts
  const scopedViews = useMemo(
    () => agentThreadsInFilter(threadViews, railFilter, scopeEntries),
    [railFilter, scopeEntries, threadViews],
  );
  const scopedPresentationViews = useMemo(
    () => agentThreadsInFilter(presentationThreads, railFilter, scopeEntries),
    [presentationThreads, railFilter, scopeEntries],
  );
```

In `selectThread`, after `setScopeState(…)` inside `if (entry !== null)`:

```ts
        setStoredFilter((current) =>
          agentRailFilterFollowingProject(current, entry.projectRootKey, scopeEntries),
        );
```

In `setProjectScope`, just before the final `setScopeState(…)`:

```ts
      setStoredFilter((current) =>
        agentRailFilterFollowingProject(current, railScope.projectRootKey, scopeEntries),
      );
```

Add `const setRailFilter = useCallback((filter: AgentRailFilter) => setStoredFilter(filter), []);` and return both `railFilter` and `setRailFilter`. Delete the now-unused `agentThreadsInScope` import. Keep `agentThreadsInScope` exported from `agentModeNavigation.ts` only if another file still imports it; otherwise delete it together with its tests.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/useAgentThreadNavigation.filter.test.tsx src/components/agentMode/useAgentThreadNavigation.test.tsx src/components/agentMode/agentModeNavigation.test.ts`
Expected: PASS. If an existing navigation test asserted that search or ⌘1-9 are limited to the active project, change it to set `setRailFilter({kind:"project", …})` first. That is the F1 behaviour change and must be explicit in the test name.
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 5: Checkpoint**

Do not commit.

---
### Task 9: Sidebar header, project filter popover and the all-projects list (+ reserved hunk a)

**Files:**
- Create: `src/components/agentMode/AgentProjectFilterMenu.tsx`, `src/components/agentMode/AgentProjectFilterMenu.test.tsx`
- Create: `src/components/agentMode/agentSidebar.css`, `src/components/agentMode/agentSidebarStyles.test.ts`
- Modify: `src/components/agentMode/AgentRailHeader.tsx` (rewrite)
- Modify: `src/components/agentMode/AgentThreadsSidebar.tsx`: props, `sections`, `selection` owner, `empty`, header props
- Modify: `src/components/agentMode/agentSidebarPresentation.ts`: `agentRailEmptyState`, `AgentRailEmptyState`, `agentRailOrphanCount(groups, filter)`
- Modify: `src/components/agentMode/AgentThreadList.tsx` (`EmptyState` copy)
- Delete: `src/components/agentMode/AgentProjectScopeMenu.tsx`, `src/components/agentMode/AgentProjectScopeMenu.test.tsx`
- Modify: `src/components/agentMode/AgentProjectMenu.tsx` (delete it too if nothing imports it after this task)
- Modify (reserved hunk a): `src/components/agentMode/AgentModeView.tsx`, the `<AgentThreadsSidebar …>` props
- Test: `src/components/agentMode/AgentThreadsSidebar.test.tsx`

**Interfaces:**
- Consumes: Task 7 filter helpers, and `navigation.railFilter` / `navigation.setRailFilter` from Task 8.
- Produces:
  - `AgentThreadsSidebarProps` gains `readonly railFilter: AgentRailFilter; onChangeFilter(filter: AgentRailFilter): void;` and loses `onTrustProject` and `onReleaseProject`, which now route through `onProjectCommand`. `scope`/`onChangeScope` stay: `scope` is the active project used as the New thread target; `onChangeScope` is called when a project is picked.
  - `AgentProjectFilterMenu({ entries, filter, onSelectAll, onSelectProject, onProjectCommand })`
  - `AgentRailEmptyState = { kind: "noProjects" } | { kind: "noThreads"; scopeLabel: string | null } | null`

- [ ] **Step 1: Write the failing tests**

Create `src/components/agentMode/AgentProjectFilterMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProjectFilterMenu } from "./AgentProjectFilterMenu";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

function entry(projectRootKey: string, label: string, trust: AgentRailScopeEntry["trust"] = "trusted"): AgentRailScopeEntry {
  return { value: projectRootKey, label, projectRootKey, repositoryRoot: projectRootKey, trust, origin: "active-tab", rootPath: projectRootKey, repositoryCount: 1 };
}
const entries = [entry("/orders", "orders-api"), entry("/web", "web-dashboard", "untrusted")];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function openFilter() {
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Filter threads by project"]')?.click());
}

describe("AgentProjectFilterMenu", () => {
  it("lists All projects and every project, marks the current one and picks by click", () => {
    const onSelectProject = vi.fn();
    const onSelectAll = vi.fn();
    act(() =>
      root.render(
        <AgentProjectFilterMenu entries={entries} filter={{ kind: "all" }} onProjectCommand={vi.fn()} onSelectAll={onSelectAll} onSelectProject={onSelectProject} />,
      ),
    );
    openFilter();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.querySelector(".cv-filter__label")?.textContent)).toEqual(["All projects", "orders-api", "web-dashboard"]);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[2]?.textContent).toContain("Not trusted");
    act(() => options[1]?.click());
    expect(onSelectProject).toHaveBeenCalledWith(entries[0]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("searches projects, hides All projects while searching and selects with the keyboard", () => {
    const onSelectProject = vi.fn();
    act(() =>
      root.render(
        <AgentProjectFilterMenu entries={entries} filter={{ kind: "project", projectRootKey: "/orders" }} onProjectCommand={vi.fn()} onSelectAll={vi.fn()} onSelectProject={onSelectProject} />,
      ),
    );
    expect(host.querySelector(".cv-favicon")?.textContent).toBe("O");
    openFilter();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "web");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...document.querySelectorAll(".cv-filter__label")].map((node) => node.textContent)).toEqual(["web-dashboard"]);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelectProject).toHaveBeenCalledWith(entries[1]);
  });

  it("says when no project matches and opens project actions from the gear", () => {
    const onProjectCommand = vi.fn();
    act(() =>
      root.render(
        <AgentProjectFilterMenu entries={entries} filter={{ kind: "all" }} onProjectCommand={onProjectCommand} onSelectAll={vi.fn()} onSelectProject={vi.fn()} />,
      ),
    );
    openFilter();
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Project settings for web-dashboard"]')?.click());
    const trust = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Trust project…");
    act(() => trust?.click());
    expect(onProjectCommand).toHaveBeenCalledWith({ projectRootKey: "/web", repositoryRoot: "/web", rootPath: "/web" }, "trust");
  });
});
```

Add to `AgentThreadsSidebar.test.tsx`, using the file's existing `render`, `group`, thread-view builders and constants `ROOT`/`OTHER`:

```tsx
  it("lists threads from every project under All projects and narrows through the filter", () => {
    const onChangeFilter = vi.fn();
    const onChangeScope = vi.fn();
    const [appThread] = threeThreads();
    const apiThread = { ...appThread!, thread: { ...appThread!.thread, threadId: "agt-api", owner: { ...appThread!.thread.owner, rootKey: OTHER, repositoryRoot: OTHER } } };
    render({
      groups: [group(ROOT, "app", [appThread!]), group(OTHER, "api", [apiThread])],
      railFilter: { kind: "all" },
      onChangeFilter,
      onChangeScope,
    });
    expect([...host.querySelectorAll("[data-thread-id]")].map((row) => row.getAttribute("data-thread-id"))).toEqual(
      expect.arrayContaining(["agt-1", "agt-api"]),
    );
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Filter threads by project"]')?.click());
    const api = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("api"));
    act(() => api?.click());
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: "project", projectRootKey: OTHER });
    expect(onChangeScope).toHaveBeenCalledWith(expect.objectContaining({ projectRootKey: OTHER }));
    render({ groups: [group(ROOT, "app", [appThread!]), group(OTHER, "api", [apiThread])], railFilter: { kind: "project", projectRootKey: OTHER } });
    expect([...host.querySelectorAll("[data-thread-id]")].map((row) => row.getAttribute("data-thread-id"))).toEqual(["agt-api"]);
  });

  it("says No threads yet for an empty All projects list and names the project otherwise", () => {
    render({ groups: [group(ROOT, "app", [])], railFilter: { kind: "all" } });
    expect(host.textContent).toContain("No threads yet");
    render({ groups: [group(ROOT, "app", [])], railFilter: { kind: "project", projectRootKey: ROOT } });
    expect(host.textContent).toContain("No threads in app yet");
  });
```

The file's `render` helper must default `railFilter` to `{ kind: "all" }` and `onChangeFilter` to `vi.fn()`. Add both to its default props object. Delete or rewrite the tests that assert `AgentProjectScopeMenu` internals ("Project scope" combobox, the scope-state row with the Release button). Release is covered by the gear menu test above.

Create `src/components/agentMode/agentSidebarStyles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLOR_LITERAL, parseCssRules, readStyleSheet, varReferences } from "../cssContractTestSupport";

const SHEET = "components/agentMode/agentSidebar.css";
const sheet = readStyleSheet(SHEET);
const parsed = parseCssRules(sheet.source, SHEET);

function declaration(selector: string, property: string): string | undefined {
  const values = parsed.rules
    .filter((rule) => rule.context.length === 0 && rule.selector.split(",").some((part) => part.trim() === selector))
    .flatMap((rule) => rule.declarations)
    .filter((entry) => entry.property === property)
    .map((entry) => entry.value);
  return values[values.length - 1];
}

describe("sidebar styles", () => {
  it("uses only --cv tokens and no colour literals", () => {
    expect(parsed.issues).toEqual([]);
    for (const rule of parsed.rules) {
      for (const entry of rule.declarations) {
        expect(COLOR_LITERAL.test(entry.value), `${rule.selector} ${entry.property}`).toBe(false);
        for (const name of varReferences(entry.value)) expect(name, rule.selector).toMatch(/^--cv-/);
      }
    }
  });

  it("mirrors the mockup geometry", () => {
    expect(declaration(".cv-sb-search__field", "height")).toBe("32px");
    expect(declaration(".cv-filter__option", "height")).toBe("32px");
    expect(declaration(".cv-favicon", "width")).toBe("16px");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/AgentProjectFilterMenu.test.tsx src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/agentSidebarStyles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `AgentProjectFilterMenu.tsx`**

```tsx
import { Check, Folder, Search, Settings } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "../../ui/foundation/IconButton";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";
import { Popover } from "../../ui/foundation/Popover";
import {
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  agentRailScopeState,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import { ALL_PROJECTS_LABEL, agentProjectMonogram, type AgentRailFilter } from "./agentRailFilter";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import "./agentSidebar.css";

const MAX_PROJECT_QUERY_CHARS = 160;

interface FilterOption {
  readonly key: string;
  readonly label: string;
  readonly entry: AgentRailScopeEntry | null;
}

export interface AgentProjectFilterMenuProps {
  readonly entries: ReadonlyArray<AgentRailScopeEntry>;
  readonly filter: AgentRailFilter;
  onSelectAll(): void;
  onSelectProject(entry: AgentRailScopeEntry): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export function AgentProjectFilterMenu({
  entries,
  filter,
  onProjectCommand,
  onSelectAll,
  onSelectProject,
}: AgentProjectFilterMenuProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const gearRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [actionsFor, setActionsFor] = useState<AgentRailScopeEntry | null>(null);
  const options = useMemo(() => filterOptions(entries, query), [entries, query]);
  const selectedKey = filter.kind === "all" ? "all" : filter.projectRootKey;
  const selected =
    filter.kind === "all"
      ? null
      : (entries.find((entry) => entry.projectRootKey === filter.projectRootKey) ?? null);
  const active = options.length === 0 ? -1 : Math.min(highlight, options.length - 1);

  const close = (): void => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };

  const choose = (option: FilterOption): void => {
    close();
    if (option.entry === null) {
      onSelectAll();
      return;
    }
    onSelectProject(option.entry);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((active + step + options.length) % options.length);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const option = options[active];
    if (option !== undefined) choose(option);
  };

  return (
    <>
      <span className="cv-sb-anchor" ref={anchorRef}>
        <IconButton
          aria-expanded={open}
          aria-haspopup="dialog"
          icon={
            selected === null ? (
              <Folder size={16} />
            ) : (
              <span className="cv-favicon">{agentProjectMonogram(selected.label)}</span>
            )
          }
          label="Filter threads by project"
          onClick={() => (open ? close() : setOpen(true))}
          pressed={open}
        />
      </span>
      <Popover
        anchorRef={anchorRef}
        className="cv-filter"
        label="Filter threads by project"
        onClose={close}
        open={open}
        placement="bottom-start"
      >
        <label className="cv-filter__search">
          <Search aria-hidden="true" size={14} />
          <input
            aria-activedescendant={active < 0 ? undefined : `${listId}-${active}`}
            aria-controls={listId}
            aria-expanded="true"
            aria-label="Search projects"
            autoComplete="off"
            autoFocus
            maxLength={MAX_PROJECT_QUERY_CHARS}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search projects..."
            role="combobox"
            value={query}
          />
        </label>
        <ul aria-label="Projects" className="cv-filter__list" id={listId} role="listbox">
          {options.map((option, index) => {
            const state = option.entry === null ? null : agentRailScopeState(option.entry);
            return (
              <li className="cv-filter__item" key={option.key} role="none">
                <div
                  aria-selected={option.key === selectedKey}
                  className="cv-filter__option"
                  data-highlighted={index === active ? "true" : undefined}
                  id={`${listId}-${index}`}
                  onClick={() => choose(option)}
                  onMouseMove={() => setHighlight(index)}
                  role="option"
                >
                  {option.entry === null ? (
                    <Folder aria-hidden="true" size={16} />
                  ) : (
                    <span aria-hidden="true" className="cv-favicon">
                      {agentProjectMonogram(option.label)}
                    </span>
                  )}
                  <span className="cv-filter__label">{option.label}</span>
                  {state !== null && <span className="cv-filter__state">{state.label}</span>}
                  <Check aria-hidden="true" className="cv-filter__check" size={14} />
                </div>
                {option.entry !== null && (
                  <IconButton
                    className="cv-filter__gear"
                    icon={<Settings size={14} />}
                    label={`Project settings for ${option.label}`}
                    onClick={(event) => {
                      gearRef.current = event.currentTarget;
                      setActionsFor(option.entry);
                    }}
                    size="xs"
                  />
                )}
              </li>
            );
          })}
        </ul>
        {options.length === 0 && <p className="cv-filter__none">No matching projects.</p>}
      </Popover>
      <Menu
        anchorRef={gearRef}
        label={actionsFor === null ? "Project actions" : `Project actions for ${actionsFor.label}`}
        onClose={() => setActionsFor(null)}
        open={actionsFor !== null}
        placement="right-start"
      >
        {actionsFor !== null &&
          agentProjectMenuEntries(actionsFor).map((item) => (
            <MenuItem
              disabled={item.disabled}
              key={item.id}
              onSelect={() => {
                const target = agentProjectMenuTarget(actionsFor);
                close();
                onProjectCommand(target, item.command);
              }}
            >
              {item.label}
            </MenuItem>
          ))}
      </Menu>
    </>
  );
}

function filterOptions(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  query: string,
): ReadonlyArray<FilterOption> {
  const needle = query.trim().toLocaleLowerCase();
  const projects = entries
    .filter((entry) => needle === "" || entry.label.toLocaleLowerCase().includes(needle))
    .map((entry) => ({ key: entry.projectRootKey, label: entry.label, entry }));
  if (needle !== "") return projects;
  return [{ key: "all", label: ALL_PROJECTS_LABEL, entry: null }, ...projects];
}
```

- [ ] **Step 4: Rewrite `AgentRailHeader.tsx`**

```tsx
import { useCallback, type KeyboardEvent, type RefObject } from "react";
import { FolderPlus, Search, SquarePen, X } from "lucide-react";
import type { AgentThreadSearchSurface } from "../../application/agentThreadPorts";
import { MAX_THREAD_SEARCH_QUERY_CHARS } from "../../domain/agentThreadSearch";
import { MAX_AGENT_PROJECT_ROOTS } from "../../domain/agentProject";
import { IconButton } from "../../ui/foundation/IconButton";
import { AgentProjectFilterMenu } from "./AgentProjectFilterMenu";
import type { AgentProjectGroup } from "./agentModePresentation";
import type { AgentProjectMenuCommand, AgentProjectMenuTarget } from "./agentProjectMenuPresentation";
import { ALL_PROJECTS_FILTER, type AgentRailFilter } from "./agentRailFilter";
import {
  agentRailDetachedThreadCount,
  agentRailNewThreadTarget,
  agentRailOrphanCount,
  agentRailScopeFromEntry,
  type AgentRailScope,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

export interface AgentRailHeaderProps {
  readonly addProjectAvailable: boolean;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly search: AgentThreadSearchSurface;
  readonly searchRef: RefObject<HTMLInputElement | null>;
  readonly scope: AgentRailScope | null;
  readonly scopeEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly railFilter: AgentRailFilter;
  readonly overflowRootPaths: ReadonlyArray<string>;
  readonly searchActiveDescendant: string | null;
  onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  onChangeFilter(filter: AgentRailFilter): void;
  onChangeScope(scope: AgentRailScope): void;
  onNewThread(projectRootKey: string, repositoryRoot: string): void;
  onAddProject(): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export function AgentRailHeader({
  addProjectAvailable,
  groups,
  onAddProject,
  onChangeFilter,
  onChangeScope,
  onNewThread,
  onProjectCommand,
  onSearchKeyDown,
  overflowRootPaths,
  railFilter,
  scope,
  scopeEntries,
  search,
  searchActiveDescendant,
  searchRef,
}: AgentRailHeaderProps) {
  const newThreadTarget = agentRailNewThreadTarget(scope, scopeEntries);
  const orphanCount = agentRailOrphanCount(groups, railFilter);
  const detachedCount = agentRailDetachedThreadCount(groups);

  const selectProject = useCallback(
    (entry: AgentRailScopeEntry) => {
      onChangeFilter({ kind: "project", projectRootKey: entry.projectRootKey });
      onChangeScope(agentRailScopeFromEntry(entry));
    },
    [onChangeFilter, onChangeScope],
  );

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") {
        onSearchKeyDown(event);
        return;
      }
      event.preventDefault();
      if (search.query === "") {
        event.currentTarget.blur();
        return;
      }
      search.clear();
    },
    [onSearchKeyDown, search],
  );

  return (
    <div className="cv-sb-head">
      <div className="cv-sb-search">
        <label className="cv-sb-search__field" data-active={search.active ? "true" : undefined}>
          <Search aria-hidden="true" size={16} />
          <input
            aria-activedescendant={searchActiveDescendant ?? undefined}
            aria-autocomplete="list"
            aria-controls="agent-rail-search-results"
            aria-expanded={search.active}
            aria-label="Search threads"
            className="cv-sb-search__input"
            maxLength={MAX_THREAD_SEARCH_QUERY_CHARS}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            ref={searchRef}
            role="combobox"
            spellCheck={false}
            type="search"
            value={search.query}
          />
          {search.query !== "" && (
            <IconButton
              className="cv-sb-search__clear"
              icon={<X size={12} />}
              label="Clear thread search"
              onClick={() => search.clear()}
              size="xs"
              title="Clear"
            />
          )}
        </label>
        <AgentProjectFilterMenu
          entries={scopeEntries}
          filter={railFilter}
          onProjectCommand={onProjectCommand}
          onSelectAll={() => onChangeFilter(ALL_PROJECTS_FILTER)}
          onSelectProject={selectProject}
        />
        <IconButton
          disabled={!addProjectAvailable}
          icon={<FolderPlus size={16} />}
          label="Add project"
          onClick={onAddProject}
        />
        <IconButton
          disabled={newThreadTarget === null}
          icon={<SquarePen size={16} />}
          label="New thread"
          onClick={() =>
            newThreadTarget !== null &&
            onNewThread(newThreadTarget.projectRootKey, newThreadTarget.repositoryRoot)
          }
          title="New thread (⌘N)"
        />
      </div>
      {orphanCount > 0 && <p className="cv-sb-note">{orphanLabel(orphanCount)}</p>}
      {detachedCount > 0 && <p className="cv-sb-note">{detachedLabel(detachedCount)}</p>}
      {overflowRootPaths.length > 0 && (
        <p className="cv-sb-note" title={overflowRootPaths.join("\n")}>
          {overflowLabel(overflowRootPaths.length)}
        </p>
      )}
    </div>
  );
}
```

Keep the three label functions `orphanLabel`, `detachedLabel` and `overflowLabel` unchanged at the bottom of the file.

In `agentSidebarPresentation.ts`:

```ts
export function agentRailOrphanCount(
  groups: ReadonlyArray<AgentProjectGroup>,
  filter: AgentRailFilter,
): number {
  let count = 0;
  for (const group of groups) {
    if (group.kind !== "project") continue;
    if (filter.kind === "project" && group.projectRootKey !== filter.projectRootKey) continue;
    for (const repo of group.repos) count += repo.orphans.length;
  }
  return count;
}

export type AgentRailEmptyState =
  | { readonly kind: "noProjects" }
  | { readonly kind: "noThreads"; readonly scopeLabel: string | null }
  | null;

export function agentRailEmptyState(
  groups: ReadonlyArray<AgentProjectGroup>,
  sections: AgentRailSections,
  scopeLabel: string | null,
): AgentRailEmptyState {
  if (groups.length === 0) return { kind: "noProjects" };
  const total =
    sections.pinned.length +
    sections.active.length +
    sections.archived.length +
    sections.hiddenArchivedCount +
    (sections.snoozed?.length ?? 0) +
    (sections.settled?.length ?? 0);
  if (total > 0) return null;
  return { kind: "noThreads", scopeLabel };
}
```

`agentSidebarPresentation.ts` imports the type from `./agentRailFilter`, and `agentRailFilter.ts` imports `AgentRailScopeEntry` as a type only, so no runtime import cycle exists.

In `AgentThreadList.tsx` `EmptyState`:

```tsx
function EmptyState({ state }: { readonly state: NonNullable<AgentRailEmptyState> }) {
  if (state.kind === "noProjects") return <div className="cv-sb-empty">No projects yet</div>;
  if (state.scopeLabel === null) return <div className="cv-sb-empty">No threads yet</div>;
  return <div className="cv-sb-empty">{`No threads in ${state.scopeLabel} yet`}</div>;
}
```

- [ ] **Step 5: Integrate into `AgentThreadsSidebar.tsx`**

- Props: add `readonly railFilter: AgentRailFilter;` and `onChangeFilter(filter: AgentRailFilter): void;`. Remove `onTrustProject` and `onReleaseProject`, and keep every other prop, including P2's `collapseShortcut` and `footerActivity`.
- `filteredViews = useMemo(() => agentThreadsInFilter(views, railFilter, scopeEntries), [railFilter, scopeEntries, views])`.
- `sections = agentRailSections(filteredViews, archivedExpanded, archivedShown, Math.max(organizationNow, Date.now()))`, and remove the `agentThreadsInScope` import.
- `empty = agentRailEmptyState(groups, sections, railFilter.kind === "all" ? null : agentRailFilterLabel(railFilter, scopeEntries))`.
- `selection = useAgentThreadSelection(agentRailFilterKey(railFilter), visibleThreadIds)`.
- `<AgentRailHeader …>`: pass `railFilter` and `onChangeFilter`, and drop `onReleaseProject` and `onTrustProject`.
- `import "./agentSidebar.css";` at the top.

- [ ] **Step 6: Add the header CSS to `agentSidebar.css`**

```css
.cv-sb-head {
  display: flex;
  flex-direction: column;
}

.cv-sb-search {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px 8px;
}

.cv-sb-search__field {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--cv-r-control);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-sm);
  font-weight: 500;
}

.cv-sb-search__field:hover {
  background: var(--cv-tint-1);
}

.cv-sb-search__field:focus-within,
.cv-sb-search__field[data-active="true"] {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-sb-search__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  appearance: none;
  background: none;
  color: var(--cv-fg-strong);
  font: inherit;
  outline: none;
}

.cv-sb-search__input::placeholder {
  color: var(--cv-fg-subtle);
}

.cv-sb-search__input::-webkit-search-cancel-button {
  appearance: none;
}

.cv-sb-search__clear {
  margin-right: -4px;
}

.cv-sb-anchor {
  display: inline-flex;
}

.cv-favicon {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: var(--cv-r-xs);
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.cv-sb-note {
  margin: 0;
  padding: 0 18px 6px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-sb-empty {
  padding: 10px 18px 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-filter {
  min-width: 240px;
  padding: 4px;
}

.cv-filter__search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin: -4px -4px 4px;
  padding: 0 12px;
  border-bottom: 1px solid var(--cv-hair);
  color: var(--cv-fg-subtle);
}

.cv-filter__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--cv-fg-strong);
  font: inherit;
  font-size: var(--cv-t-md);
  outline: none;
}

.cv-filter__search input::placeholder {
  color: var(--cv-fg-subtle);
}

.cv-filter__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cv-filter__item {
  position: relative;
}

.cv-filter__option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 32px 0 8px;
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg);
  cursor: pointer;
  font-size: var(--cv-t-md);
}

.cv-filter__option > svg {
  color: var(--cv-fg-subtle);
}

.cv-filter__option:hover,
.cv-filter__option[data-highlighted="true"] {
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
}

.cv-filter__option[aria-selected="true"] {
  color: var(--cv-fg-strong);
}

.cv-filter__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-filter__state {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-filter__option .cv-filter__check {
  visibility: hidden;
  color: var(--cv-fg-strong);
}

.cv-filter__option[aria-selected="true"] .cv-filter__check {
  visibility: visible;
}

.cv-filter__gear {
  position: absolute;
  top: 6px;
  right: 4px;
  opacity: 0;
  transition: opacity var(--cv-motion-fast) var(--cv-ease);
}

.cv-filter__item:hover .cv-filter__gear,
.cv-filter__item:has([data-highlighted="true"]) .cv-filter__gear,
.cv-filter__gear:focus-visible {
  opacity: 1;
}

.cv-filter__none {
  margin: 0;
  padding: 8px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}
```

In `agentRail.css`, delete the rules for `.agent-rail__head`, `.agent-search*`, `.agent-scope*`, `.agent-rail__row`, `.agent-rail__note`, `.agent-rail__overflow` and `.agent-rail__empty-state`, plus the project scope menu rules (`.agent-scope-menu*`, `.agent-project-menu*` if only those components used them). Run `rg -n "agent-scope|agent-search__|agent-rail__note|agent-rail__empty" src` first and delete only selectors that no remaining TSX file references.

- [ ] **Step 7: Reserved hunk (a) in `AgentModeView.tsx`**

On `<AgentThreadsSidebar …>`, add `railFilter={navigation.railFilter}` and `onChangeFilter={navigation.setRailFilter}`, and remove `onReleaseProject={releaseProject}` and `onTrustProject={trustProject}`. Both are still passed to `useAgentThreadMenuCommands`, so they stay in use.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/AgentProjectFilterMenu.test.tsx src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/agentSidebarStyles.test.ts src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/AgentModeView.test.tsx src/components/agentMode/agentRailStyles.test.ts`
Expected: PASS. `agentRailStyles.test.ts` may assert selectors that were deleted; drop those assertions only for the deleted selectors.
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 9: Checkpoint**

Do not commit.

---
### Task 10: Thread rows - 78px card, statuses (Working m:ss, Approval, Input, N agents, Done, Failed), hover Settle, unread/recede

**Files:**
- Create: `src/domain/agentPendingInteraction.ts`, `src/domain/agentPendingInteraction.test.ts`
- Create: `src/application/useAgentPendingInteractions.ts`, `src/application/useAgentPendingInteractions.test.tsx`
- Create: `src/components/agentMode/agentThreadRowStatus.ts`, `src/components/agentMode/agentThreadRowStatus.test.ts`
- Modify: `src/components/agentMode/agentSidebarPresentation.ts`: move out `AgentRowStatus`, `agentRowStatus`, `immediateRowBackground`, `lastTurnStatus`, `isFailedTurnStatus`, `isStoppedTurnStatus`, `agentRowStatusLabel`, `unsupportedRowStatus`; `agentThreadRowModel` gains `signals`; `agentRowClassName` emits `cv-card-row` classes
- Modify: `src/components/agentMode/agentClock.tsx` (add `AgentRowElapsed`)
- Modify: `src/components/agentMode/AgentThreadRow.tsx` (rewrite markup), `src/components/agentMode/AgentThreadRowParts.tsx` (`StatusSlot` → `AgentThreadRowStatusSlot`, `RenameInput` class)
- Modify: `src/components/agentMode/AgentThreadList.tsx` (pass `pending`), `src/components/agentMode/AgentThreadsSidebar.tsx` (new prop `pendingInteractions`)
- Modify (reserved hunks a, e): `src/components/agentMode/AgentModeView.tsx`: the poller call, `pendingInteractions` on `<AgentThreadsSidebar>`, `awaiting` on `<AgentThreadSession>`
- Modify: `src/components/agentMode/agentSidebar.css` (card rows)
- Test: `src/components/agentMode/AgentThreadRow.test.tsx`, `src/components/agentMode/AgentThreadRowParts.test.tsx`, `src/components/agentMode/agentSidebarPresentation.test.ts`

**Interfaces:**
- Consumes: `AgentQuestionGateway` (+ `isAgentApprovalGateway`), `agentQuestionOwner(view)`, and `AgentTurn.subagentLifecycle`.
- Produces:
  - `type AgentPendingInteraction = "approval" | "input"`
  - `agentPendingInteraction(approvals, questions): AgentPendingInteraction | null`
  - `useAgentPendingInteractions(gateway: AgentQuestionGateway | null, views: ReadonlyArray<AgentThreadView>, pinnedThreadId: string | null = null): ReadonlyMap<string, AgentPendingInteraction>`
  - `AgentRowStatus` gains `{kind:"approval"} | {kind:"input"} | {kind:"agents"; count: number}`
  - `agentRowStatus(view, evidenceOf?, background?, signals?)`
  - `agentRowWorkingAgents(view): number`
  - `agentRowStatusLabel`, `agentRowStatusTitle`, `agentRowStatusTone(status): "work" | "warn" | "ok" | "fail" | "quiet"`
  - `agentRowElapsedLabel(startedAtEpochMs, now): string`
  - `AgentThreadRowProps` gains `readonly pending: AgentPendingInteraction | null`
  - `AgentThreadsSidebarProps` gains `readonly pendingInteractions?: ReadonlyMap<string, AgentPendingInteraction>`

- [ ] **Step 1: Write the failing domain and status tests**

`src/domain/agentPendingInteraction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentApprovalRequest } from "./agentApproval";
import type { AgentQuestionRequest } from "./agentQuestion";
import { agentPendingInteraction } from "./agentPendingInteraction";

const approval = (status: AgentApprovalRequest["status"]) => ({ status }) as AgentApprovalRequest;
const question = (status: AgentQuestionRequest["status"]) => ({ status }) as AgentQuestionRequest;

describe("agentPendingInteraction", () => {
  it("prefers a pending approval over a pending question", () => {
    expect(agentPendingInteraction([approval("pending")], [question("pending")])).toBe("approval");
    expect(agentPendingInteraction([approval("approved")], [question("pending")])).toBe("input");
    expect(agentPendingInteraction([approval("expired")], [question("answered")])).toBeNull();
    expect(agentPendingInteraction([], [])).toBeNull();
  });
});
```

`src/components/agentMode/agentThreadRowStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import {
  agentRowElapsedLabel,
  agentRowStatus,
  agentRowStatusLabel,
  agentRowStatusTitle,
  agentRowStatusTone,
  agentRowWorkingAgents,
} from "./agentThreadRowStatus";

function runningView(lifecycleStates: ReadonlyArray<"running" | "completed">): AgentThreadView {
  const turn = {
    turnId: "t1",
    status: { kind: "running" },
    startedAtEpochMs: 1_000,
    events: [],
    eventsTruncated: false,
    subagentLifecycle: {
      truncated: false,
      entries: lifecycleStates.map((state, index) => ({
        id: `thread:${index}`,
        agentThreadId: `c${index}`,
        name: "subagent",
        description: "",
        state,
        telemetryState: state,
      })),
    },
  } as unknown as AgentTurn;
  return {
    unread: false,
    thread: { threadId: "a", archived: false, provider: { kind: "codex" }, turns: [turn] },
  } as unknown as AgentThreadView;
}

describe("row status", () => {
  it("puts approval and input before agents and working", () => {
    const view = runningView(["running", "running"]);
    expect(agentRowStatus(view, undefined, null, { pending: "approval", workingAgents: 2 })).toEqual({ kind: "approval" });
    expect(agentRowStatus(view, undefined, null, { pending: "input", workingAgents: 2 })).toEqual({ kind: "input" });
    expect(agentRowStatus(view, undefined, null, { pending: null, workingAgents: 2 })).toEqual({ kind: "agents", count: 2 });
    expect(agentRowStatus(view, undefined, null, { pending: null, workingAgents: 0 })).toMatchObject({ kind: "working", startedAtEpochMs: 1_000 });
  });

  it("counts only running top-level subagents of the running turn", () => {
    expect(agentRowWorkingAgents(runningView(["running", "completed", "running"]))).toBe(2);
  });

  it("labels, titles and tones", () => {
    expect(agentRowStatusLabel({ kind: "agents", count: 1 })).toBe("1 agent");
    expect(agentRowStatusLabel({ kind: "agents", count: 3 })).toBe("3 agents");
    expect(agentRowStatusTitle({ kind: "agents", count: 3 })).toBe("Waiting for 3 agents");
    expect(agentRowStatusLabel({ kind: "approval" })).toBe("Approval");
    expect(agentRowStatusLabel({ kind: "input" })).toBe("Input");
    expect(agentRowStatusTone({ kind: "input" })).toBe("warn");
    expect(agentRowStatusTone({ kind: "done" })).toBe("ok");
    expect(agentRowStatusTone({ kind: "failed" })).toBe("fail");
    expect(agentRowStatusTone({ kind: "stopped" })).toBe("quiet");
    expect(agentRowStatusTone({ kind: "working", startedAtEpochMs: 0 })).toBe("work");
  });

  it("formats elapsed time as m:ss and h:mm:ss", () => {
    expect(agentRowElapsedLabel(0, 5_000)).toBe("0:05");
    expect(agentRowElapsedLabel(0, 161_000)).toBe("2:41");
    expect(agentRowElapsedLabel(0, 3_725_000)).toBe("1:02:05");
    expect(agentRowElapsedLabel(10_000, 0)).toBe("0:00");
  });
});
```

`src/application/useAgentPendingInteractions.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalGateway } from "./agentApprovalPorts";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  AGENT_PENDING_INTERACTION_POLL_MS,
  MAX_AGENT_PENDING_INTERACTION_THREADS,
  useAgentPendingInteractions,
} from "./useAgentPendingInteractions";

function runningView(threadId: string, turnId: string, updatedAtEpochMs: number): AgentThreadView {
  return {
    lifecycle: "running",
    thread: {
      threadId,
      updatedAtEpochMs,
      provider: { kind: "claudeCode" },
      owner: { rootKey: "/r", ownerId: "ws", repositoryRoot: "/r" },
      turns: [{ turnId, status: { kind: "running" }, codexTransport: undefined }],
    },
  } as unknown as AgentThreadView;
}

class FakeGateway implements AgentQuestionGateway, AgentApprovalGateway {
  readonly calls: string[] = [];
  pendingApproval = new Set<string>();
  async list(owner: AgentQuestionOwner) {
    this.calls.push(`q:${owner.taskId}`);
    return [];
  }
  async answer(): Promise<never> {
    throw new Error("unused");
  }
  async listApprovals(owner: AgentQuestionOwner) {
    this.calls.push(`a:${owner.taskId}`);
    return this.pendingApproval.has(owner.taskId) ? [{ status: "pending" } as never] : [];
  }
  async answerApproval(): Promise<never> {
    throw new Error("unused");
  }
}

let host: HTMLDivElement;
let root: Root;
let latest: ReadonlyMap<string, string> = new Map();
function Probe({ gateway, views }: { readonly gateway: FakeGateway | null; readonly views: ReadonlyArray<AgentThreadView> }) {
  latest = useAgentPendingInteractions(gateway, views, null);
  return null;
}
function PinnedProbe({ gateway, pinned, views }: { readonly gateway: FakeGateway; readonly pinned: string; readonly views: ReadonlyArray<AgentThreadView> }) {
  latest = useAgentPendingInteractions(gateway, views, pinned);
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useAgentPendingInteractions", () => {
  it("reports approval for the exact running turn and drops it when the turn changes", async () => {
    const gateway = new FakeGateway();
    gateway.pendingApproval.add("turn-1");
    act(() => root.render(<Probe gateway={gateway} views={[runningView("a", "turn-1", 1)]} />));
    await flush();
    expect(latest.get("a")).toBe("approval");
    act(() => root.render(<Probe gateway={gateway} views={[runningView("a", "turn-2", 2)]} />));
    expect(latest.get("a")).toBeUndefined();
  });

  it("polls at most the newest 8 running threads, one thread at a time, every 2 s, and stops on unmount", async () => {
    const gateway = new FakeGateway();
    const views = Array.from({ length: 12 }, (_, index) => runningView(`t${index}`, `turn-${index}`, index));
    act(() => root.render(<Probe gateway={gateway} views={views} />));
    await flush();
    const firstRound = gateway.calls.filter((call) => call.startsWith("q:"));
    expect(firstRound).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
    expect(firstRound).not.toContain("q:turn-0");
    gateway.calls.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS);
    });
    expect(gateway.calls.filter((call) => call.startsWith("q:"))).toHaveLength(8);
    act(() => root.unmount());
    gateway.calls.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_PENDING_INTERACTION_POLL_MS * 3);
    });
    expect(gateway.calls).toEqual([]);
    root = createRoot(host);
  });

  it("does nothing without a gateway or running threads", async () => {
    act(() => root.render(<Probe gateway={null} views={[runningView("a", "turn-1", 1)]} />));
    await flush();
    expect(latest.size).toBe(0);
  });
});
```

Add to `AgentThreadRow.test.tsx`, reusing its row render helper:

```tsx
  it("renders the mockup card: monogram, project, title, branch, relative time and a hover Settle action", () => {
    renderRow({ pending: null });
    const row = host.querySelector(".cv-card-row")!;
    expect(row.querySelector(".cv-favicon")?.textContent).toMatch(/^[A-Z0-9?]$/);
    expect(row.querySelector(".cv-card-row__title")).not.toBeNull();
    expect(host.querySelector('button[aria-label="Settle thread"]')).not.toBeNull();
  });

  it("shows Approval for a running thread waiting on the user", () => {
    renderRow({ pending: "approval", view: runningThreadView() });
    expect(host.querySelector(".cv-card-row__status")?.textContent).toContain("Approval");
    expect(host.querySelector(".cv-card-row__status")?.getAttribute("data-tone")).toBe("warn");
  });

  it("starts inline rename on double-click", () => {
    renderRow({ pending: null });
    act(() => host.querySelector(".cv-card-row")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(host.querySelector('input[aria-label="Rename thread"]')).not.toBeNull();
  });
```

If the file has no `renderRow` or `runningThreadView` helper, write them next to its existing thread builder. `renderRow` renders `<ul role="listbox"><AgentThreadRow … /></ul>` inside `AgentClockProvider`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/agentPendingInteraction.test.ts src/components/agentMode/agentThreadRowStatus.test.ts src/application/useAgentPendingInteractions.test.tsx src/components/agentMode/AgentThreadRow.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the domain and the poller**

`src/domain/agentPendingInteraction.ts`:

```ts
import type { AgentApprovalRequest } from "./agentApproval";
import type { AgentQuestionRequest } from "./agentQuestion";

export type AgentPendingInteraction = "approval" | "input";

export function agentPendingInteraction(
  approvals: ReadonlyArray<AgentApprovalRequest>,
  questions: ReadonlyArray<AgentQuestionRequest>,
): AgentPendingInteraction | null {
  if (approvals.some((request) => request.status === "pending")) return "approval";
  if (questions.some((request) => request.status === "pending")) return "input";
  return null;
}
```

`src/application/useAgentPendingInteractions.ts`:

```ts
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  agentPendingInteraction,
  type AgentPendingInteraction,
} from "../domain/agentPendingInteraction";
import { isAgentApprovalGateway } from "./agentApprovalPorts";
import { agentQuestionOwner } from "./agentQuestionOwner";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import type { AgentThreadView } from "./agentThreadPorts";

export const AGENT_PENDING_INTERACTION_POLL_MS = 2_000;
export const MAX_AGENT_PENDING_INTERACTION_THREADS = 8;

interface PendingTarget {
  readonly threadId: string;
  readonly owner: AgentQuestionOwner;
  readonly key: string;
}

interface PendingObservation {
  readonly key: string;
  readonly pending: AgentPendingInteraction | null;
}

const NONE: ReadonlyMap<string, AgentPendingInteraction> = new Map();
const TARGET_SEPARATOR = "\u0001";
const LIST_SEPARATOR = "\u0002";

export function agentPendingInteractionTargets(
  views: ReadonlyArray<AgentThreadView>,
): ReadonlyArray<PendingTarget> {
  return views
    .filter((view) => view.lifecycle === "running" && view.execution?.kind !== "remote")
    .flatMap((view) => {
      const owner = agentQuestionOwner(view);
      if (owner === null || owner.kind !== "local") return [];
      return [{ view, target: { threadId: view.thread.threadId, owner, key: JSON.stringify(owner) } }];
    })
    .sort((left, right) => right.view.thread.updatedAtEpochMs - left.view.thread.updatedAtEpochMs)
    .slice(0, MAX_AGENT_PENDING_INTERACTION_THREADS)
    .map(({ target }) => target);
}

export function useAgentPendingInteractions(
  gateway: AgentQuestionGateway | null,
  views: ReadonlyArray<AgentThreadView>,
): ReadonlyMap<string, AgentPendingInteraction> {
  const targets = useMemo(() => agentPendingInteractionTargets(views), [views]);
  const signature = targets
    .map((target) => `${target.threadId}${TARGET_SEPARATOR}${target.key}`)
    .join(LIST_SEPARATOR);
  const targetsRef = useRef(targets);
  useLayoutEffect(() => {
    targetsRef.current = targets;
  }, [targets]);
  const [observed, setObserved] = useState<ReadonlyMap<string, PendingObservation>>(
    () => new Map(),
  );

  useEffect(() => {
    if (gateway === null || signature === "") return;
    const captured = targetsRef.current;
    const approvals = isAgentApprovalGateway(gateway) ? gateway : null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      const next = new Map<string, PendingObservation>();
      for (const target of captured) {
        try {
          const [approvalRequests, questionRequests] = await Promise.all([
            approvals === null ? Promise.resolve([]) : approvals.listApprovals(target.owner),
            gateway.list(target.owner),
          ]);
          if (!alive) return;
          next.set(target.threadId, {
            key: target.key,
            pending: agentPendingInteraction(approvalRequests, questionRequests),
          });
        } catch {
          if (!alive) return;
        }
      }
      if (!alive) return;
      setObserved(next);
      timer = setTimeout(() => {
        void poll();
      }, AGENT_PENDING_INTERACTION_POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [gateway, signature]);

  return useMemo(() => {
    if (targets.length === 0) return NONE;
    const result = new Map<string, AgentPendingInteraction>();
    for (const target of targets) {
      const seen = observed.get(target.threadId);
      if (seen?.key === target.key && seen.pending !== null) result.set(target.threadId, seen.pending);
    }
    return result;
  }, [observed, targets]);
}
```

Separators use unicode escapes, never a literal NUL byte (memory "Avoid literal NUL byte in source").

- [ ] **Step 4: Implement `agentThreadRowStatus.ts`**

Move the listed functions out of `agentSidebarPresentation.ts` unchanged, then extend them:

```ts
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  projectAgentBackgroundActivity,
  type AgentBackgroundActivity,
} from "../../domain/agentBackgroundActivity";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import {
  runningTurn,
  type AgentThread,
  type AgentTurn,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import {
  NO_AGENT_TURN_LOG_EVIDENCE,
  agentTurnContentLost,
  type AgentTurnLogEvidenceLookup,
} from "../../domain/agentTurnContentLoss";

export type AgentRowStatus =
  | {
      readonly kind: "working";
      readonly startedAtEpochMs: number;
      readonly activity?: "background" | "monitoring";
    }
  | { readonly kind: "approval" }
  | { readonly kind: "input" }
  | { readonly kind: "agents"; readonly count: number }
  | { readonly kind: "failed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "done" }
  | { readonly kind: "none" };

export type AgentRowStatusTone = "work" | "warn" | "ok" | "fail" | "quiet";

export interface AgentRowSignals {
  readonly pending: AgentPendingInteraction | null;
  readonly workingAgents: number;
}

export const NO_ROW_SIGNALS: AgentRowSignals = Object.freeze({ pending: null, workingAgents: 0 });

export function agentRowStatus(
  view: AgentThreadView,
  evidenceOf: AgentTurnLogEvidenceLookup = NO_AGENT_TURN_LOG_EVIDENCE,
  background?: AgentBackgroundActivity | null,
  signals: AgentRowSignals = NO_ROW_SIGNALS,
): AgentRowStatus {
  const running = runningTurn(view.thread);
  if (running !== null) {
    if (signals.pending === "approval") return { kind: "approval" };
    if (signals.pending === "input") return { kind: "input" };
    if (signals.workingAgents > 0) return { kind: "agents", count: signals.workingAgents };
    const activity =
      background === undefined ? immediateRowBackground(view, running, evidenceOf) : background;
    return {
      kind: "working",
      startedAtEpochMs: running.startedAtEpochMs,
      ...(activity?.foregroundSettled && activity.phase !== "inactive"
        ? {
            activity:
              activity.phase === "monitoring" ? ("monitoring" as const) : ("background" as const),
          }
        : {}),
    };
  }
  const last = lastTurnStatus(view.thread);
  if (last !== null && isFailedTurnStatus(last)) return { kind: "failed" };
  if (last !== null && isStoppedTurnStatus(last)) return { kind: "stopped" };
  if (view.unread && !view.thread.archived) return { kind: "done" };
  return { kind: "none" };
}

export function agentRowWorkingAgents(view: AgentThreadView): number {
  const running = runningTurn(view.thread);
  if (running === null) return 0;
  return (
    running.subagentLifecycle?.entries.filter(
      (entry) => entry.parentToolId === undefined && entry.state === "running",
    ).length ?? 0
  );
}

export function agentRowStatusLabel(status: AgentRowStatus): string | null {
  switch (status.kind) {
    case "working":
      if (status.activity === "monitoring") return "Monitoring";
      if (status.activity === "background") return "Working in background";
      return "Working";
    case "approval":
      return "Approval";
    case "input":
      return "Input";
    case "agents":
      return `${status.count} agent${status.count === 1 ? "" : "s"}`;
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "done":
      return "Done";
    case "none":
      return null;
    default:
      return unsupportedRowStatus(status);
  }
}

export function agentRowStatusTitle(status: AgentRowStatus): string | null {
  if (status.kind === "agents")
    return `Waiting for ${status.count} agent${status.count === 1 ? "" : "s"}`;
  if (status.kind === "approval") return "Waiting for your approval";
  if (status.kind === "input") return "Waiting for your answer";
  return null;
}

export function agentRowStatusTone(status: AgentRowStatus): AgentRowStatusTone {
  switch (status.kind) {
    case "working":
    case "agents":
      return "work";
    case "approval":
    case "input":
      return "warn";
    case "done":
      return "ok";
    case "failed":
      return "fail";
    case "stopped":
    case "none":
      return "quiet";
    default:
      return unsupportedRowStatus(status);
  }
}

export function agentRowElapsedLabel(startedAtEpochMs: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAtEpochMs) / 1_000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}
```

Keep `immediateRowBackground`, `lastTurnStatus`, `isFailedTurnStatus`, `isStoppedTurnStatus` and `unsupportedRowStatus` as private functions in this module, with their current bodies.

In `agentSidebarPresentation.ts`, `agentThreadRowModel(view, on, projectLabel, evidenceOf, background, signals = NO_ROW_SIGNALS)` passes `signals` to `agentRowStatus`. Delete `agentRowFilesLabel`'s provider dependency only if unused. `agentRowClassName` returns `["cv-card-row", on && "is-current", marked && "is-marked", recede && "is-recede", status.kind !== "none" && status.kind !== "done" && status.kind !== "failed" && status.kind !== "stopped" && "is-live", unread && "is-unread"]`, filtered and joined with spaces. Update its test.

In `agentClock.tsx`:

```tsx
export function AgentRowElapsed({ startedAtEpochMs }: { readonly startedAtEpochMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), WORKING_DURATION_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return <>{agentRowElapsedLabel(startedAtEpochMs, now)}</>;
}
```

- [ ] **Step 5: Rewrite the row**

`AgentThreadRowParts.tsx`: replace `StatusSlot` with:

```tsx
const STATUS_ICONS: Readonly<Record<Exclude<AgentRowStatus["kind"], "none">, ComponentType<LucideProps>>> = {
  working: CircleDashed,
  agents: Bot,
  approval: ShieldQuestion,
  input: MessageCircleQuestion,
  done: CircleCheck,
  failed: CircleAlert,
  stopped: CircleStop,
};

export function AgentThreadRowStatusSlot({
  status,
  updatedAtEpochMs,
}: {
  readonly status: AgentRowStatus;
  readonly updatedAtEpochMs: number;
}) {
  const label = agentRowStatusLabel(status);
  if (status.kind === "none" || label === null) {
    return (
      <span className="cv-card-row__when">
        <AgentCompactRelativeTime epochMs={updatedAtEpochMs} />
      </span>
    );
  }
  const Icon = STATUS_ICONS[status.kind];
  return (
    <span
      className="cv-card-row__status"
      data-tone={agentRowStatusTone(status)}
      title={agentRowStatusTitle(status) ?? undefined}
    >
      <Icon aria-hidden="true" size={13} />
      <span>{label}</span>
      {status.kind === "working" && (
        <span aria-hidden="true" className="cv-card-row__tick">
          <AgentRowElapsed startedAtEpochMs={status.startedAtEpochMs} />
        </span>
      )}
    </span>
  );
}
```

`RenameInput` keeps its behaviour, but its input class becomes `cv-card-row__rename`. `RemoteThreadIndicator` stays unchanged.

`AgentThreadRow.tsx`:
- Keep the props, the menu state, rename, drag attributes, `selectRow`, keyboard focus and the slim archived variant.
- Add a `pending` prop, `const workingAgents = agentRowWorkingAgents(view);`, and pass `{ pending, workingAgents }` to `agentThreadRowModel`.
- The card variant renders:

```tsx
  return (
    <li className="cv-sb-item" data-menu-open={menu !== null ? "true" : undefined} role="none">
      <div
        aria-current={on ? "page" : undefined}
        aria-selected={selected}
        className={rowClass}
        data-thread-id={threadId}
        draggable={!renaming && props.reorderable === true}
        onClick={selectRow}
        onContextMenu={openMenu}
        onDoubleClick={() => setRenaming(true)}
        role="option"
        tabIndex={focused ? 0 : -1}
      >
        <span className="cv-card-row__l1">
          <span aria-hidden="true" className="cv-favicon">
            {agentProjectMonogram(model.project)}
          </span>
          <span className="cv-card-row__project">{model.project}</span>
          {thread.pinned && (
            <span aria-label="Pinned" className="cv-card-row__pin" role="img">
              <Pin aria-hidden="true" size={12} />
            </span>
          )}
          <span className="cv-card-row__slot">
            <AgentThreadRowStatusSlot status={status} updatedAtEpochMs={thread.updatedAtEpochMs} />
          </span>
        </span>
        {renaming ? (
          <RenameInput initial={thread.title} onCancel={() => setRenaming(false)} onCommit={commitRename} />
        ) : (
          <span className="cv-card-row__title">
            {view.execution?.kind === "remote" && <RemoteThreadIndicator serverId={view.execution.serverId} />}
            {model.title}
          </span>
        )}
        <span className="cv-card-row__l3">
          <span className="cv-card-row__branch">{model.branch}</span>
          {model.filesLabel !== null && <span className="cv-card-row__files">{model.filesLabel}</span>}
          {importedLabel !== null && <ImportedBadge label={importedLabel} />}
        </span>
        {jumpLabel !== null && (
          <span aria-hidden="true" className="cv-card-row__jump">
            {jumpLabel}
          </span>
        )}
      </div>
      {canSettle && !renaming && (
        <button
          aria-label="Settle thread"
          className="cv-card-row__act"
          onClick={(event) => {
            event.stopPropagation();
            command({ kind: "settle" });
          }}
          title="Settle thread"
          type="button"
        >
          <Check aria-hidden="true" size={12} />
          Settle
        </button>
      )}
      {menuNode}
    </li>
  );
```

  Here `const canSettle = status.kind !== "working" && status.kind !== "agents" && status.kind !== "approval" && status.kind !== "input" && thread.settledAt == null;`. The mockup puts the hover action on every row, and settling a running thread is rejected by the domain (`ORGANIZE_RUNNING_REASON`), so the action is hidden while running.
- The provider glyph and the pin button are removed. Unpin is available from the context menu and the `P` key.
- The row passes `pending` through `AgentThreadList` (`pendingInteractions.get(threadId) ?? null`).

`AgentThreadsSidebar.tsx`: add the prop `readonly pendingInteractions?: ReadonlyMap<string, AgentPendingInteraction>;` (default: an empty map) and pass it to `AgentThreadList`, which forwards `pending` per row.

The poller runs exactly once per window, in `AgentModeView`, so the sidebar and the conversation share one bounded poll. Reserved hunks in `AgentModeView.tsx`:
- (a) `pendingInteractions={pendingInteractions}` on `<AgentThreadsSidebar …>`
- (e) one line next to the other hooks: `const pendingInteractions = useAgentPendingInteractions(questionGateway, agents.threads, selectedThread?.thread.threadId ?? null);`
- (e) on P3's `<AgentThreadSession …>` element: `awaiting={selectedThread === null ? null : (pendingInteractions.get(selectedThread.thread.threadId) ?? null)}` (P3's prop `awaiting?: AgentThreadAwaiting`, whose values `"approval" | "input" | null` match `AgentPendingInteraction | null`)

`useAgentPendingInteractions` takes a third parameter `pinnedThreadId: string | null`. When `agentPendingInteractionTargets` builds the target list, the pinned thread is always included if it is running and local, even when it is not among the 8 newest, and the list is then cut to at most 8 targets in total. Add this test to `useAgentPendingInteractions.test.tsx`:

```tsx
  it("always polls the open thread even when it is older than the newest 8", async () => {
    const gateway = new FakeGateway();
    const views = Array.from({ length: 12 }, (_, index) => runningView(`t${index}`, `turn-${index}`, index));
    act(() => root.render(<PinnedProbe gateway={gateway} pinned="t0" views={views} />));
    await flush();
    const polled = gateway.calls.filter((call) => call.startsWith("q:"));
    expect(polled).toContain("q:turn-0");
    expect(polled).toHaveLength(MAX_AGENT_PENDING_INTERACTION_THREADS);
  });
```

`PinnedProbe` is `Probe` with `latest = useAgentPendingInteractions(gateway, views, pinned)`. In the other tests `Probe` passes `null`. The targets function becomes:

```ts
export function agentPendingInteractionTargets(
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null = null,
): ReadonlyArray<PendingTarget> {
  const eligible = views
    .filter((view) => view.lifecycle === "running" && view.execution?.kind !== "remote")
    .flatMap((view) => {
      const owner = agentQuestionOwner(view);
      if (owner === null || owner.kind !== "local") return [];
      return [{ view, target: { threadId: view.thread.threadId, owner, key: JSON.stringify(owner) } }];
    })
    .sort((left, right) => {
      const pinned = Number(right.view.thread.threadId === pinnedThreadId) - Number(left.view.thread.threadId === pinnedThreadId);
      return pinned !== 0 ? pinned : right.view.thread.updatedAtEpochMs - left.view.thread.updatedAtEpochMs;
    });
  return eligible.slice(0, MAX_AGENT_PENDING_INTERACTION_THREADS).map(({ target }) => target);
}
```

In `useAgentPendingInteractions`, pass `pinnedThreadId` through (`useMemo(() => agentPendingInteractionTargets(views, pinnedThreadId), [pinnedThreadId, views])`).

- [ ] **Step 6: Add the card-row CSS to `agentSidebar.css`**

```css
.agent-list {
  margin: 0;
  padding: 0 8px;
  list-style: none;
}

.cv-sb-item {
  position: relative;
  padding: 2px 0;
}

.cv-card-row {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 78px;
  padding: 8px 10px;
  border-radius: var(--cv-r-control);
  color: var(--cv-fg);
  cursor: pointer;
  outline: none;
}

.cv-card-row:hover {
  background: var(--cv-row-hover);
}

.cv-card-row:focus-visible {
  box-shadow: var(--cv-ring-focus);
}

.cv-card-row[aria-current="page"],
.cv-card-row.is-marked {
  background: var(--cv-row-active);
}

.cv-card-row__l1,
.cv-card-row__l3 {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-card-row__project,
.cv-card-row__branch {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-card-row__project {
  font-weight: 500;
}

.cv-card-row__pin {
  display: inline-grid;
  color: var(--cv-fg-subtle);
}

.cv-card-row__slot {
  display: inline-flex;
  transition: opacity var(--cv-motion-fast) var(--cv-ease);
}

.cv-card-row__when,
.cv-card-row__files,
.cv-card-row__tick {
  font-variant-numeric: tabular-nums;
}

.cv-card-row__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cv-card-row__tick {
  font-weight: 400;
}

.cv-card-row__status[data-tone="work"] {
  color: var(--cv-accent);
}

.cv-card-row__status[data-tone="warn"] {
  color: var(--cv-warn);
}

.cv-card-row__status[data-tone="ok"] {
  color: var(--cv-ok);
}

.cv-card-row__status[data-tone="fail"] {
  color: var(--cv-danger);
}

.cv-card-row__status[data-tone="quiet"] {
  color: var(--cv-fg-subtle);
}

.cv-card-row__title {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: var(--cv-fg);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-card-row[aria-current="page"] .cv-card-row__title,
.cv-card-row.is-unread .cv-card-row__title {
  color: var(--cv-fg-strong);
}

.cv-card-row.is-recede .cv-card-row__project,
.cv-card-row.is-recede .cv-card-row__title {
  font-weight: 400;
}

.cv-card-row.is-recede .cv-card-row__title {
  color: var(--cv-fg-muted);
}

.cv-card-row__rename {
  display: block;
  width: calc(100% + 5px);
  height: 20px;
  margin: 2px 0 0 -5px;
  padding: 0 4px;
  border: 1px solid var(--cv-fg-subtle);
  border-radius: var(--cv-r-xs);
  background: var(--cv-raised);
  color: var(--cv-fg-strong);
  font: inherit;
  font-size: var(--cv-t-sm);
  font-weight: 500;
  line-height: 18px;
  outline: none;
}

.cv-card-row__rename::selection {
  background: var(--cv-selection);
}

.cv-card-row__jump {
  position: absolute;
  right: 10px;
  bottom: 10px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-2xs);
  font-variant-numeric: tabular-nums;
}

.cv-card-row__act {
  position: absolute;
  top: 10px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: transparent;
  color: var(--cv-fg-subtle);
  cursor: pointer;
  font: inherit;
  font-size: var(--cv-t-xs);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--cv-motion-fast) var(--cv-ease);
}

.cv-card-row__act:hover {
  color: var(--cv-fg-strong);
}

.cv-sb-item:hover .cv-card-row__act,
.cv-card-row__act:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.cv-sb-item:hover:has(.cv-card-row__act) .cv-card-row__slot,
.cv-sb-item:has(.cv-card-row__act:focus-visible) .cv-card-row__slot {
  opacity: 0;
}

.cv-sb-item[data-menu-open="true"] .cv-card-row {
  background: var(--cv-row-hover);
  box-shadow: inset 0 0 0 1px var(--cv-hair-strong);
}

.cv-sb-item[data-menu-open="true"] .cv-card-row__act {
  display: none;
}

.cv-sb-item[data-menu-open="true"] .cv-card-row__slot {
  opacity: 1;
}
```

Add to `agentSidebarStyles.test.ts`:

```ts
  it("keeps the t3code card row geometry", () => {
    expect(declaration(".cv-card-row", "height")).toBe("78px");
    expect(declaration(".cv-card-row", "padding")).toBe("8px 10px");
    expect(declaration(".cv-card-row__act", "top")).toBe("10px");
  });
```

Delete the replaced `.agent-row*` card rules from `agentRail.css` (`.agent-card-slot`, `.agent-row--card`, `.agent-row__line1/2/3`, `.agent-row__status*`, `.agent-row__actions`, `.agent-row__pin`, `.agent-row__rename`). Keep the `.agent-row--slim` rules that the archived shelf still uses. Before deleting, confirm with `rg -n "agent-row__|agent-card-slot" src --glob '!*.css'` that no remaining TSX file uses them.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/domain/agentPendingInteraction.test.ts src/components/agentMode/agentThreadRowStatus.test.ts src/application/useAgentPendingInteractions.test.tsx src/components/agentMode/AgentThreadRow.test.tsx src/components/agentMode/AgentThreadRowParts.test.tsx src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/agentSidebarStyles.test.ts src/components/agentMode/agentRailStyles.test.ts src/components/agentMode/agentClock.test.tsx`
Expected: PASS. Existing sidebar tests that click the removed pin button now use the menu or the `P` key. Tests that read `.agent-row__status-label` read `.cv-card-row__status`.
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 8: Checkpoint**

Do not commit.

---
### Task 11: Thread context menu (Snooze ›, Move to ›, Copy ›), delete confirmation, custom snooze, keyboard access

**Files:**
- Create: `src/components/agentMode/agentThreadContextMenuModel.ts`, `src/components/agentMode/agentThreadContextMenuModel.test.ts`
- Create: `src/components/agentMode/AgentThreadContextMenu.tsx`, `src/components/agentMode/AgentThreadContextMenu.test.tsx`
- Create: `src/components/agentMode/AgentThreadDeleteDialog.tsx`, `src/components/agentMode/AgentThreadSnoozeDialog.tsx`
- Modify: `src/domain/agentThreadOrganization.ts` (+ test): add `agentThreadSectionMoves`
- Modify: `src/components/agentMode/agentSidebarPresentation.ts`: `AgentThreadMenuCommand` gains `moveToSection`; delete `agentThreadMenuEntries`, `AgentThreadMenuEntry`, `AgentThreadMenuIcon` and `AgentThreadMenuContext`, which the new model replaces; keep the reason constants
- Modify: `src/components/agentMode/useAgentThreadMenuCommands.ts` (+ test): handle `moveToSection`
- Modify: `src/components/agentMode/AgentThreadRow.tsx` (use the new menu, keyboard opener, focus return), `AgentThreadList.tsx` / `AgentThreadsSidebar.tsx` (pass `projects`)
- Delete: `src/components/agentMode/AgentThreadRowMenu.tsx`, `src/components/agentMode/AgentThreadSnoozePicker.tsx`, `src/components/agentMode/AgentThreadOrganizationMenu.test.tsx`
- Modify: `src/components/agentMode/agentThreadOrganization.css` (delete the snooze picker rules; keep the drop-marker rules), `src/components/agentMode/agentSidebar.css` (snooze dialog input)

**Interfaces:**
- Consumes: foundation `Menu`, `Submenu`, `MenuItem`, `MenuSeparator`, `MenuLabel`, `Dialog`, `Button`.
- Produces:
  - `agentThreadContextMenu(context: AgentThreadContextMenuContext): ReadonlyArray<AgentThreadMenuNode>`
  - `AgentThreadContextMenu({ anchor, nodes, onAction, onClose })`, where `anchor: { readonly x: number; readonly y: number }` and `onAction(action: AgentThreadMenuAction): void`
  - `AgentThreadMenuCommand` gains `{ readonly kind: "moveToSection"; readonly section: AgentThreadDropSection }`
  - `agentThreadSectionMoves(thread, section, now): ReadonlyArray<"togglePin" | "settle" | "restore" | "unsnooze">`
  - `AgentThreadRowProps` gains `readonly projects: ReadonlyArray<AgentRailScopeEntry>`

- [ ] **Step 1: Write the failing model and domain tests**

`src/components/agentMode/agentThreadContextMenuModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MOVE_PROJECT_UNSUPPORTED_REASON,
  agentThreadContextMenu,
  type AgentThreadContextMenuContext,
  type AgentThreadMenuNode,
} from "./agentThreadContextMenuModel";

const base: AgentThreadContextMenuContext = {
  branch: "fix/payments-timeout",
  pinned: false,
  archived: false,
  running: false,
  snoozed: false,
  settled: false,
  canMarkUnread: true,
  threadRootKey: "/orders",
  projects: [
    { projectRootKey: "/orders", label: "orders-api" },
    { projectRootKey: "/web", label: "web-dashboard" },
  ],
  now: 1_000,
};

function labels(nodes: ReadonlyArray<AgentThreadMenuNode>): ReadonlyArray<string> {
  return nodes.map((node) => (node.kind === "separator" ? "—" : node.label));
}

function submenu(nodes: ReadonlyArray<AgentThreadMenuNode>, label: string) {
  const found = nodes.find((node) => node.kind === "submenu" && node.label === label);
  expect(found?.kind).toBe("submenu");
  return found?.kind === "submenu" ? found.children : [];
}

describe("thread context menu", () => {
  it("matches the mockup order", () => {
    expect(labels(agentThreadContextMenu(base))).toEqual([
      "New thread on fix/payments-timeout",
      "Pin thread",
      "Settle thread",
      "Snooze",
      "—",
      "Rename thread",
      "Mark unread",
      "Move to",
      "—",
      "Copy",
      "—",
      "Archive thread",
      "Delete",
    ]);
  });

  it("offers sections, reorder and projects under Move to, with other projects disabled truthfully", () => {
    const move = submenu(agentThreadContextMenu({ ...base, moveUpId: "up", moveDownId: "down" }), "Move to");
    expect(labels(move)).toEqual(["Pinned", "Active", "Settled", "—", "Move up", "Move down", "—", "Project", "orders-api", "web-dashboard"]);
    const active = move.find((node) => node.kind === "choice" && node.label === "Active");
    expect(active).toMatchObject({ checked: true, action: null });
    const pinned = move.find((node) => node.kind === "choice" && node.label === "Pinned");
    expect(pinned).toMatchObject({ checked: false, action: { kind: "command", command: { kind: "moveToSection", section: "pinned" } } });
    const other = move.find((node) => node.kind === "choice" && node.label === "web-dashboard");
    expect(other).toMatchObject({ checked: false, action: null, disabledReason: MOVE_PROJECT_UNSUPPORTED_REASON });
  });

  it("disables organise, archive and delete while running and adds Stop agent", () => {
    const nodes = agentThreadContextMenu({ ...base, running: true });
    expect(labels(nodes)).toContain("Stop agent");
    const settle = nodes.find((node) => node.kind === "item" && node.label === "Settle thread");
    expect(settle).toMatchObject({ disabledReason: "Available after the agent stops." });
    const snooze = nodes.find((node) => node.kind !== "separator" && node.label === "Snooze");
    expect(snooze?.kind).toBe("item");
    const remove = nodes.find((node) => node.kind === "item" && node.label === "Delete");
    expect(remove).toMatchObject({ tone: "danger", disabledReason: "Stop the agent before deleting this thread." });
  });

  it("uses Wake now for a snoozed thread and Unarchive for an archived one", () => {
    expect(labels(agentThreadContextMenu({ ...base, snoozed: true }))).toContain("Wake now");
    const archived = labels(agentThreadContextMenu({ ...base, archived: true }));
    expect(archived).toContain("Unarchive thread");
    expect(archived).not.toContain("Move to");
  });

  it("puts one-hour, one-day and custom snooze in the Snooze submenu", () => {
    const snooze = submenu(agentThreadContextMenu(base), "Snooze");
    expect(labels(snooze)).toEqual(["For 1 hour", "For 1 day", "—", "Choose date and time…"]);
    expect(snooze[0]).toMatchObject({ action: { kind: "command", command: { kind: "snooze", until: 3_601_000 } } });
    expect(snooze[3]).toMatchObject({ action: { kind: "snoozeCustom" } });
  });
});
```

Append to `src/domain/agentThreadOrganization.test.ts`:

```ts
describe("agentThreadSectionMoves", () => {
  const thread = (patch: Partial<AgentThread>) => ({ pinned: false, settledAt: null, snoozedUntil: null, ...patch }) as AgentThread;
  it("computes the minimal organisation steps", () => {
    expect(agentThreadSectionMoves(thread({}), "pinned", 0)).toEqual(["togglePin"]);
    expect(agentThreadSectionMoves(thread({ pinned: true }), "settled", 0)).toEqual(["togglePin", "settle"]);
    expect(agentThreadSectionMoves(thread({ settledAt: 5 }), "active", 0)).toEqual(["restore"]);
    expect(agentThreadSectionMoves(thread({ snoozedUntil: 10 }), "active", 5)).toEqual(["unsnooze"]);
    expect(agentThreadSectionMoves(thread({}), "active", 0)).toEqual([]);
  });
});
```

Append to `useAgentThreadMenuCommands.test.tsx`, reusing its harness and fake surface builder:

```tsx
  it("moves a pinned thread to Settled by unpinning and settling", () => {
    const { surface, run } = setupWithThread({ pinned: true });
    run("agt-1", { kind: "moveToSection", section: "settled" });
    expect(surface.togglePin).toHaveBeenCalledWith("agt-1");
    expect(surface.updateThreadOrganization).toHaveBeenCalledWith("agt-1", expect.objectContaining({ settledAt: expect.any(Number) }));
  });
```

If the test file's harness has another name, adapt this one call. The assertions are the contract.

`src/components/agentMode/AgentThreadContextMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentThreadContextMenu } from "./AgentThreadContextMenu";
import { agentThreadContextMenu } from "./agentThreadContextMenuModel";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const nodes = agentThreadContextMenu({
  branch: "main",
  pinned: false,
  archived: false,
  running: false,
  snoozed: false,
  settled: false,
  canMarkUnread: true,
  threadRootKey: "/orders",
  projects: [{ projectRootKey: "/orders", label: "orders-api" }],
  now: 0,
});

describe("AgentThreadContextMenu", () => {
  it("runs an item, closes, and supports keyboard navigation into a submenu", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    act(() => root.render(<AgentThreadContextMenu anchor={{ x: 10, y: 20 }} nodes={nodes} onAction={onAction} onClose={onClose} />));
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(document.activeElement?.textContent).toContain("New thread on main");
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement?.textContent).toContain("Pin thread");
    const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Copy"))!;
    act(() => copy.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const threadId = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === "Copy thread ID")!;
    act(() => threadId.click());
    expect(onAction).toHaveBeenCalledWith({ kind: "command", command: { kind: "copy", detail: "threadId" } });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape without running anything", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    act(() => root.render(<AgentThreadContextMenu anchor={{ x: 0, y: 0 }} nodes={nodes} onAction={onAction} onClose={onClose} />));
    act(() => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});
```

Add to `AgentThreadRow.test.tsx`:

```tsx
  it("opens the context menu from the keyboard and returns focus to the row", () => {
    renderRow({ pending: null, focused: true });
    const row = host.querySelector<HTMLElement>(".cv-card-row")!;
    row.focus();
    act(() => row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true })));
    expect(document.querySelector('[role="menu"][aria-label="Thread actions"]')).not.toBeNull();
    act(() => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(row);
  });

  it("asks for confirmation before deleting", () => {
    const onMenuCommand = vi.fn();
    renderRow({ pending: null, onMenuCommand });
    act(() => host.querySelector(".cv-card-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 })));
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === "Delete")!.click());
    expect(onMenuCommand).not.toHaveBeenCalled();
    act(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Delete thread")!.click());
    expect(onMenuCommand).toHaveBeenCalledWith(expect.any(String), { kind: "delete" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/agentThreadContextMenuModel.test.ts src/domain/agentThreadOrganization.test.ts src/components/agentMode/AgentThreadContextMenu.test.tsx src/components/agentMode/AgentThreadRow.test.tsx src/components/agentMode/useAgentThreadMenuCommands.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the model and the domain moves**

`src/domain/agentThreadOrganization.ts`:

```ts
export type AgentThreadSectionMove = "togglePin" | "settle" | "restore" | "unsnooze";

export function agentThreadSectionMoves(
  thread: Pick<AgentThread, "pinned" | "settledAt" | "snoozedUntil">,
  section: AgentThreadDropSection,
  now: number,
): ReadonlyArray<AgentThreadSectionMove> {
  const moves: AgentThreadSectionMove[] = [];
  const settled = thread.settledAt != null;
  if (section === "settled") {
    if (thread.pinned) moves.push("togglePin");
    if (!settled) moves.push("settle");
    return moves;
  }
  if (settled) moves.push("restore");
  if ((thread.snoozedUntil ?? 0) > now) moves.push("unsnooze");
  if ((section === "pinned") !== thread.pinned) moves.push("togglePin");
  return moves;
}
```

`src/components/agentMode/agentThreadContextMenuModel.ts`:

```ts
import type { AgentThreadDropSection } from "../../domain/agentThreadOrganization";
import {
  ARCHIVE_RUNNING_REASON,
  DELETE_RUNNING_REASON,
  MARK_UNREAD_UNAVAILABLE_REASON,
  ORGANIZE_RUNNING_REASON,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

export const MOVE_PROJECT_UNSUPPORTED_REASON = "Moving threads between projects is not supported yet.";
export const SNOOZE_HOUR_MS = 3_600_000;
export const SNOOZE_DAY_MS = 86_400_000;

export type AgentThreadMenuAction =
  | { readonly kind: "command"; readonly command: AgentThreadMenuCommand }
  | { readonly kind: "rename" }
  | { readonly kind: "delete" }
  | { readonly kind: "snoozeCustom" };

export type AgentThreadMenuIconName =
  | "newThread" | "pin" | "unpin" | "settle" | "restore" | "snooze" | "wake" | "stop"
  | "rename" | "markUnread" | "move" | "moveUp" | "moveDown" | "copy" | "archive"
  | "unarchive" | "delete";

export type AgentThreadMenuNode =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      readonly icon: AgentThreadMenuIconName | null;
      readonly action: AgentThreadMenuAction;
      readonly disabledReason: string | null;
      readonly tone: "default" | "danger";
    }
  | {
      readonly kind: "choice";
      readonly id: string;
      readonly label: string;
      readonly monogram: string | null;
      readonly checked: boolean;
      readonly action: AgentThreadMenuAction | null;
      readonly disabledReason: string | null;
    }
  | {
      readonly kind: "submenu";
      readonly id: string;
      readonly label: string;
      readonly icon: AgentThreadMenuIconName;
      readonly children: ReadonlyArray<AgentThreadMenuNode>;
    }
  | { readonly kind: "label"; readonly id: string; readonly label: string }
  | { readonly kind: "separator"; readonly id: string };

export interface AgentThreadMenuProject {
  readonly projectRootKey: string;
  readonly label: string;
  readonly memberProjectRootKeys?: ReadonlyArray<string>;
}

export interface AgentThreadContextMenuContext {
  readonly branch: string | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly running: boolean;
  readonly snoozed: boolean;
  readonly settled: boolean;
  readonly canMarkUnread: boolean;
  readonly moveUpId?: string;
  readonly moveDownId?: string;
  readonly threadRootKey: string;
  readonly projects: ReadonlyArray<AgentThreadMenuProject>;
  readonly now: number;
}

export function agentThreadContextMenu(
  context: AgentThreadContextMenuContext,
): ReadonlyArray<AgentThreadMenuNode> {
  const organizeReason = context.running ? ORGANIZE_RUNNING_REASON : null;
  const nodes: AgentThreadMenuNode[] = [
    item("new", context.branch === null ? "New thread" : `New thread on ${context.branch}`, "newThread", command({ kind: "newThread" })),
    item("pin", context.pinned ? "Unpin thread" : "Pin thread", context.pinned ? "unpin" : "pin", command({ kind: "togglePin" })),
  ];
  if (!context.archived) {
    nodes.push(
      item(
        "settle",
        context.settled ? "Restore to active" : "Settle thread",
        context.settled ? "restore" : "settle",
        command({ kind: context.settled ? "restore" : "settle" }),
        organizeReason,
      ),
    );
    nodes.push(snoozeNode(context, organizeReason));
  }
  if (context.running) nodes.push(item("stop", "Stop agent", "stop", command({ kind: "stop" })));
  nodes.push(separator("s1"));
  nodes.push(item("rename", "Rename thread", "rename", { kind: "rename" }));
  nodes.push(
    item(
      "unread",
      "Mark unread",
      "markUnread",
      command({ kind: "markUnread" }),
      context.canMarkUnread ? null : MARK_UNREAD_UNAVAILABLE_REASON,
    ),
  );
  if (!context.archived) nodes.push(moveNode(context));
  nodes.push(separator("s2"));
  nodes.push({
    kind: "submenu",
    id: "copy",
    label: "Copy",
    icon: "copy",
    children: [
      item("copy-path", "Copy path", null, command({ kind: "copy", detail: "path" })),
      item("copy-branch", "Copy branch", null, command({ kind: "copy", detail: "branch" })),
      item("copy-id", "Copy thread ID", null, command({ kind: "copy", detail: "threadId" })),
    ],
  });
  nodes.push(separator("s3"));
  nodes.push(
    context.archived
      ? item("unarchive", "Unarchive thread", "unarchive", command({ kind: "unarchive" }))
      : item("archive", "Archive thread", "archive", command({ kind: "archive" }), context.running ? ARCHIVE_RUNNING_REASON : null),
  );
  nodes.push(item("delete", "Delete", "delete", { kind: "delete" }, context.running ? DELETE_RUNNING_REASON : null, "danger"));
  return nodes;
}

function snoozeNode(context: AgentThreadContextMenuContext, reason: string | null): AgentThreadMenuNode {
  if (context.snoozed) return item("wake", "Wake now", "wake", command({ kind: "unsnooze" }), reason);
  if (reason !== null) return item("snooze", "Snooze", "snooze", { kind: "snoozeCustom" }, reason);
  return {
    kind: "submenu",
    id: "snooze",
    label: "Snooze",
    icon: "snooze",
    children: [
      item("snooze-hour", "For 1 hour", null, command({ kind: "snooze", until: context.now + SNOOZE_HOUR_MS })),
      item("snooze-day", "For 1 day", null, command({ kind: "snooze", until: context.now + SNOOZE_DAY_MS })),
      separator("snooze-s"),
      item("snooze-custom", "Choose date and time…", null, { kind: "snoozeCustom" }),
    ],
  };
}

function moveNode(context: AgentThreadContextMenuContext): AgentThreadMenuNode {
  const current: AgentThreadDropSection = context.settled ? "settled" : context.pinned ? "pinned" : "active";
  const section = (id: AgentThreadDropSection, label: string): AgentThreadMenuNode => ({
    kind: "choice",
    id: `move-${id}`,
    label,
    monogram: null,
    checked: current === id,
    action: current === id ? null : command({ kind: "moveToSection", section: id }),
    disabledReason: id === "settled" && context.running ? ORGANIZE_RUNNING_REASON : null,
  });
  const children: AgentThreadMenuNode[] = [
    section("pinned", "Pinned"),
    section("active", "Active"),
    section("settled", "Settled"),
  ];
  if (context.moveUpId !== undefined || context.moveDownId !== undefined) {
    children.push(separator("move-s1"));
    if (context.moveUpId !== undefined)
      children.push(item("move-up", "Move up", "moveUp", command({ kind: "moveBefore", targetThreadId: context.moveUpId })));
    if (context.moveDownId !== undefined)
      children.push(item("move-down", "Move down", "moveDown", command({ kind: "moveAfter", targetThreadId: context.moveDownId })));
  }
  children.push(separator("move-s2"), { kind: "label", id: "move-project", label: "Project" });
  for (const project of context.projects) {
    const own =
      project.projectRootKey === context.threadRootKey ||
      project.memberProjectRootKeys?.includes(context.threadRootKey) === true;
    children.push({
      kind: "choice",
      id: `project-${project.projectRootKey}`,
      label: project.label,
      monogram: project.label,
      checked: own,
      action: null,
      disabledReason: own ? null : MOVE_PROJECT_UNSUPPORTED_REASON,
    });
  }
  return { kind: "submenu", id: "move", label: "Move to", icon: "move", children };
}

function item(
  id: string,
  label: string,
  icon: AgentThreadMenuIconName | null,
  action: AgentThreadMenuAction,
  disabledReason: string | null = null,
  tone: "default" | "danger" = "default",
): AgentThreadMenuNode {
  return { kind: "item", id, label, icon, action, disabledReason, tone };
}

function command(value: AgentThreadMenuCommand): AgentThreadMenuAction {
  return { kind: "command", command: value };
}

function separator(id: string): AgentThreadMenuNode {
  return { kind: "separator", id };
}
```

In `agentSidebarPresentation.ts`, add `| { readonly kind: "moveToSection"; readonly section: AgentThreadDropSection }` to `AgentThreadMenuCommand`, and delete `agentThreadMenuEntries`, `menuItem`, `AgentThreadMenuEntry`, `AgentThreadMenuIcon` and `AgentThreadMenuContext`, together with their tests.

In `useAgentThreadMenuCommands.ts` `handleThreadMenuCommand`, add:

```ts
        case "moveToSection": {
          const view = threadViews.find((candidate) => candidate.thread.threadId === threadId);
          if (view === undefined) return;
          for (const move of agentThreadSectionMoves(view.thread, command.section, Date.now())) {
            handleThreadMenuCommandRef.current(threadId, { kind: move });
          }
          return;
        }
```

`handleThreadMenuCommandRef` is a `useRef` assigned `handleThreadMenuCommand` in a layout effect, so the recursion always goes through the latest callback. Declare it before the callback and assign it right after.

- [ ] **Step 4: Implement the menu component and the dialogs**

`src/components/agentMode/AgentThreadContextMenu.tsx`:

```tsx
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  BellOff,
  Clock,
  Copy,
  Mail,
  MoveRight,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  SquarePen,
  Square,
  SquareCheck,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem, MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import { Submenu } from "../../ui/foundation/Submenu";
import type { AgentThreadMenuAction, AgentThreadMenuIconName, AgentThreadMenuNode } from "./agentThreadContextMenuModel";
import { agentProjectMonogram } from "./agentRailFilter";

const ICONS: Readonly<Record<AgentThreadMenuIconName, LucideIcon>> = {
  newThread: SquarePen,
  pin: Pin,
  unpin: PinOff,
  settle: SquareCheck,
  restore: RotateCcw,
  snooze: Clock,
  wake: Sun,
  stop: Square,
  rename: Pencil,
  markUnread: Mail,
  move: MoveRight,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  copy: Copy,
  archive: Archive,
  unarchive: ArchiveRestore,
  delete: Trash2,
};

export interface AgentThreadMenuAnchor {
  readonly x: number;
  readonly y: number;
}

export function AgentThreadContextMenu({
  anchor,
  nodes,
  onAction,
  onClose,
}: {
  readonly anchor: AgentThreadMenuAnchor;
  readonly nodes: ReadonlyArray<AgentThreadMenuNode>;
  onAction(action: AgentThreadMenuAction): void;
  onClose(): void;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <>
      {createPortal(
        <span
          aria-hidden="true"
          ref={anchorRef}
          style={{ position: "fixed", left: anchor.x, top: anchor.y, width: 0, height: 0 }}
        />,
        document.body,
      )}
      <Menu anchorRef={anchorRef} label="Thread actions" onClose={onClose} open placement="bottom-start">
        {renderNodes(nodes, onAction)}
      </Menu>
    </>
  );
}

function renderNodes(
  nodes: ReadonlyArray<AgentThreadMenuNode>,
  onAction: (action: AgentThreadMenuAction) => void,
): ReactNode {
  return nodes.map((node) => {
    switch (node.kind) {
      case "separator":
        return <MenuSeparator key={node.id} />;
      case "label":
        return <MenuLabel key={node.id}>{node.label}</MenuLabel>;
      case "submenu": {
        const Icon = ICONS[node.icon];
        return (
          <Submenu icon={<Icon size={14} />} key={node.id} label={node.label}>
            {renderNodes(node.children, onAction)}
          </Submenu>
        );
      }
      case "choice":
        return (
          <MenuItem
            checked={node.checked}
            disabled={node.disabledReason !== null || (node.action === null && !node.checked)}
            icon={node.monogram === null ? undefined : <span className="cv-favicon">{agentProjectMonogram(node.monogram)}</span>}
            key={node.id}
            onSelect={() => node.action !== null && onAction(node.action)}
          >
            <span title={node.disabledReason ?? undefined}>{node.label}</span>
          </MenuItem>
        );
      case "item": {
        const Icon = node.icon === null ? null : ICONS[node.icon];
        return (
          <MenuItem
            disabled={node.disabledReason !== null}
            icon={Icon === null ? undefined : <Icon size={14} />}
            key={node.id}
            onSelect={() => onAction(node.action)}
            tone={node.tone}
          >
            <span title={node.disabledReason ?? undefined}>{node.label}</span>
          </MenuItem>
        );
      }
      default:
        return unsupportedNode(node);
    }
  });
}

function unsupportedNode(node: never): never {
  throw new TypeError(`Unsupported thread menu node: ${JSON.stringify(node)}.`);
}
```

The test "Copy thread ID" reads `item.textContent === "Copy thread ID"`. `MenuItem` wraps children in `.cv-menu__text`, and the title span adds no text, so that holds. If `lucide-react` lacks one of these icon names in the installed version, pick the closest existing icon; the names are not part of any contract.

`src/components/agentMode/AgentThreadDeleteDialog.tsx`:

```tsx
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";

export function AgentThreadDeleteDialog({
  open,
  title,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly title: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <Dialog
      description={`“${title}” and its saved history are removed from Codevo. This cannot be undone.`}
      footer={
        <>
          <Button onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button onClick={onConfirm} type="button" variant="primary">
            Delete thread
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      title="Delete thread?"
      width="sm"
    />
  );
}
```

`src/components/agentMode/AgentThreadSnoozeDialog.tsx`:

```tsx
import { useState } from "react";
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";

export function AgentThreadSnoozeDialog({
  open,
  onCancel,
  onSnooze,
}: {
  readonly open: boolean;
  onCancel(): void;
  onSnooze(until: number): void;
}) {
  const [value, setValue] = useState("");
  const until = new Date(value).getTime();
  const valid = Number.isFinite(until) && until > Date.now();
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => valid && onSnooze(until)} type="button" variant="primary">
            Snooze
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      title="Snooze until"
      width="sm"
    >
      <input
        aria-label="Snooze until"
        className="cv-snooze__input"
        onChange={(event) => setValue(event.target.value)}
        type="datetime-local"
        value={value}
      />
    </Dialog>
  );
}
```

Add to `agentSidebar.css`:

```css
.cv-snooze__input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--cv-r-control);
  background: var(--cv-tint-2);
  box-shadow: var(--cv-ring-hair);
  color: var(--cv-fg-strong);
  font: inherit;
  font-size: var(--cv-t-sm);
}

.cv-snooze__input:focus-visible {
  box-shadow: var(--cv-ring-focus);
  outline: none;
}
```

- [ ] **Step 5: Wire the row**

In `AgentThreadRow.tsx`:
- Replace `AgentThreadRowMenu` with `AgentThreadContextMenu`, fed by `agentThreadContextMenu({ branch: agentShipBranchLabel(view.ship), pinned: thread.pinned, archived: thread.archived, running: status.kind === "working" || status.kind === "agents" || status.kind === "approval" || status.kind === "input", snoozed: (thread.snoozedUntil ?? 0) > Date.now(), settled: thread.settledAt != null, canMarkUnread: agentViewCanMarkUnread(view), moveUpId: props.moveUpId, moveDownId: props.moveDownId, threadRootKey: thread.owner.rootKey, projects: props.projects, now: Date.now() })`. Build it with `useMemo` only while the menu is open.
- Add `const rowRef = useRef<HTMLDivElement | null>(null);` on the option element, plus state `const [confirmDelete, setConfirmDelete] = useState(false);` and `const [snoozeCustom, setSnoozeCustom] = useState(false);`.
- `onAction` dispatches: `command` → `onMenuCommand(threadId, action.command)`; `rename` → `setRenaming(true)`; `delete` → `setConfirmDelete(true)`; `snoozeCustom` → `setSnoozeCustom(true)`.
- `closeMenu` sets `menu` to `null` and calls `queueMicrotask(() => rowRef.current?.focus())`.
- Add a row `onKeyDown`:

```tsx
  const openMenuFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left + 12, y: rect.top + rect.height - 8 });
  };
```

- Render `<AgentThreadDeleteDialog open={confirmDelete} title={model.title} onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); onMenuCommand(threadId, { kind: "delete" }); }} />` and `<AgentThreadSnoozeDialog open={snoozeCustom} onCancel={() => setSnoozeCustom(false)} onSnooze={(until) => { setSnoozeCustom(false); onMenuCommand(threadId, { kind: "snooze", until }); }} />` inside the `<li>`.

`AgentThreadList` takes `projects` and passes it to every row. `AgentThreadsSidebar` passes `scopeEntries` as `projects`. The type is `AgentRailScopeEntry`, which is structurally compatible with `AgentThreadMenuProject`.

Delete `AgentThreadRowMenu.tsx`, `AgentThreadSnoozePicker.tsx` and `AgentThreadOrganizationMenu.test.tsx`. Delete the `.agent-thread-snooze*` and `.agent-menu*` rules in `agentThreadOrganization.css`/`agentRail.css` that no remaining TSX file references (check with `rg -n "agent-thread-snooze|agent-menu" src --glob '!*.css'`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/agentThreadContextMenuModel.test.ts src/domain/agentThreadOrganization.test.ts src/components/agentMode/AgentThreadContextMenu.test.tsx src/components/agentMode/AgentThreadRow.test.tsx src/components/agentMode/useAgentThreadMenuCommands.test.tsx src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/AgentThreadHeader.test.tsx`
Expected: PASS. `AgentThreadHeader` also sends `onThreadMenuCommand`; its commands are unchanged apart from the new union member, so it only needs to compile.
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 7: Checkpoint**

Do not commit.

---
### Task 12: List shelves (Settled/Snoozed collapsed, Archived extracted), search results restyle, Usage popover extraction, CSS cleanup

**Files:**
- Create: `src/components/agentMode/AgentThreadArchivedShelf.tsx`, `src/components/agentMode/AgentRailUsagePopover.tsx`
- Modify: `src/components/agentMode/AgentThreadList.tsx`: shelves; the drop markers show only while dragging
- Modify: `src/components/agentMode/useAgentThreadDrag.tsx`: expose `data-dragging` through `handlers`
- Modify: `src/components/agentMode/AgentThreadsSidebar.tsx`: shelf state, `visibleThreadIds`, usage extraction, search rows
- Modify: `src/components/agentMode/AgentThreadSearchResults.tsx` (+ test): favicon, time, title marks. The props stay backward-compatible for P5.
- Modify: `src/components/agentMode/agentThreadOrganization.css`: token migration of the drop-zone rules
- Modify: `src/components/agentMode/agentSidebar.css`: shelves and search results
- Modify: `src/components/agentMode/agentRail.css`: delete every rule whose selector no remaining TSX file uses
- Test: `src/components/agentMode/AgentThreadsSidebar.test.tsx`, `src/components/agentMode/AgentThreadSearchResults.test.tsx`, `src/components/agentMode/agentSidebarStyles.test.ts`, `src/components/agentMode/agentRailStyles.test.ts`

**Interfaces:**
- Consumes: Task 10 rows and Task 11 menu.
- Produces:
  - `AgentThreadArchivedShelf({ sections, expanded, onToggle, onShowMore, renderRows })`
  - `AgentRailUsagePopover({ open, onClose, triggerRef, railRef, accountUsage, evidenceOf, projectLabels, threads, turnLog })`
  - `AgentThreadSearchResultsProps` gains the optional `readonly rows?: ReadonlyMap<string, { readonly projectLabel: string; readonly updatedAtEpochMs: number }>`
  P9 later deletes the first two (agreed).

- [ ] **Step 1: Write the failing tests**

Add to `AgentThreadsSidebar.test.tsx`:

```tsx
  it("keeps Settled collapsed behind a counted shelf and excludes its rows from keyboard navigation", () => {
    const [first, second] = threeThreads();
    const settled = { ...second!, thread: { ...second!.thread, settledAt: NOW - 1_000 } };
    render({ groups: [group(ROOT, "app", [first!, settled])] });
    const shelf = [...host.querySelectorAll<HTMLButtonElement>("button.cv-sb-shelf")].find((button) => button.textContent?.startsWith("Settled"));
    expect(shelf?.textContent).toContain("Settled (1)");
    expect(shelf?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(`[data-thread-id="${settled.thread.threadId}"]`)).toBeNull();
    act(() => shelf?.click());
    expect(host.querySelector(`[data-thread-id="${settled.thread.threadId}"]`)).not.toBeNull();
  });

  it("hides the Pins and Active drop markers until a drag starts", () => {
    render({ groups: [group(ROOT, "app", threeThreads())] });
    expect(host.querySelector(".agent-list")?.getAttribute("data-dragging")).toBeNull();
  });
```

Add to `AgentThreadSearchResults.test.tsx`:

```tsx
  it("shows the project monogram, relative time and title highlight like the mockup", () => {
    render({
      matches: [
        { threadId: "a", source: "title", turnId: null, eventIndex: null, snippet: "Idempotency keys for POST /orders", ranges: [{ start: 0, end: 7 }], segmentStart: 0, segmentEnd: 33, score: 1 },
        { threadId: "b", source: "assistant", turnId: "t", eventIndex: 2, snippet: "the retry reuses the same idempotency key", ranges: [{ start: 26, end: 33 }], segmentStart: 0, segmentEnd: 40, score: 1 },
      ],
      titles: new Map([
        ["a", "Idempotency keys for POST /orders"],
        ["b", "Flaky Jest timeout in payments"],
      ]),
      rows: new Map([
        ["a", { projectLabel: "orders-api", updatedAtEpochMs: Date.now() - 240_000 }],
        ["b", { projectLabel: "web-dashboard", updatedAtEpochMs: Date.now() - 7_200_000 }],
      ]),
    });
    const options = [...host.querySelectorAll('[role="option"]')];
    expect(options[0]?.querySelector(".cv-favicon")?.textContent).toBe("O");
    expect(options[0]?.querySelector(".cv-sr__title mark")?.textContent).toBe("Idempot");
    expect(options[0]?.querySelector(".cv-sr__when")?.textContent).toBe("4m");
    expect(options[1]?.querySelector(".cv-sr__who")?.textContent).toBe("Agent:");
    expect(options[1]?.querySelector(".cv-sr__snippet mark")?.textContent).toBe("idempot");
  });
```

The file's `render` helper must accept `rows`. If the helper passes a fixed props object, add `rows` to it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/AgentThreadSearchResults.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the shelves and drag visibility**

In `useAgentThreadDrag.tsx`:
- Add `const [dragging, setDragging] = useState(false);`.
- Call `setDragging(true)` at the end of a successful `onDragStart`, and `setDragging(false)` inside `finish`.
- Include `"data-dragging": dragging ? "true" : undefined` in the returned `handlers` object, so `{...drag.handlers}` sets it on the `<ul>`.
- `marker(section, label)` keeps its markup.

In `AgentThreadList.tsx`, add the props `settledExpanded`, `snoozedExpanded`, `onToggleSettled` and `onToggleSnoozed`, and render:

```tsx
      {drag.marker("pinned", "Pins")}
      {renderRows(sections.pinned)}
      {drag.marker("active", "Active")}
      {renderRows(sections.active)}
      {(sections.snoozed?.length ?? 0) > 0 && (
        <Shelf
          count={sections.snoozed!.length}
          expanded={snoozedExpanded}
          label="Snoozed"
          onToggle={onToggleSnoozed}
        />
      )}
      {snoozedExpanded && renderRows(sections.snoozed ?? [])}
      <Shelf
        count={sections.settled?.length ?? 0}
        dropSection="settled"
        expanded={settledExpanded}
        label="Settled"
        onToggle={onToggleSettled}
      />
      {settledExpanded && renderRows(sections.settled ?? [])}
      <AgentThreadArchivedShelf
        expanded={archivedExpanded}
        onShowMore={onShowMoreArchived}
        onToggle={onToggleArchived}
        renderRows={renderRows}
        sections={sections}
      />
```

with:

```tsx
function Shelf({
  count,
  dropSection,
  expanded,
  label,
  onToggle,
}: {
  readonly count: number;
  readonly dropSection?: AgentThreadDropSection;
  readonly expanded: boolean;
  readonly label: string;
  onToggle(): void;
}) {
  return (
    <li className="cv-sb-shelf-slot" data-thread-drop-section={dropSection} role="none">
      <button aria-expanded={expanded} className="cv-sb-shelf" onClick={onToggle} type="button">
        {count > 0 ? `${label} (${count})` : label}
        <span aria-hidden="true" className="cv-sb-shelf__rule" />
        <ChevronDown aria-hidden="true" className="cv-sb-shelf__chevron" size={12} />
      </button>
    </li>
  );
}
```

`src/components/agentMode/AgentThreadArchivedShelf.tsx` holds the existing archived `<li>` shelf plus the nested `<ul aria-label="Archived threads">` with "Show N more", moved verbatim from `AgentThreadList.tsx`, with the classes `cv-sb-shelf-slot`, `cv-sb-shelf`, `cv-sb-shelf__rule`, `cv-sb-shelf__chevron`. It renders nothing when `sections.archived.length + sections.hiddenArchivedCount === 0`.

In `AgentThreadsSidebar.tsx`:
- Add `const [settledExpanded, setSettledExpanded] = useState(false);` and `const [snoozedExpanded, setSnoozedExpanded] = useState(false);`.
- `visibleThreadIds` = `[...pinned, ...active, ...(snoozedExpanded ? snoozed : []), ...(settledExpanded ? settled : []), ...archived]`, mapped to ids.
- The facts-request `visible` list uses the same rule.

- [ ] **Step 4: Extract the Usage popover**

Move the `usageOpen` layout effect (focus, outside-click, focus restore) and the portal JSX from `AgentThreadsSidebar.tsx` into `AgentRailUsagePopover.tsx`:

```tsx
export interface AgentRailUsagePopoverProps {
  readonly open: boolean;
  readonly railRef: RefObject<HTMLElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
  readonly evidenceOf?: AgentTurnLogEvidenceLookup;
  readonly projectLabels: ReadonlyMap<string, string>;
  readonly threads: ReadonlyArray<AgentThread>;
  readonly turnLog: AgentTurnLogFactsSource | null;
  onClose(): void;
}
```

The body is exactly the current code: the `useLayoutEffect` keyed on `open`, the `createPortal(<div className="agent-usage-layer">…</div>, railRef.current?.closest(".workbench-frame") ?? document.body)`, and the `focusUsageSuccessor` / `isConnectedVisibleButton` helpers. `AgentThreadsSidebar` keeps `usageOpen`, `closeUsage` and the footer wiring, which is P2's `AgentProviderRailFooter` API, and mounts `<AgentRailUsagePopover … />` once. The existing Usage tests must pass unchanged.

- [ ] **Step 5: Restyle the search results**

`AgentThreadSearchResults.tsx`, keeping the existing ids, roles, keyboard and status line:

```tsx
          <li
            aria-selected={index === activeIndex}
            className="cv-sr"
            id={`${optionPrefix}${index}`}
            key={matchKey(match)}
            onClick={() => onSelect(match.threadId, agentThreadRevealForMatch(query, match))}
            onMouseMove={() => onHighlight(index)}
            role="option"
          >
            <span aria-hidden="true" className="cv-favicon">
              {agentProjectMonogram(rows?.get(match.threadId)?.projectLabel ?? "")}
            </span>
            <span className="cv-sr__body">
              <span className="cv-sr__line">
                <span className="cv-sr__title">
                  {match.source === "title"
                    ? marked(match.snippet, match.ranges)
                    : (titles.get(match.threadId) ?? match.threadId)}
                </span>
                {rows?.get(match.threadId) !== undefined && (
                  <span className="cv-sr__when">
                    <AgentCompactRelativeTime epochMs={rows.get(match.threadId)!.updatedAtEpochMs} />
                  </span>
                )}
              </span>
              {match.source !== "title" && (
                <span className="cv-sr__snippet">
                  <span className={match.source === "user" ? "cv-sr__who" : "cv-sr__who cv-sr__who--agent"}>
                    {whoLabel(match.source)}
                  </span>{" "}
                  {marked(match.snippet, match.ranges)}
                </span>
              )}
            </span>
          </li>
```

The list gets the class `cv-sb-results`, and the status, empty and truncation paragraphs get the class `cv-sb-hint`. In `AgentThreadsSidebar.tsx`, build `rows` only while search is active:

```tsx
  const searchRows = useMemo(
    () =>
      searchActive
        ? new Map(views.map((view) => [view.thread.threadId, { projectLabel: agentRowProjectLabel(projectLabels, view), updatedAtEpochMs: view.thread.updatedAtEpochMs }]))
        : EMPTY_ROWS,
    [projectLabels, searchActive, views],
  );
```

Pass it as `rows={searchRows}`.

- [ ] **Step 6: CSS**

Add to `agentSidebar.css`:

```css
.cv-sb-shelf-slot {
  list-style: none;
}

.cv-sb-shelf {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--cv-r-control);
  background: transparent;
  color: var(--cv-fg-subtle);
  cursor: pointer;
  font: inherit;
  font-size: var(--cv-t-xs);
}

.cv-sb-shelf:hover {
  color: var(--cv-fg-strong);
}

.cv-sb-shelf:focus-visible {
  box-shadow: var(--cv-ring-focus);
  outline: none;
}

.cv-sb-shelf__rule {
  flex: 1;
  height: 1px;
  background: var(--cv-hair);
}

.cv-sb-shelf__chevron {
  transition: transform var(--cv-motion-base) var(--cv-ease);
}

.cv-sb-shelf[aria-expanded="true"] .cv-sb-shelf__chevron {
  transform: rotate(180deg);
}

.cv-sb-results {
  margin: 0;
  padding: 0 8px;
  list-style: none;
}

.cv-sr {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 36px;
  margin: 1px 0;
  padding: 6px 10px;
  border-radius: var(--cv-r-control);
  color: var(--cv-fg-muted);
  cursor: pointer;
  font-size: var(--cv-t-sm);
}

.cv-sr .cv-favicon {
  margin-top: 2px;
}

.cv-sr:hover {
  background: var(--cv-row-hover);
  color: var(--cv-fg-strong);
}

.cv-sr[aria-selected="true"] {
  background: var(--cv-row-active);
  color: var(--cv-fg-strong);
}

.cv-sr__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.cv-sr__line {
  display: flex;
  gap: 10px;
}

.cv-sr__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-sr__when {
  flex: none;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
}

.cv-sr__snippet {
  overflow: hidden;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-sr__who {
  color: var(--cv-fg-muted);
  font-weight: 500;
}

.cv-sr__who--agent {
  color: var(--cv-accent);
}

.cv-sr mark {
  background: transparent;
  color: var(--cv-fg-strong);
  font-weight: 600;
}

.cv-sb-hint {
  margin: 0;
  padding: 10px 18px 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}
```

Replace `agentThreadOrganization.css` with its drop-zone rules migrated to tokens and made drag-only:

```css
.agent-thread-drop-zone {
  box-sizing: border-box;
  height: 0;
  min-height: 0;
  padding: 0 12px;
  overflow: hidden;
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-2xs);
}

.agent-list[data-dragging="true"] .agent-thread-drop-zone {
  height: auto;
  min-height: 24px;
  padding: 5px 12px;
}

.agent-list [data-drop-placement="before"] {
  background-image: linear-gradient(var(--cv-accent), var(--cv-accent));
  background-position: top;
  background-repeat: no-repeat;
  background-size: 100% 2px;
}

.agent-list [data-drop-placement="after"] {
  background-image: linear-gradient(var(--cv-accent), var(--cv-accent));
  background-position: bottom;
  background-repeat: no-repeat;
  background-size: 100% 2px;
}

.agent-thread-drop-zone[data-drop-placement],
.cv-sb-shelf-slot[data-drop-placement] .cv-sb-shelf {
  background: var(--cv-tint-2);
  color: var(--cv-fg);
}
```

Delete from `agentRail.css` every rule that only styled markup removed in Tasks 9-12. Run `rg -o "\.agent-[a-z0-9_-]+" src/components/agentMode/agentRail.css | sort -u`, then for each class run `rg -n "<class>" src --glob '*.tsx' --glob '*.ts'`, and delete only the rules whose classes have no remaining TSX/TS reference. Keep P2's `.agent-rail`/`.agent-rail-resize*` and the usage popover rules. Update `agentRailStyles.test.ts` to drop assertions on deleted selectors only.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/agentMode/AgentThreadsSidebar.test.tsx src/components/agentMode/AgentThreadSearchResults.test.tsx src/components/agentMode/agentSidebarStyles.test.ts src/components/agentMode/agentRailStyles.test.ts src/components/agentMode/AgentModeView.test.tsx`
Expected: PASS.
Run: `npm run check ; echo "exit $?"` and `npx eslint src/components/agentMode --max-warnings 0 ; echo "exit $?"`
Expected: `exit 0` for both.
Run: `npm run size:hotspots ; echo "exit $?"`
Expected: `exit 0`. `AgentThreadsSidebar.tsx` must end below its starting 596 lines.

- [ ] **Step 8: Checkpoint**

Do not commit.

---
### Task 13: F2 - thread error banner with Retry (+ reserved hunk b)

**Files:**
- Create: `src/domain/agentTurnRetry.ts`, `src/domain/agentTurnRetry.test.ts`
- Create: `src/application/useAgentTurnRetry.ts`, `src/application/useAgentTurnRetry.test.tsx`
- Create: `src/components/agentMode/agentThreadErrorBannerPresentation.ts`, `src/components/agentMode/agentThreadErrorBannerPresentation.test.ts`
- Create: `src/components/agentMode/AgentThreadErrorBanner.tsx`, `src/components/agentMode/AgentThreadErrorBanner.test.tsx`, `src/components/agentMode/agentThreadErrorBanner.css`
- Modify (reserved hunk b): `src/components/agentMode/AgentModeView.tsx`, one mount line between `<AgentThreadHeader …/>` and the session

**Interfaces:**
- Consumes: `AgentThreadsSurface.sendFollowUp(request: AgentFollowUpRequest): Promise<boolean>`, `AgentThreadsSurface.lastUsedLaunch(projectRootKey: string): AgentLaunchOptions | null`, `AgentThreadsSurface.threads`, `classifyAgentProviderError`, `agentProviderErrorHeadline`, `agentProviderDisplayName`, `agentPromptLooksClipped`, `runningTurn`.
- Produces:
  - `agentFailedLastTurn(thread): AgentTurn | null`
  - `agentTurnRetryPlan(thread, fallbackLaunch): AgentTurnRetryPlan | null`
  - `type AgentTurnRetryPlan = { kind: "ready"; threadId; failedTurnId; prompt; launch } | { kind: "unavailable"; failedTurnId; reason }`
  - `useAgentTurnRetry(agents): { readonly pendingTurnId: string | null; retry(plan: ReadyPlan): Promise<void> }`
  - `agentThreadErrorBannerModel(view, fallbackLaunch): AgentThreadErrorBannerModel | null`
  - `AgentThreadErrorBanner({ view, agents })`

- [ ] **Step 1: Write the failing domain and presentation tests**

`src/domain/agentTurnRetry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentLaunchOptions } from "./agentLaunch";
import type { AgentThread, AgentTurn } from "./agentThread";
import {
  RETRY_ARCHIVED_REASON,
  RETRY_ATTACHMENTS_REASON,
  RETRY_CLIPPED_REASON,
  RETRY_NO_LAUNCH_REASON,
  agentTurnRetryPlan,
} from "./agentTurnRetry";
import { CLIPPED_AGENT_PROMPT_MARKER } from "./agentPromptClipping";

const claude = { provider: "claudeCode", model: "default", mode: "default" } as unknown as AgentLaunchOptions;
const codex = { provider: "codex", model: "default", mode: "default" } as unknown as AgentLaunchOptions;

function thread(last: Partial<AgentTurn>, patch: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-1",
    archived: false,
    provider: { kind: "claudeCode", sessionId: "s" },
    owner: { rootKey: "/orders", ownerId: "w", repositoryRoot: "/orders" },
    turns: [{ turnId: "t1", prompt: "Add idempotency", status: { kind: "failed", message: "boom" }, launch: claude, ...last }],
    ...patch,
  } as unknown as AgentThread;
}

describe("agentTurnRetryPlan", () => {
  it("retries a failed or non-zero exit last turn with its own launch", () => {
    expect(agentTurnRetryPlan(thread({}), null)).toEqual({ kind: "ready", threadId: "agt-1", failedTurnId: "t1", prompt: "Add idempotency", launch: claude });
    expect(agentTurnRetryPlan(thread({ status: { kind: "exited", exitCode: 1 } }), null)?.kind).toBe("ready");
  });

  it("offers nothing for success, stop, running or no turns", () => {
    expect(agentTurnRetryPlan(thread({ status: { kind: "exited", exitCode: 0 } }), null)).toBeNull();
    expect(agentTurnRetryPlan(thread({ status: { kind: "stopped" } }), null)).toBeNull();
    expect(agentTurnRetryPlan(thread({ status: { kind: "running" } }), null)).toBeNull();
    expect(agentTurnRetryPlan({ ...thread({}), turns: [] } as AgentThread, null)).toBeNull();
  });

  it("falls back to the last used launch only for the same provider", () => {
    expect(agentTurnRetryPlan(thread({ launch: null }), claude)).toMatchObject({ kind: "ready", launch: claude });
    expect(agentTurnRetryPlan(thread({ launch: null }), codex)).toEqual({ kind: "unavailable", failedTurnId: "t1", reason: RETRY_NO_LAUNCH_REASON });
  });

  it("refuses clipped prompts, attachments and archived threads with a reason", () => {
    expect(agentTurnRetryPlan(thread({ prompt: `long${CLIPPED_AGENT_PROMPT_MARKER}` }), null)).toMatchObject({ reason: RETRY_CLIPPED_REASON });
    expect(agentTurnRetryPlan(thread({ attachments: [{ kind: "reference", name: "a.ts", path: "/a.ts", bytes: 1 }] }), null)).toMatchObject({ reason: RETRY_ATTACHMENTS_REASON });
    expect(agentTurnRetryPlan(thread({}, { archived: true }), null)).toMatchObject({ reason: RETRY_ARCHIVED_REASON });
  });
});
```

If `CLIPPED_AGENT_PROMPT_MARKER` is not exported from `agentPromptClipping.ts`, export it. It is a constant, not an API change.

`src/components/agentMode/agentThreadErrorBannerPresentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadErrorBannerModel } from "./agentThreadErrorBannerPresentation";

function view(status: unknown, provider: "claudeCode" | "codex" = "claudeCode"): AgentThreadView {
  return {
    thread: {
      threadId: "agt-1",
      archived: false,
      provider: { kind: provider, sessionId: null },
      owner: { rootKey: "/r", ownerId: "w", repositoryRoot: "/r" },
      turns: [{ turnId: "t1", prompt: "p", status, launch: { provider, model: "default", mode: "default" } }],
    },
  } as unknown as AgentThreadView;
}

describe("thread error banner model", () => {
  it("uses the provider headline and hint for a protocol failure", () => {
    const model = agentThreadErrorBannerModel(view({ kind: "failed", message: "provider_protocol_failed" }), null);
    expect(model?.title).toBe("Claude Code could not complete this run.");
    expect(model?.detail).toBe("The provider session could not continue. Check the provider CLI and try again.");
    expect(model?.key).toBe("agt-1\u0001t1");
    expect(model?.retry.kind).toBe("ready");
  });

  it("explains a non-zero exit and bounds an unknown message to its first line", () => {
    expect(agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 1 }, "codex"), null)).toMatchObject({
      title: "Codex could not complete this run.",
      detail: "The agent process exited with code 1.",
    });
    const long = `${"x".repeat(400)}\nsecond line`;
    const detail = agentThreadErrorBannerModel(view({ kind: "failed", message: long }), null)?.detail ?? "";
    expect(detail.length).toBeLessThanOrEqual(241);
    expect(detail).not.toContain("second line");
  });

  it("returns null when nothing failed", () => {
    expect(agentThreadErrorBannerModel(view({ kind: "exited", exitCode: 0 }), null)).toBeNull();
    expect(agentThreadErrorBannerModel(null, null)).toBeNull();
  });
});
```

The exact `failed` message that `classifyAgentProviderError` maps to `protocolFailure` is the token checked at `agentProviderError.ts:136`. If it differs from `provider_protocol_failed`, use the string that function recognises.

- [ ] **Step 2: Write the failing hook and component tests**

`src/application/useAgentTurnRetry.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "./agentThreadPorts";
import { useAgentTurnRetry } from "./useAgentTurnRetry";

function failedView(turnIds: ReadonlyArray<string>, running = false): AgentThreadView {
  return {
    thread: {
      threadId: "agt-1",
      archived: false,
      provider: { kind: "claudeCode" },
      turns: turnIds.map((turnId, index) => ({
        turnId,
        prompt: "p",
        status: running && index === turnIds.length - 1 ? { kind: "running" } : { kind: "failed", message: "boom" },
      })),
    },
  } as unknown as AgentThreadView;
}

const plan = { kind: "ready", threadId: "agt-1", failedTurnId: "t1", prompt: "p", launch: { provider: "claudeCode" } } as never;

let host: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useAgentTurnRetry> | null = null;
function Probe({ threads, sendFollowUp }: { readonly threads: ReadonlyArray<AgentThreadView>; readonly sendFollowUp: (request: unknown) => Promise<boolean> }) {
  latest = useAgentTurnRetry({ threads, sendFollowUp });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe("useAgentTurnRetry", () => {
  it("sends exactly once even when pressed twice", async () => {
    let resolve: (value: boolean) => void = () => undefined;
    const sendFollowUp = vi.fn(() => new Promise<boolean>((done) => (resolve = done)));
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"])]} />));
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = latest!.retry(plan);
      void latest!.retry(plan);
    });
    expect(latest!.pendingTurnId).toBe("t1");
    await act(async () => {
      resolve(true);
      await first;
    });
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
    expect(sendFollowUp).toHaveBeenCalledWith({ threadId: "agt-1", prompt: "p", launch: { provider: "claudeCode" } });
    expect(latest!.pendingTurnId).toBeNull();
  });

  it("does not send when a newer turn exists or the thread is running", async () => {
    const sendFollowUp = vi.fn(async () => true);
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1", "t2"])]} />));
    await act(() => latest!.retry(plan));
    act(() => root.render(<Probe sendFollowUp={sendFollowUp} threads={[failedView(["t1"], true)]} />));
    await act(() => latest!.retry(plan));
    expect(sendFollowUp).not.toHaveBeenCalled();
  });
});
```

`src/components/agentMode/AgentThreadErrorBanner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AgentThreadErrorBanner } from "./AgentThreadErrorBanner";

function failed(turnId: string, message = "boom"): AgentThreadView {
  return {
    thread: {
      threadId: "agt-1",
      archived: false,
      provider: { kind: "claudeCode", sessionId: null },
      owner: { rootKey: "/r", ownerId: "w", repositoryRoot: "/r" },
      turns: [{ turnId, prompt: "Add idempotency", status: { kind: "failed", message }, launch: { provider: "claudeCode", model: "default", mode: "default" } }],
    },
  } as unknown as AgentThreadView;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("AgentThreadErrorBanner", () => {
  it("retries the failed prompt and hides after dismiss until a new failure", async () => {
    const sendFollowUp = vi.fn(async () => true);
    const agents = (view: AgentThreadView) => ({ threads: [view], sendFollowUp, lastUsedLaunch: () => null });
    const first = failed("t1");
    act(() => root.render(<AgentThreadErrorBanner agents={agents(first)} view={first} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Claude Code could not complete this run.");
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry"))!.click();
    });
    expect(sendFollowUp).toHaveBeenCalledWith(expect.objectContaining({ threadId: "agt-1", prompt: "Add idempotency" }));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss error"]')!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const second = failed("t2");
    act(() => root.render(<AgentThreadErrorBanner agents={agents(second)} view={second} />));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("disables Retry and says why when the run cannot be repeated", () => {
    const view = failed("t1");
    const withAttachment = {
      ...view,
      thread: { ...view.thread, turns: [{ ...view.thread.turns[0]!, attachments: [{ kind: "reference", name: "a", path: "/a", bytes: 1 }] }] },
    } as AgentThreadView;
    act(() =>
      root.render(
        <AgentThreadErrorBanner agents={{ threads: [withAttachment], sendFollowUp: vi.fn(), lastUsedLaunch: () => null }} view={withAttachment} />,
      ),
    );
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry"));
    expect(retry?.disabled).toBe(true);
    expect(host.textContent).toContain("Send it again from the composer.");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/domain/agentTurnRetry.test.ts src/components/agentMode/agentThreadErrorBannerPresentation.test.ts src/application/useAgentTurnRetry.test.tsx src/components/agentMode/AgentThreadErrorBanner.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement the domain and the hook**

`src/domain/agentTurnRetry.ts`:

```ts
import type { AgentLaunchOptions } from "./agentLaunch";
import { agentPromptLooksClipped } from "./agentPromptClipping";
import { runningTurn, type AgentThread, type AgentTurn, type AgentTurnStatus } from "./agentThread";

export const RETRY_CLIPPED_REASON =
  "This message was too long to keep in full. Send it again from the composer.";
export const RETRY_ATTACHMENTS_REASON =
  "This message had attachments. Send it again from the composer.";
export const RETRY_NO_LAUNCH_REASON =
  "The settings of this run were not saved. Send it again from the composer.";
export const RETRY_ARCHIVED_REASON = "Unarchive the thread to retry.";

export type AgentTurnRetryPlan =
  | {
      readonly kind: "ready";
      readonly threadId: string;
      readonly failedTurnId: string;
      readonly prompt: string;
      readonly launch: AgentLaunchOptions;
    }
  | { readonly kind: "unavailable"; readonly failedTurnId: string; readonly reason: string };

export type AgentTurnRetryReadyPlan = Extract<AgentTurnRetryPlan, { kind: "ready" }>;

export function agentTurnFailed(status: AgentTurnStatus): boolean {
  return status.kind === "failed" || (status.kind === "exited" && status.exitCode !== 0);
}

export function agentFailedLastTurn(thread: AgentThread): AgentTurn | null {
  if (runningTurn(thread) !== null) return null;
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined || !agentTurnFailed(last.status)) return null;
  return last;
}

export function agentTurnRetryPlan(
  thread: AgentThread,
  fallbackLaunch: AgentLaunchOptions | null,
): AgentTurnRetryPlan | null {
  const failed = agentFailedLastTurn(thread);
  if (failed === null) return null;
  const unavailable = (reason: string): AgentTurnRetryPlan => ({
    kind: "unavailable",
    failedTurnId: failed.turnId,
    reason,
  });
  if (thread.archived) return unavailable(RETRY_ARCHIVED_REASON);
  if (agentPromptLooksClipped(failed.prompt)) return unavailable(RETRY_CLIPPED_REASON);
  if ((failed.attachments?.length ?? 0) > 0) return unavailable(RETRY_ATTACHMENTS_REASON);
  const fallback = fallbackLaunch?.provider === thread.provider.kind ? fallbackLaunch : null;
  const launch = failed.launch ?? fallback;
  if (launch === null) return unavailable(RETRY_NO_LAUNCH_REASON);
  return {
    kind: "ready",
    threadId: thread.threadId,
    failedTurnId: failed.turnId,
    prompt: failed.prompt,
    launch,
  };
}
```

`src/application/useAgentTurnRetry.ts`:

```ts
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { agentFailedLastTurn, type AgentTurnRetryReadyPlan } from "../domain/agentTurnRetry";
import type { AgentThreadsSurface } from "./agentThreadPorts";

export interface AgentTurnRetrySurface {
  readonly pendingTurnId: string | null;
  retry(plan: AgentTurnRetryReadyPlan): Promise<void>;
}

export function useAgentTurnRetry(
  agents: Pick<AgentThreadsSurface, "threads" | "sendFollowUp">,
): AgentTurnRetrySurface {
  const threadsRef = useRef(agents.threads);
  const sendRef = useRef(agents.sendFollowUp);
  useLayoutEffect(() => {
    threadsRef.current = agents.threads;
    sendRef.current = agents.sendFollowUp;
  }, [agents.sendFollowUp, agents.threads]);
  const inFlight = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);

  const retry = useCallback(async (plan: AgentTurnRetryReadyPlan) => {
    if (inFlight.current !== null) return;
    const current = threadsRef.current.find((view) => view.thread.threadId === plan.threadId);
    if (current === undefined) return;
    if (agentFailedLastTurn(current.thread)?.turnId !== plan.failedTurnId) return;
    inFlight.current = plan.failedTurnId;
    setPendingTurnId(plan.failedTurnId);
    try {
      await sendRef.current({ threadId: plan.threadId, prompt: plan.prompt, launch: plan.launch });
    } finally {
      inFlight.current = null;
      if (mounted.current) setPendingTurnId(null);
    }
  }, []);

  return useMemo(() => ({ pendingTurnId, retry }), [pendingTurnId, retry]);
}
```

`sendFollowUp` owns admission, authority and generation capture, and it publishes its own notices on refusal. `dangerousLaunchConfirmed` is deliberately omitted.

- [ ] **Step 5: Implement the presentation, the component and the CSS**

`src/components/agentMode/agentThreadErrorBannerPresentation.ts`:

```ts
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import {
  agentProviderDisplayName,
  agentProviderErrorHeadline,
  classifyAgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import {
  agentFailedLastTurn,
  agentTurnRetryPlan,
  type AgentTurnRetryPlan,
} from "../../domain/agentTurnRetry";

const MAX_DETAIL_CHARACTERS = 240;
const KEY_SEPARATOR = "\u0001";

export interface AgentThreadErrorBannerModel {
  readonly key: string;
  readonly failedTurnId: string;
  readonly title: string;
  readonly detail: string;
  readonly retry: AgentTurnRetryPlan;
}

export function agentThreadErrorBannerModel(
  view: AgentThreadView | null,
  fallbackLaunch: AgentLaunchOptions | null,
): AgentThreadErrorBannerModel | null {
  if (view === null) return null;
  const thread = view.thread;
  const failed = agentFailedLastTurn(thread);
  const retry = agentTurnRetryPlan(thread, fallbackLaunch);
  if (failed === null || retry === null) return null;
  const provider = thread.provider.kind;
  const name = agentProviderDisplayName(provider);
  const generic = `${name} could not complete this run.`;
  const base = { key: `${thread.threadId}${KEY_SEPARATOR}${failed.turnId}`, failedTurnId: failed.turnId, retry };
  if (failed.status.kind === "exited") {
    return { ...base, title: generic, detail: `The agent process exited with code ${failed.status.exitCode}.` };
  }
  if (failed.status.kind !== "failed") return null;
  const error = classifyAgentProviderError(failed.status.message, provider);
  switch (error.detail.kind) {
    case "protocolFailure":
      return {
        ...base,
        title: agentProviderErrorHeadline(error, null),
        detail: "The provider session could not continue. Check the provider CLI and try again.",
      };
    case "authenticationRequired":
      return { ...base, title: agentProviderErrorHeadline(error, null), detail: `Sign in to ${name} again, then retry.` };
    case "unsupportedModelForCliVersion":
      return { ...base, title: agentProviderErrorHeadline(error, null), detail: "Pick another model in the composer, or update the provider CLI." };
    case "advisory":
    case "unknown":
      return { ...base, title: generic, detail: firstLine(failed.status.message) };
    default:
      return unsupportedDetail(error.detail);
  }
}

function firstLine(message: string): string {
  const line = message.split("\n").find((candidate) => candidate.trim() !== "")?.trim() ?? "";
  return line.length > MAX_DETAIL_CHARACTERS ? `${line.slice(0, MAX_DETAIL_CHARACTERS)}…` : line;
}

function unsupportedDetail(detail: never): never {
  throw new TypeError(`Unsupported provider error detail: ${JSON.stringify(detail)}.`);
}
```

If `AgentProviderErrorDetail` has more kinds than these five, `npm run check` flags the `never` default. Map each new kind to the `generic` title and `firstLine` detail.

`src/components/agentMode/AgentThreadErrorBanner.tsx`:

```tsx
import { CircleAlert, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { useAgentTurnRetry } from "../../application/useAgentTurnRetry";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";
import { agentThreadErrorBannerModel } from "./agentThreadErrorBannerPresentation";
import "./agentThreadErrorBanner.css";

const MAX_DISMISSED = 64;

export function AgentThreadErrorBanner({
  agents,
  view,
}: {
  readonly agents: Pick<AgentThreadsSurface, "threads" | "sendFollowUp" | "lastUsedLaunch">;
  readonly view: AgentThreadView | null;
}) {
  const retry = useAgentTurnRetry(agents);
  const [dismissed, setDismissed] = useState<ReadonlyArray<string>>([]);
  const fallback = view === null ? null : agents.lastUsedLaunch(view.thread.owner.rootKey);
  const model = useMemo(() => agentThreadErrorBannerModel(view, fallback), [fallback, view]);
  if (model === null || dismissed.includes(model.key)) return null;
  const plan = model.retry;
  const pending = retry.pendingTurnId === model.failedTurnId;
  return (
    <div className="cv-thread-alert-wrap">
      <div className="cv-conversation-column cv-thread-alert" role="alert">
        <CircleAlert aria-hidden="true" className="cv-thread-alert__icon" size={16} />
        <div className="cv-thread-alert__text">
          <b>{model.title}</b>
          <span>{model.detail}</span>
          {plan.kind === "unavailable" && <span className="cv-thread-alert__reason">{plan.reason}</span>}
        </div>
        <div className="cv-thread-alert__actions">
          <Button
            disabled={plan.kind !== "ready" || pending}
            icon={<RotateCcw size={14} />}
            onClick={() => {
              if (plan.kind === "ready") void retry.retry(plan);
            }}
            size="sm"
            type="button"
          >
            {pending ? "Retrying…" : "Retry"}
          </Button>
          <IconButton
            icon={<X size={14} />}
            label="Dismiss error"
            onClick={() =>
              setDismissed((current) => [...current, model.key].slice(-MAX_DISMISSED))
            }
            size="xs"
            title="Dismiss"
          />
        </div>
      </div>
    </div>
  );
}
```

`src/components/agentMode/agentThreadErrorBanner.css` (values from the mockup `.alert-wrap`/`.alert`):

```css
.cv-thread-alert-wrap {
  display: flex;
  flex: none;
  justify-content: center;
  padding: 4px 20px 0;
}

.cv-thread-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  box-sizing: border-box;
  width: min(var(--cv-column), 100%);
  padding: 10px 8px 10px 12px;
  border-radius: var(--cv-r-card);
  background: color-mix(in srgb, var(--cv-danger) 9%, var(--cv-raised));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--cv-danger) 28%, transparent),
    var(--cv-lift);
}

.cv-thread-alert__icon {
  flex: none;
  margin-top: 2px;
  color: var(--cv-danger);
}

.cv-thread-alert__text {
  flex: 1;
  min-width: 0;
}

.cv-thread-alert__text b {
  display: block;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-sm);
  font-weight: 500;
}

.cv-thread-alert__text span {
  display: block;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  line-height: 18px;
  overflow-wrap: anywhere;
}

.cv-thread-alert__reason {
  margin-top: 2px;
  color: var(--cv-fg-subtle);
}

.cv-thread-alert__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
```

Add a style test next to it, `src/components/agentMode/agentThreadErrorBannerStyles.test.ts`, with the same body as the "uses only --cv tokens and no colour literals" test in Task 9, pointed at `components/agentMode/agentThreadErrorBanner.css`.

- [ ] **Step 6: Reserved hunk (b)**

In `AgentModeView.tsx`, add `<AgentThreadErrorBanner agents={agents} view={sessionThread} />` immediately after the `<AgentThreadHeader … />` element and before the session container, inside `.agent-mode__center`. Import it. There is no other change.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/domain/agentTurnRetry.test.ts src/components/agentMode/agentThreadErrorBannerPresentation.test.ts src/application/useAgentTurnRetry.test.tsx src/components/agentMode/AgentThreadErrorBanner.test.tsx src/components/agentMode/agentThreadErrorBannerStyles.test.ts src/components/agentMode/AgentModeView.test.tsx`
Expected: PASS.
Run: `npm run check ; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 8: Checkpoint**

Do not commit.

---
### Task 14: Full repository gates

**Files:** none. Fixes go back to the task that owns the failing file.

**Interfaces:** consumes the finished Tasks 1-13.

- [ ] **Step 1: Free the Node inspector port**

Run: `lsof -ti tcp:9229 | xargs -r kill`
Expected: exit 0.

- [ ] **Step 2: TypeScript gates, one per line, checking each exit code**

```bash
npm run check ; echo "check $?"
npm run lint -- --max-warnings 0 ; echo "lint $?"
npm run lint:exhaustive-deps ; echo "deps $?"
npm run build ; echo "build $?"
npm run size:hotspots ; echo "hotspots $?"
npm run format:check ; echo "format $?"
npm run format:check:changed ; echo "format-changed $?"
npm test -- --run ; echo "test $?"
```

Expected: every line prints `0`. `npm run build` is required here because it is a CLAUDE.md gate that includes the bundle budget. If the only `npm test` failures are Node watch/debug tests, free port 9229 and rerun those files one at a time before calling it a regression. For formatting failures, run `npx prettier --write <file>` only on the files listed in the Ownership section.

- [ ] **Step 3: Rust gates**

```bash
cd src-tauri
cargo check --all-targets ; echo "cargo-check $?"
cargo test --lib ; echo "cargo-lib $?"
cargo test --tests ; echo "cargo-tests $?"
cargo fmt --all -- --check ; echo "fmt $?"
cargo clippy --all-targets -- -D warnings ; echo "clippy $?"
cd ..
```

Expected: every line prints `0`.

- [ ] **Step 4: Coverage, whitespace and scope**

Run: `npm run test:coverage ; echo "coverage $?"`
Expected: `coverage 0`.
Run: `git diff --check ; echo "diff-check $?"` then `git status --porcelain`
Expected: `diff-check 0`. The status lists only the files in the Ownership section, plus the sibling phases' files if they run in parallel in the same tree. Those are never staged by P4.

- [ ] **Step 5: Hotspot evidence**

Run: `wc -l src/components/agentMode/AgentModeView.tsx src/components/agentMode/AgentThreadsSidebar.tsx src/components/agentMode/agentSidebarPresentation.ts src/domain/agentThread.ts src-tauri/src/codex_turn_event.rs`
Expected:
- `AgentThreadsSidebar.tsx` is below 596 lines.
- `agentSidebarPresentation.ts` is below 1181 lines.
- `AgentModeView.tsx` grew only by P4's reserved hunks, and there are more removed than added lines in hunks (a)-(d) combined relative to P2's tree.
- `agentThread.ts` grew by at most 2 lines.
- `codex_turn_event.rs` stays under 1100 lines.

---

### Task 15: Independent read-only review (Opus 5.5)

**Files:** none.

- [ ] **Step 1: Dispatch the reviewer**

Dispatch a fresh general-purpose agent with `model: "opus"` and this prompt. The reviewer must not edit files and must not run mutating git commands.

```text
You are an independent, read-only reviewer for phase P4 of the Codevo redesign in /Users/matusmockor/Developer/editor. Do not edit files, do not run git commands that change state, never run coderabbit. Read CLAUDE.md, the spec docs/superpowers/specs/2026-09-23-codevo-redesign-design.md (§3.1.5, §3.1.6, §3.2 B3, §3.3 F1/F2, §4, §6), the plan docs/superpowers/plans/2026-09-24-redesign-p4-sidebar-agents.md and the mockup docs/redesign/v3-sidebar-agents.html, then review the working-tree diff of the files in the plan's Ownership section.

Report findings as P0 (wrong behaviour, data loss, isolation leak), P1 (spec or CLAUDE.md violation, missing test for a risky path), P2 (quality). For each: file:line, what is wrong, a concrete failing scenario, the fix. Verify every claim in code before reporting it.

Focus on:
1. B3 wire: Rust CollabAgentToolCall decoding is lenient where it must be and fail-closed where it must be; NDJSON subagentSpawn key order and bounds match the TS decoder; the persisted AgentTurnEvent subagentSpawn is identical on both sides (event-kinds fixture, EXPECTED_EVENT_KINDS, validation bounds, turn-log kind code 19); lifecycle model/effort keys are retained-only and never written into the v1 file shape.
2. B3 lifecycle: spawn placeholder merge, consecutive-spawn batching, failed spawns, name survival through mergeAliases, no duplicate members, 32-entry bound; the removed subagentGroup path leaves no dead code or unreachable search hits.
3. F1: railFilter vs railScope separation; filter reconciliation on project close, A→B→A, member roots; search/jump/next/prev follow the filter; bulk actions use exact per-thread owners; drag/move never crosses projects.
4. Pending interactions poller: bounded threads, one thread at a time, owner-keyed results, no request after unmount, no stale status after a turn change, remote threads excluded.
5. F2 retry: single send, revalidation of the failed turn before sending, no dangerous-launch bypass, truthful unavailable reasons, dismissal bounded and keyed by thread+turn.
6. Agents panel bridge: publish/unpublish ordering, no render loops (memoised AgentThreadAgents), right-panel surface works with no provider, toggle state correct, no focus trap left behind.
7. UI: every screen state of v3-sidebar-agents.html (default, search, menu, rename, collapsed, subagents, agents, error) matches structure, sizes and copy; only --cv tokens; reduced motion; keyboard access to menus, submenus, filter popover, rename and dialogs; focus returns to the row.
8. Hotspots and ownership: no edits outside the Ownership section except the agreed reserved hunks; AgentModeView/AgentThreadSession did not grow beyond the reserved hunks.

End with a verdict: SHIP, SHIP AFTER FIXES (list), or DO NOT SHIP.
```

- [ ] **Step 2: Triage**

Before acting on any P0/P1 finding, verify it in the code; audits in this repo over-report (memory "Verify audit findings before fixing"). Fix the real findings through a new implementer task scoped to the affected files, rerun the focused tests and Task 14, and send the reviewer the fix diff. Record each rejected finding with a one-line reason for the final report.

---

### Task 16: QA build and Codex computer-use QA

**Files:** `~/tmp/codevo-qa/qa_prompt_p4.txt` and `~/tmp/codevo-qa/p4-fixture-web/` (scratch; deleted at the end).

- [ ] **Step 1: Prepare a second small project for the all-projects list**

```bash
mkdir -p ~/tmp/codevo-qa/p4-fixture-web/src
cd ~/tmp/codevo-qa/p4-fixture-web
printf '{\n  "name": "web-dashboard",\n  "version": "0.0.0",\n  "private": true\n}\n' > package.json
printf 'export const answer = 42;\n' > src/index.ts
git init -q && git add . && git -c user.name=qa -c user.email=qa@example.invalid commit -qm init
cd -
```

Expected: exit 0.

- [ ] **Step 2: Build and start the QA bundle**

Run: `npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'`
Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists. An exit code 1 caused only by the missing updater signing key is acceptable; a compile error is not.
Run: `open "src-tauri/target/debug/bundle/macos/Codevo QA.app" && sleep 3 && osascript -e 'tell application "Codevo QA" to activate'`
Expected: the "Codevo QA" window is frontmost. Never use `npm run debug`, and never touch "Codevo Editor".

- [ ] **Step 3: Write the QA prompt**

```bash
mkdir -p ~/tmp/codevo-qa && cat > ~/tmp/codevo-qa/qa_prompt_p4.txt <<'QA'
You are a UI QA tester with Computer Use. First action: take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop.

Rules:
- ATTACH ONLY to the already running app "Codevo QA" (bundle id dev.mockor.editor.qa). Never launch, quit, restart or build any app. Never interact with "Codevo Editor" or any other app.
- Before EVERY screenshot run: osascript -e 'tell application "Codevo QA" to activate' and wait 1 second, so the QA window is frontmost.
- Do not edit files. The only shell commands you may run are the osascript activate command above and saving screenshots under ~/tmp/codevo-qa/p4-shots/.
- Record worked/failed and the screenshot path for every step.

Reference: the approved mockup is docs/redesign/v3-sidebar-agents.html in /Users/matusmockor/Developer/editor. Open it in a browser tab ONLY if you need to compare (file URL), never modify it.

Steps:
1. If fewer than two projects are open: use the sidebar "Add project" button (folder with plus) → Open folder, and add /Users/matusmockor/Developer/editor and /Users/matusmockor/tmp/codevo-qa/p4-fixture-web. Trust them if asked.
2. In each project start one thread (New thread button, pencil icon) with the prompt "Reply with the single word OK." using Claude Code. Wait until both finish.
3. Sidebar default: confirm threads from BOTH projects are listed together without choosing a project, each row 3 lines (project monogram + project name + time or status; title; branch or "in place"), rows ~78px tall, a pinned thread shows a pin icon. Hover a row: a "Settle" action appears at the top right in place of the time.
4. Project filter: click the folder icon "Filter threads by project" next to the search field. Confirm the popover shows "Search projects...", "All projects" with a check, and both projects with monograms. Type "web" and confirm only web-dashboard remains; press Enter. The list shows only the web-dashboard thread and the filter icon becomes the "W" monogram. Reopen and choose All projects: both threads are back.
5. Search: click the search field, type "OK". Results show a monogram, the thread title, a relative time and an "Agent:" line with OK highlighted. Press Escape twice: the list returns.
6. Context menu: right-click a thread row. Confirm the menu order: New thread on …, Pin thread, Settle thread, Snooze ›, separator, Rename thread, Mark unread, Move to ›, separator, Copy ›, separator, Archive thread, Delete (red). Hover "Move to": Pinned/Active/Settled with Active checked, a "Project" label, the thread's project checked and the other project greyed out. Hover "Snooze": For 1 hour, For 1 day, Choose date and time…. Press Escape and confirm focus is back on the row (a focus ring on the row).
7. Keyboard: focus a row and press Shift+F10: the same menu opens. Choose Rename thread, type " QA", press Enter: the title updates. Double-click another row: an inline rename field appears; press Escape: nothing changes.
8. Pin/Settle: pin a thread from the menu (it moves to the top with a pin icon), then use the hover "Settle" action on another thread: it disappears into a "Settled (1)" shelf at the bottom; click the shelf to expand and collapse it.
9. Delete: open the menu on a thread, choose Delete: a confirmation dialog "Delete thread?" appears; press Cancel: the thread stays.
10. Collapsed sidebar: press Cmd+B: the sidebar hides, the top bar shows window lights, an Expand sidebar button and a New thread button. Press Cmd+B again: the sidebar returns.
11. Codex subagents (B3): switch the composer provider to Codex, start a thread in /Users/matusmockor/Developer/editor with: "Use two subagents in parallel: one counts the files in src/domain, the other reads package.json and reports the version. Then summarise both answers in one sentence." While it runs: the sidebar row shows "2 agents" (or "1 agent") in accent colour; the transcript shows ONE row "Kicked off 2 subagents · N working" with two member rows titled by their tasks (not "echo_test"-style path names) and role tags; there is NO separate grey collapsible block repeating the child tool calls. Screenshot the transcript.
12. Agents panel: click the users icon "Toggle agents panel" in the top bar (or "Open Agents panel ›" under the batch row). A right panel titled "Agents" opens with a "THIS TURN" section, one row per subagent with a live timer, an activity line and a metrics line (model · tokens · tools), and a footer "● N working … Σ … tok". Expand "Recent activity" on one row. Close the panel from its tab close button.
13. Error banner (F2), best effort: if any thread shows a failed run, open it: a red-tinted banner under the top bar reads "<Provider> could not complete this run." with a Retry button and a Dismiss (x) button. Click Dismiss: it disappears. If no failed run exists, report "not reproducible" for this step (do not try to break the app).
14. Palettes: open Settings > Appearance, switch to Graphite · Teal Light, then Carbon · Lime Dark. In each, screenshot the sidebar with the filter popover open and the context menu open, and the Agents panel. Report any unreadable text or colours that do not follow the palette. Finish on Graphite · Teal Dark.

Final report format:
- One line per step: "Step N: worked" or "Step N: failed - <what you saw>" (or "not reproducible").
- A list of visual differences versus the mockup (sizes, spacing, copy, icons) with screenshot paths.
QA
```

- [ ] **Step 4: Run the tester and wait for the report**

Run (in the background; the orchestrator caps the run at 45 minutes): `python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p4.txt > /tmp/qa-p4.log 2>&1`
Expected: the log ends with the tester's report. Read only the final or error lines (`COMPUTER_USE_UNAVAILABLE`, `TIMEOUT`, `ERROR`, the final agent message). If the permission classifier blocks the run, ask the user to run the same command with the `!` prefix, or to paste `~/tmp/codevo-qa/qa_prompt_p4.txt` into their own Codex desktop thread and paste the report back.

- [ ] **Step 5: Fix loop**

For each QA failure: confirm the root cause in code, fix it through a scoped implementer task, rerun the focused tests, Task 14 and a reviewer pass on the fix, rebuild the QA app, and re-run only the failed steps with a shortened prompt.

- [ ] **Step 6: Clean up**

Run: `osascript -e 'quit app "Codevo QA"'; rm -rf ~/tmp/codevo-qa/p4-fixture-web ~/tmp/codevo-qa/p4-shots /tmp/qa-p4.log ~/tmp/codevo-qa/qa_prompt_p4.txt`
Expected: exit 0.

---

### Task 17: Commit to main (lead only)

**Files:** the Ownership section only.

- [ ] **Step 1: Confirm nothing foreign is staged**

Run: `git status --porcelain && git log --oneline -5`
Expected: only the P4 files and the sibling phases' files are modified. Check for foreign commits and hunks first, because a user's parallel Codex session may share the tree (memory "Concurrent Codex session in same tree").

- [ ] **Step 2: Commit B3 (Tasks 1-5)**

```bash
git add src-tauri/src/codex_app_server_protocol.rs src-tauri/src/codex_app_server_protocol_tests.rs \
  src-tauri/src/codex_turn_event.rs src-tauri/src/codex_turn_event_collab.rs src-tauri/src/codex_turn_event_items.rs \
  src-tauri/src/codex_turn_event_tests.rs src-tauri/src/agent_thread_store.rs src-tauri/src/agent_thread_store_appserver.rs \
  src-tauri/src/agent_thread_store_event_wire_tests.rs src-tauri/src/agent_turn_log/payload.rs src-tauri/src/agent_subagent_lifecycle.rs \
  contracts/agent-subagent-lifecycle-wire.json src/domain/fixtures/agent-turn-event-kinds.json \
  src/domain/agentSubagentSpawn.ts src/domain/agentSubagentSpawn.test.ts src/domain/agentThread.ts src/domain/agentThreadWire.ts \
  src/domain/agentThreadWire.test.ts src/domain/agentThreadWire.subagentLifecycle.test.ts src/domain/agentThreadTailCap.ts \
  src/domain/agentTurnEventSupersession.ts src/domain/agentThreadSearch.ts src/domain/agentThreadSearch.test.ts \
  src/domain/agentSubagentLifecycle.ts src/domain/agentSubagentLifecycle.test.ts src/domain/agentSubagentLifecycleLegacy.ts \
  src/domain/agentOutput/codexAppServer.ts src/domain/agentOutput/codexAppServer.test.ts \
  src/components/remoteRunner/remoteRunnerOutput.ts src/components/agentMode/agentTurnProjection.ts \
  src/components/agentMode/AgentTurnItemView.tsx src/components/agentMode/AgentThreadSession.test.tsx \
  src/components/agentMode/agentAppServerGroups.test.ts src/components/agentMode/agentTranscriptPresentation.test.ts \
  src/components/agentMode/useAgentThreadFind.ts src/components/agentMode/agentSubagentDisclosurePresentation.ts \
  src/components/agentMode/agentRuntimeSubagentPresentation.ts src/components/agentMode/agentRuntimeSubagentPresentation.test.ts \
  src/components/agentMode/AgentSubagentDisclosure.tsx src/components/agentMode/AgentSubagentDisclosure.test.tsx \
  src/components/agentMode/agentSubagents.css src/components/agentMode/agentSubagentsStyles.test.ts
git diff --cached --stat
git commit -m "fix(agents): map Codex subagent spawns to typed events and one batch row"
```

`AgentTurnItemView.tsx`, `agentTurnProjection.ts` and `AgentThreadSession.test.tsx` are shared with P3. If P3's changes to those files are already in the working tree and not yet committed, do not stage those three files here; include them in P3's commit and tell P3. `agentSubagents.css` is edited by both Task 5 and Task 6, so commit it with this commit only if Task 6 is already folded in; otherwise commit it in Step 3. Check `git diff --cached --stat` before committing. Staged files must be exactly the B3 files.

- [ ] **Step 3: Commit the Agents panel, F1 sidebar and F2 (Tasks 6-13)**

Stage every remaining file from the Ownership section by explicit path, then run `git add -u` restricted to the deleted P4 files, then `git diff --cached --stat`. Before committing, `AgentModeView.tsx` must contain only P4's reserved hunks (a)-(d) on top of P2's committed tree: inspect `git diff --cached src/components/agentMode/AgentModeView.tsx`.

```bash
git commit -m "feat(sidebar): all-projects thread list, thread menu, Agents panel and run retry"
```

Expected: two commits on `main`, no AI attribution, no push, no tag.

- [ ] **Step 4: Report**

Report to the lead:
- the gate results with exit codes
- the reviewer verdict and any rejected findings
- the QA table
- the remaining gaps below

---

## Remaining gaps (reported, not claimed)

- Move to > Project is shown but disabled ("Moving threads between projects is not supported yet."), because moving a thread record, its worktree, turn log and provider session between project roots has no safe path yet.
- Sidebar rows show `N files`, not `+a −d`, because thread change summaries carry no line counts.
- Agents panel recent activity has no per-entry timestamps (the mockup shows `1:12`), because runtime subagent activity entries are not timestamped.
- Approval and Input sidebar statuses cover local threads only. Remote threads show Working.
- Codex nested spawns (a child spawning its own subagents) and the non-spawn collab tools (`wait`, `sendInput`, `closeAgent`, …) are not rendered.
- F2 Retry is unavailable for turns that carried attachments, turns with clipped prompts, and turns without recorded launch options. The banner states the reason.
- The exact `collabAgentToolCall` spawn payload is taken from the published app-server schema (t3code `effect-codex-app-server` generated schema). The repo has no captured spawn frame yet, and QA step 11 is the first real-provider check.

## Self-review

1. **Spec coverage:**
   - §3.1.5 sidebar:
     - all projects + filter: Tasks 7, 8, 9
     - pinned/active/settled: Task 12
     - statuses: Task 10
     - search highlight + You:/Agent: snippet: Task 12
     - context menu with new thread on branch, pin, settle, snooze, rename, mark unread, move to, copy, archive, delete: Task 11
     - inline rename: Tasks 10, 11
     - collapsed mode: P2 shell; verified in QA step 10
   - §3.1.6 Agents: Tasks 5 and 6.
   - B3: Tasks 1-4, the wire contract on both sides in Task 3, lifecycle contract in Task 4.
   - F1: Tasks 7-9. F2: Task 13.
   - §6 testing: unit/component tests per task, contract tests TS+Rust (Tasks 2-4), a11y keyboard (Task 11 and Review Focus 5), token/AA gates (style tests plus QA palettes step 14), gates (Task 14).
   - Hotspots: Task 14 Step 5.
2. **Placeholder scan:** no TBD/TODO. Where a step depends on an existing test harness whose helper names were not reproduced, the step gives the exact assertions and says to reuse or write the named helper.
3. **Type consistency:**
   - `AgentRailFilter`, `agentThreadsInFilter`, `agentRailFilterFollowingProject` and `agentRailFilterKey` are used identically in Tasks 7, 8, 9 and 12.
   - `AgentSubagentSpawnEvent` fields (`callId`, `status`, `taskTitle`, `model`, `reasoningEffort`, `agentThreadIds`) are identical in Tasks 2, 3 and 4.
   - `AgentThreadAgents.ticker` is added in Task 6 and consumed there.
   - `AgentRowSignals` and `agentRowWorkingAgents` are defined and consumed in Task 10.
   - `AgentThreadMenuAction`/`AgentThreadMenuNode` are defined and consumed in Task 11.
   - `AgentTurnRetryReadyPlan` is shared by the domain, hook and component in Task 13.
4. **Review Focus:** each of the five lines has a pinned test in the task named on that line.

## Lead decisions (2026-09-24)

1. "Move to > Project": drop the Project section from the context menu (no disabled entries). Moving a
   thread between projects is out of scope because Claude sessions are bound to their working folder;
   "Move to" keeps Pinned / Active / Settled only.
2. Accept the listed gaps (rows show "N files" instead of line counts, no per-entry times in Agents panel
   recent activity, no Approval/Input status for remote threads, nested Codex spawns and other collab
   tools not shown). Keep the error banner component-tested if QA cannot trigger a failed run.
3. Commit without waiting for the owner once gates, review and QA pass (no push, no tag).
