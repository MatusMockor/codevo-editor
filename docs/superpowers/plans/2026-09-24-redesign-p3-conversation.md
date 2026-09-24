# Redesign P3 - Conversation, Composer and B7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the agent conversation and composer to match `docs/redesign/v3-monolith-clean.html` (t3code layout, Codevo tokens) in every state - default, running, approval, background agents, queued edit with image, diff entry row, empty thread - and replace the "Earlier activity of this turn is saved but not shown here yet." notice with a quiet, bounded "Load earlier activity" control that pages older events from the turn log without a scroll jump (B7).

**Architecture:** Presentation-level rewrite inside the existing agent-mode components. New focused modules live in `src/components/agentMode/conversation/` (transcript pieces and sheets) and `src/components/agentMode/composer/` (composer frame, submit, interactions). All new and rewritten CSS uses only `--cv-*` tokens from `src/ui/tokens/**` and the P1 foundation components (`SubmitButton`, `IconButton`, `Button`, `ComposerBanner`, `Menu`). B7 adds one pure domain module (`src/domain/agentTurnActivityWindow.ts`: a bounded, contiguous, seq-keyed window over turn-log pages) and replaces the one-page viewer hook in `src/application/useAgentHistoryActivity.ts` with an accumulating, owner-revalidated pager; the UI renders the window inside the turn's work region with seq-based React keys and restores the scroll anchor after every prepend. Approval and question cards move into the composer slab (t3code `ComposerPendingApprovalPanel` pattern) through a keyed interaction source that reuses the unchanged `useAgentApprovals` / `useAgentQuestions` hooks.

**Tech Stack:** React 19, TypeScript 5.8 strict, Vite 8, Vitest 4 + jsdom 29, lucide-react, plain CSS (no CSS modules), P1 foundation (`src/ui/foundation/*`), P1 tokens (`src/ui/tokens/*`).

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1 item 4, §3.2 row B7, §4, §5 P3, §6, §7). Visual source of truth: `docs/redesign/v3-monolith-clean.html` (`<style id="codevo-base">` sections 9, 10 and 12, `<style id="screen-chat">`, the state switcher states). Shell context: `docs/superpowers/plans/2026-09-24-redesign-p2-app-shell.md` (P3 renders inside the P2 shell and is planned against the post-P2 tree).

## Global Constraints

- Scope (spec §3.1.4): "user bubble with image thumbnails + lightbox; work rows, thought rows and subagent batches as in t3code; compact "N files changed +a -d" row opening the diff; metadata on hover only; round send/stop; attachment tiles; approval, question, background-agents and queued-edit states inside/attached to the composer; empty thread."
- B7 (spec §3.2): "A quiet "Load earlier activity" control (t3code "Load earlier turns" pattern) pages older events from the turn log; bounded memory, no scroll jump".
- Success (spec §1): every state of `v3-monolith-clean.html` exists "with the same structure, sizes, copy and interactions, in all 6 palettes x dark/light"; "no existing capability is lost".
- Source of truth (spec §2): "Where a mockup and this spec disagree, this spec wins; where this spec is silent, the mockup wins."
- Architecture (spec §4): "no feature component defines its own colors"; "Redesign is presentation-level"; "`AgentThreadSession.tsx` and other large files must shrink or stay flat; new surfaces get their own focused modules"; "Old styles are removed as each surface is migrated; no long-lived dual styling."
- Agents (spec §7.1): implementation and review agents are Opus 5.5 only (Agent `model: "opus"`); UI QA is Codex with Computer Use via `codex app-server` against the QA bundle `dev.mockor.editor.qa`.
- Release (spec §7.3): no release, no tag, no push in P3.
- Mockup measurements (reuse, do not re-derive): column `--cv-column` 768px; transcript scroll padding `24px 20px 12px`; user row gap 4px, padding-bottom 16px; bubble max-width 80%, padding 12px, radius `--cv-r-bubble` 18px, background `--cv-tint-2`, text `--cv-fg-strong` 14px / 1.625; bubble image grid 2 columns, gap 8px, max-width 210px, aspect 4 / 3, radius `--cv-r-card`, border `--cv-hair-strong`; meta row 20px, 12px, `--cv-fg-subtle`, opacity 0 until hover/focus; fold row padding `4px 2px 8px`, margin-bottom 8px, bottom hairline; assistant block padding `2px 4px 16px`; prose 14px / 1.625, paragraph margin `0 0 10px`; inline code 12px mono, padding `1.5px 5px`, radius 6px, hair border, `--cv-tint-1`; file link chip 18px high, padding `0 6px`, 12px/500, `--cv-accent` on `--cv-accent-soft`; code block radius 10px on `--cv-tint-1`, `pre` padding `12.8px 14.4px`, 13px / 1.6 mono, copy button top-right on hover; changes row 36px, padding `0 6px 0 12px`, radius 10px, `--cv-tint-1`, 12px/500 (`--cv-tint-2` when active); live row min-height 28px, gap 6px, 24px icon box, pulse `steps(6)`; composer banner margin `0 22px -16px`, padding `6px 8px 22px 12px`, radius `16px 16px 0 0`; slab radius `--cv-r-composer` 22px, `--cv-raised`, hair border (hair-strong on focus-within), `--cv-edge-top, --cv-lift`; editor min-height 86px, padding `16px 16px 10px`; attachment tiles 64x64, remove chip 20px round `rgba(0,0,0,.65)`; foot height 48px, padding `0 16px 16px 12px`; round submit 32px; drawer 32px high, margin `-1px 22px 0`, radius `0 0 14px 14px`, `--cv-side`; approval body padding `14px 16px 6px`, kicker 11px with `--cv-warn` bold label, `pre` 12px/18px mono; empty hero heading 28px / 36px display font 500, letter-spacing -0.015em, margin-bottom 32px, dotted underline on the project, hero padding-bottom 80px; lightbox scrim `--cv-scrim`, image radius 10px, close chip 28px at `top: -40px; right: 0`, caption 12px `rgba(255,255,255,.8)`.
- Copy (mockup): placeholders "Ask anything, or / for commands" (thread follow-up), "Queue a follow-up" (steer, queue behavior), "Ask for changes, send follow-ups, or attach images" (new thread); live rows "Thinking", "Waiting for N agents", "Waiting for approval"; banners "N agents running" + names + "View", "Editing queued message" + "sends after this turn" + "Cancel"; row "N changed files" (singular "1 changed file") + "+a" "−d" (U+2212) + "Open diff"; B7 control "Load earlier activity" / "Loading earlier activity…"; "Load earlier turns" / "Loading earlier turns…" for thread history. The mockup's "@ files" hint is NOT used because the composer has no `@` mention support (F10's `@` prefix lives in the P5 palette).
- Accessible names that tests and users rely on stay unchanged unless a task says otherwise: "Send follow-up", "Start agent", "Queue message", "Send now", "Save queued message", "Stop agent", "Attach files", "Cancel editing queued message", "Copy your message", "Copy AI response", "Preview {name}", "Remove {name}", "Jump to latest", "Stop agent and background work", "Edit queued message", "Send queued message now", "Remove queued message".
- Token rule: P3 sheets reference only `--cv-*` names declared in `src/ui/tokens/*.css` or `src/ui/foundation/*.css` (P2 adds `--cv-divider` and `--cv-edge-{start,end,top,bottom}-divider`; use them only after P2 has landed). No colour literals except the two the mockup fixes on media chips (`rgba(0, 0, 0, 0.65)`, `rgba(0, 0, 0, 0.8)`, `rgba(255, 255, 255, 0.2)`, `rgba(255, 255, 255, 0.8)`), which the contract test allow-lists by selector.
- Thread text size (existing capability, `src/components/appShellTypeScale.ts`): the Settings "agent thread font size" sets `--codevo-fs-scale` on `.app-shell`. Every conversation and composer text size in P3 sheets is `calc(<size token> * var(--codevo-fs-scale, 1))` (for example `calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))`); `--codevo-fs-scale` is the only non-`--cv-` variable the P3 contract test allows. Hairline heights (20px meta row, 28px rows, 32px buttons) do not scale.
- Legacy token rewrite table (for any legacy rule P3 keeps and only re-tokens): `--agent-raised`→`--cv-raised`; `--agent-well`, `--agent-code-background`→`--cv-tint-1`; `--agent-hover`, `--agent-row-hover`→`--cv-tint-2`; `--agent-fill`→`--cv-tint-3`; `--agent-hairline`→`--cv-hair`; `--agent-hairline-strong`→`--cv-hair-strong`; `--agent-text-strong`, `--agent-ink`→`--cv-fg-strong`; `--agent-text`→`--cv-fg`; `--agent-text-muted`→`--cv-fg-muted`; `--agent-text-subtle`, `--agent-stopped`→`--cv-fg-subtle`; `--agent-text-disabled`→`--cv-fg-disabled`; `--agent-accent`, `--agent-live`, `--agent-plan`→`--cv-accent`; `--agent-live-soft`, `--agent-mark`, `--agent-glow`→`--cv-accent-soft`; `--agent-live-contrast`→`--cv-on-accent`; `--agent-ok`, `--agent-status-working`, `--agent-status-done`→`--cv-ok`; `--agent-attention`, `--agent-status-stopped`→`--cv-warn`; `--agent-danger`, `--agent-status-failed`→`--cv-danger`; `--agent-canvas`, `--agent-thread-canvas`→`--cv-canvas`; `--agent-rail`, `--agent-shade`→`--cv-side`; `--agent-sans`→`--cv-font-ui`; `--agent-mono`→`--cv-font-mono`; `--agent-radius-sm`→`--cv-r-control`; `--agent-radius-md`, `--agent-radius-xl`→`--cv-r-card`; `--agent-radius-lg`→`--cv-r-group`; `--agent-radius-pill`→`--cv-r-pill`; `--agent-fs-2xs`→`--cv-t-xs`; `--agent-fs-xs`, `--agent-fs-sm`→`--cv-t-md`; `--agent-fs-md`→`--cv-t-sm`; `--agent-fs-lg`→`--cv-t-lg`; `--agent-space-1..7` (2,4,8,12,16,24,32px)→`--cv-space-1`,`-2`,`-4`,`-5`,`-6`,`-7`,`-8`; `--agent-motion-hover`→`--cv-motion-fast`; `--agent-motion-select`, `--agent-motion-enter`→`--cv-motion-base`; `--agent-shadow-raised`→`--cv-lift`; `--agent-focus-ring`→`--cv-ring-focus`; `--ease-standard`→`--cv-ease`. For `--codevo-*`: `--codevo-raised`→`--cv-raised`; `--codevo-well`, `--codevo-well-soft`→`--cv-tint-1`; `--codevo-hover`, `--codevo-hover-soft`→`--cv-tint-2`; `--codevo-active`, `--codevo-selected`→`--cv-tint-3`; `--codevo-line`→`--cv-hair`; `--codevo-line-strong`→`--cv-hair-strong`; `--codevo-fg-strong`→`--cv-fg-strong`; `--codevo-fg`, `--codevo-prose`→`--cv-fg`; `--codevo-fg-muted`→`--cv-fg-muted`; `--codevo-fg-subtle`, `--codevo-prose-subtle`→`--cv-fg-subtle`; `--codevo-fg-disabled`→`--cv-fg-disabled`; `--codevo-primary`→`--cv-accent` (text) or `--cv-accent-fill` (fills); `--codevo-primary-fg`→`--cv-on-accent`; `--codevo-primary-soft`→`--cv-accent-soft`; `--codevo-ok`→`--cv-ok`; `--codevo-warn`→`--cv-warn`; `--codevo-danger`→`--cv-danger`; `--codevo-r-sm`→`--cv-r-control`; `--codevo-r-md`, `--codevo-r-xl`→`--cv-r-card`; `--codevo-r-lg`→`--cv-r-group`; `--codevo-r-pill`→`--cv-r-pill`; `--codevo-fs-ui`→`--cv-t-sm`; `--codevo-fs-meta`→`--cv-t-md`; `--codevo-fs-small`→`--cv-t-xs`; `--codevo-fs-label`→`--cv-t-2xs`; `--codevo-sans`→`--cv-font-ui`; `--codevo-mono`→`--cv-font-mono`; `--codevo-focus-ring`→`--cv-ring-focus`; `--codevo-shadow-float`→`--cv-shadow-pop`.
- Boundedness (CLAUDE.md): the B7 window holds at most `MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES = 1_000` raw log entries and `MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES = 2 * 1_024 * 1_024` bytes per turn view; one read request in flight per turn view; the first activation reads at most `MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES = 16` pages of at most `AGENT_TURN_LOG_LIMITS.pageEvents` (200) entries / `pageBytes` (512 KiB); a truncated/lossy/gapped window is labelled, never presented as complete.
- Isolation (CLAUDE.md): every async read captures the source identity `[rootKey, ownerId, threadId, turnId, generation, leaseToken]` plus a ticket; after every `await` the hook drops the result unless mounted, same ticket and same identity. Workspace A → B → A resets the window.
- Git (CLAUDE.md, memory): work on `main`; subagents never run mutating git commands (no stash/checkout/reset/commit); only the lead commits after review, gates and QA; commit messages carry no AI/Claude/Anthropic/co-author attribution.
- Review (CLAUDE.md): never run `coderabbit`/`cr`; review is a separate read-only Opus 5.5 agent.
- Code style (user rules): no code comments (bare tooling annotations only); guard clauses, no `else`; closed unions with exhaustive `never` checks; no `any`.
- Tests (user rules): real collaborators, no mocks of internal modules (only the turn-log `readPage` port and gateways are faked, as the existing tests do); React tests use `act`; tests never `throw` (use `expect`); jsdom tests start with `// @vitest-environment jsdom`.
- Formatting (memory): never `prettier --write` a directory; run `npx prettier --write <file>` only on files the task created; for modified files run `npm run format:check:changed` and prettier-write only files it lists.
- Token scan (P1): `src/domain/themeContrast.test.ts` treats every literal `var(--name` in `src/**` (tests included) as a use that must be declared in some stylesheet; in tests match variables with regexes such as `/var\(--cv-tint-2\)/` only for declared names and never write a literal `var(--...` for an undeclared name.
- Verify exit codes, not pipes (memory): run gates with `; echo name=$?`, never `cmd | tail`.
- Node watch tests (memory): if `npm test` fails only in Node watch tests with `EADDRINUSE 9229`, free the port (kill only orphaned `node` test processes) and rerun sequentially.

## Review Focus

- A turn whose log keeps growing (running turn) or whose project is switched A → B → A while a "Load earlier activity" read is in flight: the late page must be dropped, the window must never mix owners, and a running turn in log mode must always offer "Show latest activity" because its tail moves. Pinned in Task 13 (`drops a page that resolves after the source changed`, `drops a page that resolves after unmount`) and Task 14 (`offers the latest activity again while the turn is still running`).
- Rapid repeated clicks and mid-way read failures: exactly one read in flight, a failed page keeps the previous window visible with a Retry control, and the window never exceeds 1 000 entries or 2 MiB however many pages are prepended. Pinned in Task 12 (`evicts the newest entries past the entry and byte caps`) and Task 13 (`ignores a second load while one is in flight`, `keeps the previous window when a page fails and retries the same direction`).
- The user scrolled mid-transcript when earlier activity is prepended: the row that was the first visible row stays at the same viewport offset (no jump); when the replaced memory rows disappear on first activation, the control itself keeps its offset. Pinned in Task 14 (`useAgentScrollAnchor` tests).
- An approval or question arriving while the user has typed a draft: the draft, its attachments and the launch controls stay mounted (hidden, not cleared) and come back unchanged when the interaction settles; a double click on Approve sends one decision. Pinned in Task 11 (`keeps the typed draft while an approval replaces the editor`, `sends one decision for a double click`).
- Long unbroken content - a 400-character shell command in an approval, a deep file path in a changes row, a long model label in hover metadata, a long branch name in the drawer: it wraps or scrolls inside the 768px column, never clips or pushes the column wider. Pinned in Task 1/6/11 CSS contract tests (`keeps long approval commands inside the slab`, `truncates the drawer and meta rows instead of widening the column`).

---

## Ownership

P3 is one of four phases implemented in parallel (P3-P6). Agreements recorded with the sibling planners on 2026-09-24:

| Contested file / surface | Owner | Agreement |
|---|---|---|
| `AgentThreadSession.tsx` | P3 (sole) | P4 and P6 add no hunks; P4 keeps `useAgentThreadAgents` + `<AgentAgentsDock>` wrap untouched and rewrites the dock internally. |
| `AgentModeView.tsx` | P2 | P3 owns exactly one hunk: replace `<AgentThreadQuestions gateway={questionGateway} thread={sessionThread} />` + `<AgentComposerController ...>` with `<AgentComposerController ... interactions={{ gateway: questionGateway, thread: sessionThread }} />` (after P2 lands). P8 adds `banners`, P9 `renderDrawerEnd`, P6 `activeDiffTurnId`, P4 optionally `awaiting` on the elements P3 exposes; each is that phase's hunk. P2 keeps `.agent-mode__center` a flex column whose direct children are header, session, notices, controller. |
| `agentThread.css` | P3 for transcript/composer rule groups; P2 for header groups (`.agent-thread-head`, `.agent-crumbs*`, `.agent-layout-controls`, `.agent-icon-toggle*`) | P3 moves its groups out into `conversation/*.css`; ship/menu/split/files/diff groups stay for their owners. |
| `agentThreadStyles.test.ts`, `agentModeResponsiveStyles.test.ts` | shared | P3 deletes/rewrites only the `it` blocks named in its tasks; P2 edits the header blocks. |
| `AgentTurnItemView.tsx`, `agentTurnProjection.ts` | P3 | P4 owns one delete-only hunk (Codex `subagentGroup` case, `AgentSubagentGroupView`, the `{kind:"subagentGroup"}` emission, the dead `subagentGroup` clause in `agentTurnWorkFold`, and the Codex child-event filter) as P4's first task together with B3. P3 never edits those lines; P3's projection change is only the optional `keyOf` parameter (Task 14). Re-Read before every Edit. |
| `AgentSubagentDisclosure.tsx`, `agentSubagents.css`, `AgentAgentsPanel*`, `AgentAgentsDock.tsx`, `useAgentThreadAgents.tsx`, B3 | P4 | P3 renders `<AgentSubagentDisclosure>` unchanged. P3 publishes `.cv-work-row*` in `conversation/agentWorkRows.css` (Task 1) for P4's batch row. `.agent-background-row*` rules in `agentSubagents.css` become dead after Task 3; P4 may delete them. |
| F2 thread error banner | P4 | Mounted by P4 in `AgentModeView` between header and session; reuses `.cv-conversation-column`; no P3 slot. |
| Awaiting live row | P3 renders, P4 may feed | `AgentThreadSession` prop `awaiting?: "approval" \| "input" \| null` (default null). |
| Diff opening, `activeDiffTurnId` | P6 | P3 row calls the unchanged `onOpenTurnDiff(threadId, summary)`; P6 passes `activeDiffTurnId` from `AgentModeView`. P6 deletes `AgentTurnChangesCard.tsx`, `AgentTurnChangesCard.test.tsx`, `agentTurnChangesCard.css`, `agentRecordedTurnChanges.css` together with `AgentRecordedTurnDiff.tsx`; P3 only stops using them. |
| Pickers (`AgentLaunchControls`, `AgentModelPicker`, `AgentTraitsPicker`, `AgentExecutionEnvironmentPicker`, `AgentComposerControls.tsx`, `agentComposerCheckout.tsx`, picker rule groups in `agentComposer.css`), F8, usage notice | P9 | P3 positions `launchControls` in `.cv-composer__controls` and the environment/checkout pair in `.cv-composer__drawer-start` with unchanged props. P9 swaps the drawer-start pair for `AgentEnvironmentCheckoutPicker` in a small hunk inside AgentComposer's `drawerStart` constant, extends `AgentComposerDrawerContext` (`worktreeBase`, `onWorktreeBaseChange`) and fills `renderDrawerEnd`. P9's `worktreeBase` hunks in `useAgentComposerState.ts`, `agentThreadPorts.ts`, `useAgentTurnDispatch.ts` are P9's; P3 does not touch those files. |
| P5 palette "Change model" bridge | P5 + P9 | Hook call lives in P9's `AgentLaunchControls.tsx`; P3 touches nothing. |
| Clone composer, trust banner, clone placeholder | P8 | P8 owns `AgentCloneComposer.tsx` and passes `banners` and `placeholder` to `AgentComposer`. |

Exposed P3 contract names (final, shared with siblings): `AgentComposerProps.banners?: ReactNode`, `AgentComposerProps.renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode` (context type exported from `composer/AgentComposerFrame.tsx`), `AgentComposerProps.placeholder?: string`, `AgentComposerProps.layout?: "dock" | "hero"`, `AgentComposerProps.interaction?: AgentComposerInteraction | null`, `AgentComposerControllerProps.banners?`, `.renderDrawerEnd?`, `.interactions?: { readonly gateway: AgentQuestionGateway | null; readonly thread: AgentThreadView | null }`; classes `.cv-composer-dock[data-layout]`, `.cv-composer__banners`, `.cv-composer__slab`, `.cv-composer__foot`, `.cv-composer__controls`, `.cv-composer__actions`, `.cv-composer__drawer`, `.cv-composer__drawer-start`, `.cv-composer__drawer-end`, `.cv-conversation-column`, `.cv-work-row`, `.cv-work-row__icon`, `.cv-work-row__label`, `.cv-work-row__meta`, `.cv-work-row__chevron`, `.cv-live-row`; `AgentThreadSessionProps.activeDiffTurnId?: string | null`, `.awaiting?: AgentThreadAwaiting | null`.

Files P3 creates:

| Path | Responsibility |
|---|---|
| `src/components/agentMode/conversation/conversation.css` | Column, session scroll, turn rhythm, user row + bubble + bubble images, hover meta rows, assistant block, notes, end mark, failure block, raw output, queued bubbles, jump-to-latest, history pager, load-earlier control, empty hero. |
| `src/components/agentMode/conversation/agentWorkRows.css` | `.cv-work-row*`, `.cv-live-row*`, work fold, activity groups, thought rows, compaction rows. |
| `src/components/agentMode/conversation/agentProse.css` | Assistant prose, markdown blocks, inline code, path-link chips, code block with hover actions, copy buttons. |
| `src/components/agentMode/conversation/agentTurnChangesRow.css` | Changes row. |
| `src/components/agentMode/conversation/agentLightbox.css` | Image preview lightbox. |
| `src/components/agentMode/conversation/conversationStyles.test.ts` | Contract test for every P3 sheet. |
| `src/components/agentMode/conversation/agentTurnMetaLine.ts` (+ `.test.ts`) | Pure clock-time / agent-label / duration helpers for hover metadata. |
| `src/components/agentMode/conversation/AgentTurnMeta.tsx` (+ `.test.tsx`) | Hover metadata row of an answer. |
| `src/components/agentMode/conversation/AgentLiveRow.tsx` (+ `.test.tsx`) | Live status rows (Thinking / Working / Waiting for N agents / Waiting for approval / Waiting for input). |
| `src/components/agentMode/conversation/AgentTurnWork.tsx` | Work fold region extracted from `AgentTurnView.tsx`. |
| `src/components/agentMode/conversation/AgentTurnChangesRow.tsx` (+ `.test.tsx`) | Compact "N changed files +a −d · Open diff" row. |
| `src/components/agentMode/conversation/agentSessionDom.ts` (+ `.test.ts`) | DOM lookup and scroll-anchor math extracted from `AgentThreadSession.tsx`. |
| `src/components/agentMode/conversation/AgentSessionPreamble.tsx` | History pager, truncation/provenance notes, imported history block. |
| `src/components/agentMode/conversation/AgentQueuedMessages.tsx` | Pending-message list extracted from `AgentThreadSession.tsx`. |
| `src/components/agentMode/conversation/AgentSessionDock.tsx` (+ `.test.tsx`) | Bottom-of-session stack: jump-to-latest, queue count, background-work banner, agents banner. |
| `src/components/agentMode/conversation/agentAgentsBannerPresentation.ts` (+ `.test.ts`) | Pure "N agents running · names" model. |
| `src/components/agentMode/conversation/AgentTurnEarlierActivity.tsx` (+ `.test.tsx`) | B7 control, window footer controls and states. |
| `src/components/agentMode/conversation/useAgentScrollAnchor.ts` (+ `.test.tsx`) | Capture/restore of the first visible row across prepends. |
| `src/components/agentMode/conversation/useAgentActivitySources.ts` | Identity-stable per-turn turn-log readers (keeps `AgentTurnView` memoized). |
| `src/components/agentMode/conversation/agentTurnFinalResponse.ts` (+ `.test.ts`) | Split of projected items at the final answer (log mode). |
| `src/domain/agentTurnActivityWindow.ts` (+ `.test.ts`) | B7 pure bounded window over turn-log pages. |
| `src/components/agentMode/composer/AgentComposerFrame.tsx` (+ `.test.tsx`) | Dock/hero wrapper, banner stack, drawer slots. |
| `src/components/agentMode/composer/agentComposerFrame.css` | Composer layout sheet (dock, banners, slab, editor, tiles, foot, drawer, captions, interaction panel). |
| `src/components/agentMode/composer/agentComposerInteraction.ts` (+ `.test.ts`) | Closed `AgentComposerInteraction` union and the pure picker. |
| `src/components/agentMode/composer/AgentComposerInteractionSource.tsx` | Owner-keyed hook host publishing the current interaction. |
| `src/components/agentMode/composer/AgentComposerApprovalPanel.tsx` (+ `.test.tsx`) | Approval inside the slab (detail + Decline/Approve + More menu). |
| `src/components/agentMode/composer/AgentComposerQuestionPanel.tsx` | Question card inside the slab. |

Files P3 modifies: `src/ui/foundation/SubmitButton.tsx`, `src/ui/foundation/buttons.test.tsx`, `src/ui/foundation/buttons.css`, `src/components/agentMode/AgentThreadSession.tsx`, `AgentThreadSessionEmpty.tsx`, `AgentTurnView.tsx`, `AgentTurnParts.tsx`, `AgentTurnItemView.tsx` (not the P4 hunk), `AgentActivityItems.tsx`, `agentActivityGrouping.ts`, `AgentToolRow.tsx`, `AgentThought.tsx`, `AgentBackgroundActivity.tsx`, `AgentCompactionActivity.tsx`, `AgentAssistantText.tsx`, `AgentMarkdownCodeBlock.tsx`, `AgentTurnAttachments.tsx`, `AgentAttachmentLightbox.tsx`, `AgentImportedHistory.tsx`, `AgentRecordedTurnChanges.tsx`, `AgentQueuedPrompt.tsx`, `AgentJumpToLatest.tsx`, `AgentHistoryPager.tsx`, `AgentBackgroundWorkBanner.tsx`, `agentTurnLogNotice.ts` (+ test), `agentTurnProjection.ts` (only `keyOf`), `agentTurnItemKeys.ts`, `agentApprovalPresenter.ts` (+ test), `AgentComposer.tsx`, `AgentComposerController.tsx`, `AgentComposerSubmitControls.tsx`, `AgentComposerAttachments.tsx`, `AgentComposerQueuedEditBar.tsx`, `AgentQuestionCard.tsx`, `agentQuestionCard.css`, `agentComposerCommands.css`, `agentComposer.css` (delete non-picker groups), `agentThread.css` (delete migrated groups), `agentToolRows.css` (rewritten), `AgentModeView.tsx` (the one hunk), `src/application/useAgentHistoryActivity.ts` and its test (rewritten in place; `useAgentThreadHistory.ts` keeps importing the unchanged `AgentHistoryActivitySource` type), plus the tests named per task.

Files P3 deletes: `AgentHistoryActivity.tsx`, `AgentHistoryActivity.test.tsx`, `agentTranscript.css`, `agentThought.css`, `agentActivityGroups.css`, `agentBackgroundWorkBanner.css`, `agentApprovalCard.css`, `AgentApprovalCard.tsx`, `AgentApprovalCard.test.tsx`, `AgentThreadApprovals.tsx`, `AgentThreadApprovals.test.tsx`, `AgentThreadQuestions.tsx`, `agentToolRowsStyles.test.ts` (its assertions move into `conversationStyles.test.ts`). `agentTurnHeadPresentation.ts` is kept (timing).

P3 does NOT touch: `App.tsx`, `App.css`, `AgentWorkbenchScreen.tsx`, `useAgentThreads.ts`, `useAgentThreadHistory.ts`, `agentThread.ts`, `agentModeTokens.css`, `agentMode.css`, `agentSubagents.css`, `agentHistory.css`, any picker file, any right-panel/surface file, any Rust file.

## Execution Order

- Precondition (lead, Task 0): P2 is committed; P4's delete-only Task 1 hunk is either committed or not started (never mid-edit) before P3 Task 3 or Task 14 edit `AgentTurnItemView.tsx` / `agentTurnProjection.ts`.
- Stream A (transcript, strictly sequential - shared files): Task 1 → 2 → 3 → 4 → 5 → 6 → 7.
- Stream B (composer, strictly sequential): Task 8 → 9 → 10 → 11. Stream B runs in parallel with Stream A (disjoint files; only `conversation.css` vs `agentComposerFrame.css` - separate files).
- Stream C (B7): Task 12 and Task 13 in parallel with A and B (new files only); Task 14 after Task 7 and Task 13 (it edits `AgentTurnView.tsx`, `AgentThreadSession.tsx`, `agentTurnProjection.ts`).
- Wrap-up (lead): Task 15 performance evidence → Task 16 gates → Task 17 independent review → Task 18 QA build + Codex QA → Task 19 commit.
- Each implementer reports changed files and exact focused test output; the lead reruns the focused tests before starting dependent tasks.

---
### Task 0: Preconditions (lead)

**Files:** none.

**Interfaces:**
- Consumes: the P2 commit, P4's progress on its delete-only Task 1.
- Produces: a go/no-go note for Streams A-C.

- [ ] **Step 1: Confirm P2 landed and the tree is clean for P3**

Run: `cd /Users/matusmockor/Developer/editor && git log --oneline -8 && git status --short`
Expected: a P2 app-shell commit is present; `src/components/agentMode/agentMode.css` contains `.agent-mode__center` with `display: flex` and `flex-direction: column`; no uncommitted edits in files P3 owns (see Ownership). If P2 is not committed, stop and report.

- [ ] **Step 2: Record the P4 hunk state**

Run: `cd /Users/matusmockor/Developer/editor && grep -n "subagentGroup" src/components/agentMode/AgentTurnItemView.tsx src/components/agentMode/agentTurnProjection.ts`
Expected: either matches (P4 not yet done) or none (P4 done). Tell Stream A/C implementers which; if P4 is mid-edit, Tasks 3 and 14 wait.

- [ ] **Step 3: Record baselines for Task 15**

Run: `cd /Users/matusmockor/Developer/editor && git rev-parse HEAD && node -e 'import("./scripts/check-hotspot-size-budget.mjs").then(({countSourceLines,countStructuralTokens})=>{const fs=require("fs");for(const f of ["src/components/agentMode/AgentThreadSession.tsx","src/components/agentMode/AgentTurnView.tsx","src/components/agentMode/AgentComposer.tsx"]){const c=fs.readFileSync(f,"utf8");console.log(countSourceLines(c),countStructuralTokens(c,f),f)}})'`
Expected: the baseline commit hash (keep it for Task 15) and three lines `lines tokens path`; pre-P3 values were `786 4874 AgentThreadSession.tsx`, `618 3679 AgentTurnView.tsx`, `897 4654 AgentComposer.tsx`. Save the output for Task 15.

---

### Task 1: Conversation sheets, column and user row

**Files:**
- Create: `src/components/agentMode/conversation/conversation.css`
- Create: `src/components/agentMode/conversation/agentWorkRows.css`
- Create: `src/components/agentMode/conversation/conversationStyles.test.ts`
- Modify: `src/components/agentMode/AgentThreadSession.tsx` (imports, body class)
- Modify: `src/components/agentMode/agentThread.css` (delete migrated groups, `.agent-session` padding)
- Modify: `src/components/agentMode/agentThreadStyles.test.ts` (delete four blocks, trim one list)
- Modify: `src/components/agentMode/agentModeResponsiveStyles.test.ts` (block "reflows thread content inside the docked center column")
- Modify: `src/components/agentMode/agentThreadTurns.test.tsx:143-144`

**Interfaces:**
- Consumes: P1 tokens; `parseAllStyleSheets`, `selectorParts`, `varReferences`, `COLOR_LITERAL` from `src/components/cssContractTestSupport.ts`.
- Produces: classes `.cv-conversation-column`, `.cv-work-row`, `.cv-work-row__icon`, `.cv-work-row__label`, `.cv-work-row__meta`, `.cv-work-row__chevron`, `.cv-live-row`, `.cv-live-row__icon`, `.cv-live-row__label`, `.cv-live-row--pulse`, `.cv-live-row--warn`; the test helpers `P3_SHEETS` list and `declaredValue(sheet, selector, property, context?)` inside `conversationStyles.test.ts` that later tasks extend.

- [ ] **Step 1: Write the failing contract test**

Create `src/components/agentMode/conversation/conversationStyles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseAllStyleSheets,
  selectorParts,
  varReferences,
} from "../../cssContractTestSupport";

const CONVERSATION = "components/agentMode/conversation/conversation.css";
const WORK_ROWS = "components/agentMode/conversation/agentWorkRows.css";
const P3_SHEETS: ReadonlyArray<string> = [CONVERSATION, WORK_ROWS];
const MEDIA_CHIP_SELECTORS: ReadonlySet<string> = new Set<string>([]);
const TYPE_SCALE = "--codevo-fs-scale";
const LEGACY_TOKEN = /var\(\s*--(color|agent|settings|toast|change|ease)-|var\(\s*--codevo-(?!fs-scale\b)/;
const MOTION_PROPERTIES = new Set(["transition", "transition-duration", "animation", "animation-duration"]);
const DURATION_LITERAL = /(^|[\s,(])\d+(\.\d+)?m?s\b/;
const MOTION_TOKEN = /var\(--cv-motion-(fast|base|slow|spin)\)/;
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const MIGRATED_SELECTORS = [
  ".agent-session__scroll",
  ".agent-session__body",
  ".agent-turn-list",
  ".agent-turn",
  ".agent-prompt",
  ".agent-prompt__bubble",
  ".agent-prompt__body",
  ".agent-answer",
  ".agent-turn__events",
] as const;

const parsed = parseAllStyleSheets();
const declaredTokens = new Set(
  parsed.rules
    .filter((rule) => rule.sheet.startsWith("ui/"))
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);

function p3Declarations() {
  return parsed.rules
    .filter((rule) => P3_SHEETS.includes(rule.sheet))
    .flatMap((rule) => rule.declarations.map((declaration) => ({ rule, declaration })));
}

function declaredValue(
  sheet: string,
  selector: string,
  property: string,
  context: ReadonlyArray<string> = [],
): string | undefined {
  const values = parsed.rules
    .filter((rule) => rule.sheet === sheet)
    .filter((rule) => rule.context.join("|") === context.join("|"))
    .filter((rule) => selectorParts(rule.selector).includes(selector))
    .flatMap((rule) => rule.declarations)
    .filter((declaration) => declaration.property === property)
    .map((declaration) => declaration.value);
  return values[values.length - 1];
}

describe("P3 conversation sheets", () => {
  it("exist and parse cleanly", () => {
    expect(parsed.issues).toEqual([]);
    for (const sheet of P3_SHEETS) {
      expect(parsed.rules.some((rule) => rule.sheet === sheet), sheet).toBe(true);
    }
  });

  it("use only declared --cv tokens, the thread type scale and no legacy variables", () => {
    const undeclared = p3Declarations().flatMap(({ rule, declaration }) =>
      varReferences(declaration.value)
        .filter((name) => name !== TYPE_SCALE)
        .filter((name) => !name.startsWith("--cv-") || !declaredTokens.has(name))
        .map((name) => `${rule.sheet} ${rule.selector} ${name}`),
    );
    const legacy = p3Declarations()
      .filter(({ declaration }) => LEGACY_TOKEN.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(undeclared).toEqual([]);
    expect(legacy).toEqual([]);
  });

  it("declare no colour literals outside the media chips", () => {
    const literals = p3Declarations()
      .filter(({ rule }) => !MEDIA_CHIP_SELECTORS.has(rule.selector))
      .filter(({ declaration }) => COLOR_LITERAL.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(literals).toEqual([]);
  });

  it("animate only through the motion tokens", () => {
    const offenders = p3Declarations()
      .filter(({ declaration }) => MOTION_PROPERTIES.has(declaration.property))
      .filter(({ declaration }) => declaration.value !== "none")
      .filter(
        ({ declaration }) =>
          DURATION_LITERAL.test(declaration.value) || !MOTION_TOKEN.test(declaration.value),
      )
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector}: ${declaration.value}`);

    expect(offenders).toEqual([]);
  });

  it("moves every transcript layout selector out of the legacy thread sheet", () => {
    for (const selector of MIGRATED_SELECTORS) {
      const sheets = parsed.rules
        .filter((rule) => rule.context.length === 0)
        .filter((rule) => selectorParts(rule.selector).includes(selector))
        .map((rule) => rule.sheet);
      expect(
        sheets.some((sheet) => P3_SHEETS.includes(sheet)),
        selector,
      ).toBe(true);
      expect(sheets, selector).not.toContain("components/agentMode/agentThread.css");
    }
  });

  it("centres the conversation on the 768px column with the mockup gutters", () => {
    expect(declaredValue(CONVERSATION, ".cv-conversation-column", "max-width")).toBe(
      "var(--cv-column)",
    );
    expect(declaredValue(CONVERSATION, ".cv-conversation-column", "margin")).toBe("0 auto");
    expect(declaredValue(CONVERSATION, ".cv-conversation-column", "min-width")).toBe("0");
    expect(declaredValue(CONVERSATION, ".agent-session__scroll", "padding")).toBe(
      "var(--cv-space-7) 20px var(--cv-space-5)",
    );
    expect(declaredValue(CONVERSATION, ".agent-turn-list", "gap")).toBe("var(--cv-space-2)");
  });

  it("draws the user message as the right-aligned t3code bubble", () => {
    expect(declaredValue(CONVERSATION, ".agent-prompt", "align-items")).toBe("flex-end");
    expect(declaredValue(CONVERSATION, ".agent-prompt", "padding-bottom")).toBe("var(--cv-space-6)");
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "max-width")).toBe("80%");
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "padding")).toBe("var(--cv-space-5)");
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "border-radius")).toBe(
      "var(--cv-r-bubble)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "background")).toBe(
      "var(--cv-tint-2)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "line-height")).toBe(
      "var(--cv-lh-prose)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__body", "white-space")).toBe("pre-wrap");
    expect(declaredValue(CONVERSATION, ".agent-prompt__body", "overflow-wrap")).toBe("anywhere");
  });

  it("publishes the shared work-row vocabulary with the mockup metrics", () => {
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "min-height")).toBe("28px");
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "gap")).toBe("var(--cv-space-3)");
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "color")).toBe("var(--cv-fg-subtle)");
    expect(declaredValue(WORK_ROWS, ".cv-work-row:hover", "color")).toBe("var(--cv-fg-strong)");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__icon", "width")).toBe("24px");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__icon", "height")).toBe("24px");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__label", "text-overflow")).toBe("ellipsis");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__meta", "opacity")).toBe("0");
    expect(declaredValue(WORK_ROWS, ".cv-live-row", "min-height")).toBe("28px");
  });

  it("stops the live pulse under reduced motion", () => {
    expect(
      declaredValue(WORK_ROWS, ".cv-live-row--pulse .cv-live-row__label", "animation", [
        REDUCED_MOTION,
      ]),
    ).toBe("none");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/conversationStyles.test.ts`
Expected: FAIL - "exist and parse cleanly" reports the two missing sheets.

- [ ] **Step 3: Create `conversation/conversation.css`**

```css
.cv-conversation-column {
  width: 100%;
  min-width: 0;
  max-width: var(--cv-column);
  margin: 0 auto;
}

.agent-session__scroll {
  min-width: 0;
  overflow-x: hidden;
  padding: var(--cv-space-7) 20px var(--cv-space-5);
}

.agent-session__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  min-width: 0;
}

.agent-turn-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--cv-space-2);
  min-width: 0;
}

.agent-turn {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
}

.agent-prompt {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--cv-space-2);
  min-width: 0;
  padding-bottom: var(--cv-space-6);
}

.agent-prompt__bubble {
  display: grid;
  gap: var(--cv-space-4);
  min-width: 0;
  max-width: 80%;
  padding: var(--cv-space-5);
  border-radius: var(--cv-r-bubble);
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
  line-height: var(--cv-lh-prose);
}

.agent-prompt__bubble:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.agent-prompt__body {
  min-width: 0;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.agent-answer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--cv-space-2);
  min-width: 0;
  padding: var(--cv-space-1) var(--cv-space-2) var(--cv-space-6);
}

.agent-turn__events {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
}
```

When moving each of these selectors out of `agentThread.css`, carry over verbatim any declaration the block above does not set among `position`, `display`, `flex*`, `overflow*`, `scroll-*`, `overscroll-behavior`, `contain`, `z-index`, `inset*` (layout behavior the find bar, minimap and follow logic rely on); drop every other old declaration.

- [ ] **Step 4: Create `conversation/agentWorkRows.css`**

```css
.cv-work-row {
  display: flex;
  align-items: center;
  gap: var(--cv-space-3);
  width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 0 var(--cv-space-1);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-ui);
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
  line-height: var(--cv-lh-prose);
  text-align: left;
  cursor: pointer;
  transition: color var(--cv-motion-fast) var(--cv-ease);
}

.cv-work-row:hover {
  color: var(--cv-fg-strong);
}

.cv-work-row:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.cv-work-row__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
}

.cv-work-row__label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-work-row__meta {
  flex: none;
  margin-left: auto;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity var(--cv-motion-slow) var(--cv-ease);
}

.cv-work-row:hover .cv-work-row__meta,
.cv-work-row:focus-visible .cv-work-row__meta {
  opacity: 1;
}

.cv-work-row__chevron {
  flex: none;
  transition: transform var(--cv-motion-base) var(--cv-ease);
}

.cv-work-row[aria-expanded="true"] .cv-work-row__chevron {
  transform: rotate(90deg);
}

.cv-live-row {
  display: flex;
  align-items: center;
  gap: var(--cv-space-3);
  min-height: 28px;
  padding: 0 var(--cv-space-1) var(--cv-space-4);
  color: var(--cv-fg-subtle);
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
}

.cv-live-row__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
}

.cv-live-row__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-live-row--pulse .cv-live-row__label {
  animation: cv-live-pulse calc(var(--cv-motion-spin) * 2) steps(6) infinite;
}

.cv-live-row--warn {
  color: var(--cv-fg-muted);
}

.cv-live-row--warn .cv-live-row__icon {
  color: var(--cv-warn);
}

@keyframes cv-live-pulse {
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

@media (prefers-reduced-motion: reduce) {
  .cv-live-row--pulse .cv-live-row__label {
    animation: none;
  }
}
```

- [ ] **Step 5: Load the sheets and put the body on the column**

In `src/components/agentMode/AgentThreadSession.tsx` add after the last import:

```ts
import "./conversation/conversation.css";
import "./conversation/agentWorkRows.css";
```

and change `<div className="agent-session__body">` to `<div className="agent-session__body cv-conversation-column">`.

- [ ] **Step 6: Remove the migrated legacy rules**

In `src/components/agentMode/agentThread.css`:
1. Find each group with `grep -n "^\.agent-session__scroll\|^\.agent-session__body\b\|^\.agent-turn-list\|^\.agent-turn\s*{\|^\.agent-turn,\|^\.agent-prompt\s*{\|^\.agent-prompt,\|^\.agent-prompt__bubble\|^\.agent-prompt__body\|^\.agent-answer\|^\.agent-turn__events" src/components/agentMode/agentThread.css` and delete every rule whose selector list consists only of those selectors (including `:focus-visible`/`:hover` variants of `.agent-prompt__bubble`). A rule that lists one of them together with other selectors keeps the other selectors.
2. In the `.agent-session` rule, set `padding: 0;` (keep every other declaration).

- [ ] **Step 7: Update the legacy style tests**

- `agentThreadStyles.test.ts`: delete the `it` blocks "centres the thread column on the T3 measure", "puts the prompt back in a right-aligned raised bubble capped at 85% of the column", "lets the prompt run to its full length instead of clamping it", "gives every prompt and answer block 30px and every block inside an answer 12px"; in "declares every thread-body selector once, in the thread stylesheet" remove from its selector list every entry of `MIGRATED_SELECTORS` above.
- `agentThreadTurns.test.tsx`: delete the two lines `expect(declaration(".agent-turn-list", "gap"))...` and `expect(declaration(".agent-turn", "gap"))...` (143-144).
- `agentModeResponsiveStyles.test.ts`: in "reflows thread content inside the docked center column" add `const conversationCss = readStyleSheet("components/agentMode/conversation/conversation.css").source;` at the top of the block and pass `conversationCss` as the second argument of `rule(...)` for `.agent-session__scroll`, `.agent-session__body`, `.agent-turn`, `.agent-answer`, `.agent-turn__events`, `.agent-prompt`, `.agent-prompt__body`, `.agent-prompt__bubble`; change `"max-width: 85%"` to `"max-width: 80%"`.

- [ ] **Step 8: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts src/components/agentMode/agentThreadTurns.test.tsx src/components/agentMode/AgentThreadSession.test.tsx`
Expected: PASS.

- [ ] **Step 9: Format new files**

Run: `npx prettier --write src/components/agentMode/conversation/conversation.css src/components/agentMode/conversation/agentWorkRows.css src/components/agentMode/conversation/conversationStyles.test.ts && npm run format:check:changed; echo format=$?`
Expected: `format=0` (prettier-write only a file the check lists).

---
### Task 2: Metadata on hover (user message and answer)

**Files:**
- Create: `src/components/agentMode/conversation/agentTurnMetaLine.ts`
- Create: `src/components/agentMode/conversation/agentTurnMetaLine.test.ts`
- Create: `src/components/agentMode/conversation/AgentTurnMeta.tsx`
- Create: `src/components/agentMode/conversation/AgentTurnMeta.test.tsx`
- Modify: `src/components/agentMode/AgentTurnParts.tsx` (prompt meta row, delete `AgentTurnHead`)
- Modify: `src/components/agentMode/AgentTurnView.tsx` (meta at the end of the answer)
- Modify: `src/components/agentMode/AgentImportedHistory.tsx:9,12,127-128`
- Modify: `src/components/agentMode/conversation/conversation.css`, `conversationStyles.test.ts`
- Modify: `src/components/agentMode/agentThread.css`, `agentTranscript.css` (delete head rules)
- Modify tests: `agentThreadTurns.test.tsx` (4 blocks), `AgentThreadSession.test.tsx` (time + launch assertions), `AgentThreadSession.compaction.test.tsx`, `AgentImportedHistory.test.tsx`, `agentThreadStyles.test.ts`, `agentModeResponsiveStyles.test.ts`

**Interfaces:**
- Consumes: `agentTurnLaunchLabel(launch)` (`agentTurnMetaPresentation.ts`), `agentCliKindLabel`, `agentTurnDurationLabel` (`agentModePresentation.ts`), `agentTurnTiming`, `AGENT_TURN_UNTIMED`, `AgentTurnTiming` (`agentTurnHeadPresentation.ts`), `AgentWorkingDuration` (`agentClock.tsx`).
- Produces:
  - `interface AgentMetaClockTime { readonly label: string; readonly iso: string; readonly title: string }`
  - `agentClockTime(epochMs: number | null, locale?: string): AgentMetaClockTime | null`
  - `agentTurnMetaAgentLabel(provider: AgentCliKind, launch: AgentLaunchOptions | null): string`
  - `agentTurnMetaAt(turn: Pick<AgentTurn, "startedAtEpochMs" | "endedAtEpochMs">): number`
  - `<AgentMetaTime epochMs />`, `<AgentTurnMeta agentLabel atEpochMs timing />`
  - `AgentTurnPromptProps.sentAtEpochMs?: number | null`
  - DOM: `.agent-prompt > .cv-turn-meta.cv-turn-meta--prompt > time.cv-turn-meta__time + .agent-message-actions`; `.agent-answer > .cv-turn-meta > time.cv-turn-meta__time + span.cv-turn-meta__agent + span.cv-turn-meta__duration`. `AgentTurnHead` no longer exists.

- [ ] **Step 1: Write the failing unit tests**

Create `src/components/agentMode/conversation/agentTurnMetaLine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { agentClockTime, agentTurnMetaAgentLabel, agentTurnMetaAt } from "./agentTurnMetaLine";

const EPOCH = Date.UTC(2026, 8, 24, 8, 42, 0);

describe("agentClockTime", () => {
  it("formats a two-digit clock time with a machine-readable instant and a full title", () => {
    const time = agentClockTime(EPOCH, "en-GB");

    expect(time?.label).toMatch(/^\d{2}:\d{2}$/);
    expect(time?.iso).toBe(new Date(EPOCH).toISOString());
    expect(time?.title).toContain("2026");
  });

  it("drops unusable instants instead of throwing", () => {
    expect(agentClockTime(null)).toBeNull();
    expect(agentClockTime(Number.NaN)).toBeNull();
    expect(agentClockTime(Number.POSITIVE_INFINITY)).toBeNull();
    expect(agentClockTime(8_640_000_000_000_001)).toBeNull();
  });
});

describe("agentTurnMetaAgentLabel", () => {
  it("names the model when the launch chose one and the provider otherwise", () => {
    expect(agentTurnMetaAgentLabel("claudeCode", null)).toBe("Claude Code");
    expect(agentTurnMetaAgentLabel("codex", null)).toBe("Codex");
  });
});

describe("agentTurnMetaAt", () => {
  it("stamps an answer with its end and a running answer with its start", () => {
    expect(agentTurnMetaAt({ startedAtEpochMs: 10, endedAtEpochMs: 20 })).toBe(20);
    expect(agentTurnMetaAt({ startedAtEpochMs: 10, endedAtEpochMs: null })).toBe(10);
  });
});
```

Create `src/components/agentMode/conversation/AgentTurnMeta.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_TURN_UNTIMED } from "../agentTurnHeadPresentation";
import { AgentTurnMeta } from "./AgentTurnMeta";
import { agentClockTime } from "./agentTurnMetaLine";

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

describe("AgentTurnMeta", () => {
  it("lists time, agent and settled duration in the mockup order", () => {
    const at = Date.UTC(2026, 8, 24, 8, 42, 0);
    act(() =>
      root.render(
        <AgentTurnMeta
          agentLabel="Opus 5.5"
          atEpochMs={at}
          timing={{ kind: "elapsed", elapsedMs: 98_000 }}
        />,
      ),
    );

    const meta = host.querySelector<HTMLElement>(".cv-turn-meta");
    expect([...(meta?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-turn-meta__time",
      "cv-turn-meta__agent",
      "cv-turn-meta__duration",
    ]);
    expect(meta?.querySelector("time")?.textContent).toBe(agentClockTime(at)?.label);
    expect(meta?.querySelector("time")?.getAttribute("datetime")).toBe(new Date(at).toISOString());
    expect(meta?.querySelector(".cv-turn-meta__agent")?.textContent).toBe("Opus 5.5");
    expect(meta?.querySelector(".cv-turn-meta__duration")?.textContent).toBe("1m 38s");
  });

  it("shows only the agent for an imported answer without time", () => {
    act(() =>
      root.render(
        <AgentTurnMeta agentLabel="Claude Code" atEpochMs={null} timing={AGENT_TURN_UNTIMED} />,
      ),
    );

    const meta = host.querySelector<HTMLElement>(".cv-turn-meta");
    expect([...(meta?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-turn-meta__agent",
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/agentTurnMetaLine.test.ts src/components/agentMode/conversation/AgentTurnMeta.test.tsx`
Expected: FAIL - modules not found.

- [ ] **Step 3: Implement `agentTurnMetaLine.ts`**

```ts
import type { AgentLaunchOptions } from "../../../domain/agentLaunch";
import type { AgentCliKind } from "../../../domain/agentTask";
import type { AgentTurn } from "../../../domain/agentThread";
import { agentCliKindLabel } from "../agentModePresentation";
import { agentTurnLaunchLabel } from "../agentTurnMetaPresentation";

const MAX_TIME_VALUE = 8_640_000_000_000_000;

export interface AgentMetaClockTime {
  readonly label: string;
  readonly iso: string;
  readonly title: string;
}

export function agentClockTime(epochMs: number | null, locale?: string): AgentMetaClockTime | null {
  if (epochMs === null) return null;
  if (!Number.isFinite(epochMs)) return null;
  if (Math.abs(epochMs) > MAX_TIME_VALUE) return null;
  const date = new Date(epochMs);
  return {
    label: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date),
    iso: date.toISOString(),
    title: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date),
  };
}

export function agentTurnMetaAgentLabel(
  provider: AgentCliKind,
  launch: AgentLaunchOptions | null,
): string {
  return agentTurnLaunchLabel(launch) ?? agentCliKindLabel(provider);
}

export function agentTurnMetaAt(turn: Pick<AgentTurn, "startedAtEpochMs" | "endedAtEpochMs">): number {
  return turn.endedAtEpochMs ?? turn.startedAtEpochMs;
}
```

- [ ] **Step 4: Implement `AgentTurnMeta.tsx`**

```tsx
import { AgentWorkingDuration } from "../agentClock";
import { agentTurnDurationLabel } from "../agentModePresentation";
import type { AgentTurnTiming } from "../agentTurnHeadPresentation";
import { agentClockTime } from "./agentTurnMetaLine";

export function AgentMetaTime({ epochMs }: { readonly epochMs: number | null }) {
  const time = agentClockTime(epochMs);
  if (time === null) return null;
  return (
    <time className="cv-turn-meta__time" dateTime={time.iso} title={time.title}>
      {time.label}
    </time>
  );
}

export interface AgentTurnMetaProps {
  readonly agentLabel: string;
  readonly atEpochMs: number | null;
  readonly timing: AgentTurnTiming;
}

export function AgentTurnMeta({ agentLabel, atEpochMs, timing }: AgentTurnMetaProps) {
  return (
    <div className="cv-turn-meta">
      <AgentMetaTime epochMs={atEpochMs} />
      <span className="cv-turn-meta__agent" title={agentLabel}>
        {agentLabel}
      </span>
      <AgentTurnMetaDuration timing={timing} />
    </div>
  );
}

function AgentTurnMetaDuration({ timing }: { readonly timing: AgentTurnTiming }) {
  if (timing.kind === "untimed") return null;
  if (timing.kind === "running") {
    return (
      <span className="cv-turn-meta__duration">
        <AgentWorkingDuration startedAtEpochMs={timing.startedAtEpochMs} />
      </span>
    );
  }
  return <span className="cv-turn-meta__duration">{agentTurnDurationLabel(timing.elapsedMs)}</span>;
}
```

- [ ] **Step 5: Run the unit tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/agentTurnMetaLine.test.ts src/components/agentMode/conversation/AgentTurnMeta.test.tsx`
Expected: PASS.

- [ ] **Step 6: Move the prompt copy control into the hover row and delete the head**

In `src/components/agentMode/AgentTurnParts.tsx`:
1. Remove the imports `AgentRelativeTime, AgentWorkingDuration` (`./agentClock`), `agentCliKindLabel, agentTurnDurationLabel` (`./agentModePresentation`), `AgentCliKind`, `AgentTurnTiming`, the `MAX_TIME_VALUE` constant, `AgentTurnHeadProps`, `AgentTurnHead`, `AgentTurnDuration` and `isoTime`. Add `import { AgentMetaTime } from "./conversation/AgentTurnMeta";`.
2. Add `readonly sentAtEpochMs?: number | null;` to `AgentTurnPromptProps` and `sentAtEpochMs = null,` to the destructuring.
3. Replace the returned JSX of `AgentTurnPrompt` with:

```tsx
    <div
      className={role === "steer" ? "agent-prompt agent-prompt--steered" : "agent-prompt"}
      data-agent-event={eventKey}
    >
      <div className="agent-prompt__bubble" tabIndex={-1}>
        {displayText !== "" && (
          <p className="agent-prompt__body">
            <HighlightRun current={current} query={query} text={displayText} />
          </p>
        )}
        {promptClipped && <p className="agent-note">{AGENT_PROMPT_CLIPPED_NOTICE}</p>}
        <AgentTurnAttachments attachments={attachments} images={attachmentImages} />
      </div>
      <div className="cv-turn-meta cv-turn-meta--prompt">
        <AgentMetaTime epochMs={sentAtEpochMs} />
        <div className="agent-message-actions">
          <AgentMessageCopyButton
            blockedReason={promptClipped ? AGENT_PROMPT_CLIPPED_COPY_BLOCKED : null}
            clipboard={textClipboard}
            label="your message"
            text={prompt}
          />
        </div>
      </div>
    </div>
```

- [ ] **Step 7: Put the answer metadata at the end of the answer**

In `src/components/agentMode/AgentTurnView.tsx`:
1. Replace `import { AgentTurnHead, AgentTurnPrompt } from "./AgentTurnParts";` with `import { AgentTurnPrompt } from "./AgentTurnParts";`, delete `import { agentTurnLaunchLabel } from "./agentTurnMetaPresentation";`, add `import { AgentTurnMeta } from "./conversation/AgentTurnMeta";` and `import { agentTurnMetaAgentLabel, agentTurnMetaAt } from "./conversation/agentTurnMetaLine";`.
2. Delete `const launchLabel = agentTurnLaunchLabel(turn.launch);`.
3. Pass `sentAtEpochMs={turn.startedAtEpochMs}` to `<AgentTurnPrompt>`.
4. Delete the `{!standaloneCompaction && (<AgentTurnHead ... />)}` block.
5. Directly after `{endMarker !== null && <AgentTurnEnd marker={endMarker} />}` add:

```tsx
          {!standaloneCompaction && (
            <AgentTurnMeta
              agentLabel={agentTurnMetaAgentLabel(provider, turn.launch)}
              atEpochMs={agentTurnMetaAt(turn)}
              timing={agentTurnTiming(turn)}
            />
          )}
```

In `src/components/agentMode/AgentImportedHistory.tsx`: replace `import { AgentTurnHead, AgentTurnPrompt } from "./AgentTurnParts";` with `import { AgentTurnPrompt } from "./AgentTurnParts";`, add `import { AgentTurnMeta } from "./conversation/AgentTurnMeta";` and `import { agentCliKindLabel } from "./agentModePresentation";` (skip if already imported), delete the `<AgentTurnHead provider={provider} startedAtEpochMs={null} timing={AGENT_TURN_UNTIMED} />` line and add as the last child of that `<div className="agent-answer">`:

```tsx
        <AgentTurnMeta
          agentLabel={agentCliKindLabel(provider)}
          atEpochMs={null}
          timing={AGENT_TURN_UNTIMED}
        />
```

- [ ] **Step 8: Style the hover rows**

Append to `src/components/agentMode/conversation/conversation.css`:

```css
.cv-turn-meta {
  display: flex;
  align-items: center;
  gap: var(--cv-space-4);
  min-width: 0;
  max-width: 100%;
  height: 20px;
  color: var(--cv-fg-subtle);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity var(--cv-motion-slow) var(--cv-ease);
}

.agent-answer > .cv-turn-meta {
  margin-top: var(--cv-space-3);
}

.agent-prompt:hover > .cv-turn-meta,
.agent-prompt:focus-within > .cv-turn-meta,
.agent-answer:hover > .cv-turn-meta,
.agent-answer:focus-within > .cv-turn-meta {
  opacity: 1;
}

.cv-turn-meta__agent {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-turn-meta__time,
.cv-turn-meta__duration {
  flex: none;
}

.cv-turn-meta__time + .cv-turn-meta__agent::before,
.cv-turn-meta__agent + .cv-turn-meta__duration::before {
  content: "·";
  margin-right: var(--cv-space-4);
}

.cv-turn-meta .agent-message-actions {
  display: flex;
}

.cv-turn-meta .agent-message-copy {
  opacity: 1;
}
```

Append to `conversationStyles.test.ts` inside the `describe`:

```ts
  it("shows turn metadata only on hover or focus", () => {
    expect(declaredValue(CONVERSATION, ".cv-turn-meta", "opacity")).toBe("0");
    expect(declaredValue(CONVERSATION, ".cv-turn-meta", "height")).toBe("20px");
    expect(declaredValue(CONVERSATION, ".agent-prompt:hover > .cv-turn-meta", "opacity")).toBe("1");
    expect(declaredValue(CONVERSATION, ".agent-answer:focus-within > .cv-turn-meta", "opacity")).toBe(
      "1",
    );
    expect(declaredValue(CONVERSATION, ".cv-turn-meta__agent", "text-overflow")).toBe("ellipsis");
  });
```

- [ ] **Step 9: Delete the head styles and update the legacy tests**

1. `agentThread.css`: delete the rules for `.agent-turn__head`, `.agent-turn__spark`, `.agent-turn__agent`, `.agent-turn__time`, `.agent-turn__duration` (find them with `grep -n "agent-turn__head\|agent-turn__spark\|agent-turn__agent\|agent-turn__time\|agent-turn__duration" src/components/agentMode/agentThread.css`). `agentTranscript.css`: delete every `.agent-turn__launch` rule.
2. `agentThreadStyles.test.ts`: delete the blocks "sets the prompt and the turn head from the type ladder", "marks the turn head with an accent dot and pushes the duration to the far end", "reveals the prompt copy control on hover or focus like the other messages".
3. `agentModeResponsiveStyles.test.ts`, block "reflows thread content inside the docked center column": replace the two lines for `.agent-turn__head` / `.agent-turn__agent` with
   `expect(rule(".cv-turn-meta", conversationCss)).toContain("min-width: 0");` and `expect(rule(".cv-turn-meta__agent", conversationCss)).toContain("text-overflow: ellipsis");`.
4. `agentThreadTurns.test.tsx`: in "gives every turn a right-aligned prompt bubble and an answer under its own head" replace the two `header.agent-turn__head` expectations with
   `expect(section.querySelectorAll(".agent-answer > .cv-turn-meta")).toHaveLength(1);`. Replace the three tests "shows the accent dot, the provider and the settled duration in the turn head", "drops the machine-readable time rather than throwing on an unusable timestamp", "keeps a running head counting and drops the duration when the end is unknown" and "leaves an imported head without a time or a duration rather than an empty slot" with:

```tsx
  it("shows the clock time, the provider and the settled duration in the hover row", () => {
    render({ thread: threadView([turn("t1", "First question", SETTLED, [text("alpha")])]) });

    const meta = host.querySelector<HTMLElement>(".agent-answer > .cv-turn-meta");
    expect([...(meta?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-turn-meta__time",
      "cv-turn-meta__agent",
      "cv-turn-meta__duration",
    ]);
    expect(meta?.querySelector(".cv-turn-meta__agent")?.textContent).toBe("Claude Code");
    expect(meta?.querySelector("time")?.getAttribute("datetime")).toMatch(/Z$/);
    expect(meta?.querySelector(".cv-turn-meta__duration")?.textContent).toBe("4m 30s");
  });

  it("drops the time rather than throwing on an unusable timestamp", () => {
    render({
      thread: threadView([
        {
          ...turn("t1", "First question", SETTLED, [text("alpha")]),
          startedAtEpochMs: Number.NaN,
          endedAtEpochMs: null,
        },
      ]),
    });

    expect(host.querySelector(".agent-answer > .cv-turn-meta time")).toBeNull();
    expect(host.querySelector(".cv-turn-meta__agent")?.textContent).toBe("Claude Code");
  });

  it("keeps a running answer counting and drops the duration when the end is unknown", () => {
    render({ thread: threadView([turn("t1", "First question", RUNNING, [text("alpha")])]) });
    expect(host.querySelector(".cv-turn-meta__duration")).not.toBeNull();

    render({
      thread: threadView([
        { ...turn("t1", "First question", SETTLED, [text("alpha")]), endedAtEpochMs: null },
      ]),
    });

    expect(host.querySelector(".cv-turn-meta__duration")).toBeNull();
    expect(host.querySelector(".agent-answer > .cv-turn-meta time")).not.toBeNull();
  });

  it("leaves an imported answer with only its agent in the hover row", () => {
    render({
      thread: threadView([], {
        exchanges: [
          { role: "user", text: "Original question" },
          { role: "assistant", text: "Original answer" },
        ],
      }),
    });

    const meta = host.querySelector<HTMLElement>(".agent-imported-history .agent-answer > .cv-turn-meta");
    expect([...(meta?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-turn-meta__agent",
    ]);
    expect(meta?.textContent).toBe("Claude Code");
  });
```

5. Everywhere else, apply this selector map and fix the expectation text accordingly (find with `grep -rn "agent-turn__head\|agent-turn__agent\|agent-turn__launch\|agent-turn__duration\|agent-turn__time\|agent-turn__spark" src/components/agentMode/*.test.ts*`):

| Old | New | Expectation change |
|---|---|---|
| `header.agent-turn__head` | `.agent-answer > .cv-turn-meta` | presence/absence unchanged |
| `header.agent-turn__head time` | `.agent-answer > .cv-turn-meta time` | text `"5 minutes ago"` → `agentClockTime(<same epoch>)?.label` (import from `./conversation/agentTurnMetaLine`) |
| `.agent-turn__launch` | `.cv-turn-meta__agent` | same regexes (`/Sonnet.* · Low effort$/`, `/Opus/`, `/GPT/i`) |
| `.agent-turn__agent` | `.cv-turn-meta__agent` | same text |
| `.agent-turn__duration` | `.cv-turn-meta__duration` | same text |
| `.agent-turn__spark` | (delete the assertion) | - |

- [ ] **Step 10: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/agentThreadTurns.test.tsx src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/AgentThreadSession.compaction.test.tsx src/components/agentMode/AgentImportedHistory.test.tsx src/components/agentMode/AgentTurnAttachments.test.tsx src/components/agentMode/AgentThreadSession.promptClipped.test.tsx src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts`
Expected: PASS. `grep -rn "AgentTurnHead" src` returns nothing.

---

### Task 3: Work rows, thought rows and live rows

**Files:**
- Create: `src/components/agentMode/conversation/AgentLiveRow.tsx`
- Create: `src/components/agentMode/conversation/AgentLiveRow.test.tsx`
- Create: `src/components/agentMode/conversation/AgentTurnWork.tsx` (extracted from `AgentTurnView.tsx:450-570`)
- Modify: `src/components/agentMode/AgentTurnView.tsx` (use extracted work + live row)
- Modify: `src/components/agentMode/agentActivityGrouping.ts` (+ `agentActivityGrouping.test.ts`)
- Modify: `src/components/agentMode/AgentActivityItems.tsx`, `AgentToolRow.tsx`, `AgentThought.tsx`, `AgentBackgroundActivity.tsx`
- Modify: `src/components/agentMode/agentToolRows.css` (rewrite), `conversation/agentWorkRows.css`, `conversationStyles.test.ts`
- Delete: `src/components/agentMode/agentThought.css`, `src/components/agentMode/agentActivityGroups.css`, `src/components/agentMode/agentToolRowsStyles.test.ts`
- Modify tests: `AgentThreadSession.test.tsx` (`.agent-work__counts`), `AgentThreadSession.background.test.tsx`, `AgentThreadSession.thoughts.test.tsx`, `AgentBackgroundActivity.test.tsx`, `agentThreadStyles.test.ts`

**Interfaces:**
- Consumes: `agentActivityEntries`, `AgentActivityEntry` (`agentActivityGrouping.ts`), `isAgentSubagentToolItem` (`agentModePresentation.ts`), `cx` (`src/ui/foundation/classNames.ts`), `AgentBackgroundIndicator`.
- Produces:
  - `agentWorkFoldLabel(items: ReadonlyArray<AgentTurnItem>, summary: string): string`
  - `type AgentLiveRowTone = "thinking" | "working" | "agents" | "approval" | "input"`; `<AgentLiveRow tone label icon? onActivate? activateLabel? className? />`
  - `toolRowIcon(kind: AgentToolRowKind): LucideIcon` exported from `AgentToolRow.tsx`
  - `<AgentTurnWork ... label meta />` in `conversation/AgentTurnWork.tsx` with the same props as today's inner `AgentTurnWork` plus `readonly label: string` (settled title) and `readonly meta: string | null` (hover duration); `savedToolSettlement(status)` exported from the same file.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/agentMode/agentActivityGrouping.test.ts` (reuse its `activityTool`, `read`, `thought` helpers; add `agentWorkFoldLabel` to the import list):

```ts
describe("agentWorkFoldLabel", () => {
  it("names a fold holding one command run like t3code", () => {
    expect(
      agentWorkFoldLabel([activityTool(0), activityTool(1), activityTool(2)], "3 commands"),
    ).toBe("Ran 3 commands");
  });

  it("keeps the tally when the fold holds more than one run", () => {
    const items = [
      activityTool(0),
      { kind: "assistantText" as const, key: "e1", text: "Next", paragraphs: ["Next"] },
      read(2),
    ];
    expect(agentWorkFoldLabel(items, "1 command · 1 update · 1 file read")).toBe(
      "1 command · 1 update · 1 file read",
    );
  });

  it("keeps the tally for a thought-only fold", () => {
    expect(agentWorkFoldLabel([thought(0)], "Activity")).toBe("Activity");
  });
});
```

Create `src/components/agentMode/conversation/AgentLiveRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLiveRow } from "./AgentLiveRow";

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

describe("AgentLiveRow", () => {
  it("pulses a thinking row and announces it politely", () => {
    act(() => root.render(<AgentLiveRow label="Thinking" tone="thinking" />));

    const row = host.querySelector<HTMLElement>(".cv-live-row");
    expect(row?.className).toBe("cv-live-row cv-live-row--pulse");
    expect(row?.getAttribute("role")).toBe("status");
    expect(row?.getAttribute("aria-live")).toBe("polite");
    expect(row?.querySelector(".cv-live-row__icon svg")).not.toBeNull();
    expect(row?.querySelector(".cv-live-row__label")?.textContent).toBe("Thinking");
  });

  it("marks an approval wait with the warning tone and no pulse", () => {
    act(() => root.render(<AgentLiveRow label="Waiting for approval" tone="approval" />));

    expect(host.querySelector(".cv-live-row")?.className).toBe("cv-live-row cv-live-row--warn");
  });

  it("opens the agents panel from an agents row", () => {
    const open = vi.fn();
    act(() =>
      root.render(
        <AgentLiveRow
          activateLabel="2 agents working. Open Agents panel"
          label="Waiting for 2 agents"
          onActivate={open}
          tone="agents"
        />,
      ),
    );

    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="2 agents working. Open Agents panel"]',
    );
    act(() => button?.click());
    expect(open).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/agentActivityGrouping.test.ts src/components/agentMode/conversation/AgentLiveRow.test.tsx`
Expected: FAIL - `agentWorkFoldLabel` is not exported; `./AgentLiveRow` not found.

- [ ] **Step 3: Implement `agentWorkFoldLabel`**

Append to `src/components/agentMode/agentActivityGrouping.ts`:

```ts
type AgentActivityGroupEntry = Extract<AgentActivityEntry, { kind: "group" }>;

function isGroupEntry(entry: AgentActivityEntry): entry is AgentActivityGroupEntry {
  return entry.kind === "group";
}

function isLooseTool(entry: AgentActivityEntry): boolean {
  if (entry.kind !== "item") return false;
  if (entry.item.kind !== "tool") return false;
  return !isAgentSubagentToolItem(entry.item);
}

export function agentWorkFoldLabel(items: ReadonlyArray<AgentTurnItem>, summary: string): string {
  const entries = agentActivityEntries(items, "settled");
  const groups = entries.filter(isGroupEntry);
  if (groups.length !== 1) return summary;
  if (entries.some(isLooseTool)) return summary;
  const [group] = groups;
  if (group === undefined) return summary;
  if (group.tools === 0) return summary;
  if (entries.some((entry) => entry.kind === "item" && entry.item.kind === "assistantText"))
    return summary;
  return group.label;
}
```

- [ ] **Step 4: Implement `AgentLiveRow.tsx`**

```tsx
import type { ReactNode } from "react";
import { AlertTriangle, Brain, Users } from "lucide-react";
import { cx } from "../../../ui/foundation/classNames";

export type AgentLiveRowTone = "thinking" | "working" | "agents" | "approval" | "input";

export interface AgentLiveRowProps {
  readonly tone: AgentLiveRowTone;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly activateLabel?: string;
  readonly onActivate?: () => void;
}

export function AgentLiveRow({
  activateLabel,
  className,
  icon,
  label,
  onActivate,
  tone,
}: AgentLiveRowProps) {
  const classes = cx(
    "cv-live-row",
    livePulse(tone) && "cv-live-row--pulse",
    liveWarn(tone) && "cv-live-row--warn",
    className,
  );
  const content = (
    <>
      <span aria-hidden="true" className="cv-live-row__icon">
        {icon ?? <LiveRowIcon tone={tone} />}
      </span>
      <span className="cv-live-row__label">{label}</span>
    </>
  );
  if (onActivate === undefined) {
    return (
      <div aria-live="polite" className={classes} role="status">
        {content}
      </div>
    );
  }
  return (
    <div aria-live="polite" className={classes} role="status">
      <button
        aria-label={activateLabel ?? label}
        className="cv-live-row__action"
        onClick={onActivate}
        type="button"
      >
        {content}
      </button>
    </div>
  );
}

function livePulse(tone: AgentLiveRowTone): boolean {
  switch (tone) {
    case "thinking":
    case "working":
    case "agents":
      return true;
    case "approval":
    case "input":
      return false;
    default:
      return unsupportedTone(tone);
  }
}

function liveWarn(tone: AgentLiveRowTone): boolean {
  return tone === "approval" || tone === "input";
}

function LiveRowIcon({ tone }: { readonly tone: AgentLiveRowTone }) {
  switch (tone) {
    case "thinking":
    case "working":
      return <Brain size={16} strokeWidth={1.5} />;
    case "agents":
      return <Users size={16} strokeWidth={1.5} />;
    case "approval":
    case "input":
      return <AlertTriangle size={16} strokeWidth={1.5} />;
    default:
      return unsupportedTone(tone);
  }
}

function unsupportedTone(tone: never): never {
  throw new TypeError(`Unsupported live row tone: ${String(tone)}.`);
}
```

- [ ] **Step 5: Run the new tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/agentActivityGrouping.test.ts src/components/agentMode/conversation/AgentLiveRow.test.tsx`
Expected: PASS.

- [ ] **Step 6: Extract the work fold and restyle its summary row**

Create `src/components/agentMode/conversation/AgentTurnWork.tsx` by MOVING from `AgentTurnView.tsx` the functions `AgentTurnWork`, `AgentTurnWorkTitle` and `savedToolSettlement` (export `AgentTurnWork` and `savedToolSettlement`; fix relative imports with `../`). Change `AgentTurnWork`:
1. Replace the `summary: string` prop by `label: string` and `meta: string | null`; delete the `attention` local and the `agent-work__counts` text.
2. Replace the `<summary>` element with:

```tsx
      <summary
        className="agent-work__summary cv-work-row"
        onClick={(event) => {
          const disclosure = event.currentTarget.parentElement;
          if (disclosure instanceof HTMLDetailsElement && !disclosure.open) historyWork.open();
        }}
      >
        <span className="agent-work__title cv-work-row__label">
          <AgentTurnWorkTitle
            backgroundTitle={backgroundTitle}
            compacting={compacting}
            label={label}
            running={running}
            turn={turn}
          />
        </span>
        <ChevronRight aria-hidden="true" className="agent-work__chevron cv-work-row__chevron" size={14} />
        {meta !== null && <span className="agent-work__counts cv-work-row__meta">{meta}</span>}
      </summary>
```

3. `AgentTurnWorkTitle` gets a `label: string` prop and its settled branch returns `<>{label}</>` instead of "Worked for …" (the running and background branches stay).

In `AgentTurnView.tsx` import `{ AgentTurnWork, savedToolSettlement } from "./conversation/AgentTurnWork"` and `agentWorkFoldLabel` from `./agentActivityGrouping`, and pass to `<AgentTurnWork>`:

```tsx
                label={workFoldTitle(
                  agentWorkFoldLabel(
                    savedItems ?? workFold?.workItems ?? [],
                    agentPartialWorkSummary(
                      workFold?.summary ?? "Activity",
                      historyWork.turn === null ? projection.hiddenCount : 0,
                    ),
                  ),
                  agentActivityAttentionCount(workFold?.workItems ?? []),
                )}
                meta={
                  foregroundRunning
                    ? null
                    : agentTurnDurationLabel(
                        (turn.endedAtEpochMs ?? turn.startedAtEpochMs) - turn.startedAtEpochMs,
                      )
                }
```

and add at the bottom of `AgentTurnView.tsx`:

```ts
function workFoldTitle(label: string, attention: number): string {
  if (attention === 0) return label;
  return `${label} · ${attention} need attention`;
}
```

- [ ] **Step 7: Replace the live status with `AgentLiveRow`**

In `AgentTurnView.tsx` replace the body of `AgentTurnLiveStatus` with:

```tsx
  const working = activity.kind === "working";
  const thinking = working && items[items.length - 1]?.kind === "reasoning";
  const live = working
    ? undefined
    : items.find((item) => item.kind === "tool" && item.toolId === activity.toolId);
  const Icon = live !== undefined && live.kind === "tool" ? toolRowIcon(live.rowKind) : null;
  return (
    <AgentLiveRow
      className={working ? "agent-tool-row--working" : "agent-tool-row-live"}
      icon={Icon === null ? undefined : <Icon size={16} strokeWidth={1.5} />}
      label={thinking ? "Thinking" : liveStatusText(activity, items)}
      tone={thinking ? "thinking" : "working"}
    />
  );
```

and import `AgentLiveRow` from `./conversation/AgentLiveRow` and `toolRowIcon` from `./AgentToolRow` (export `toolRowIcon` there by adding `export` to its declaration).

- [ ] **Step 8: Rows use the shared vocabulary**

1. `AgentActivityItems.tsx`: replace `ChevronDown` with `ChevronRight` in the import; delete `import "./agentActivityGroups.css";`; render the group toggle as:

```tsx
      <button
        className="cv-work-row agent-activity-group__toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={disclosure.toggle}
      >
        <span aria-hidden="true" className="cv-work-row__icon">
          <Icon size={16} strokeWidth={1.5} />
        </span>
        <span
          className={
            group.phase === "thinking"
              ? "agent-activity-group__label agent-activity-group__label--live cv-work-row__label"
              : "agent-activity-group__label cv-work-row__label"
          }
        >
          {group.label}
        </span>
        <ChevronRight aria-hidden="true" className="agent-activity-group__chevron cv-work-row__chevron" size={14} />
        <span className="agent-activity-group__status cv-work-row__meta">
          {group.running > 0
            ? `${group.running} running`
            : group.completed > 0
              ? `${group.completed} completed`
              : null}
        </span>
      </button>
```

2. `AgentToolRow.tsx`: export `toolRowIcon`; `toolRowClassName` returns the same names prefixed with `"cv-work-row "` (for example `"cv-work-row agent-tool-row agent-tool-row--running"`); render the icon as `<span aria-hidden="true" className="cv-work-row__icon"><Icon className="agent-tool-row__icon" size={16} strokeWidth={1.5} /></span>` and the label as `<span className="agent-tool-row__label cv-work-row__label">`.
3. `AgentThought.tsx`: delete `import "./agentThought.css";`; replace `ChevronDown` with `ChevronRight`; on the row toggle replace the class `agent-tool-row` by `cv-work-row` (keep `agent-thought__toggle`), wrap the `Brain` icon as `<span aria-hidden="true" className="cv-work-row__icon"><Brain size={16} strokeWidth={1.5} /></span>`, add `cv-work-row__chevron` to the chevron's class and `cv-work-row__label` to `.agent-thought__preview`.
4. `AgentBackgroundActivity.tsx`: delete `import "./agentSubagents.css";` and the `Bot`, `ChevronRight` imports; the `agents` branch returns

```tsx
    return (
      <AgentLiveRow
        activateLabel={`${indicator.label}. Open Agents panel`}
        label={indicator.label}
        onActivate={onOpenAgents}
        tone="agents"
      />
    );
```

   and the `tasks` branch renders `<details className="agent-background-activity cv-work-disclosure">` whose `<summary className="cv-work-row">` wraps the icon in `<span aria-hidden="true" className="cv-work-row__icon">` and the label span gets `className="cv-work-row__label"`, the count `className="agent-background-activity__count cv-work-row__meta"`; the `<ul>` gets `className="agent-background-activity__tasks"`.

- [ ] **Step 9: Move the row styles into the P3 sheets**

Append to `conversation/agentWorkRows.css`:

```css
.agent-work {
  min-width: 0;
  margin-bottom: var(--cv-space-4);
}

.agent-work__summary {
  padding: var(--cv-space-2) var(--cv-space-1) var(--cv-space-4);
  border-bottom: 1px solid var(--cv-hair);
  border-radius: 0;
  list-style: none;
}

.agent-work__summary::-webkit-details-marker {
  display: none;
}

.agent-work[open] > .agent-work__summary .cv-work-row__chevron {
  transform: rotate(90deg);
}

.agent-work__events {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  padding-top: var(--cv-space-2);
}

.agent-activity-group {
  min-width: 0;
}

.agent-activity-group__label--live,
.agent-thought--live .agent-thought__label,
.agent-tool-row--running .agent-tool-row__label {
  animation: cv-live-pulse calc(var(--cv-motion-spin) * 2) steps(6) infinite;
}

.agent-activity-group__items,
.agent-activity-group__live {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  padding-left: var(--cv-space-5);
}

.agent-activity-group__pages {
  display: flex;
  align-items: center;
  gap: var(--cv-space-4);
  padding: var(--cv-space-2) 0 var(--cv-space-2) 30px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
}

.agent-activity-group__pages button {
  height: 24px;
  padding: 0 var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-muted);
  font: inherit;
  cursor: pointer;
}

.agent-activity-group__pages button:hover:not(:disabled) {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.agent-activity-group__pages button:disabled {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.agent-thought {
  min-width: 0;
}

.agent-thought__label {
  flex: none;
}

.agent-thought__panel,
.agent-thought--body {
  min-width: 0;
  padding: var(--cv-space-1) 0 var(--cv-space-4) 30px;
}

.agent-thought__body {
  color: var(--cv-fg-muted);
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
  line-height: var(--cv-lh-prose);
  overflow-wrap: anywhere;
}

.cv-live-row__action {
  display: flex;
  align-items: center;
  gap: var(--cv-space-3);
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.cv-live-row__action:hover {
  color: var(--cv-fg-strong);
}

.cv-work-disclosure > summary {
  list-style: none;
}

.cv-work-disclosure > summary::-webkit-details-marker {
  display: none;
}

.agent-background-activity__tasks {
  margin: 0;
  padding: 0 0 var(--cv-space-4) 30px;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  list-style: none;
}

@media (prefers-reduced-motion: reduce) {
  .agent-activity-group__label--live,
  .agent-thought--live .agent-thought__label,
  .agent-tool-row--running .agent-tool-row__label {
    animation: none;
  }
}
```

Replace the whole content of `src/components/agentMode/agentToolRows.css` with:

```css
.agent-tool-row__argument {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-tool-row--failed {
  color: var(--cv-danger);
}

.agent-tool-row--stopped,
.agent-tool-row--interrupted {
  color: var(--cv-fg-subtle);
  text-decoration: line-through;
  text-decoration-color: var(--cv-hair-strong);
}

.agent-tool-row__detail {
  display: grid;
  gap: var(--cv-space-2);
  min-width: 0;
  margin: var(--cv-space-1) 0 var(--cv-space-4) 30px;
}

.agent-tool-row__command,
.agent-tool-row__output {
  max-height: 320px;
  margin: 0;
  padding: var(--cv-space-4) var(--cv-space-5);
  overflow: auto;
  border-radius: var(--cv-r-card);
  background: var(--cv-tint-1);
  color: var(--cv-fg);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
  line-height: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-tool-row__empty {
  margin: 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}
```

Delete `src/components/agentMode/agentThought.css`, `src/components/agentMode/agentActivityGroups.css` and `src/components/agentMode/agentToolRowsStyles.test.ts`. In `agentThread.css` delete the rule groups `.agent-work`, `.agent-work__summary`, `.agent-work__title`, `.agent-work__counts`, `.agent-work__chevron`, `.agent-work__events` (find with `grep -n "agent-work" src/components/agentMode/agentThread.css`) and `.agent-background-activity*`. In `agentThreadStyles.test.ts` delete "keeps tool rows, subagent rows and the work fold boxless with a hover-only radius" and "keeps the work fold legible on light themes", and remove `.agent-work`, `.agent-work__summary` from the "declares every thread-body selector once" list.

Extend `P3_SHEETS` in `conversationStyles.test.ts` with `"components/agentMode/agentToolRows.css"` (constant `TOOL_ROWS`) and add:

```ts
  it("draws the work fold as the t3code fold row", () => {
    expect(declaredValue(WORK_ROWS, ".agent-work__summary", "border-bottom")).toBe(
      "1px solid var(--cv-hair)",
    );
    expect(declaredValue(WORK_ROWS, ".agent-work__summary", "padding")).toBe(
      "var(--cv-space-2) var(--cv-space-1) var(--cv-space-4)",
    );
    expect(declaredValue(WORK_ROWS, ".agent-work", "margin-bottom")).toBe("var(--cv-space-4)");
    expect(declaredValue(TOOL_ROWS, ".agent-tool-row--failed", "color")).toBe("var(--cv-danger)");
    expect(declaredValue(TOOL_ROWS, ".agent-tool-row__output", "white-space")).toBe("pre-wrap");
    expect(declaredValue(TOOL_ROWS, ".agent-tool-row__output", "overflow")).toBe("auto");
  });
```

- [ ] **Step 10: Update the behavior tests to the new structure**

Find: `grep -rn "agent-work__counts\|Worked for\|agent-background-row\|agent-tool-row__icon\|agent-thought__chevron\|agent-activity-group__chevron" src/components/agentMode/*.test.ts*`
- `.agent-work__counts` text assertions (AgentThreadSession.test.tsx ~530, ~593) now read `.agent-work__title` for the summary text (for example `"3 commands · 1 update"` stays the same string when the fold holds more than one run; a single command run now reads `"Ran N commands"`), and `.agent-work__counts` holds only the duration (for example `"4m 30s"`).
- `AgentBackgroundActivity.test.tsx`: the button is still found by aria-label `"1 agent working. Open Agents panel"`; replace `.agent-background-row*` selectors by `.cv-live-row` / `.cv-live-row__label`.
- `.agent-tool-row__icon` stays on the svg inside `.cv-work-row__icon`.

- [ ] **Step 11: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/agentActivityGrouping.test.ts src/components/agentMode/AgentActivityItems.test.tsx src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/AgentThreadSession.background.test.tsx src/components/agentMode/AgentThreadSession.thoughts.test.tsx src/components/agentMode/AgentThreadSession.groupingRemote.test.tsx src/components/agentMode/AgentThreadSession.hydration.test.tsx src/components/agentMode/AgentBackgroundActivity.test.tsx src/components/agentMode/agentThreadTurns.test.tsx src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/agentSubagentsStyles.test.ts`
Expected: PASS.

---
### Task 4: Assistant prose, markdown, code blocks, notes and end marks

**Files:**
- Create: `src/components/agentMode/conversation/agentProse.css`
- Modify: `src/components/agentMode/AgentThreadSession.tsx` (import the sheet)
- Modify: `src/components/agentMode/agentThread.css`, `agentTranscript.css` (delete migrated groups)
- Modify: `conversation/conversationStyles.test.ts`, `agentThreadStyles.test.ts`, `agentModeResponsiveStyles.test.ts`

**Interfaces:**
- Consumes: DOM classes rendered today by `AgentAssistantText.tsx`, `AgentMarkdown.tsx`, `AgentMarkdownCodeBlock.tsx`, `AgentMarkdownCodeBody.tsx`, `AgentMessageCopyButton.tsx`, `AgentTurnItemView.tsx` (`agent-finale*`, `agent-microlabel*`, `agent-note`), `AgentTurnView.tsx` (`agent-raw*`, `agent-turn-end*`), `AgentCompactionActivity.tsx` (`agent-compaction-*`). No TSX change in this task.
- Produces: the prose sheet; the code-block action bar floats top-right and appears on hover/focus (mockup `.code .copy`); the language label is visually hidden (the copy button keeps it in its accessible name "Copy ts code block").

- [ ] **Step 1: Write the failing contract assertions**

In `conversationStyles.test.ts` add `const PROSE = "components/agentMode/conversation/agentProse.css";`, append `PROSE` to `P3_SHEETS`, append these selectors to `MIGRATED_SELECTORS`: `".agent-text"`, `".agent-text__paragraph"`, `".agent-md__code"`, `".agent-md__code-body"`, `".agent-md__inline-code"`, `".agent-note"`, `".agent-finale"`, `".agent-raw"`, `".agent-message-actions"`, `".agent-message-copy"`, and add:

```ts
  it("sets assistant prose and markdown like the mockup", () => {
    expect(declaredValue(PROSE, ".agent-text", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(PROSE, ".agent-text", "line-height")).toBe("var(--cv-lh-prose)");
    expect(declaredValue(PROSE, ".agent-text__paragraph", "margin")).toBe("0 0 10px");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "padding")).toBe("1.5px 5px");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "border")).toBe("1px solid var(--cv-hair)");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "background")).toBe("var(--cv-tint-1)");
    expect(declaredValue(PROSE, ".agent-md__path-link", "background")).toBe("var(--cv-accent-soft)");
    expect(declaredValue(PROSE, ".agent-md__path-link", "color")).toBe("var(--cv-accent)");
    expect(declaredValue(PROSE, ".agent-md__path-link", "text-overflow")).toBe("ellipsis");
  });

  it("puts code on one quiet slab with actions only on hover", () => {
    expect(declaredValue(PROSE, ".agent-md__code", "border-radius")).toBe("var(--cv-r-card)");
    expect(declaredValue(PROSE, ".agent-md__code", "background")).toBe("var(--cv-tint-1)");
    expect(declaredValue(PROSE, ".agent-md__code-body", "padding")).toBe("12.8px 14.4px");
    expect(declaredValue(PROSE, ".agent-md__code-body", "overflow-x")).toBe("auto");
    expect(declaredValue(PROSE, ".agent-md__code-body", "white-space")).toBe("pre-wrap");
    expect(declaredValue(PROSE, ".agent-md__code-bar", "opacity")).toBe("0");
    expect(declaredValue(PROSE, ".agent-md__code:hover .agent-md__code-bar", "opacity")).toBe("1");
    expect(declaredValue(PROSE, ".agent-md__table-scroll", "overflow-x")).toBe("auto");
    expect(declaredValue(PROSE, ".agent-raw__lines", "overflow")).toBe("auto");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/conversationStyles.test.ts`
Expected: FAIL - `agentProse.css` missing.

- [ ] **Step 3: Create `conversation/agentProse.css`**

```css
.agent-text {
  min-width: 0;
  color: var(--cv-fg);
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
  line-height: var(--cv-lh-prose);
  overflow-wrap: anywhere;
}

.agent-text > :first-child {
  margin-top: 0;
}

.agent-text > :last-child {
  margin-bottom: 0;
}

.agent-text__paragraph {
  margin: 0 0 10px;
}

.agent-md__heading {
  margin: var(--cv-space-6) 0 var(--cv-space-4);
  color: var(--cv-fg-strong);
  font-weight: 600;
  line-height: 1.35;
}

.agent-md__heading--h1 {
  font-size: calc(var(--cv-t-title) * var(--codevo-fs-scale, 1));
}

.agent-md__heading--h2 {
  font-size: calc(var(--cv-t-lg) * var(--codevo-fs-scale, 1));
}

.agent-md__heading--h3,
.agent-md__heading--h4,
.agent-md__heading--h5,
.agent-md__heading--h6 {
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
}

.agent-md__list {
  margin: 0 0 10px;
  padding-left: 22px;
}

.agent-md__item {
  margin: var(--cv-space-1) 0;
}

.agent-md__item::marker {
  color: var(--cv-fg-subtle);
}

.agent-md__quote {
  margin: 0 0 10px;
  padding-left: var(--cv-space-5);
  border-left: 2px solid var(--cv-hair-strong);
  color: var(--cv-fg-muted);
}

.agent-md__table-scroll {
  max-width: 100%;
  margin: 0 0 10px;
  overflow-x: auto;
}

.agent-md__table {
  border-collapse: collapse;
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
}

.agent-md__th,
.agent-md__td {
  padding: var(--cv-space-3) 10px;
  border-bottom: 1px solid var(--cv-hair);
  text-align: left;
  vertical-align: top;
}

.agent-md__th {
  color: var(--cv-fg-strong);
  font-weight: 600;
}

.agent-md__checkbox {
  margin: 0 var(--cv-space-3) 0 0;
  accent-color: var(--cv-accent-fill);
}

.agent-md__rule {
  height: 1px;
  margin: var(--cv-space-6) 0;
  border: 0;
  background: var(--cv-hair);
}

.agent-md__inline-code {
  padding: 1.5px 5px;
  border: 1px solid var(--cv-hair);
  border-radius: var(--cv-r-sm);
  background: var(--cv-tint-1);
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-mono);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-md__link {
  color: var(--cv-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agent-md__path-link {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-2);
  max-width: 100%;
  min-height: 18px;
  padding: 0 6px;
  overflow: hidden;
  border-radius: var(--cv-r-sm);
  background: var(--cv-accent-soft);
  color: var(--cv-accent);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  font-weight: 500;
  text-decoration: none;
  text-overflow: ellipsis;
  vertical-align: 1px;
  white-space: nowrap;
}

.agent-md__path-link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agent-md__image {
  max-width: 100%;
  border-radius: var(--cv-r-card);
}

.agent-md__note {
  margin: var(--cv-space-2) 0 0;
}

.agent-md__code {
  position: relative;
  display: grid;
  min-width: 0;
  max-width: 100%;
  margin: 10px 0;
  border-radius: var(--cv-r-card);
  background: var(--cv-tint-1);
}

.agent-md__code-bar {
  position: absolute;
  top: var(--cv-space-4);
  right: var(--cv-space-4);
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity var(--cv-motion-base) var(--cv-ease);
}

.agent-md__code:hover .agent-md__code-bar,
.agent-md__code:focus-within .agent-md__code-bar {
  opacity: 1;
}

.agent-md__code-lang {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.agent-md__code-actions {
  display: flex;
  align-items: center;
  gap: var(--cv-space-1);
  padding: var(--cv-space-1);
  border-radius: var(--cv-r-control);
  background: var(--cv-raised);
  box-shadow: var(--cv-ring-hair);
}

.agent-md__code-body {
  min-width: 0;
  margin: 0;
  padding: 12.8px 14.4px;
  overflow-x: auto;
  color: var(--cv-fg);
  font-family: var(--cv-font-mono);
  font-size: calc(13px * var(--codevo-fs-scale, 1));
  line-height: 1.6;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-md__code-body[data-wrap="false"] {
  white-space: pre;
  overflow-wrap: normal;
}

.agent-md__code-body code {
  font: inherit;
  white-space: inherit;
  overflow-wrap: inherit;
}

.agent-md__code-colorized {
  display: block;
}

.agent-md__code-line {
  display: block;
  min-height: 1.6em;
}

.agent-message-actions {
  display: flex;
  align-items: center;
  gap: var(--cv-space-1);
}

.agent-text > .agent-message-actions {
  margin-top: var(--cv-space-2);
  opacity: 0;
  transition: opacity var(--cv-motion-slow) var(--cv-ease);
}

.agent-text:hover > .agent-message-actions,
.agent-text:focus-within > .agent-message-actions,
.agent-finale:hover > .agent-message-actions,
.agent-finale:focus-within > .agent-message-actions {
  opacity: 1;
}

.agent-finale > .agent-message-actions {
  opacity: 0;
  transition: opacity var(--cv-motion-slow) var(--cv-ease);
}

.agent-message-copy {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-subtle);
  cursor: pointer;
  transition:
    background-color var(--cv-motion-fast) var(--cv-ease),
    color var(--cv-motion-fast) var(--cv-ease);
}

.agent-message-copy:hover,
.agent-message-copy[aria-pressed="true"] {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.agent-message-copy:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.agent-message-copy--copied {
  color: var(--cv-ok);
}

.agent-message-copy--failed {
  color: var(--cv-danger);
}

.agent-note {
  margin: 0;
  color: var(--cv-fg-subtle);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  line-height: var(--cv-lh-sm);
  overflow-wrap: anywhere;
}

.agent-note--warning {
  color: var(--cv-warn);
}

.agent-note--bad {
  color: var(--cv-danger);
}

.agent-finale {
  display: grid;
  gap: var(--cv-space-2);
  min-width: 0;
  color: var(--cv-fg);
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
  line-height: var(--cv-lh-prose);
}

.agent-finale .agent-microlabel {
  display: none;
}

.agent-finale--bad {
  padding: var(--cv-space-4) var(--cv-space-5);
  border-radius: var(--cv-r-card);
  background: var(--cv-tint-1);
}

.agent-finale--bad .agent-microlabel {
  display: inline;
  color: var(--cv-danger);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  font-weight: 500;
}

.agent-finale__body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-raw {
  min-width: 0;
}

.agent-raw__toggle {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--cv-space-4);
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg-muted);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  cursor: pointer;
  list-style: none;
}

.agent-raw__toggle::-webkit-details-marker {
  display: none;
}

.agent-raw__toggle:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.agent-raw__lines {
  max-height: 320px;
  margin: var(--cv-space-2) 0 0;
  padding: var(--cv-space-4) var(--cv-space-5);
  overflow: auto;
  border-radius: var(--cv-r-card);
  background: var(--cv-tint-1);
  color: var(--cv-fg);
  font-family: var(--cv-font-mono);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  line-height: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-turn-end,
.agent-compaction-event {
  display: flex;
  align-items: center;
  gap: var(--cv-space-4);
  min-width: 0;
  margin: var(--cv-space-2) 0;
  color: var(--cv-fg-subtle);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
}

.agent-turn-end__rule {
  flex: 1 1 0;
  height: 1px;
  background: var(--cv-hair);
}

.agent-turn-end__label {
  flex: none;
  color: var(--cv-fg-muted);
  font-weight: 500;
}

.agent-turn-end[data-kind="exited"] .agent-turn-end__label {
  color: var(--cv-danger);
}

.agent-turn-end__detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-compaction-event__tokens {
  font-family: var(--cv-font-mono);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Load it and delete the old groups**

Add `import "./conversation/agentProse.css";` to `AgentThreadSession.tsx` (after the Task 1 imports). In `agentThread.css` delete every rule whose selectors are only `.agent-text*`, `.agent-md*`, `.agent-message-actions`, `.agent-message-copy*`, `.agent-note*`, `.agent-microlabel*`, `.agent-finale*`, `.agent-raw*`, `.agent-compaction-event*`, `.agent-compaction-activity` (find with `grep -n "^\.agent-\(text\|md\|message-actions\|message-copy\|note\|microlabel\|finale\|raw\|compaction\)" src/components/agentMode/agentThread.css`). In `agentTranscript.css` delete the `.agent-turn-end*`, `.agent-md__path-link*` and `.agent-md__code-colorized*` / `.agent-md__code-line` groups.

- [ ] **Step 5: Update the legacy style tests**

- `agentThreadStyles.test.ts`: delete the blocks "hides the result microlabel and keeps no styling for unrendered blocks", "scopes markdown horizontal scrolling to the code body and table wrapper only", "wraps code and unbroken tokens without a nested vertical viewport", "sets the markdown prose rhythm from one block margin and zeroes the outer edges", "keeps the code block on one quiet slab and the inline code on the well", "fits a markdown table to the reading column and rules it with hairlines only", "keeps markdown chrome on the well tones without side tone or z-index"; in "puts code blocks on the well tone and the changes summary on a raised card" delete only the code-block expectations and rename the block to "puts the changes summary on a raised card" (the `.agent-changes` expectations belong to P6's surface and stay); remove `.agent-text`, `.agent-text__paragraph`, `.agent-raw` from the "declares every thread-body selector once" list.
- `agentModeResponsiveStyles.test.ts`: in "reflows thread content inside the docked center column" replace `rule(".agent-raw__lines")` with `rule(".agent-raw__lines", readStyleSheet("components/agentMode/conversation/agentProse.css").source)`.

- [ ] **Step 6: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts src/components/agentMode/AgentMarkdown.test.tsx src/components/agentMode/AgentThreadSession.markdown.test.tsx src/components/agentMode/AgentThreadSession.transcript.test.tsx src/components/agentMode/AgentThreadSession.compaction.test.tsx src/components/themeContrast.test.ts src/domain/themeContrast.test.ts`
Expected: PASS (drop from the command any path that does not exist).

---
### Task 5: Bubble images, lightbox, queued messages, jump-to-latest, history pager, minimap tokens

**Files:**
- Create: `src/components/agentMode/conversation/agentLightbox.css`
- Modify: `src/components/agentMode/AgentTurnParts.tsx` (images before text)
- Modify: `src/components/agentMode/AgentTurnAttachments.tsx` (uniform 4:3 cells)
- Modify: `src/components/agentMode/AgentAttachmentLightbox.tsx` (own backdrop class)
- Modify: `src/components/agentMode/AgentHistoryPager.tsx` (quiet "Load earlier turns")
- Modify: `src/components/agentMode/AgentThreadSession.tsx` (imported-history nav class, lightbox sheet import)
- Modify: `src/components/agentMode/AgentTurnView.tsx` (drop `agentTranscript.css` import)
- Modify: `conversation/conversation.css`, `conversationStyles.test.ts`
- Modify: `src/components/agentMode/agentThread.css` (delete lightbox, attachments, queued, empty-state groups; re-token minimap)
- Delete: `src/components/agentMode/agentTranscript.css`
- Modify tests: `AgentTurnAttachments.test.tsx:120-150`, `AgentAttachmentLightbox.test.tsx:104`, `AgentHistoryPager.test.tsx`, `agentThreadStyles.test.ts`

**Interfaces:**
- Consumes: Task 1 sheets and helpers.
- Produces: `.cv-load-earlier` (quiet full-width text button, t3code `TimelineLoadEarlierHeader`), `.cv-history-pager`; history pager copy "Load earlier turns" / "Loading earlier turns…"; lightbox root class `agent-lightbox` only (no `palette-backdrop`).

- [ ] **Step 1: Write the failing tests**

In `conversationStyles.test.ts` add `const LIGHTBOX = "components/agentMode/conversation/agentLightbox.css";`, append it to `P3_SHEETS`, change `MEDIA_CHIP_SELECTORS` to `new Set([".agent-lightbox__chip", ".agent-lightbox__chip:hover", ".agent-lightbox__caption"])`, append `".agent-attachments"`, `".agent-lightbox"`, `".agent-queued-list"`, `".agent-jump-latest"` to `MIGRATED_SELECTORS`, and add:

```ts
  it("lays sent images out as the mockup's 2-column 4:3 grid above the text", () => {
    expect(declaredValue(CONVERSATION, ".agent-attachments", "grid-template-columns")).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
    expect(declaredValue(CONVERSATION, ".agent-attachments", "max-width")).toBe("210px");
    expect(declaredValue(CONVERSATION, ".agent-attachments", "gap")).toBe("var(--cv-space-4)");
    expect(declaredValue(CONVERSATION, ".agent-attachments__open", "aspect-ratio")).toBe("4 / 3");
    expect(declaredValue(CONVERSATION, ".agent-attachments__open", "border")).toBe(
      "1px solid var(--cv-hair-strong)",
    );
    expect(declaredValue(CONVERSATION, ".agent-attachments__image", "object-fit")).toBe("cover");
  });

  it("floats the image preview on the scrim with the close chip above the corner", () => {
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__scrim", "background")).toBe("var(--cv-scrim)");
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__image", "border-radius")).toBe(
      "var(--cv-r-card)",
    );
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__close", "top")).toBe("-40px");
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__chip", "width")).toBe("28px");
  });

  it("keeps the load-earlier controls quiet", () => {
    expect(declaredValue(CONVERSATION, ".cv-load-earlier", "background")).toBe("none");
    expect(declaredValue(CONVERSATION, ".cv-load-earlier", "color")).toBe("var(--cv-fg-subtle)");
    expect(declaredValue(CONVERSATION, ".cv-load-earlier:hover:not(:disabled)", "color")).toBe(
      "var(--cv-fg-strong)",
    );
  });
```

In `AgentHistoryPager.test.tsx` add:

```tsx
it("offers earlier turns as one quiet button whose label is the loading state", () => {
  const onEarlier = vi.fn();
  act(() =>
    root.render(
      <AgentHistoryPager hasEarlier onEarlier={onEarlier} onLatest={() => undefined} page={null} />,
    ),
  );
  const button = host.querySelector<HTMLButtonElement>("button.cv-load-earlier");
  expect(button?.textContent).toBe("Load earlier turns");
  act(() => button?.click());
  expect(onEarlier).toHaveBeenCalledTimes(1);

  act(() =>
    root.render(
      <AgentHistoryPager
        hasEarlier
        onEarlier={onEarlier}
        onLatest={() => undefined}
        page={{ threadId: "t", turns: [], hasEarlier: true, loading: true, error: null }}
      />,
    ),
  );
  expect(host.querySelector("button.cv-load-earlier")?.textContent).toBe("Loading earlier turns…");
  expect(host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.disabled).toBe(true);
});
```

(use the file's existing `host`/`root` setup; if it creates them per test, create them the same way inside this test.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/conversationStyles.test.ts src/components/agentMode/AgentHistoryPager.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Components**

1. `AgentTurnParts.tsx` (`AgentTurnPrompt`): move `<AgentTurnAttachments attachments={attachments} images={attachmentImages} />` to be the first child of `.agent-prompt__bubble` (mockup `.bubble .imgs` precede the text).
2. `AgentTurnAttachments.tsx`: in `AgentAttachmentImage` delete `style={placeholderStyle(attachment)}` and the `placeholderStyle` function and its `agentAttachmentPlaceholderSize`/`CSSProperties` imports if now unused; keep `width`/`height` attributes on the `<img>`.
3. `AgentAttachmentLightbox.tsx:130`: change `className="palette-backdrop agent-lightbox"` to `className="agent-lightbox"`. Delete `import`-level reliance on palette styles (none expected). Add `import "./conversation/agentLightbox.css";`.
4. `AgentHistoryPager.tsx`: delete `import "./agentHistory.css";`, change the `nav` class to `cv-history-pager`, give every button `className="cv-load-earlier"`, and change the earlier label to `{page?.loading ? "Loading earlier turns…" : "Load earlier turns"}`.
5. `AgentThreadSession.tsx`: the imported-history `<nav aria-label="Original conversation history" className="agent-history-pager">` becomes `className="cv-history-pager"` and both of its buttons get `className="cv-load-earlier"`.
6. `AgentTurnView.tsx`: delete `import "./agentTranscript.css";`.

- [ ] **Step 4: Styles**

Append to `conversation/conversation.css`:

```css
.agent-attachments {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--cv-space-4);
  max-width: 210px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.agent-attachments__item {
  min-width: 0;
}

.agent-attachments__item:has(> .agent-attachments__chip) {
  grid-column: 1 / -1;
}

.agent-attachments__open,
.agent-attachments__pending {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--cv-hair-strong);
  border-radius: var(--cv-r-card);
  background: var(--cv-canvas);
}

.agent-attachments__open {
  cursor: zoom-in;
}

.agent-attachments__open:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.agent-attachments__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.agent-attachments__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-3);
  max-width: 100%;
  min-height: 28px;
  padding: 0 var(--cv-space-4);
  border-radius: var(--cv-r-control);
  background: var(--cv-tint-1);
  color: var(--cv-fg);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
}

.agent-attachments__chip[data-agent-attachment="unavailable"] {
  color: var(--cv-warn);
}

.agent-attachments__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-prompt--queued .agent-prompt__bubble {
  background: var(--cv-tint-1);
  box-shadow: inset 0 0 0 1px var(--cv-hair-strong);
  color: var(--cv-fg);
}

.agent-prompt__queue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--cv-space-2) var(--cv-space-4);
  color: var(--cv-fg-subtle);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
}

.agent-prompt__queue-status,
.agent-prompt__queue-attachments {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-2);
}

.agent-prompt__queue-note {
  flex: 1 1 100%;
}

.agent-prompt__queue-action {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-2);
  height: 24px;
  min-width: 24px;
  padding: 0 var(--cv-space-3);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-muted);
  font: inherit;
  cursor: pointer;
}

.agent-prompt__queue-action:hover:not(:disabled) {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.agent-prompt__queue-action:disabled {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.agent-queued-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--cv-space-2);
  min-width: 0;
}

.agent-queued-list:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.agent-queued-list__controls {
  display: flex;
  justify-content: flex-end;
}

.agent-jump-latest {
  position: absolute;
  right: 0;
  bottom: var(--cv-space-5);
  left: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.agent-jump-latest__button {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-3);
  height: 28px;
  padding: 0 var(--cv-space-5);
  border: 0;
  border-radius: var(--cv-r-pill);
  background: var(--cv-raised);
  box-shadow: var(--cv-shadow-pop);
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  cursor: pointer;
  pointer-events: auto;
}

.agent-jump-latest__button:hover,
.agent-jump-latest__button[data-unseen="true"] {
  color: var(--cv-fg-strong);
}

.agent-jump-latest__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cv-accent);
}

.cv-history-pager {
  display: grid;
  gap: var(--cv-space-2);
  min-width: 0;
  padding-bottom: var(--cv-space-4);
}

.cv-load-earlier {
  width: 100%;
  padding: 6px 0;
  border: 0;
  background: none;
  color: var(--cv-fg-subtle);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  cursor: pointer;
  transition: color var(--cv-motion-fast) var(--cv-ease);
}

.cv-load-earlier:hover:not(:disabled) {
  color: var(--cv-fg-strong);
}

.cv-load-earlier:disabled {
  cursor: default;
}

.cv-load-earlier:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}
```

Create `conversation/agentLightbox.css`:

```css
.agent-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--cv-z-dialog);
  display: grid;
  place-items: center;
}

.agent-lightbox__scrim {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: var(--cv-scrim);
  cursor: zoom-out;
}

.agent-lightbox__stage {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: var(--cv-space-4);
  max-width: calc(92vw - 96px);
}

.agent-lightbox__frame {
  position: relative;
}

.agent-lightbox__image {
  display: block;
  max-width: min(92vw, 800px);
  max-height: min(86vh, 600px);
  border-radius: var(--cv-r-card);
  object-fit: contain;
}

.agent-lightbox__chip {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.95);
  cursor: pointer;
}

.agent-lightbox__chip:hover {
  background: rgba(0, 0, 0, 0.8);
}

.agent-lightbox__chip:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.agent-lightbox__close {
  position: absolute;
  top: -40px;
  right: 0;
}

.agent-lightbox__nav {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
}

.agent-lightbox__nav--previous {
  left: var(--cv-space-7);
}

.agent-lightbox__nav--next {
  right: var(--cv-space-7);
}

.agent-lightbox__caption {
  display: flex;
  align-items: center;
  gap: var(--cv-space-4);
  max-width: 100%;
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--cv-t-xs);
}

.agent-lightbox__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-lightbox__reveal {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
```

Move the remaining `agentTranscript.css` groups `.agent-turn-earlier*` into `conversation.css` re-tokened with the Global Constraints table (Task 14 replaces them), then delete `src/components/agentMode/agentTranscript.css`. `.agent-jump-latest*` groups were replaced above.

In `agentThread.css`: delete the groups `.agent-lightbox*`, `.palette-backdrop` (only the lightbox-specific rule), `.agent-attachments*`, `.agent-prompt--queued*`, `.agent-prompt__queue*`, `.agent-prompt__chip--queued`, `.agent-queued-list*`, `.agent-session__queue-*`; in every remaining `.agent-minimap*` rule replace legacy variables using the Global Constraints rewrite table (values only, selectors unchanged).

- [ ] **Step 5: Update the legacy tests**

- `AgentTurnAttachments.test.tsx` lines ~120-150: replace the width/height expectations of `.agent-attachments__pending` with `expect(pending?.getAttribute("style")).toBeNull();` and keep the class/role assertions; delete the test "keeps the default placeholder for an image view without dimensions" if it only checks the inline size.
- `AgentAttachmentLightbox.test.tsx:104`: `expect(dialog.classList.contains("agent-lightbox")).toBe(true);`.
- `agentThreadStyles.test.ts`: delete "keeps borders limited to the intentional queued-message outline", "distinguishes compact queued outlines from sent bubbles using the prompt tokens", "mutes a disabled queue action and keeps the hover fill off it", "keeps the edit pencil on the shared queue-action chip contract", "keeps sent attachments inside the bubble under the text and its chips on the agent ladder", "floats the attachment lightbox on the shade scrim, fitted to the viewport without upscaling", "pins the lightbox close chip to the image corner and the chevrons to the viewport edges"; in "steps the minimap dash width..." replace `"var(--agent-text-muted)"` → `"var(--cv-fg-muted)"`, `"var(--agent-accent)"` → `"var(--cv-accent)"` (both places), `"var(--agent-text-strong)"` → `"var(--cv-fg-strong)"`.
- Any test that queries `.agent-history-pager` for the conversation pager or the imported nav: use `.cv-history-pager`; label `"Earlier turns"` → `"Load earlier turns"`.

- [ ] **Step 6: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/AgentTurnAttachments.test.tsx src/components/agentMode/AgentTurnAttachments.imageCache.test.tsx src/components/agentMode/AgentAttachmentLightbox.test.tsx src/components/agentMode/AgentHistoryPager.test.tsx src/components/agentMode/AgentQueuedPrompt.uncertain.test.tsx src/components/agentMode/agentThreadTurns.test.tsx src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/AgentThreadSession.transcript.test.tsx src/components/agentMode/AgentThreadSession.minimap.test.tsx src/components/agentMode/AgentImportedHistory.test.tsx src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts`
Expected: PASS.

---

### Task 6: Compact changes row

**Files:**
- Create: `src/components/agentMode/conversation/AgentTurnChangesRow.tsx`
- Create: `src/components/agentMode/conversation/AgentTurnChangesRow.test.tsx`
- Create: `src/components/agentMode/conversation/agentTurnChangesRow.css`
- Modify: `src/components/agentMode/AgentRecordedTurnChanges.tsx`
- Modify: `src/components/agentMode/AgentRecordedTurnChanges.test.tsx`
- Modify: `src/components/agentMode/AgentThreadSession.tsx` (prop `activeDiffTurnId`, pass `active`)
- Modify: `conversation/conversationStyles.test.ts`

**Interfaces:**
- Consumes: `AgentTurnChangeSummary` (`src/domain/agentTurnChanges.ts`), `buildAgentTurnDiffTree(files)` (`src/domain/agentTurnDiffTree.ts`, `.stats: { addedLines: number | null; deletedLines: number | null; unknownFiles: number; fileCount: number }`, `.truncated`), `classifyTurnChangesReadFailure`, `isRetryableTurnChangesReason`.
- Produces:
  - `interface AgentTurnChangesRowProps { readonly summary: AgentTurnChangeSummary; readonly active: boolean; onOpenDiff(): void }`, `AgentTurnChangesRow` (memo)
  - `AgentRecordedTurnChangesProps.active?: boolean`; `onOpenDiff` is still `(summary, relativePath?) => void` but P3 never passes a path
  - `AgentThreadSessionProps.activeDiffTurnId?: string | null` (default `null`)

- [ ] **Step 1: Write the failing component test**

Create `src/components/agentMode/conversation/AgentTurnChangesRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnChangeSummary, AgentTurnChangedFile } from "../../../domain/agentTurnChanges";
import { AgentTurnChangesRow } from "./AgentTurnChangesRow";

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

function file(relativePath: string, addedLines: number | null, deletedLines: number | null): AgentTurnChangedFile {
  return { relativePath, oldRelativePath: null, status: "modified", addedLines, deletedLines };
}

function summary(patch: Partial<AgentTurnChangeSummary> = {}): AgentTurnChangeSummary {
  return {
    turnId: "turn-1",
    state: "ready",
    files: [file("src/routes/orders.ts", 4, 1), file("src/middleware/idempotency.ts", 29, 0), file("test/orders.test.ts", 9, 6)],
    truncated: false,
    reason: null,
    ...patch,
  };
}

describe("AgentTurnChangesRow", () => {
  it("summarizes the turn in one row and opens the whole turn diff", () => {
    const open = vi.fn();
    act(() => root.render(<AgentTurnChangesRow active={false} onOpenDiff={open} summary={summary()} />));

    const row = host.querySelector<HTMLButtonElement>("button.cv-changes-row");
    expect(row?.textContent).toBe("3 changed files+42−7Open diff");
    expect(row?.getAttribute("aria-label")).toBe("3 changed files, 42 lines added, 7 removed. Open diff");
    expect(row?.dataset.active).toBe("false");
    act(() => row?.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith();
  });

  it("uses the singular, marks the active turn and hides unknown counts", () => {
    act(() =>
      root.render(
        <AgentTurnChangesRow
          active
          onOpenDiff={() => undefined}
          summary={summary({ files: [file("assets/logo.png", null, null)] })}
        />,
      ),
    );

    const row = host.querySelector<HTMLButtonElement>("button.cv-changes-row");
    expect(row?.textContent).toBe("1 changed fileOpen diff");
    expect(row?.dataset.active).toBe("true");
  });

  it("says when only part of the turn was recorded", () => {
    act(() =>
      root.render(
        <AgentTurnChangesRow active={false} onOpenDiff={() => undefined} summary={summary({ truncated: true })} />,
      ),
    );

    expect(host.querySelector(".cv-changes-row__count")?.textContent).toBe("At least 3 changed files");
  });

  it("renders the unavailable reason as a quiet note and nothing for an empty turn", () => {
    act(() =>
      root.render(
        <AgentTurnChangesRow
          active={false}
          onOpenDiff={() => undefined}
          summary={summary({ state: "unavailable", files: [], reason: "Recorded changes cannot be read in this session." })}
        />,
      ),
    );
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector(".cv-changes-row--unavailable")?.textContent).toBe(
      "Recorded changes cannot be read in this session.",
    );

    act(() =>
      root.render(
        <AgentTurnChangesRow active={false} onOpenDiff={() => undefined} summary={summary({ files: [] })} />,
      ),
    );
    expect(host.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/AgentTurnChangesRow.test.tsx`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement the row**

Create `src/components/agentMode/conversation/AgentTurnChangesRow.tsx`:

```tsx
import { memo, useMemo } from "react";
import { FileDiff } from "lucide-react";
import type { AgentTurnChangeSummary } from "../../../domain/agentTurnChanges";
import { buildAgentTurnDiffTree } from "../../../domain/agentTurnDiffTree";
import "./agentTurnChangesRow.css";

export interface AgentTurnChangesRowProps {
  readonly summary: AgentTurnChangeSummary;
  readonly active: boolean;
  onOpenDiff(): void;
}

export const AgentTurnChangesRow = memo(function AgentTurnChangesRow({
  active,
  onOpenDiff,
  summary,
}: AgentTurnChangesRowProps) {
  const tree = useMemo(() => buildAgentTurnDiffTree(summary.files), [summary.files]);
  if (summary.state === "unsupported") return null;
  if (summary.state === "unavailable") {
    return (
      <p className="cv-changes-row cv-changes-row--unavailable" role="note">
        {summary.reason ?? "Changes for this turn are unavailable."}
      </p>
    );
  }
  const partial = summary.truncated || tree.truncated;
  const count = tree.stats.fileCount;
  if (count === 0 && !partial) return null;
  const countLabel = `${partial ? "At least " : ""}${count} changed ${count === 1 ? "file" : "files"}`;
  const { addedLines, deletedLines } = tree.stats;
  return (
    <button
      aria-label={changesAccessibleLabel(countLabel, addedLines, deletedLines)}
      className="cv-changes-row"
      data-active={active ? "true" : "false"}
      onClick={() => onOpenDiff()}
      type="button"
    >
      <span className="cv-changes-row__count">{countLabel}</span>
      {(addedLines !== null || deletedLines !== null) && (
        <span className="cv-changes-row__stat">
          {addedLines !== null && <span className="cv-changes-row__added">+{addedLines}</span>}
          {deletedLines !== null && <span className="cv-changes-row__deleted">−{deletedLines}</span>}
        </span>
      )}
      <span className="cv-changes-row__open">
        <FileDiff aria-hidden="true" size={12} strokeWidth={1.5} />
        Open diff
      </span>
    </button>
  );
});

function changesAccessibleLabel(
  countLabel: string,
  addedLines: number | null,
  deletedLines: number | null,
): string {
  const parts = [countLabel];
  if (addedLines !== null) parts.push(`${addedLines} lines added`);
  if (deletedLines !== null) parts.push(`${deletedLines} removed`);
  return `${parts.join(", ")}. Open diff`;
}
```

Create `src/components/agentMode/conversation/agentTurnChangesRow.css`:

```css
.cv-changes-row {
  display: flex;
  align-items: center;
  gap: var(--cv-space-5);
  width: 100%;
  min-width: 0;
  height: 36px;
  margin-top: var(--cv-space-6);
  padding: 0 6px 0 var(--cv-space-5);
  border: 0;
  border-radius: var(--cv-r-card);
  background: var(--cv-tint-1);
  color: var(--cv-fg-strong);
  font-size: calc(var(--cv-t-xs) * var(--codevo-fs-scale, 1));
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--cv-motion-fast) var(--cv-ease);
}

.cv-changes-row:hover,
.cv-changes-row[data-active="true"] {
  background: var(--cv-tint-2);
}

.cv-changes-row:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.cv-changes-row__count {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-changes-row__stat {
  display: inline-flex;
  flex: none;
  gap: var(--cv-space-2);
  font-family: var(--cv-font-mono);
  font-weight: 400;
}

.cv-changes-row__added {
  color: var(--cv-ok);
}

.cv-changes-row__deleted {
  color: var(--cv-danger);
}

.cv-changes-row__open {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--cv-space-2);
  height: 24px;
  margin-left: auto;
  padding: 0 var(--cv-space-4);
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg-muted);
  font-weight: 400;
}

.cv-changes-row:hover .cv-changes-row__open {
  color: var(--cv-fg-strong);
}

.cv-changes-row--unavailable {
  height: auto;
  margin: var(--cv-space-4) 0 0;
  padding: 0;
  background: none;
  color: var(--cv-fg-subtle);
  font-weight: 400;
  cursor: default;
}

.cv-changes-retry {
  justify-self: start;
  height: 24px;
  margin-top: var(--cv-space-2);
  padding: 0 var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  cursor: pointer;
}

.cv-changes-retry:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}
```

- [ ] **Step 4: Use the row from the recorded-changes loader**

In `src/components/agentMode/AgentRecordedTurnChanges.tsx`: replace `import { AgentTurnChangesCard } from "./AgentTurnChangesCard";` and `import "./agentRecordedTurnChanges.css";` with `import { AgentTurnChangesRow } from "./conversation/AgentTurnChangesRow";`; add `readonly active?: boolean;` to the props; replace the rendered card with

```tsx
      <AgentTurnChangesRow
        active={props.active ?? false}
        key={`${threadId}:${turnId}`}
        onOpenDiff={() => props.onOpenDiff?.(result.summary)}
        summary={result.summary}
      />
```

and give the retry button `className="cv-changes-retry agent-turn-changes-retry"`.

In `AgentThreadSession.tsx` add `readonly activeDiffTurnId?: string | null;` to `AgentThreadSessionProps`, destructure `activeDiffTurnId = null`, and pass `active={activeDiffTurnId === turn.turnId}` and `onOpenDiff={(summary) => onOpenTurnDiff?.(threadId, summary)}` to `<AgentRecordedTurnChanges>`.

- [ ] **Step 5: Update the loader test and the contract test**

In `AgentRecordedTurnChanges.test.tsx`: the "Open diff" button is now `button.cv-changes-row` (find by `.cv-changes-row`); `"1 changed file"` text is read from `.cv-changes-row__count`; `.agent-turn-changes--unavailable` becomes `.cv-changes-row--unavailable`; the "routes Open diff to the sidebar callback" test expects the callback called with `(summary)` only (one argument). Delete assertions about per-file rows and folder toggles (that tree is gone from the transcript; P6 owns it in the diff panel).

In `conversationStyles.test.ts` add `const CHANGES = "components/agentMode/conversation/agentTurnChangesRow.css";`, append it to `P3_SHEETS`, and add:

```ts
  it("draws the changes row at the mockup size and truncates long counts", () => {
    expect(declaredValue(CHANGES, ".cv-changes-row", "height")).toBe("36px");
    expect(declaredValue(CHANGES, ".cv-changes-row", "padding")).toBe("0 6px 0 var(--cv-space-5)");
    expect(declaredValue(CHANGES, ".cv-changes-row", "border-radius")).toBe("var(--cv-r-card)");
    expect(declaredValue(CHANGES, ".cv-changes-row", "background")).toBe("var(--cv-tint-1)");
    expect(declaredValue(CHANGES, '.cv-changes-row[data-active="true"]', "background")).toBe(
      "var(--cv-tint-2)",
    );
    expect(declaredValue(CHANGES, ".cv-changes-row__count", "text-overflow")).toBe("ellipsis");
  });
```

- [ ] **Step 6: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/AgentRecordedTurnChanges.test.tsx src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/AgentModeView.test.tsx`
Expected: PASS.

---
### Task 7: Session extraction, bottom dock banners, awaiting row and empty hero

**Files:**
- Create: `src/components/agentMode/conversation/agentSessionDom.ts` (+ `agentSessionDom.test.ts`)
- Create: `src/components/agentMode/conversation/AgentSessionPreamble.tsx`
- Create: `src/components/agentMode/conversation/AgentQueuedMessages.tsx`
- Create: `src/components/agentMode/conversation/agentAgentsBannerPresentation.ts` (+ `.test.ts`)
- Create: `src/components/agentMode/conversation/AgentSessionDock.tsx` (+ `AgentSessionDock.test.tsx`)
- Modify: `src/components/agentMode/AgentThreadSession.tsx` (use the extractions; props `awaiting`)
- Modify: `src/components/agentMode/AgentBackgroundWorkBanner.tsx` (foundation banner)
- Modify: `src/components/agentMode/AgentThreadSessionEmpty.tsx` (hero)
- Modify: `conversation/conversation.css`, `conversationStyles.test.ts`
- Modify: `src/components/agentMode/agentThread.css` (delete `.agent-empty*`, `.agent-session__body--empty`)
- Delete: `src/components/agentMode/agentBackgroundWorkBanner.css`
- Modify tests: `AgentThreadSession.background.test.tsx`, `AgentThreadSession.test.tsx` (empty state), `agentThreadStyles.test.ts`

**Interfaces:**
- Consumes: `ComposerBanner` (`src/ui/foundation/ComposerBanner.tsx`, props `tone`, `icon`, `actions`, `children`), `AgentLiveRow` (Task 3), `AgentThreadAgents` (`useAgentThreadAgents.tsx`: `groups: ReadonlyArray<{ key: string; subagents: AgentRuntimeSubagents }>`, `openPanel()`), `useAgentThreadFollow` result (`jumpToLatest`, `unseenActivity`, `atLatest`).
- Produces:
  - Classes `.cv-banner-line`, `.cv-banner-detail` (text row inside a `ComposerBanner`).
  - `agentSessionDom.ts`: `export const AGENT_FIND_REVEAL_INSET = 34` is NOT moved (it stays exported from `AgentThreadSession.tsx`); exported `turnCursor`, `revealTarget`, `columnElement`, `prependedTurnIds`, `turnInsertionTops`, `interface AgentRevealTarget`, `interface AgentTurnEventOffset` with the exact signatures they have today in `AgentThreadSession.tsx:665-786`.
  - `type AgentThreadAwaiting = "approval" | "input"`; `AgentThreadSessionProps.awaiting?: AgentThreadAwaiting | null`.
  - `agentAgentsBannerModel(groups): { readonly label: string; readonly names: string } | null`, `MAX_AGENTS_BANNER_NAMES = 3`.
  - `<AgentSessionDock ...>`, `<AgentSessionPreamble ...>`, `<AgentQueuedMessages ...>` (props below).
  - Classes `.cv-session-dock`, `.cv-session-dock__banners`, `.cv-banner-strong`, `.cv-banner-action`, `.cv-empty-hero`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/agentMode/conversation/agentAgentsBannerPresentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentRuntimeSubagent, AgentRuntimeSubagents } from "../../../domain/agentRuntimeSubagent";
import { agentAgentsBannerModel } from "./agentAgentsBannerPresentation";

function agent(id: string, patch: Partial<AgentRuntimeSubagent> = {}): AgentRuntimeSubagent {
  return {
    id,
    batchId: "batch",
    title: `Agent ${id}`,
    titleKnown: true,
    role: null,
    model: null,
    status: "working",
    activity: null,
    activityTruncated: false,
    recentActivity: [],
    elapsed: { kind: "unknown" },
    totalTokens: null,
    toolUses: null,
    nestedAgents: 0,
    activityOrder: 0,
    ...patch,
  };
}

function group(agents: ReadonlyArray<AgentRuntimeSubagent>): { readonly subagents: AgentRuntimeSubagents } {
  return { subagents: { agents, batches: [], truncated: false } };
}

describe("agentAgentsBannerModel", () => {
  it("counts working agents across turns and names them by role", () => {
    expect(
      agentAgentsBannerModel([
        group([agent("a", { role: "explorer" }), agent("b", { status: "completed" })]),
        group([agent("c", { role: "reviewer" })]),
      ]),
    ).toEqual({ label: "2 agents running", names: "explorer, reviewer" });
  });

  it("falls back to titles, dedupes and bounds the names", () => {
    expect(
      agentAgentsBannerModel([
        group([agent("a"), agent("b"), agent("c"), agent("d"), agent("e", { title: "Agent a" })]),
      ]),
    ).toEqual({ label: "5 agents running", names: "Agent a, Agent b, Agent c +1" });
  });

  it("hides the banner when nothing is working", () => {
    expect(agentAgentsBannerModel([group([agent("a", { status: "idle" })])])).toBeNull();
    expect(agentAgentsBannerModel([])).toBeNull();
  });

  it("uses the singular for one agent", () => {
    expect(agentAgentsBannerModel([group([agent("a", { role: "explorer" })])])?.label).toBe(
      "1 agent running",
    );
  });
});
```

Create `src/components/agentMode/conversation/agentSessionDom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prependedTurnIds, turnCursor } from "./agentSessionDom";

describe("prependedTurnIds", () => {
  it("reports only turns whose first event moved earlier", () => {
    expect(
      prependedTurnIds(
        [
          { turnId: "a", offset: 0 },
          { turnId: "b", offset: -10 },
        ],
        [
          { turnId: "a", offset: -200 },
          { turnId: "b", offset: -10 },
          { turnId: "c", offset: -5 },
        ],
      ),
    ).toEqual(["a"]);
    expect(prependedTurnIds([], [{ turnId: "a", offset: -1 }])).toEqual([]);
  });
});

describe("turnCursor", () => {
  it("counts earlier hits on the same event", () => {
    const hit = { scope: "turn", turnId: "t", eventIndex: 3 } as const;
    expect(turnCursor([hit, hit, hit] as never, 2)).toEqual({ kind: "event", eventIndex: 3, occurrence: 2 });
    expect(turnCursor([] as never, 0)).toBeNull();
  });
});
```

Create `src/components/agentMode/conversation/AgentSessionDock.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionDock } from "./AgentSessionDock";

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

describe("AgentSessionDock", () => {
  it("attaches the agents banner above the composer and opens the panel from View", () => {
    const open = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          agents={{ label: "2 agents running", names: "explorer, reviewer" }}
          background={null}
          follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
          onOpenAgents={open}
          onRevealQueue={() => undefined}
          queuedCount={0}
        />,
      ),
    );

    const banner = host.querySelector(".cv-session-dock__banners .cv-composer-banner");
    expect(banner?.className).toContain("cv-composer-banner--working");
    expect(banner?.textContent).toBe("2 agents runningexplorer, reviewerView");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="View agents"]')?.click());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shows jump-to-latest only away from the latest message and the queue count only when queued", () => {
    const jump = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          agents={null}
          background={null}
          follow={{ atLatest: false, unseenActivity: true, jumpToLatest: jump }}
          onOpenAgents={() => undefined}
          onRevealQueue={() => undefined}
          queuedCount={2}
        />,
      ),
    );

    expect(host.querySelector(".agent-jump-latest__button")?.textContent).toBe("New activity");
    expect(host.querySelector('button[aria-label="Show 2 queued messages"]')?.textContent).toBe("2 queued");
    expect(host.querySelector(".cv-session-dock__banners")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/agentAgentsBannerPresentation.test.ts src/components/agentMode/conversation/agentSessionDom.test.ts src/components/agentMode/conversation/AgentSessionDock.test.tsx`
Expected: FAIL - modules not found.

- [ ] **Step 3: Implement the banner model**

Create `src/components/agentMode/conversation/agentAgentsBannerPresentation.ts`:

```ts
import type { AgentRuntimeSubagents } from "../../../domain/agentRuntimeSubagent";

export const MAX_AGENTS_BANNER_NAMES = 3;

export interface AgentAgentsBannerModel {
  readonly label: string;
  readonly names: string;
}

export function agentAgentsBannerModel(
  groups: ReadonlyArray<{ readonly subagents: AgentRuntimeSubagents }>,
): AgentAgentsBannerModel | null {
  const working = groups
    .flatMap((group) => group.subagents.agents)
    .filter((agent) => agent.status === "working");
  if (working.length === 0) return null;
  const labels = [
    ...new Set(
      working.map((agent) => (agent.role ?? agent.title).trim()).filter((label) => label !== ""),
    ),
  ];
  const shown = labels.slice(0, MAX_AGENTS_BANNER_NAMES);
  const hidden = labels.length - shown.length;
  return {
    label: `${working.length} ${working.length === 1 ? "agent" : "agents"} running`,
    names: hidden > 0 ? `${shown.join(", ")} +${hidden}` : shown.join(", "),
  };
}
```

- [ ] **Step 4: Move the DOM helpers**

Create `src/components/agentMode/conversation/agentSessionDom.ts` by MOVING `AgentRevealTarget`, `turnCursor`, `revealTarget`, `importedElement`, `columnElement`, `AgentTurnEventOffset`, `prependedTurnIds`, `turnInsertionTops`, `turnElement`, `eventElement`, `turnEventOffset` verbatim from `AgentThreadSession.tsx:85-88` and `:665-786`, adding `export` to `AgentRevealTarget`, `turnCursor`, `revealTarget`, `columnElement`, `AgentTurnEventOffset`, `prependedTurnIds`, `turnInsertionTops`. Imports it needs: `AgentThreadFindHit` (`../../../domain/agentThreadSearch`), `AgentThreadRevealRequest` (`../agentSidebarPresentation`), `agentThreadColumnKey`, `AgentThreadColumnAnchor` (`../agentThreadColumn`), `AgentTurnHighlightCursor` (`../agentTurnHighlightModel`), `agentTurnItemKey`, `normalizeAgentTurnEventOffset` (`../agentTurnItemKeys`). `AgentThreadSession.tsx` imports them back from `./conversation/agentSessionDom`.

- [ ] **Step 5: Extract the preamble and the queued list**

Create `src/components/agentMode/conversation/AgentSessionPreamble.tsx`:

```tsx
import type { ComponentProps } from "react";
import type {
  AgentThreadHistoryPageView,
  AgentThreadHistorySurface,
} from "../../../application/useAgentThreadHistory";
import type { ExternalAgentSessionHistory } from "../../../domain/externalAgentSession";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import type { AgentProseContext } from "../AgentAssistantText";
import { AgentHistoryPager } from "../AgentHistoryPager";
import { AgentImportedHistory, type AgentExternalHistoryState } from "../AgentImportedHistory";

type ImportedProps = ComponentProps<typeof AgentImportedHistory>;

export interface AgentSessionPreambleProps {
  readonly threadId: string;
  readonly history: AgentThreadHistorySurface | undefined;
  readonly historyPage: AgentThreadHistoryPageView | null;
  readonly turnsTruncated: boolean;
  readonly provenanceNote: string | null;
  readonly importedSessionId: string | null;
  readonly importedHistory: ExternalAgentSessionHistory | undefined;
  readonly importedImages: ImportedProps["attachmentImages"];
  readonly importedHighlights: ImportedProps["highlights"];
  readonly hasEarlierImportedHistory: boolean;
  readonly externalHistoryState: AgentExternalHistoryState | undefined;
  readonly prose: AgentProseContext;
  readonly textClipboard: TextClipboardGateway | null;
  readonly onEarlierImportedHistory?: () => void;
  readonly onRetryExternalHistory?: () => void;
}

export function AgentSessionPreamble({
  externalHistoryState,
  hasEarlierImportedHistory,
  history,
  historyPage,
  importedHighlights,
  importedHistory,
  importedImages,
  importedSessionId,
  onEarlierImportedHistory,
  onRetryExternalHistory,
  prose,
  provenanceNote,
  textClipboard,
  threadId,
  turnsTruncated,
}: AgentSessionPreambleProps) {
  return (
    <>
      {history !== undefined && (
        <AgentHistoryPager
          page={historyPage}
          hasEarlier={turnsTruncated}
          onEarlier={() => {
            void history.older(threadId);
          }}
          onNewer={
            history.newer === undefined
              ? undefined
              : () => {
                  void history.newer?.(threadId);
                }
          }
          onLatest={history.latest}
        />
      )}
      {turnsTruncated && history === undefined && (
        <p className="agent-note agent-note--warning">Earlier turns were dropped to bound memory.</p>
      )}
      {provenanceNote !== null && (
        <p className="agent-note agent-session__provenance">{provenanceNote}</p>
      )}
      {importedSessionId !== null && onEarlierImportedHistory !== undefined && (
        <nav aria-label="Original conversation history" className="cv-history-pager">
          <button
            className="cv-load-earlier"
            disabled={externalHistoryState === "loading" || !hasEarlierImportedHistory}
            onClick={onEarlierImportedHistory}
            type="button"
          >
            Earlier imported messages
          </button>
          <button
            className="cv-load-earlier"
            disabled={externalHistoryState === "loading"}
            onClick={onRetryExternalHistory}
            type="button"
          >
            Latest imported messages
          </button>
        </nav>
      )}
      {importedSessionId !== null && (
        <AgentImportedHistory
          attachmentImages={importedImages}
          highlights={importedHighlights}
          history={importedHistory}
          key={`${threadId}:${importedSessionId}`}
          onRetry={onRetryExternalHistory}
          prose={prose}
          state={externalHistoryState}
          textClipboard={textClipboard}
        />
      )}
    </>
  );
}
```

In `AgentThreadSession.tsx` replace the JSX from `{history !== undefined && (<AgentHistoryPager` through the closing `)}` of `<AgentImportedHistory ... />` with:

```tsx
          <AgentSessionPreamble
            externalHistoryState={externalHistoryState}
            hasEarlierImportedHistory={hasEarlierImportedHistory}
            history={history}
            historyPage={historyPage}
            importedHighlights={importedHighlights}
            importedHistory={displayedImportedHistory}
            importedImages={importedCarriesAttachments ? attachmentImageViewer : null}
            importedSessionId={record.externalOrigin?.sessionId ?? null}
            onEarlierImportedHistory={onEarlierImportedHistory}
            onRetryExternalHistory={onRetryExternalHistory}
            prose={prose}
            provenanceNote={provenanceNote}
            textClipboard={textClipboard}
            threadId={threadId}
            turnsTruncated={record.turnsTruncated}
          />
```

(`record.externalOrigin != null` becomes `importedSessionId !== null`; keep the exact semantics - `externalOrigin` null or undefined means no imported block.)

Create `src/components/agentMode/conversation/AgentQueuedMessages.tsx`:

```tsx
import { Play } from "lucide-react";
import type { Ref } from "react";
import type { DeferredFollowUp } from "../../../application/agentDeferredFollowUps";
import { AgentQueuedPrompt } from "../AgentQueuedPrompt";

export interface AgentQueuedMessagesProps {
  readonly entries: ReadonlyArray<DeferredFollowUp>;
  readonly listRef: Ref<HTMLDivElement>;
  readonly onResume?: () => void;
  readonly onEdit?: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onSendNow?: (id: string) => void;
}

export function AgentQueuedMessages({
  entries,
  listRef,
  onEdit,
  onRemove,
  onResume,
  onSendNow,
}: AgentQueuedMessagesProps) {
  if (entries.length === 0) return null;
  return (
    <div
      aria-label="Pending messages"
      className="agent-queued-list"
      ref={listRef}
      role="region"
      tabIndex={-1}
    >
      {entries.some((entry) => entry.state === "paused") && onResume !== undefined && (
        <div className="agent-queued-list__controls">
          <button
            aria-label="Resume queued messages"
            className="agent-prompt__queue-action agent-prompt__queue-action--resume"
            onClick={onResume}
            title="Resume queued messages"
            type="button"
          >
            <Play aria-hidden="true" />
            Resume
          </button>
        </div>
      )}
      {entries.map((entry) => (
        <AgentQueuedPrompt
          attachments={entry.request.attachments}
          displayAttachmentCount={entry.displayAttachmentCount}
          id={entry.id}
          key={entry.id}
          onEdit={onEdit}
          onRemove={onRemove}
          onSendNow={onSendNow}
          prompt={entry.request.prompt}
          state={entry.editLease === undefined ? entry.state : "editing"}
        />
      ))}
    </div>
  );
}
```

In `AgentThreadSession.tsx` replace the `{deferredFollowUps.length > 0 && (<div className="agent-queued-list" ...>...</div>)}` block with:

```tsx
          <AgentQueuedMessages
            entries={deferredFollowUps}
            listRef={queueRef}
            onEdit={onEditDeferredFollowUp === undefined ? undefined : editQueued}
            onRemove={removeQueued}
            onResume={
              onResumeDeferredFollowUps === undefined
                ? undefined
                : () => void onResumeDeferredFollowUps(threadId)
            }
            onSendNow={onSendDeferredFollowUpNow === undefined ? undefined : sendQueuedNow}
          />
```

- [ ] **Step 6: Implement the bottom dock**

Rewrite `src/components/agentMode/AgentBackgroundWorkBanner.tsx`'s returned JSX (keep its hooks and props) and imports (`Square` and the css import go away; add `import { ComposerBanner } from "../../ui/foundation/ComposerBanner";`):

```tsx
  if (status === null) return null;
  return (
    <div className="agent-background-banner">
      <ComposerBanner
        actions={
          onStop === undefined ? undefined : (
            <button
              aria-label="Stop agent and background work"
              className="agent-background-banner__stop cv-banner-action"
              onClick={onStop}
              type="button"
            >
              Stop
            </button>
          )
        }
        tone="working"
      >
        <span className="cv-banner-strong">{status}</span>
      </ComposerBanner>
    </div>
  );
```

Delete `src/components/agentMode/agentBackgroundWorkBanner.css`.

Create `src/components/agentMode/conversation/AgentSessionDock.tsx`:

```tsx
import { ChevronRight, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { ComposerBanner } from "../../../ui/foundation/ComposerBanner";
import { AgentJumpToLatest } from "../AgentJumpToLatest";
import type { AgentAgentsBannerModel } from "./agentAgentsBannerPresentation";

export interface AgentSessionDockFollow {
  readonly atLatest: boolean;
  readonly unseenActivity: boolean;
  jumpToLatest(): void;
}

export interface AgentSessionDockProps {
  readonly follow: AgentSessionDockFollow;
  readonly queuedCount: number;
  readonly agents: AgentAgentsBannerModel | null;
  readonly background: ReactNode;
  onRevealQueue(): void;
  onOpenAgents(): void;
}

export function AgentSessionDock({
  agents,
  background,
  follow,
  onOpenAgents,
  onRevealQueue,
  queuedCount,
}: AgentSessionDockProps) {
  const banners = agents !== null || background !== null;
  return (
    <div className="cv-session-dock cv-conversation-column">
      <AgentJumpToLatest
        onJump={follow.jumpToLatest}
        unseenActivity={follow.unseenActivity}
        visible={!follow.atLatest}
      />
      {queuedCount > 0 && (
        <div className="agent-session__queue-summary">
          <button
            aria-label={`Show ${queuedCount} queued ${queuedCount === 1 ? "message" : "messages"}`}
            className="agent-prompt__queue-action agent-session__queue-count"
            onClick={onRevealQueue}
            title="Show pending messages, including paused messages"
            type="button"
          >
            <Clock3 aria-hidden="true" size={12} />
            {queuedCount} queued
          </button>
        </div>
      )}
      {banners && (
        <div className="cv-session-dock__banners">
          {agents !== null && (
            <ComposerBanner
              actions={
                <button
                  aria-label="View agents"
                  className="cv-banner-action"
                  onClick={onOpenAgents}
                  type="button"
                >
                  View
                  <ChevronRight aria-hidden="true" size={12} />
                </button>
              }
              tone="working"
            >
              <span className="cv-banner-line">
                <span className="cv-banner-strong">{agents.label}</span>
                <span className="cv-banner-detail">{agents.names}</span>
              </span>
            </ComposerBanner>
          )}
          {background}
        </div>
      )}
    </div>
  );
}
```

In `AgentThreadSession.tsx`:
1. Add imports `AgentSessionDock` (`./conversation/AgentSessionDock`), `agentAgentsBannerModel` (`./conversation/agentAgentsBannerPresentation`), `AgentLiveRow` (`./conversation/AgentLiveRow`), `AgentSessionPreamble`, `AgentQueuedMessages`; drop the now-unused `Clock3`, `Play`, `AgentHistoryPager`, `AgentImportedHistory` (keep the `AgentExternalHistoryState` type import), `AgentQueuedPrompt` and `AgentJumpToLatest` imports.
2. Add `export type AgentThreadAwaiting = "approval" | "input";`, the prop `readonly awaiting?: AgentThreadAwaiting | null;`, destructure `awaiting = null`, and after the `</AgentArtifactPreviewScope>` closing tag render:

```tsx
          {awaiting !== null && liveTurn !== null && !isTerminalAgentTurnStatus(liveTurn.status) && (
            <AgentLiveRow
              label={awaiting === "approval" ? "Waiting for approval" : "Waiting for your answer"}
              tone={awaiting === "approval" ? "approval" : "input"}
            />
          )}
```

3. Add `const agentsBanner = useMemo(() => agentAgentsBannerModel(agents.groups), [agents.groups]);` next to the other memos.
4. Replace `<AgentJumpToLatest ... />`, `<AgentBackgroundWorkBanner ... />` and the `.agent-session__queue-summary` block after the scroll container with:

```tsx
      <AgentSessionDock
        agents={agentsBanner}
        background={
          <AgentBackgroundWorkBanner
            onStop={onStopBackground}
            provider={record.provider.kind}
            threadId={threadId}
            turn={liveTurn}
          />
        }
        follow={follow}
        onOpenAgents={agents.openPanel}
        onRevealQueue={revealQueue}
        queuedCount={deferredFollowUps.length}
      />
```

Because `AgentBackgroundWorkBanner` may render `null`, `AgentSessionDock` treats the `background` element as present; the empty `.cv-session-dock__banners` container is hidden by CSS (`:empty` is not enough for a component rendering null inside it, so the CSS uses `.cv-session-dock__banners:not(:has(*))`).

- [ ] **Step 7: Empty thread hero**

Replace the returned JSX of `AgentThreadSessionEmpty` with:

```tsx
    <section aria-label="New agent thread" className="agent-session cv-empty-hero">
      <div className="cv-empty-hero__body cv-conversation-column">
        <AgentEmptyTitle repositoryLabel={repositoryLabel} />
      </div>
    </section>
```

- [ ] **Step 8: Styles**

Append to `conversation/conversation.css`:

```css
.cv-session-dock {
  position: relative;
  display: grid;
  flex: none;
  padding: 0 20px;
}

.cv-session-dock .agent-jump-latest {
  bottom: calc(100% + var(--cv-space-5));
}

.cv-session-dock__banners {
  display: grid;
}

.cv-session-dock__banners:not(:has(*)) {
  display: none;
}

.cv-session-dock__banners .cv-composer-banner {
  margin-bottom: 0;
  padding-bottom: 6px;
}

.agent-session__queue-summary {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--cv-space-5) var(--cv-space-2);
}

.cv-banner-strong {
  color: var(--cv-fg-strong);
  font-weight: 500;
}

.cv-banner-line {
  display: inline-flex;
  gap: var(--cv-space-4);
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.cv-banner-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cv-banner-action {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-2);
  height: 24px;
  padding: 0 var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-muted);
  font: inherit;
  cursor: pointer;
}

.cv-banner-action:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-banner-action:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.cv-empty-hero {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 0;
  padding: 0 20px var(--cv-space-8);
}

.agent-empty__title {
  margin: 0;
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-display);
  font-size: 28px;
  font-weight: 500;
  line-height: 36px;
  letter-spacing: -0.015em;
  text-align: center;
  overflow-wrap: anywhere;
}

.agent-empty__project {
  text-decoration: underline dotted var(--cv-fg-subtle);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 6px;
}

.agent-empty__text {
  max-width: 480px;
  margin: var(--cv-space-4) auto 0;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-sm);
  text-align: center;
}
```

(P3 never restyles P1's own `.cv-composer-banner*` elements except the two dock overrides above that detach the banner from a slab; the text row is P3's `.cv-banner-line`.)

Delete from `agentThread.css` every `.agent-empty*` and `.agent-session__body--empty` rule. In `agentThreadStyles.test.ts` delete "underlines the project in the empty-state question". Add to `conversationStyles.test.ts`:

```ts
  it("centres the empty-thread question like the mockup hero", () => {
    expect(declaredValue(CONVERSATION, ".cv-empty-hero", "flex")).toBe("1 1 0");
    expect(declaredValue(CONVERSATION, ".cv-empty-hero", "justify-content")).toBe("flex-end");
    expect(declaredValue(CONVERSATION, ".agent-empty__title", "font-size")).toBe("28px");
    expect(declaredValue(CONVERSATION, ".agent-empty__title", "line-height")).toBe("36px");
    expect(declaredValue(CONVERSATION, ".agent-empty__project", "text-decoration")).toBe(
      "underline dotted var(--cv-fg-subtle)",
    );
  });
```

- [ ] **Step 9: Update behavior tests**

- `AgentThreadSession.background.test.tsx`: `.agent-background-banner` and `.agent-background-banner__stop` still exist; the status text is now inside `.cv-composer-banner__message` (role `status` sits on the `.cv-composer-banner` element); replace any `.agent-background-banner__status` selector with `.agent-background-banner [role="status"]`.
- `AgentThreadSession.test.tsx`: `.agent-session__body--empty` → `.cv-empty-hero`; the title text is unchanged.
- Tests counting `.agent-session__queue-count` / "Show N queued messages" keep working (same element and label).

- [ ] **Step 10: Run the focused tests and check the hotspot**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/AgentThreadSession.background.test.tsx src/components/agentMode/AgentThreadSession.transcript.test.tsx src/components/agentMode/AgentThreadSession.viewport.test.tsx src/components/agentMode/AgentThreadSession.minimap.test.tsx src/components/agentMode/AgentThreadSession.hydration.test.tsx src/components/agentMode/AgentThreadSession.agentsPanel.test.tsx src/components/agentMode/AgentThreadSession.turnLog.test.tsx src/components/agentMode/agentThreadTurns.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/agentMode/agentThreadStyles.test.ts`
Expected: PASS (drop paths that do not exist).

Run: `cd /Users/matusmockor/Developer/editor && node -e 'import("./scripts/check-hotspot-size-budget.mjs").then(({countSourceLines,countStructuralTokens})=>{const fs=require("fs");const f="src/components/agentMode/AgentThreadSession.tsx";const c=fs.readFileSync(f,"utf8");console.log(countSourceLines(c),countStructuralTokens(c,f))})'`
Expected: fewer than 4874 structural tokens (the pre-P3 value).

---
### Task 8: Foundation submit button gains busy, title, shortcuts and a class hook

**Files:**
- Modify: `src/ui/foundation/SubmitButton.tsx`
- Modify: `src/ui/foundation/buttons.test.tsx`

**Interfaces:**
- Consumes: `Spinner` (`src/ui/foundation/Spinner.tsx`), `cx` (`classNames.ts`).
- Produces: `SubmitButtonProps` adds `readonly busy?: boolean; readonly title?: string; readonly keyShortcuts?: string; readonly className?: string;` (all optional; existing callers and the three existing tests are unchanged).

- [ ] **Step 1: Write the failing test**

Append inside `describe("SubmitButton", ...)` in `src/ui/foundation/buttons.test.tsx`:

```tsx
  it("shows a busy spinner, a custom title, key shortcuts and an extra class", () => {
    const { host } = mount(
      <SubmitButton
        busy
        className="agent-composer__send"
        keyShortcuts="Enter Meta+Enter"
        label="Send follow-up"
        mode="send"
        title="Send follow-up (Enter)"
      />,
    );
    const button = host.querySelector("button");

    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.getAttribute("aria-keyshortcuts")).toBe("Enter Meta+Enter");
    expect(button?.title).toBe("Send follow-up (Enter)");
    expect(button?.className).toBe("cv-submit agent-composer__send");
    expect(button?.querySelector(".cv-spinner")).not.toBeNull();
    expect(button?.querySelector("path[d='M8 3L8 13M8 3L4 7M8 3L12 7']")).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/ui/foundation/buttons.test.tsx`
Expected: FAIL - `aria-busy` is null.

- [ ] **Step 3: Implement**

Replace `src/ui/foundation/SubmitButton.tsx` props and component (glyph functions unchanged):

```tsx
import { cx } from "./classNames";
import { Spinner } from "./Spinner";
import "./buttons.css";

export type SubmitButtonMode = "send" | "stop" | "update";

export interface SubmitButtonProps {
  readonly mode: SubmitButtonMode;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly title?: string;
  readonly busy?: boolean;
  readonly keyShortcuts?: string;
  readonly className?: string;
  onClick?(): void;
}

const LABELS: Readonly<Record<SubmitButtonMode, string>> = {
  send: "Send message",
  stop: "Stop generation",
  update: "Update queued message",
};

export function SubmitButton({
  busy = false,
  className,
  disabled = false,
  keyShortcuts,
  label,
  mode,
  onClick,
  title,
}: SubmitButtonProps) {
  const accessibleLabel = label ?? LABELS[mode];
  const stopping = mode === "stop";
  return (
    <button
      aria-busy={busy || undefined}
      aria-keyshortcuts={keyShortcuts}
      aria-label={accessibleLabel}
      className={cx("cv-submit", stopping && "cv-submit--stop", className)}
      disabled={disabled}
      onClick={onClick}
      title={title ?? accessibleLabel}
      type={stopping ? "button" : "submit"}
    >
      {submitGlyph(busy, stopping)}
    </button>
  );
}

function submitGlyph(busy: boolean, stopping: boolean) {
  if (busy) return <Spinner />;
  if (stopping) return <StopGlyph />;
  return <ArrowGlyph />;
}
```

- [ ] **Step 4: Run the foundation tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/ui/foundation`
Expected: PASS (the stop test still sees `className` `"cv-submit cv-submit--stop"`).

---

### Task 9: Composer frame, slab, foot, drawer, round submit and extension slots

**Files:**
- Create: `src/components/agentMode/composer/AgentComposerFrame.tsx`
- Create: `src/components/agentMode/composer/AgentComposerFrame.test.tsx`
- Create: `src/components/agentMode/composer/agentComposerFrame.css`
- Modify: `src/components/agentMode/AgentComposer.tsx` (JSX return, new props, placeholder copy)
- Modify: `src/components/agentMode/AgentComposerSubmitControls.tsx` (foundation `SubmitButton`)
- Modify: `src/components/agentMode/AgentComposerController.tsx` (pass-through props + equality)
- Modify: `src/components/agentMode/agentComposer.css` (delete the groups P3 owns)
- Modify: `src/components/agentMode/agentComposerCommands.css` (re-token)
- Modify: `src/components/agentMode/conversation/conversationStyles.test.ts` (composer sheet)
- Modify tests: `AgentComposer.test.tsx` ("AgentComposer Airy styling contract" blocks 1-2, selector map), `AgentComposerController.test.tsx`, `AgentModeView.test.tsx` (selector map), `agentModeResponsiveStyles.test.ts` (composer blocks)

**Interfaces:**
- Consumes: `SubmitButton` (Task 8), `IconButton` (`size="round"`, `className`, `label`, `icon`), `AgentTaskIsolation` (already imported in `AgentComposer.tsx`), `AgentComposerTarget.selectedRepositoryRoot`.
- Produces:
  - `export type AgentComposerLayout = "dock" | "hero"`
  - `export interface AgentComposerDrawerContext { readonly repositoryRoot: string | null; readonly isolation: AgentTaskIsolation; readonly locked: boolean; readonly disabled: boolean }` (P9 extends it in its own hunk)
  - `export interface AgentComposerFrameProps { readonly layout: AgentComposerLayout; readonly banners: ReactNode; readonly slab: ReactNode; readonly drawerStart: ReactNode; readonly drawerEnd: ReactNode }`, `AgentComposerFrame`
  - `AgentComposerProps` adds `readonly banners?: ReactNode; readonly placeholder?: string; readonly layout?: AgentComposerLayout; readonly renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode;`
  - `AgentComposerControllerProps` adds `readonly banners?: ReactNode; readonly renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode;` (compared by identity in `agentComposerControllerPropsEqual`)
  - DOM: `div.cv-composer-dock[data-layout] > div.cv-composer.cv-conversation-column > (div.cv-composer__banners, form.agent-composer.cv-composer__slab, div.cv-composer__drawer.agent-composer__footer > (div.cv-composer__drawer-start, div.cv-composer__drawer-end))`; inside the form: `div.agent-composer__box` (editor), `div.cv-composer__notes`, `div.cv-composer__foot[data-presentation] > (div.cv-composer__controls, div.cv-composer__actions)`.
  - Placeholders: new thread "Ask for changes, send follow-ups, or attach images"; follow-up "Ask anything, or / for commands"; steer + queue "Queue a follow-up"; steer + immediate "Send a message to the running agent" (unchanged); queued edit "Edit the queued message" (unchanged).

- [ ] **Step 1: Write the failing tests**

Create `src/components/agentMode/composer/AgentComposerFrame.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentComposerFrame } from "./AgentComposerFrame";

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

describe("AgentComposerFrame", () => {
  it("stacks banners, slab and drawer in the column with the layout marker", () => {
    act(() =>
      root.render(
        <AgentComposerFrame
          banners={<p>clone</p>}
          drawerEnd={<span>feat/idempotency-keys</span>}
          drawerStart={<span>Local checkout</span>}
          layout="hero"
          slab={<form aria-label="Slab" />}
        />,
      ),
    );

    const dock = host.querySelector<HTMLElement>(".cv-composer-dock");
    expect(dock?.dataset.layout).toBe("hero");
    const column = dock?.querySelector(".cv-composer.cv-conversation-column");
    expect([...(column?.children ?? [])].map((child) => child.className)).toEqual([
      "cv-composer__banners",
      "",
      "cv-composer__drawer agent-composer__footer",
    ]);
    expect(host.querySelector(".cv-composer__drawer-start")?.textContent).toBe("Local checkout");
    expect(host.querySelector(".cv-composer__drawer-end")?.textContent).toBe("feat/idempotency-keys");
  });
});
```

Add to `conversationStyles.test.ts`: `const COMPOSER = "components/agentMode/composer/agentComposerFrame.css";`, append it to `P3_SHEETS`, extend `MEDIA_CHIP_SELECTORS` with `".agent-composer-attachment__remove"` and `".agent-composer-attachment__remove:hover"` (Task 10 uses them), and add:

```ts
  it("draws the composer slab, foot and drawer at the t3code measurements", () => {
    expect(declaredValue(COMPOSER, ".cv-composer__slab", "border-radius")).toBe(
      "var(--cv-r-composer)",
    );
    expect(declaredValue(COMPOSER, ".cv-composer__slab", "background")).toBe("var(--cv-raised)");
    expect(declaredValue(COMPOSER, ".cv-composer__slab", "border")).toBe("1px solid var(--cv-hair)");
    expect(declaredValue(COMPOSER, ".cv-composer__slab:focus-within", "border-color")).toBe(
      "var(--cv-hair-strong)",
    );
    expect(declaredValue(COMPOSER, ".agent-composer__box", "min-height")).toBe("86px");
    expect(declaredValue(COMPOSER, ".agent-composer__box", "padding")).toBe(
      "var(--cv-space-6) var(--cv-space-6) 10px",
    );
    expect(declaredValue(COMPOSER, ".cv-composer__foot", "height")).toBe("48px");
    expect(declaredValue(COMPOSER, ".cv-composer__foot", "padding")).toBe(
      "0 var(--cv-space-6) var(--cv-space-6) var(--cv-space-5)",
    );
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "height")).toBe("32px");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "margin")).toBe("-1px 22px 0");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "border-radius")).toBe("0 0 14px 14px");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "background")).toBe("var(--cv-side)");
    expect(declaredValue(COMPOSER, ".agent-composer__textarea", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(COMPOSER, '.cv-composer-dock[data-layout="hero"]', "flex")).toBe("1 1 0");
  });

  it("truncates the drawer and foot controls instead of widening the column", () => {
    expect(declaredValue(COMPOSER, ".cv-composer__drawer-start", "overflow")).toBe("hidden");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer-end", "overflow")).toBe("hidden");
    expect(declaredValue(COMPOSER, ".cv-composer__controls", "overflow")).toBe("hidden");
    expect(declaredValue(COMPOSER, ".cv-composer__controls", "min-width")).toBe("0");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/composer src/components/agentMode/conversation/conversationStyles.test.ts`
Expected: FAIL - module/sheet missing.

- [ ] **Step 3: Implement the frame**

Create `src/components/agentMode/composer/AgentComposerFrame.tsx`:

```tsx
import type { ReactNode } from "react";
import type { AgentTaskIsolation } from "../../../domain/agentTask";
import "./agentComposerFrame.css";

export type AgentComposerLayout = "dock" | "hero";

export interface AgentComposerDrawerContext {
  readonly repositoryRoot: string | null;
  readonly isolation: AgentTaskIsolation;
  readonly locked: boolean;
  readonly disabled: boolean;
}

export interface AgentComposerFrameProps {
  readonly layout: AgentComposerLayout;
  readonly banners: ReactNode;
  readonly slab: ReactNode;
  readonly drawerStart: ReactNode;
  readonly drawerEnd: ReactNode;
}

export function AgentComposerFrame({
  banners,
  drawerEnd,
  drawerStart,
  layout,
  slab,
}: AgentComposerFrameProps) {
  return (
    <div className="cv-composer-dock" data-layout={layout}>
      <div className="cv-composer cv-conversation-column">
        <div className="cv-composer__banners">{banners}</div>
        {slab}
        <div className="cv-composer__drawer agent-composer__footer">
          <div className="cv-composer__drawer-start">{drawerStart}</div>
          <div className="cv-composer__drawer-end">{drawerEnd}</div>
        </div>
      </div>
    </div>
  );
}
```

(Verify the `AgentTaskIsolation` import path with `grep -n "AgentTaskIsolation" src/components/agentMode/AgentComposer.tsx` and use the same module.)

Create `src/components/agentMode/composer/agentComposerFrame.css`:

```css
.cv-composer-dock {
  flex: none;
  min-width: 0;
  padding: 0 20px var(--cv-space-6);
}

.cv-composer-dock[data-layout="hero"] {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  justify-content: flex-start;
  padding-bottom: 80px;
}

.cv-composer {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.cv-composer__banners {
  display: grid;
}

.cv-composer__banners:empty {
  display: none;
}

.cv-composer__slab {
  position: relative;
  z-index: 1;
  min-width: 0;
  margin: 0;
  border: 1px solid var(--cv-hair);
  border-radius: var(--cv-r-composer);
  background: var(--cv-raised);
  box-shadow: var(--cv-edge-top), var(--cv-lift);
  transition: border-color var(--cv-motion-fast) var(--cv-ease);
}

.cv-composer__slab:focus-within {
  border-color: var(--cv-hair-strong);
}

.agent-composer__box {
  min-width: 0;
  min-height: 86px;
  padding: var(--cv-space-6) var(--cv-space-6) 10px;
  border-radius: var(--cv-r-composer) var(--cv-r-composer) 0 0;
}

.agent-composer__box--drop {
  box-shadow: inset 0 0 0 1px var(--cv-accent);
}

.agent-composer__textarea {
  display: block;
  width: 100%;
  min-height: calc(var(--cv-t-sm) * var(--cv-lh-prose) * 2);
  max-height: min(40vh, calc(420px * var(--codevo-fs-scale, 1)));
  padding: 0;
  border: 0;
  outline: 0;
  resize: none;
  background: none;
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-ui);
  font-size: calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1));
  line-height: var(--cv-lh-prose);
}

.agent-composer__textarea::placeholder {
  color: var(--cv-fg-subtle);
}

.agent-composer__textarea:disabled {
  cursor: not-allowed;
}

.cv-composer__notes {
  display: grid;
  gap: var(--cv-space-2);
  padding: 0 var(--cv-space-6) var(--cv-space-4);
}

.cv-composer__notes:empty {
  display: none;
}

.agent-composer__caption,
.agent-composer__reason {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--cv-space-2) var(--cv-space-4);
  margin: 0;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  line-height: var(--cv-lh-xs);
}

.agent-composer__caption p {
  margin: 0;
}

.agent-composer__caption[role="alert"],
.agent-composer__caption [role="alert"] {
  color: var(--cv-danger);
}

.cv-composer__foot {
  display: flex;
  align-items: center;
  gap: var(--cv-space-4);
  min-width: 0;
  height: 48px;
  padding: 0 var(--cv-space-6) var(--cv-space-6) var(--cv-space-5);
}

.cv-composer__controls {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.cv-composer__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--cv-space-4);
  margin-left: auto;
}

.agent-composer__alternate,
.agent-composer__reason button {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  cursor: pointer;
}

.agent-composer__alternate:hover:not(:disabled),
.agent-composer__reason button:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.agent-composer__alternate:disabled {
  color: var(--cv-fg-disabled);
  cursor: default;
}

.agent-composer__bytes {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
}

.agent-composer__bytes--over {
  color: var(--cv-danger);
}

.cv-composer__drawer {
  display: flex;
  align-items: center;
  gap: var(--cv-space-3);
  min-width: 0;
  height: 32px;
  margin: -1px 22px 0;
  padding: 0 var(--cv-space-5);
  border: 1px solid var(--cv-hair);
  border-top: 0;
  border-radius: 0 0 14px 14px;
  background: var(--cv-side);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-composer__drawer-start {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--cv-space-3);
  min-width: 0;
  overflow: hidden;
}

.cv-composer__drawer-end {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
}

.cv-composer__drawer-end:empty {
  display: none;
}

.agent-compaction-offer {
  flex-wrap: wrap;
}

.agent-compaction-offer__copy {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--cv-space-4);
  min-width: 0;
}

.agent-compaction-offer__copy strong {
  color: var(--cv-fg-strong);
  font-weight: 500;
}

.agent-compaction-offer__explanation {
  flex-basis: 100%;
  margin: var(--cv-space-2) 0 0;
  color: var(--cv-fg-muted);
}
```

- [ ] **Step 4: Rebuild the composer JSX on the frame**

In `src/components/agentMode/AgentComposer.tsx`:
1. Imports: add `type ReactNode` to the React import; add `import { IconButton } from "../../ui/foundation/IconButton";`, `import { AgentComposerFrame, type AgentComposerDrawerContext, type AgentComposerLayout } from "./composer/AgentComposerFrame";`.
2. `AgentComposerProps` add:

```ts
  readonly banners?: ReactNode;
  readonly placeholder?: string;
  readonly layout?: AgentComposerLayout;
  readonly renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode;
```

   and destructure `banners = null, placeholder, layout, renderDrawerEnd,`.
3. Replace `const footer = followUp ? ... : targetControls;` with:

```tsx
  const checkout = followUp ? (
    <AgentComposerLockedCheckout isolation={isolation} remote={executionTarget === "server"} />
  ) : (
    targetControls
  );
  const drawerContext = useMemo<AgentComposerDrawerContext>(
    () => ({
      repositoryRoot: target?.selectedRepositoryRoot ?? null,
      isolation,
      locked: followUp,
      disabled: dispatching || allProvidersDisabled,
    }),
    [target, isolation, followUp, dispatching, allProvidersDisabled],
  );
  const drawerStart = (
    <>
      {onOpenEnvironmentSettings !== undefined && (
        <>
          <AgentExecutionEnvironmentPicker
            disabled={dispatching}
            locked={followUp}
            executionServerId={executionServerId}
            onOpenEnvironmentSettings={onOpenEnvironmentSettings}
          />
          <span aria-hidden="true" className="agent-composer__divider" />
        </>
      )}
      {checkout}
    </>
  );
```

4. Move the whole compaction-offer JSX (`{compactionOffer !== null && ... && (<div className="agent-compaction-offer">...</div>)}`) into a constant `compactionBanner` and change its root to `<div className="cv-composer-banner cv-composer-banner--neutral agent-compaction-offer">`; give the "Compact" button and the dismiss button the extra class `cv-banner-action`.
5. Replace the `return (<form ...>...</form>);` with:

```tsx
  const slab = (
    <form
      aria-label={followUp ? "Follow up on agent thread" : "New agent thread"}
      className="agent-composer cv-composer__slab"
      onSubmit={submit}
      ref={composerRef}
    >
      <div
        className={
          dropActive ? "agent-composer__box agent-composer__box--drop" : "agent-composer__box"
        }
        data-agent-composer-drop={dropActive ? "active" : undefined}
      >
        {queuedEdit !== null && <AgentComposerQueuedEditBar edit={queuedEdit} />}
        {attachments !== null && (
          <AgentComposerAttachments
            key={JSON.stringify([attachmentTargetKey, executionServerId, promptOwnerKey])}
            drafts={attachments.drafts}
            onDismissRefusal={attachments.dismissRefusal}
            onRemove={attachments.remove}
            refusal={attachments.refusal}
          />
        )}
        {/* keep the existing <label>, <textarea> and {commands.open && <AgentComposerCommands/>} exactly as they are today, except the placeholder expression below */}
      </div>
      <div className="cv-composer__notes">
        {/* move here, unchanged, the recovery caption, the over-limit caption, the unavailable-attachment alert and the provider/target reason that are today inside .agent-composer__box after .agent-composer__row */}
      </div>
      <div className="cv-composer__foot" data-presentation={compact ? "compact" : "inline"}>
        <div className="cv-composer__controls">{launchControls}</div>
        <div className="cv-composer__actions">
          <AgentComposerBytes promptBytes={promptBytes} />
          {(attachmentsEnabled || targetReason !== null) && (
            <IconButton
              className="agent-composer__attach"
              disabled={dispatching || !attachmentsEnabled}
              icon={<Paperclip size={16} strokeWidth={1.5} />}
              label="Attach files"
              onClick={pickAttachments}
              size="round"
              title={attachmentsEnabled ? "Attach files" : (targetReason ?? "Choose a project")}
            />
          )}
          <AgentComposerSubmitControls
            running={running}
            steering={steering}
            editingQueued={editingQueued}
            dispatching={dispatching}
            disabled={blocked && !localCommandAvailable}
            submitName={submitName}
            followUpBehavior={effectiveFollowUpBehavior}
            immediateBlockedReason={immediateBlockedReason}
            shortcut={shortcut}
            onStop={onStop}
            onAlternate={() => {
              if (commands.interceptSubmit() || blocked) return;
              dispatch(true);
            }}
          />
        </div>
      </div>
    </form>
  );

  return (
    <AgentComposerFrame
      banners={
        <>
          {banners}
          {compactionBanner}
        </>
      }
      drawerEnd={renderDrawerEnd === undefined ? null : renderDrawerEnd(drawerContext)}
      drawerStart={drawerStart}
      layout={layout ?? (mode.kind === "new" ? "hero" : "dock")}
      slab={slab}
    />
  );
```

   The two `{/* ... */}` markers above are instructions for this step only - replace them with the moved JSX; the committed file contains no comments. `.cv-composer__banners:empty` hides the stack when `banners` is null and there is no offer (React renders nothing for `null`/`false`).
6. Placeholder expression on the textarea becomes:

```tsx
          placeholder={
            targetReason ??
            (editingQueued
              ? "Edit the queued message"
              : (placeholder ?? composerPlaceholder(mode, effectiveFollowUpBehavior)))
          }
```

   and `composerPlaceholder` returns `"Queue a follow-up"` for steer+queue, `"Send a message to the running agent"` for steer+immediate, `"Ask anything, or / for commands"` for follow-up and `"Ask for changes, send follow-ups, or attach images"` for a new thread.
7. Delete the now-unused `agent-composer__row`, `agent-composer__spacer`, `agent-composer__footer` wrapper JSX (their content moved above).

- [ ] **Step 5: Round submit and stop from the foundation**

Replace the body of `AgentComposerSubmitControls` return with:

```tsx
  return (
    <>
      {steering && !editingQueued && (
        <button
          className="agent-composer__alternate"
          disabled={disabled || immediateBlockedReason !== null}
          aria-label={alternateName}
          aria-keyshortcuts={shortcut.secondary.keys}
          title={immediateBlockedReason ?? `${alternateName} (${shortcut.secondary.glyphs})`}
          type="button"
          onClick={onAlternate}
        >
          {alternateName}
        </button>
      )}
      {running && (
        <SubmitButton
          busy={dispatching}
          className="agent-composer__stop"
          label="Stop agent"
          mode="stop"
          onClick={onStop}
          title="Stop (Esc)"
        />
      )}
      {(!running || enterOnly) && (
        <SubmitButton
          busy={dispatching}
          className="agent-composer__send"
          disabled={disabled}
          keyShortcuts={enterOnly ? "Enter" : agentSubmitKeyShortcuts(shortcut)}
          label={submitName}
          mode={editingQueued ? "update" : "send"}
          title={
            enterOnly
              ? `${submitName} (Enter)`
              : `${submitName} (Enter or ${shortcut.secondary.glyphs})`
          }
        />
      )}
    </>
  );
```

and change its imports to `import { SubmitButton } from "../../ui/foundation/SubmitButton";` (drop `ArrowUp`, `Loader2`, `Square`).

- [ ] **Step 6: Controller pass-through**

In `AgentComposerController.tsx`: add `import type { ReactNode } from "react";` and `import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";`; add to `AgentComposerControllerProps`:

```ts
  readonly banners?: ReactNode;
  readonly renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode;
```

destructure them, pass `banners={banners}` and `renderDrawerEnd={renderDrawerEnd}` to `<AgentComposer>`, and add `left.banners === right.banners && left.renderDrawerEnd === right.renderDrawerEnd &&` at the start of the boolean chain in `agentComposerControllerPropsEqual`. Add to `AgentComposerController.test.tsx`:

```tsx
  it("re-renders when the extension slots change and passes them through", () => {
    const banner = <p className="p8-banner">Cloning orders-api</p>;
    renderController({ banners: banner, renderDrawerEnd: () => <span className="p9-branch">main</span> });
    expect(host.querySelector(".cv-composer__banners .p8-banner")?.textContent).toBe("Cloning orders-api");
    expect(host.querySelector(".cv-composer__drawer-end .p9-branch")?.textContent).toBe("main");
  });
```

(`renderController` = the file's existing helper that renders `<AgentComposerController>` with its default props; spread the extra props into it. If the helper has another name, use it.)

- [ ] **Step 7: Remove the composer groups P3 owns from the legacy sheet**

In `src/components/agentMode/agentComposer.css` delete every rule whose selectors are only among: `.agent-composer` (root, including its `max-width: 768px`), `.agent-composer__box*`, `.agent-composer__textarea*`, `.agent-composer__row*`, `.agent-composer__attach*`, `.agent-composer__spacer`, `.agent-composer__send*`, `.agent-composer__stop*`, `.agent-composer__alternate*`, `.agent-composer__caption*`, `.agent-composer__reason*`, `.agent-composer__bytes*`, `.agent-composer__footer` (the bare layout rule only), `.agent-compaction-offer*`. Leave to P9 (do not edit): `.agent-picker*`, `.agent-model-picker*`, `.agent-traits-picker*`, `.agent-composer__launch*`, `.agent-composer__compact*`, `.agent-composer__lock*`, `.agent-composer__target*`, `.agent-composer__divider`, `.agent-environment*`, and any rule that combines `.agent-composer__footer` with a picker selector. Re-token `agentComposerCommands.css` with the Global Constraints table (`--color-surface`→`--cv-popover`, `--color-hover`→`--cv-tint-2`, `--color-text-muted`→`--cv-fg-muted`, `--font-mono`→`--cv-font-mono`, `--codevo-sans`→`--cv-font-ui`) and add it to `P3_SHEETS` as `"components/agentMode/agentComposerCommands.css"`.

- [ ] **Step 8: Update the legacy composer tests**

- `AgentComposer.test.tsx`, describe "AgentComposer Airy styling contract": delete "centres the composer box at 768px, raised on radius 14 with the card shadow only" and "renders the send button as a 30px round primary control that idles on the active tone" (the composer contract test replaces them); leave the picker blocks to P9.
- Selector map for `AgentComposer*.test.tsx`, `AgentModeView*.test.tsx`, `AgentCloneComposer.test.tsx`:

| Old | New |
|---|---|
| `.agent-composer__row` | `.cv-composer__foot` |
| `.agent-composer__footer` | `.cv-composer__drawer` (the old class is still on the element; only change assertions that check its children order) |
| `.agent-composer__send--busy`, `.agent-composer__send-spinner` | `.agent-composer__send[aria-busy="true"]`, `.agent-composer__send .cv-spinner` |
| `.agent-composer__stop` svg `rect` | unchanged (`SubmitButton` stop glyph is a `rect`) |
| placeholder `"Queue a message for the next turn"` | `"Queue a follow-up"` |
| placeholder `"Reply to the agent in this thread"` | `"Ask anything, or / for commands"` |
| placeholder `"Ask anything or describe the change you want"` | `"Ask for changes, send follow-ups, or attach images"` |

- `agentModeResponsiveStyles.test.ts`: in "keeps the composer launch row full while the center column can hold it" replace `.agent-composer__row` with `.cv-composer__foot` and read it from `readStyleSheet("components/agentMode/composer/agentComposerFrame.css").source`.

- [ ] **Step 9: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/ui/foundation src/components/agentMode/composer src/components/agentMode/conversation/conversationStyles.test.ts src/components/agentMode/AgentComposer.test.tsx src/components/agentMode/AgentComposer.render.test.tsx src/components/agentMode/AgentComposer.commands.test.tsx src/components/agentMode/AgentComposer.textPaste.test.tsx src/components/agentMode/AgentComposerController.test.tsx src/components/agentMode/AgentComposerController.drafts.test.tsx src/components/agentMode/AgentComposerAttachments.test.tsx src/components/agentMode/AgentComposerCompactMenu.test.tsx src/components/agentMode/AgentCloneComposer.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/agentMode/agentModeResponsiveStyles.test.ts`
Expected: PASS (drop paths that do not exist).

---
### Task 10: Attachment tiles and the queued-edit state

**Files:**
- Modify: `src/components/agentMode/AgentComposerAttachments.tsx` (tile markup)
- Modify: `src/components/agentMode/AgentComposerQueuedEditBar.tsx` (banner + separate attachments)
- Modify: `src/components/agentMode/AgentComposer.tsx` (banner in the stack, queued tiles in the editor)
- Modify: `src/components/agentMode/composer/agentComposerFrame.css`, `conversation/conversationStyles.test.ts`
- Modify tests: `AgentComposerAttachments.test.tsx`, `useAgentQueuedEditImagePreviews.test.tsx`, `AgentModeView.test.tsx` (queued-edit selectors)

**Interfaces:**
- Consumes: `ComposerBanner`, `AgentComposerAttachments` props (`drafts`, `refusal`, `onDismissRefusal`, `onRemove`), `AgentComposerQueuedEdit` (`attachments`, `onRemoveAttachment`, `onCancel`).
- Produces:
  - `AgentComposerQueuedEditBar({ edit })` renders only the banner: `div.agent-composer__queued-edit[role=group][aria-label="Editing queued message"] > .cv-composer-banner` with text "Editing queued message" + "sends after this turn" and the Cancel button (`aria-label="Cancel editing queued message"`, text "Cancel").
  - `export function AgentComposerQueuedEditAttachments({ edit }: { readonly edit: AgentComposerQueuedEdit })` renders the queued message's tiles (the nested `AgentComposerAttachments` that used to live in the bar).
  - Tile DOM (unchanged class names, new layout): `ul.agent-composer__attachment-list > li > .agent-composer-attachment--image` 64x64 with `.agent-composer-attachment__thumb` filling it and `.agent-composer-attachment__remove` as the 20px round media chip at `top: 4px; right: 4px`.

- [ ] **Step 1: Write the failing tests**

Add to `conversationStyles.test.ts`:

```ts
  it("draws composer image tiles as 64px thumbnails with the round media remove chip", () => {
    expect(declaredValue(COMPOSER, ".agent-composer-attachment--image", "width")).toBe("64px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment--image", "height")).toBe("64px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__thumb", "border-radius")).toBe(
      "var(--cv-r-card)",
    );
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__remove", "width")).toBe("20px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__remove", "top")).toBe("4px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__remove", "background")).toBe(
      "rgba(0, 0, 0, 0.65)",
    );
    expect(declaredValue(COMPOSER, ".agent-composer__attachment-list", "gap")).toBe("var(--cv-space-4)");
  });
```

Add to `AgentComposerAttachments.test.tsx` (use the file's existing render helper and an image draft fixture it already builds, e.g. the one named `"shot.webp"`):

```tsx
  it("keeps the queued-edit banner above the slab and the queued image as a tile inside the editor", () => {
    renderComposerWithQueuedEdit();
    const banner = host.querySelector('.cv-composer__banners [aria-label="Editing queued message"]');
    expect(banner?.textContent).toBe("Editing queued messagesends after this turnCancel");
    const tile = host.querySelector(".agent-composer__box .agent-composer-attachment--image");
    expect(tile?.querySelector("img.agent-composer-attachment__preview")).not.toBeNull();
    expect(host.querySelector('button[aria-label="Save queued message"]')?.className).toContain(
      "cv-submit",
    );
  });
```

where `renderComposerWithQueuedEdit()` renders `AgentComposer` with the file's default props plus `running: true`, `mode: { kind: "steer", threadId: "t" }` and a `queuedEdit` built like the existing queued-edit test in that file (`attachments: [<ready image draft with previewUrl>]`, `onRemoveAttachment: vi.fn()`, `onCancel: vi.fn()`, `commit: vi.fn()`, `threadId: "t"`, `lease: {}`, `prompt: "Then regenerate openapi.yaml"`). If no such helper exists, write it in the test file with those exact values.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/conversationStyles.test.ts src/components/agentMode/AgentComposerAttachments.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Split the queued-edit bar**

Replace `src/components/agentMode/AgentComposerQueuedEditBar.tsx` with:

```tsx
import { Pencil } from "lucide-react";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { AgentComposerAttachments } from "./AgentComposerAttachments";
import type { AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";

export const AGENT_COMPOSER_QUEUED_EDIT_LABEL = "Editing queued message";
export const AGENT_COMPOSER_QUEUED_EDIT_CANCEL_LABEL = "Cancel editing queued message";
export const AGENT_COMPOSER_SAVE_QUEUED_LABEL = "Save queued message";
export const AGENT_COMPOSER_QUEUED_EDIT_HINT = "sends after this turn";

const NO_REFUSAL = null;

export function AgentComposerQueuedEditBar({ edit }: { readonly edit: AgentComposerQueuedEdit }) {
  return (
    <div
      aria-label={AGENT_COMPOSER_QUEUED_EDIT_LABEL}
      className="agent-composer__queued-edit"
      role="group"
    >
      <ComposerBanner
        actions={
          <button
            aria-label={AGENT_COMPOSER_QUEUED_EDIT_CANCEL_LABEL}
            className="agent-composer__queued-edit-cancel cv-banner-action"
            onClick={edit.onCancel}
            title="Cancel (Esc)"
            type="button"
          >
            Cancel
          </button>
        }
        icon={<Pencil size={12} strokeWidth={1.5} />}
      >
        <span className="cv-banner-line">
          <span className="agent-composer__queued-edit-title cv-banner-strong">
            {AGENT_COMPOSER_QUEUED_EDIT_LABEL}
          </span>
          <span className="cv-banner-detail">{AGENT_COMPOSER_QUEUED_EDIT_HINT}</span>
        </span>
      </ComposerBanner>
    </div>
  );
}

export function AgentComposerQueuedEditAttachments({
  edit,
}: {
  readonly edit: AgentComposerQueuedEdit;
}) {
  return (
    <AgentComposerAttachments
      drafts={edit.attachments}
      onDismissRefusal={dismissNothing}
      onRemove={edit.onRemoveAttachment}
      refusal={NO_REFUSAL}
    />
  );
}

function dismissNothing(): void {}
```

In `AgentComposer.tsx`: import `AgentComposerQueuedEditAttachments` too; in the slab replace `{queuedEdit !== null && <AgentComposerQueuedEditBar edit={queuedEdit} />}` with `{queuedEdit !== null && <AgentComposerQueuedEditAttachments edit={queuedEdit} />}`; in the frame's `banners` fragment add `{queuedEdit !== null && <AgentComposerQueuedEditBar edit={queuedEdit} />}` after `{compactionBanner}` (nearest the slab, per the Ownership agreement: external banners first).

- [ ] **Step 4: Tile styles**

Append to `composer/agentComposerFrame.css`:

```css
.agent-composer__attachments {
  display: grid;
  gap: var(--cv-space-4);
  margin-bottom: var(--cv-space-5);
}

.agent-composer__attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cv-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.agent-composer-attachment {
  position: relative;
  min-width: 0;
}

.agent-composer-attachment--image {
  width: 64px;
  height: 64px;
}

.agent-composer-attachment__thumb {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--cv-hair-strong);
  border-radius: var(--cv-r-card);
  background: var(--cv-canvas);
  color: var(--cv-fg-subtle);
  cursor: zoom-in;
}

.agent-composer-attachment__thumb:disabled {
  cursor: default;
}

.agent-composer-attachment__preview {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.agent-composer-attachment--chip {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-3);
  max-width: 240px;
  height: 32px;
  padding: 0 32px 0 var(--cv-space-4);
  border-radius: var(--cv-r-control);
  background: var(--cv-tint-1);
  color: var(--cv-fg);
  font-size: var(--cv-t-xs);
}

.agent-composer-attachment__meta {
  display: grid;
  min-width: 0;
}

.agent-composer-attachment__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-composer-attachment__size,
.agent-composer-attachment__notice {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-2xs);
}

.agent-composer-attachment__failure {
  color: var(--cv-danger);
  font-size: var(--cv-t-2xs);
}

.agent-composer-attachment__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.95);
  cursor: pointer;
}

.agent-composer-attachment--chip .agent-composer-attachment__remove {
  top: 6px;
}

.agent-composer-attachment__remove:hover {
  background: rgba(0, 0, 0, 0.8);
}

.agent-composer-attachment__remove:focus-visible,
.agent-composer-attachment__thumb:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.agent-composer__attachment-refusal {
  display: flex;
  align-items: center;
  gap: var(--cv-space-4);
  margin: 0;
  color: var(--cv-warn);
  font-size: var(--cv-t-xs);
}

.agent-composer__attachment-dismiss {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-subtle);
  cursor: pointer;
}
```

Also delete from `agentComposer.css` the groups `.agent-composer__queued-edit*`, `.agent-composer__attachments`, `.agent-composer__attachment-*` and `.agent-composer-attachment*`.

- [ ] **Step 5: Update the queued-edit selectors in tests**

`grep -rn "agent-composer__queued-edit-head\|agent-composer__queued-edit .agent-composer-attachment" src/components/agentMode/*.test.ts*` - the queued attachments are no longer inside `.agent-composer__queued-edit`; select them with `.agent-composer__box .agent-composer-attachment` instead. The group, title, Cancel label and "Save queued message" name are unchanged.

- [ ] **Step 6: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/conversationStyles.test.ts src/components/agentMode/AgentComposerAttachments.test.tsx src/components/agentMode/useAgentQueuedEditImagePreviews.test.tsx src/components/agentMode/agentComposerQueuedEdit.test.ts src/components/agentMode/AgentComposer.test.tsx src/components/agentMode/AgentModeView.test.tsx`
Expected: PASS.

---

### Task 11: Approval and question inside the composer slab

**Files:**
- Create: `src/components/agentMode/composer/agentComposerInteraction.ts` (+ `agentComposerInteraction.test.ts`)
- Create: `src/components/agentMode/composer/AgentComposerInteractionSource.tsx` (+ `AgentComposerInteractionSource.test.tsx`)
- Create: `src/components/agentMode/composer/AgentComposerApprovalPanel.tsx` (+ `AgentComposerApprovalPanel.test.tsx`)
- Create: `src/components/agentMode/composer/AgentComposerQuestionPanel.tsx`
- Modify: `src/components/agentMode/AgentComposer.tsx` (prop `interaction`)
- Modify: `src/components/agentMode/AgentComposerController.tsx` (prop `interactions`, source, equality)
- Modify: `src/components/agentMode/AgentModeView.tsx` (the one agreed hunk)
- Modify: `src/components/agentMode/agentApprovalPresenter.ts` (+ `agentApprovalPresenter.test.ts`) (mockup copy)
- Modify: `src/components/agentMode/AgentQuestionCard.tsx` (no card chrome class), `agentQuestionCard.css` (re-token, slab layout)
- Modify: `composer/agentComposerFrame.css`, `conversation/conversationStyles.test.ts`
- Delete: `AgentThreadQuestions.tsx`, `AgentThreadApprovals.tsx`, `AgentThreadApprovals.test.tsx`, `AgentApprovalCard.tsx`, `AgentApprovalCard.test.tsx`, `agentApprovalCard.css`

**Interfaces:**
- Consumes: `useAgentApprovals(gateway, owner, running): AgentApprovalsSurface` (`requests`, `answering`, `error`, `answer(requestId, decision)`), `useAgentQuestions(gateway, owner, running)` (`requests`, `answering`, `error`, `answer(requestId, response)`), `agentQuestionOwner(view)`, `isAgentApprovalGateway`, `presentAgentApproval`, `visibleAgentApprovals`, `AgentQuestionCard` props (`request`, `pending`, `error`, `onAnswer`), foundation `Button`, `Menu`, `MenuItem`, `ComposerBanner`.
- Produces:
  - ```ts
    export type AgentComposerInteraction =
      | { readonly kind: "approval"; readonly key: string; readonly view: AgentApprovalView; readonly pendingCount: number; readonly sending: boolean; readonly error: string | null; decide(decision: AgentApprovalDecision): Promise<void> }
      | { readonly kind: "question"; readonly key: string; readonly request: AgentQuestionRequest; readonly sending: boolean; readonly error: string | null; answer(response: AgentQuestionResponse): Promise<void> }
      | { readonly kind: "notice"; readonly key: string; readonly text: string };
    ```
  - `pickAgentComposerInteraction(inputs: AgentComposerInteractionInputs): AgentComposerInteraction | null`
  - `<AgentComposerInteractionSource gateway owner running onChange />` (renders nothing; key it by owner)
  - `AgentComposerProps.interaction?: AgentComposerInteraction | null`
  - `AgentComposerControllerProps.interactions?: { readonly gateway: AgentQuestionGateway | null; readonly thread: AgentThreadView | null }`
  - Approval copy for command/fileChange/tool requests: `allowOnce` → "Approve", `allowForSession` → "Approve for this session" (in the More menu), `deny` → "Decline"; plan and MCP copy unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/components/agentMode/composer/agentComposerInteraction.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest } from "../../../domain/agentQuestion";
import { pickAgentComposerInteraction } from "./agentComposerInteraction";

const approval: AgentApprovalRequest = {
  id: "a1",
  taskId: "task",
  provider: "codex",
  kind: "command",
  title: "outside the sandbox",
  detail: "npm test -- orders.idempotency",
  detailTruncated: false,
  facts: [{ label: "Reason", value: "Needs network access" }],
  decisions: ["allowOnce", "allowForSession", "deny"],
  status: "pending",
};

const question: AgentQuestionRequest = {
  id: "q1",
  taskId: "task",
  provider: "claudeCode",
  questions: [],
  status: "pending",
};

function inputs(patch: Partial<Parameters<typeof pickAgentComposerInteraction>[0]> = {}) {
  return {
    approvals: { requests: [], answering: null, error: null, answer: vi.fn() },
    questions: { requests: [], answering: null, error: null, answer: vi.fn() },
    running: true,
    ...patch,
  };
}

describe("pickAgentComposerInteraction", () => {
  it("puts the first pending approval in the slab and counts the rest", () => {
    const second = { ...approval, id: "a2" };
    const picked = pickAgentComposerInteraction(
      inputs({ approvals: { requests: [approval, second], answering: "a1", error: null, answer: vi.fn() } }),
    );
    expect(picked?.kind).toBe("approval");
    expect(picked?.kind === "approval" && picked.pendingCount).toBe(2);
    expect(picked?.kind === "approval" && picked.sending).toBe(true);
    expect(picked?.key).toBe("approval:task:a1");
  });

  it("routes a decision to the picked request only", async () => {
    const answer = vi.fn().mockResolvedValue(undefined);
    const picked = pickAgentComposerInteraction(
      inputs({ approvals: { requests: [approval], answering: null, error: null, answer } }),
    );
    if (picked?.kind === "approval") await picked.decide("deny");
    expect(answer).toHaveBeenCalledWith("a1", "deny");
  });

  it("falls back to a pending question, then a settled approval notice, then nothing", () => {
    expect(
      pickAgentComposerInteraction(
        inputs({ questions: { requests: [question], answering: null, error: null, answer: vi.fn() } }),
      )?.kind,
    ).toBe("question");
    const withdrawn: AgentApprovalRequest = { ...approval, status: "cancelled" };
    expect(
      pickAgentComposerInteraction(
        inputs({ approvals: { requests: [withdrawn], answering: null, error: null, answer: vi.fn() } }),
      ),
    ).toEqual({
      kind: "notice",
      key: "approval-notice:a1:cancelled",
      text: "outside the sandbox · The agent withdrew this request.",
    });
    expect(pickAgentComposerInteraction(inputs())).toBeNull();
  });

  it("shows a question error only while the thread runs", () => {
    const failing = { requests: [], answering: null, error: "The answer could not be confirmed.", answer: vi.fn() };
    expect(pickAgentComposerInteraction(inputs({ questions: failing }))?.kind).toBe("notice");
    expect(pickAgentComposerInteraction(inputs({ questions: failing, running: false }))).toBeNull();
  });
});
```

Create `src/components/agentMode/composer/AgentComposerApprovalPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentAgentApproval } from "../agentApprovalPresenter";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { AgentComposerApprovalPanel } from "./AgentComposerApprovalPanel";

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

function interaction(
  decide: (decision: "allowOnce" | "allowForSession" | "deny") => Promise<void>,
): Extract<AgentComposerInteraction, { kind: "approval" }> {
  return {
    kind: "approval",
    key: "approval:task:a1",
    pendingCount: 2,
    sending: false,
    error: null,
    decide,
    view: presentAgentApproval({
      id: "a1",
      taskId: "task",
      provider: "codex",
      kind: "command",
      title: "outside the sandbox",
      detail: `npm test -- ${"orders.idempotency ".repeat(30)}`,
      detailTruncated: false,
      facts: [{ label: "Reason", value: "Needs network access" }],
      decisions: ["allowOnce", "allowForSession", "deny"],
      status: "pending",
    }),
  };
}

function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === name || candidate.getAttribute("aria-label") === name,
  );
}

describe("AgentComposerApprovalPanel", () => {
  it("shows the request like the mockup with Decline, Approve and the more menu", () => {
    act(() => root.render(<AgentComposerApprovalPanel interaction={interaction(vi.fn())} />));

    const panel = host.querySelector('[role="group"][aria-label="Approval request"]');
    expect(panel?.querySelector(".cv-composer-interaction__kicker b")?.textContent).toBe("Command");
    expect(panel?.querySelector(".cv-composer-interaction__count")?.textContent).toBe("1/2");
    expect(panel?.querySelector("pre")?.textContent).toContain("npm test --");
    expect(panel?.textContent).toContain("Reason: Needs network access");
    expect(button("Decline")?.className).toContain("cv-button--default");
    expect(button("Approve")?.className).toContain("cv-button--primary");
    expect(button("Approve for this session")).toBeUndefined();
    act(() => button("More approval options")?.click());
    expect(button("Approve for this session")).toBeDefined();
  });

  it("sends one decision for a double click and re-enables after a failure", async () => {
    let fail: (reason: Error) => void = () => undefined;
    const decide = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    act(() => root.render(<AgentComposerApprovalPanel interaction={interaction(decide)} />));

    act(() => {
      button("Approve")?.click();
      button("Approve")?.click();
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith("allowOnce");
    expect(button("Approve")?.disabled).toBe(true);
    await act(async () => {
      fail(new Error("offline"));
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not send your decision. Please try again.",
    );
    expect(button("Approve")?.disabled).toBe(false);
  });
});
```

Create `src/components/agentMode/composer/AgentComposerInteractionSource.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalOwner } from "../../../application/agentApprovalPorts";
import type { AgentApprovalRequest } from "../../../domain/agentApproval";
import { waitForReact as waitFor } from "../../../test/reactTestLifecycle";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { AgentComposerInteractionSource } from "./AgentComposerInteractionSource";

const owner: AgentApprovalOwner = {
  kind: "local",
  workspaceId: "workspace",
  repositoryRoot: "/repo",
  taskId: "task",
};
const pending: AgentApprovalRequest = {
  id: "a1",
  taskId: "task",
  provider: "codex",
  kind: "command",
  title: "Run a command?",
  detail: "cargo test",
  detailTruncated: false,
  facts: [],
  decisions: ["allowOnce", "deny"],
  status: "pending",
};

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

describe("AgentComposerInteractionSource", () => {
  it("publishes the owner's pending approval and clears it on unmount", async () => {
    const seen: Array<AgentComposerInteraction | null> = [];
    const gateway = {
      list: vi.fn().mockResolvedValue([]),
      answer: vi.fn(),
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi.fn().mockResolvedValue({ ...pending, status: "approved", decision: "allowOnce" }),
    };
    const onChange = (next: AgentComposerInteraction | null) => seen.push(next);
    act(() =>
      root.render(
        <AgentComposerInteractionSource gateway={gateway} onChange={onChange} owner={owner} running />,
      ),
    );
    await waitFor(() => expect(seen.at(-1)?.kind).toBe("approval"));
    act(() => root.render(<></>));
    expect(seen.at(-1)).toBeNull();
  });

  it("publishes nothing without a gateway", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <AgentComposerInteractionSource gateway={null} onChange={onChange} owner={owner} running />,
      ),
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
```

Add to `src/components/agentMode/composer/AgentComposerFrame.test.tsx` a composer-level regression (reuse the `fixture(1)` shape from `AgentComposer.render.test.tsx`, copied into this file as `composerFixture()` with `mode: { kind: "followUp", blockedReason: null }` and `prompt: "half-typed draft"`):

```tsx
  it("keeps the typed draft while an approval replaces the editor", () => {
    const props = composerFixture();
    const approval = {
      kind: "approval" as const,
      key: "approval:task:a1",
      pendingCount: 1,
      sending: false,
      error: null,
      decide: vi.fn().mockResolvedValue(undefined),
      view: presentAgentApproval({
        id: "a1",
        taskId: "task",
        provider: "codex",
        kind: "command",
        title: "outside the sandbox",
        detail: "npm test",
        detailTruncated: false,
        facts: [],
        decisions: ["allowOnce", "deny"],
        status: "pending",
      }),
    };
    act(() => root.render(<AgentComposer {...props} interaction={approval} />));

    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toBe("half-typed draft");
    expect(textarea?.closest(".agent-composer__box")?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector(".cv-composer__slab > .cv-composer__foot")?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('.cv-composer__slab [aria-label="Approval request"]')).not.toBeNull();

    act(() => root.render(<AgentComposer {...props} interaction={null} />));
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("half-typed draft");
    expect(host.querySelector(".agent-composer__box")?.hasAttribute("hidden")).toBe(false);
  });
```

(add the imports `vi`, `AgentComposer`, `AgentComposerProps`, `presentAgentApproval` to that test file.)

In `agentApprovalPresenter.test.ts` change the expected command labels: "Allow once" → "Approve", "Allow for this session" → "Approve for this session", "Deny" → "Decline" (plan: "Approve plan"/"Keep planning" and MCP: "Accept"/"Decline" unchanged).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/composer src/components/agentMode/agentApprovalPresenter.test.ts`
Expected: FAIL - modules missing, labels differ.

- [ ] **Step 3: Pure interaction model**

Create `src/components/agentMode/composer/agentComposerInteraction.ts`:

```ts
import type { AgentApprovalDecision, AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest, AgentQuestionResponse } from "../../../domain/agentQuestion";
import {
  presentAgentApproval,
  visibleAgentApprovals,
  type AgentApprovalView,
} from "../agentApprovalPresenter";

export type AgentComposerInteraction =
  | {
      readonly kind: "approval";
      readonly key: string;
      readonly view: AgentApprovalView;
      readonly pendingCount: number;
      readonly sending: boolean;
      readonly error: string | null;
      decide(decision: AgentApprovalDecision): Promise<void>;
    }
  | {
      readonly kind: "question";
      readonly key: string;
      readonly request: AgentQuestionRequest;
      readonly sending: boolean;
      readonly error: string | null;
      answer(response: AgentQuestionResponse): Promise<void>;
    }
  | { readonly kind: "notice"; readonly key: string; readonly text: string };

export interface AgentComposerInteractionInputs {
  readonly approvals: {
    readonly requests: ReadonlyArray<AgentApprovalRequest>;
    readonly answering: string | null;
    readonly error: string | null;
    answer(requestId: string, decision: AgentApprovalDecision): Promise<void>;
  };
  readonly questions: {
    readonly requests: ReadonlyArray<AgentQuestionRequest>;
    readonly answering: string | null;
    readonly error: string | null;
    answer(requestId: string, response: AgentQuestionResponse): Promise<void>;
  };
  readonly running: boolean;
}

export function pickAgentComposerInteraction(
  inputs: AgentComposerInteractionInputs,
): AgentComposerInteraction | null {
  const visible = visibleAgentApprovals(inputs.approvals.requests);
  const pending = visible.filter((request) => request.status === "pending");
  const approval = pending[0];
  if (approval !== undefined) {
    return {
      kind: "approval",
      key: `approval:${approval.taskId}:${approval.id}`,
      view: presentAgentApproval(approval),
      pendingCount: pending.length,
      sending: inputs.approvals.answering === approval.id,
      error: inputs.approvals.error,
      decide: (decision) => inputs.approvals.answer(approval.id, decision),
    };
  }
  const question = inputs.questions.requests.find((request) => request.status === "pending");
  if (question !== undefined) {
    return {
      kind: "question",
      key: `question:${question.taskId}:${question.id}`,
      request: question,
      sending: inputs.questions.answering === question.id,
      error: inputs.questions.error,
      answer: (response) => inputs.questions.answer(question.id, response),
    };
  }
  const settled = visible[0];
  if (settled !== undefined) {
    return {
      kind: "notice",
      key: `approval-notice:${settled.id}:${settled.status}`,
      text: `${settled.title} · ${presentAgentApproval(settled).statusText}`,
    };
  }
  if (inputs.questions.error !== null && inputs.running) {
    return { kind: "notice", key: "question-error", text: inputs.questions.error };
  }
  return null;
}
```

(If `useAgentQuestions().answer` is typed `(id, response) => Promise<void>` it fits; if it returns `Promise<unknown>`, wrap it in the source as `async (id, response) => { await answer(id, response); }`.)

- [ ] **Step 4: Keyed interaction source**

Create `src/components/agentMode/composer/AgentComposerInteractionSource.tsx`:

```tsx
import { useLayoutEffect, useMemo } from "react";
import { isAgentApprovalGateway } from "../../../application/agentApprovalPorts";
import type { AgentQuestionGateway, AgentQuestionOwner } from "../../../application/agentQuestionPorts";
import { useAgentApprovals } from "../../../application/useAgentApprovals";
import { useAgentQuestions } from "../../../application/useAgentQuestions";
import {
  pickAgentComposerInteraction,
  type AgentComposerInteraction,
} from "./agentComposerInteraction";

export interface AgentComposerInteractionSourceProps {
  readonly gateway: AgentQuestionGateway | null;
  readonly owner: AgentQuestionOwner | null;
  readonly running: boolean;
  onChange(interaction: AgentComposerInteraction | null): void;
}

export function AgentComposerInteractionSource({
  gateway,
  onChange,
  owner,
  running,
}: AgentComposerInteractionSourceProps) {
  const {
    requests: approvalRequests,
    answering: approvalAnswering,
    error: approvalError,
    answer: answerApproval,
  } = useAgentApprovals(isAgentApprovalGateway(gateway) ? gateway : null, owner, running);
  const {
    requests: questionRequests,
    answering: questionAnswering,
    error: questionError,
    answer: answerQuestion,
  } = useAgentQuestions(gateway, owner, running);
  const interaction = useMemo(
    () =>
      pickAgentComposerInteraction({
        approvals: {
          requests: approvalRequests,
          answering: approvalAnswering,
          error: approvalError,
          answer: answerApproval,
        },
        questions: {
          requests: questionRequests,
          answering: questionAnswering,
          error: questionError,
          answer: async (requestId, response) => {
            await answerQuestion(requestId, response);
          },
        },
        running,
      }),
    [
      approvalRequests,
      approvalAnswering,
      approvalError,
      answerApproval,
      questionRequests,
      questionAnswering,
      questionError,
      answerQuestion,
      running,
    ],
  );
  useLayoutEffect(() => {
    onChange(interaction);
  }, [interaction, onChange]);
  useLayoutEffect(() => () => onChange(null), [onChange]);
  return null;
}
```

- [ ] **Step 5: Approval and question panels**

Create `src/components/agentMode/composer/AgentComposerApprovalPanel.tsx`:

```tsx
import { MoreHorizontal } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { AgentApprovalDecision } from "../../../domain/agentApproval";
import { Button } from "../../../ui/foundation/Button";
import { Menu } from "../../../ui/foundation/Menu";
import { MenuItem } from "../../../ui/foundation/MenuItem";
import type { AgentComposerInteraction } from "./agentComposerInteraction";

export const AGENT_APPROVAL_SEND_FAILURE = "Could not send your decision. Please try again.";

export function AgentComposerApprovalPanel({
  interaction,
}: {
  readonly interaction: Extract<AgentComposerInteraction, { kind: "approval" }>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { view } = interaction;
  const busy = interaction.sending || sending;
  const primary = view.actions.find((action) => action.tone === "primary") ?? null;
  const danger = view.actions.find((action) => action.tone === "danger") ?? null;
  const secondary = view.actions.filter((action) => action.tone === "secondary");
  const error = sendError ?? interaction.error;

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.closest("[hidden]") === null) return;
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const decide = (decision: AgentApprovalDecision): void => {
    if (busy || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    void interaction
      .decide(decision)
      .catch(() => setSendError(AGENT_APPROVAL_SEND_FAILURE))
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  return (
    <div
      aria-busy={busy}
      aria-label="Approval request"
      className="cv-composer-interaction"
      ref={rootRef}
      role="group"
      tabIndex={-1}
    >
      <div className="cv-composer-interaction__body">
        <p className="cv-composer-interaction__kicker">
          <b>{view.detailLabel}</b>
          <span className="cv-composer-interaction__title">{view.title}</span>
          {interaction.pendingCount > 1 && (
            <span className="cv-composer-interaction__count">1/{interaction.pendingCount}</span>
          )}
        </p>
        {view.detail !== "" && (
          <pre className="cv-composer-interaction__detail" tabIndex={0}>
            {view.detail}
          </pre>
        )}
        {view.truncatedNote !== null && (
          <p className="cv-composer-interaction__note">{view.truncatedNote}</p>
        )}
        {view.facts.map((fact, index) => (
          <p className="cv-composer-interaction__note" key={`${fact.label}-${index}`}>
            {fact.label}: {fact.value}
          </p>
        ))}
        {error !== null && (
          <p className="cv-composer-interaction__error" role="alert">
            {error}
          </p>
        )}
        <span className="agent-visually-hidden" role="status">
          {busy ? "Sending decision…" : view.statusText}
        </span>
      </div>
      <div className="cv-composer__foot">
        <span className="cv-composer__controls" />
        <div className="cv-composer__actions">
          {secondary.length > 0 && (
            <>
              <button
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                aria-label="More approval options"
                className="cv-icon-button cv-icon-button--sm"
                disabled={busy}
                onClick={() => setMoreOpen((open) => !open)}
                ref={moreRef}
                title="More options"
                type="button"
              >
                <span aria-hidden="true" className="cv-icon-button__glyph">
                  <MoreHorizontal size={16} strokeWidth={1.5} />
                </span>
              </button>
              <Menu
                anchorRef={moreRef}
                label="More approval options"
                onClose={() => setMoreOpen(false)}
                open={moreOpen}
                placement="top-end"
              >
                {secondary.map((action) => (
                  <MenuItem key={action.decision} onSelect={() => decide(action.decision)}>
                    {action.label}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
          {danger !== null && (
            <Button disabled={busy} onClick={() => decide(danger.decision)}>
              {danger.label}
            </Button>
          )}
          {primary !== null && (
            <Button disabled={busy} onClick={() => decide(primary.decision)} variant="primary">
              {primary.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

Create `src/components/agentMode/composer/AgentComposerQuestionPanel.tsx`:

```tsx
import { AgentQuestionCard } from "../AgentQuestionCard";
import type { AgentComposerInteraction } from "./agentComposerInteraction";

export function AgentComposerQuestionPanel({
  interaction,
}: {
  readonly interaction: Extract<AgentComposerInteraction, { kind: "question" }>;
}) {
  return (
    <div className="cv-composer-interaction cv-composer-interaction--question">
      <AgentQuestionCard
        error={interaction.error}
        key={interaction.key}
        onAnswer={interaction.answer}
        pending={interaction.sending}
        request={interaction.request}
      />
    </div>
  );
}
```

In `agentApprovalPresenter.ts` change the non-plan, non-MCP labels in `actionLabel`: `allowOnce` → `"Approve"`, `allowForSession` → `"Approve for this session"`, `deny` → `"Decline"`.

- [ ] **Step 6: Composer renders the interaction**

In `AgentComposer.tsx`:
1. Import `AgentComposerApprovalPanel`, `AgentComposerQuestionPanel`, `type AgentComposerInteraction` and `ComposerBanner` (`../../ui/foundation/ComposerBanner`), `AlertTriangle` from lucide.
2. Add `readonly interaction?: AgentComposerInteraction | null;` to the props and destructure `interaction = null`.
3. `const interactionActive = interaction !== null && interaction.kind !== "notice";`
4. In the slab: insert before the `.agent-composer__box` div

```tsx
      {interaction?.kind === "approval" && (
        <AgentComposerApprovalPanel interaction={interaction} key={interaction.key} />
      )}
      {interaction?.kind === "question" && (
        <AgentComposerQuestionPanel interaction={interaction} key={interaction.key} />
      )}
```

   and add `hidden={interactionActive}` to the `.agent-composer__box` div, the `.cv-composer__notes` div and the `.cv-composer__foot` div (they stay mounted, so the draft, attachments and launch controls survive).
5. Append to the banners fragment (after the queued-edit banner):

```tsx
          {interaction?.kind === "notice" && (
            <ComposerBanner icon={<AlertTriangle size={12} strokeWidth={1.5} />} tone="warn">
              {interaction.text}
            </ComposerBanner>
          )}
```

6. In `onKeyDown`, return early before any Enter/Escape handling when `interactionActive` is true (the textarea is hidden; keystrokes must not submit or stop).

- [ ] **Step 7: Controller hosts the source**

In `AgentComposerController.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import { agentQuestionOwner } from "../../application/agentQuestionOwner";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentComposerInteraction } from "./composer/agentComposerInteraction";
import { AgentComposerInteractionSource } from "./composer/AgentComposerInteractionSource";

export interface AgentComposerInteractionsInput {
  readonly gateway: AgentQuestionGateway | null;
  readonly thread: AgentThreadView | null;
}
```

Add `readonly interactions?: AgentComposerInteractionsInput;` to the props; in the component:

```tsx
  const [interaction, setInteraction] = useState<AgentComposerInteraction | null>(null);
  const owner = interactions === undefined ? null : agentQuestionOwner(interactions.thread);
  const ownerKey = JSON.stringify(owner);
```

return

```tsx
    <>
      {interactions !== undefined && (
        <AgentComposerInteractionSource
          gateway={interactions.gateway}
          key={ownerKey}
          onChange={setInteraction}
          owner={owner}
          running={interactions.thread?.lifecycle === "running"}
        />
      )}
      <AgentComposer
        {...controlledProps}
        interaction={interactions === undefined ? null : interaction}
        /* existing props unchanged */
      />
    </>
```

(the inline `/* existing props unchanged */` stands for the props already passed today; do not write the comment into the file). Extend `agentComposerControllerPropsEqual` with `sameInteractions(left.interactions, right.interactions) &&`:

```ts
function sameInteractions(
  left: AgentComposerInteractionsInput | undefined,
  right: AgentComposerInteractionsInput | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.gateway !== right.gateway) return false;
  if (left.thread?.lifecycle !== right.thread?.lifecycle) return false;
  return JSON.stringify(agentQuestionOwner(left.thread)) === JSON.stringify(agentQuestionOwner(right.thread));
}
```

- [ ] **Step 8: The agreed AgentModeView hunk and deletions**

In `src/components/agentMode/AgentModeView.tsx` (post-P2 tree) delete the line `<AgentThreadQuestions gateway={questionGateway} thread={sessionThread} />` and its import, and add to the `<AgentComposerController` element the prop:

```tsx
                    interactions={{ gateway: questionGateway, thread: sessionThread }}
```

Delete `AgentThreadQuestions.tsx`, `AgentThreadApprovals.tsx`, `AgentThreadApprovals.test.tsx`, `AgentApprovalCard.tsx`, `AgentApprovalCard.test.tsx`, `agentApprovalCard.css`. Run `grep -rn "AgentThreadQuestions\|AgentThreadApprovals\|AgentApprovalCard\|agent-approval-card\|agent-thread-questions" src` - expected: no matches except `AgentQuestionCard`.

- [ ] **Step 9: Styles**

Append to `composer/agentComposerFrame.css`:

```css
.agent-composer__box[hidden],
.cv-composer__notes[hidden],
.cv-composer__foot[hidden] {
  display: none;
}

.cv-composer-interaction {
  display: grid;
  min-width: 0;
}

.cv-composer-interaction:focus-visible {
  outline: none;
}

.cv-composer-interaction__body {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 14px var(--cv-space-6) 6px;
}

.cv-composer-interaction__kicker {
  display: flex;
  align-items: center;
  gap: var(--cv-space-4);
  min-width: 0;
  margin: 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-2xs);
}

.cv-composer-interaction__kicker b {
  flex: none;
  color: var(--cv-warn);
  font-weight: 500;
}

.cv-composer-interaction__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-composer-interaction__count {
  flex: none;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.cv-composer-interaction__detail {
  max-height: 80px;
  margin: 0;
  overflow: auto;
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
  line-height: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cv-composer-interaction__detail:focus-visible {
  outline: 2px solid var(--cv-focus);
  outline-offset: 2px;
}

.cv-composer-interaction__note {
  margin: 0;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  overflow-wrap: anywhere;
}

.cv-composer-interaction__error {
  margin: 0;
  color: var(--cv-danger);
  font-size: var(--cv-t-xs);
}
```

Rewrite `src/components/agentMode/agentQuestionCard.css`: delete the `.agent-thread-questions` group (lines 1-10); on `.agent-question-card` remove `background`, `border`, `box-shadow`, `border-radius` and set `padding: 14px var(--cv-space-6) var(--cv-space-6)`; replace every remaining legacy variable using the Global Constraints table; the submit button rule uses `background: var(--cv-accent-fill); color: var(--cv-on-accent); border-radius: var(--cv-r-control); height: 28px`. Add `"components/agentMode/agentQuestionCard.css"` to `P3_SHEETS`.

Add to `conversationStyles.test.ts`:

```ts
  it("keeps long approval commands inside the slab", () => {
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "max-height")).toBe("80px");
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "overflow")).toBe("auto");
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "white-space")).toBe("pre-wrap");
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "overflow-wrap")).toBe("anywhere");
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__kicker b", "color")).toBe("var(--cv-warn)");
  });
```

- [ ] **Step 10: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/composer src/components/agentMode/conversation/conversationStyles.test.ts src/components/agentMode/agentApprovalPresenter.test.ts src/components/agentMode/AgentQuestionCard.test.tsx src/components/agentMode/AgentComposer.test.tsx src/components/agentMode/AgentComposerController.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/agentMode/AgentModeView.remote.test.tsx src/application/useAgentApprovals.test.tsx src/application/useAgentQuestions.test.tsx`
Expected: PASS (drop paths that do not exist). Any `AgentModeView` test that found approval buttons by the old labels uses "Approve" / "Decline" / (More menu) "Approve for this session".

---
### Task 12: B7 domain - bounded activity window over turn-log pages

**Files:**
- Create: `src/domain/agentTurnActivityWindow.ts`
- Create: `src/domain/agentTurnActivityWindow.test.ts`

**Interfaces:**
- Consumes: `MAX_AGENT_EVENT_BYTES_PER_TURN`, `agentTurnEventUtf8Bytes`, `coalesceAgentTextEvents`, `AgentTurnEvent` (`src/domain/agentThread.ts`); `AGENT_TURN_LOG_LIMITS`, `AgentTurnLogAnchor`, `AgentTurnLogEntry`, `AgentTurnLogLoss`, `AgentTurnLogPage` (`src/domain/agentTurnLog.ts`).
- Produces:
  - `MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES = 1_000`, `MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES = MAX_AGENT_EVENT_BYTES_PER_TURN`, `MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES = 16`
  - `interface AgentTurnActivityWindow { entries; bytes; hasEarlier; hasLater; gap; loss; clipped }`
  - `type AgentTurnActivityRejection = "oversized" | "unordered" | "inconsistent" | "notAdvancing"`
  - `agentTurnActivityPageRejection(page, anchor): AgentTurnActivityRejection | null`
  - `agentTurnActivityPageBytes(page): number`
  - `openAgentTurnActivityWindow(page): AgentTurnActivityWindow`
  - `prependAgentTurnActivityPage(window, page): AgentTurnActivityWindow` (evicts newest past the caps → `hasLater: true`)
  - `appendAgentTurnActivityPage(window, page): AgentTurnActivityWindow` (evicts earliest past the caps → `hasEarlier: true`)
  - `agentTurnActivityWindowFirstSeq(window): number | null`, `agentTurnActivityWindowLastSeq(window): number | null`
  - `interface AgentTurnActivityWindowEvents { readonly events: ReadonlyArray<AgentTurnEvent>; readonly seqs: ReadonlyArray<number> }`, `agentTurnActivityWindowEvents(window)` (coalesces adjacent text/reasoning deltas, keeps the first seq of each run)

- [ ] **Step 1: Write the failing test**

Create `src/domain/agentTurnActivityWindow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "./agentThread";
import type { AgentTurnLogEntry, AgentTurnLogPage } from "./agentTurnLog";
import {
  MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES,
  MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES,
  agentTurnActivityPageRejection,
  agentTurnActivityWindowEvents,
  agentTurnActivityWindowFirstSeq,
  agentTurnActivityWindowLastSeq,
  appendAgentTurnActivityPage,
  openAgentTurnActivityWindow,
  prependAgentTurnActivityPage,
} from "./agentTurnActivityWindow";

function tool(seq: number): AgentTurnLogEntry {
  return { seq, event: { kind: "toolCall", toolId: `t${seq}`, name: "Bash", inputSummary: "ls" } };
}

function text(seq: number, value: string): AgentTurnLogEntry {
  return { seq, event: { kind: "assistantText", text: value } };
}

function page(
  entries: ReadonlyArray<AgentTurnLogEntry>,
  patch: Partial<AgentTurnLogPage> = {},
): AgentTurnLogPage {
  return {
    entries,
    firstSeq: entries[0]?.seq ?? 0,
    lastSeq: entries[entries.length - 1]?.seq ?? 0,
    hasEarlier: true,
    hasLater: false,
    loss: { kind: "none" },
    clipped: false,
    ...patch,
  };
}

function range(from: number, to: number): ReadonlyArray<AgentTurnLogEntry> {
  return Array.from({ length: to - from + 1 }, (_, index) => tool(from + index));
}

describe("agent turn activity window", () => {
  it("opens from the tail and grows backwards contiguously", () => {
    const opened = openAgentTurnActivityWindow(page(range(801, 1000)));
    const grown = prependAgentTurnActivityPage(opened, page(range(601, 800)));

    expect(agentTurnActivityWindowFirstSeq(grown)).toBe(601);
    expect(agentTurnActivityWindowLastSeq(grown)).toBe(1000);
    expect(grown.entries).toHaveLength(400);
    expect(grown.hasEarlier).toBe(true);
    expect(grown.hasLater).toBe(false);
    expect(grown.gap).toBe(false);
  });

  it("evicts the newest entries past the entry and byte caps", () => {
    let window = openAgentTurnActivityWindow(page(range(4801, 5000)));
    for (let first = 4601; first >= 3401; first -= 200) {
      window = prependAgentTurnActivityPage(window, page(range(first, first + 199)));
    }
    expect(window.entries).toHaveLength(MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES);
    expect(agentTurnActivityWindowFirstSeq(window)).toBe(3401);
    expect(agentTurnActivityWindowLastSeq(window)).toBe(4400);
    expect(window.hasLater).toBe(true);

    const big = "x".repeat(300_000);
    let heavy = openAgentTurnActivityWindow(page([text(100, big)]));
    for (let seq = 99; seq >= 92; seq -= 1) {
      heavy = prependAgentTurnActivityPage(heavy, page([text(seq, big)]));
    }
    expect(heavy.bytes).toBeLessThanOrEqual(MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES);
    expect(heavy.entries).toHaveLength(6);
    expect(agentTurnActivityWindowFirstSeq(heavy)).toBe(92);
    expect(heavy.hasLater).toBe(true);
  });

  it("slides forward by evicting the earliest entries", () => {
    let window = openAgentTurnActivityWindow(page(range(1, 1000), { hasEarlier: false, hasLater: true }));
    window = appendAgentTurnActivityPage(window, page(range(1001, 1200), { hasEarlier: true, hasLater: false }));

    expect(agentTurnActivityWindowFirstSeq(window)).toBe(201);
    expect(agentTurnActivityWindowLastSeq(window)).toBe(1200);
    expect(window.hasEarlier).toBe(true);
    expect(window.hasLater).toBe(false);
  });

  it("marks a discontinuity, keeps the first loss and remembers clipping", () => {
    const opened = openAgentTurnActivityWindow(page(range(50, 60)));
    const gapped = prependAgentTurnActivityPage(
      opened,
      page(range(10, 20), { loss: { kind: "diskBudget", atEpochMs: 1 }, clipped: true }),
    );
    expect(gapped.gap).toBe(true);
    expect(gapped.loss).toEqual({ kind: "diskBudget", atEpochMs: 1 });
    expect(gapped.clipped).toBe(true);
  });

  it("rejects pages that overflow, reorder, disagree with their bounds or do not advance", () => {
    expect(agentTurnActivityPageRejection(page(range(1, 201)), { at: "tail" })).toBe("oversized");
    expect(agentTurnActivityPageRejection(page([tool(5), tool(4)]), { at: "tail" })).toBe("unordered");
    expect(
      agentTurnActivityPageRejection(page([tool(4), tool(5)], { firstSeq: 3 }), { at: "tail" }),
    ).toBe("inconsistent");
    expect(agentTurnActivityPageRejection(page(range(10, 20)), { at: "before", seq: 15 })).toBe(
      "notAdvancing",
    );
    expect(agentTurnActivityPageRejection(page(range(10, 20)), { at: "after", seq: 12 })).toBe(
      "notAdvancing",
    );
    expect(agentTurnActivityPageRejection(page([], { hasEarlier: true }), { at: "before", seq: 5 })).toBe(
      "notAdvancing",
    );
    expect(agentTurnActivityPageRejection(page(range(10, 20)), { at: "before", seq: 21 })).toBeNull();
  });

  it("coalesces streamed text for display and keys each run by its first seq", () => {
    const window = openAgentTurnActivityWindow(
      page([text(7, "Hel"), text(8, "lo"), tool(9), text(10, "Done")]),
    );
    const view = agentTurnActivityWindowEvents(window);

    expect(view.seqs).toEqual([7, 9, 10]);
    expect(view.events.map((event: AgentTurnEvent) => event.kind)).toEqual([
      "assistantText",
      "toolCall",
      "assistantText",
    ]);
    expect(view.events[0]).toMatchObject({ text: "Hello" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/domain/agentTurnActivityWindow.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `src/domain/agentTurnActivityWindow.ts`:

```ts
import {
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  type AgentTurnEvent,
} from "./agentThread";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogEntry,
  type AgentTurnLogLoss,
  type AgentTurnLogPage,
} from "./agentTurnLog";

export const MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES = 1_000;
export const MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES = MAX_AGENT_EVENT_BYTES_PER_TURN;
export const MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES = 16;

export interface AgentTurnActivityWindow {
  readonly entries: ReadonlyArray<AgentTurnLogEntry>;
  readonly bytes: number;
  readonly hasEarlier: boolean;
  readonly hasLater: boolean;
  readonly gap: boolean;
  readonly loss: AgentTurnLogLoss;
  readonly clipped: boolean;
}

export type AgentTurnActivityRejection = "oversized" | "unordered" | "inconsistent" | "notAdvancing";

export interface AgentTurnActivityWindowEvents {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly seqs: ReadonlyArray<number>;
}

export function agentTurnActivityPageRejection(
  page: AgentTurnLogPage,
  anchor: AgentTurnLogAnchor,
): AgentTurnActivityRejection | null {
  if (page.entries.length > AGENT_TURN_LOG_LIMITS.pageEvents) return "oversized";
  if (!ascending(page.entries)) return "unordered";
  const first = page.entries[0];
  const last = page.entries[page.entries.length - 1];
  if (first === undefined || last === undefined) return emptyPageRejection(page, anchor);
  if (first.seq !== page.firstSeq || last.seq !== page.lastSeq) return "inconsistent";
  if (anchor.at === "before" && page.lastSeq >= anchor.seq) return "notAdvancing";
  if (anchor.at === "after" && page.firstSeq <= anchor.seq) return "notAdvancing";
  return null;
}

export function agentTurnActivityPageBytes(page: AgentTurnLogPage): number {
  return entriesBytes(page.entries);
}

export function openAgentTurnActivityWindow(page: AgentTurnLogPage): AgentTurnActivityWindow {
  return evictNewest({
    entries: page.entries,
    bytes: entriesBytes(page.entries),
    hasEarlier: page.hasEarlier,
    hasLater: page.hasLater,
    gap: false,
    loss: page.loss,
    clipped: page.clipped,
  });
}

export function prependAgentTurnActivityPage(
  window: AgentTurnActivityWindow,
  page: AgentTurnLogPage,
): AgentTurnActivityWindow {
  const first = window.entries[0];
  const joinedGap = first !== undefined && page.entries.length > 0 && page.lastSeq + 1 !== first.seq;
  return evictNewest({
    entries: [...page.entries, ...window.entries],
    bytes: window.bytes + entriesBytes(page.entries),
    hasEarlier: page.hasEarlier,
    hasLater: window.hasLater,
    gap: window.gap || joinedGap,
    loss: firstLoss(window.loss, page.loss),
    clipped: window.clipped || page.clipped,
  });
}

export function appendAgentTurnActivityPage(
  window: AgentTurnActivityWindow,
  page: AgentTurnLogPage,
): AgentTurnActivityWindow {
  const last = window.entries[window.entries.length - 1];
  const joinedGap = last !== undefined && page.entries.length > 0 && page.firstSeq !== last.seq + 1;
  return evictEarliest({
    entries: [...window.entries, ...page.entries],
    bytes: window.bytes + entriesBytes(page.entries),
    hasEarlier: window.hasEarlier,
    hasLater: page.hasLater,
    gap: window.gap || joinedGap,
    loss: firstLoss(window.loss, page.loss),
    clipped: window.clipped || page.clipped,
  });
}

export function agentTurnActivityWindowFirstSeq(window: AgentTurnActivityWindow): number | null {
  return window.entries[0]?.seq ?? null;
}

export function agentTurnActivityWindowLastSeq(window: AgentTurnActivityWindow): number | null {
  return window.entries[window.entries.length - 1]?.seq ?? null;
}

export function agentTurnActivityWindowEvents(
  window: AgentTurnActivityWindow,
): AgentTurnActivityWindowEvents {
  const events: AgentTurnEvent[] = [];
  const seqs: number[] = [];
  for (const entry of window.entries) {
    const previous = events[events.length - 1];
    const merged = previous === undefined ? null : coalesceAgentTextEvents(previous, entry.event);
    if (merged !== null) {
      events[events.length - 1] = merged;
      continue;
    }
    events.push(entry.event);
    seqs.push(entry.seq);
  }
  return { events, seqs };
}

function emptyPageRejection(
  page: AgentTurnLogPage,
  anchor: AgentTurnLogAnchor,
): AgentTurnActivityRejection | null {
  if (anchor.at === "before" && page.hasEarlier) return "notAdvancing";
  if (anchor.at === "after" && page.hasLater) return "notAdvancing";
  return null;
}

function ascending(entries: ReadonlyArray<AgentTurnLogEntry>): boolean {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous === undefined || current === undefined) return false;
    if (current.seq <= previous.seq) return false;
  }
  return true;
}

function entriesBytes(entries: ReadonlyArray<AgentTurnLogEntry>): number {
  return entries.reduce((total, entry) => total + agentTurnEventUtf8Bytes(entry.event), 0);
}

function firstLoss(current: AgentTurnLogLoss, next: AgentTurnLogLoss): AgentTurnLogLoss {
  if (current.kind !== "none") return current;
  return next;
}

function overCap(count: number, bytes: number): boolean {
  if (count > MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES) return true;
  return bytes > MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES;
}

function evictNewest(window: AgentTurnActivityWindow): AgentTurnActivityWindow {
  let end = window.entries.length;
  let bytes = window.bytes;
  while (end > 1 && overCap(end, bytes)) {
    end -= 1;
    const dropped = window.entries[end];
    if (dropped !== undefined) bytes -= agentTurnEventUtf8Bytes(dropped.event);
  }
  if (end === window.entries.length) return window;
  return { ...window, entries: window.entries.slice(0, end), bytes, hasLater: true };
}

function evictEarliest(window: AgentTurnActivityWindow): AgentTurnActivityWindow {
  let start = 0;
  let bytes = window.bytes;
  while (window.entries.length - start > 1 && overCap(window.entries.length - start, bytes)) {
    const dropped = window.entries[start];
    if (dropped !== undefined) bytes -= agentTurnEventUtf8Bytes(dropped.event);
    start += 1;
  }
  if (start === 0) return window;
  return { ...window, entries: window.entries.slice(start), bytes, hasEarlier: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/domain/agentTurnActivityWindow.test.ts`
Expected: PASS.

---

### Task 13: B7 application - accumulating, owner-revalidated pager hook

**Files:**
- Modify (rewrite): `src/application/useAgentHistoryActivity.ts`
- Modify (rewrite): `src/application/useAgentHistoryActivity.test.tsx`

**Interfaces:**
- Consumes: Task 12 exports; `AGENT_TURN_LOG_LIMITS`, `AgentTurnLogAnchor`, `AgentTurnLogPage`, `AgentTurnLogScope`, `ReadAgentTurnLogPageRequest`.
- Produces (the `AgentHistoryActivitySource` interface is unchanged, so `useAgentThreadHistory.ts` needs no edit):
  - `agentHistoryActivitySourceIdentity(source: AgentHistoryActivitySource | null): string | null`
  - `type AgentTurnActivityDirection = "earlier" | "later"`
  - `type AgentTurnEarlierActivityState = { kind: "latest" } | { kind: "loading"; direction; window: AgentTurnActivityWindow | null } | { kind: "ready"; window: AgentTurnActivityWindow } | { kind: "failed"; direction; window: AgentTurnActivityWindow | null }`
  - `agentTurnActivityWindowOf(state): AgentTurnActivityWindow | null`
  - `interface AgentTurnEarlierActivity { readonly state; loadEarlier(memoryBytes: number): Promise<void>; loadLater(): Promise<void>; latest(): void }`
  - `useAgentTurnEarlierActivity(source: AgentHistoryActivitySource | null): AgentTurnEarlierActivity` (replaces `useAgentHistoryActivity`)
  - First activation (`state.kind === "latest"`): reads backwards from `{ at: "tail" }`, prepending pages, until a page has no earlier entries, or one more page after the bytes read reach `memoryBytes`, or `MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES` pages; later calls read exactly one page before the first / after the last seq.

- [ ] **Step 1: Write the failing test**

Replace `src/application/useAgentHistoryActivity.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentTurnEventUtf8Bytes } from "../domain/agentThread";
import type {
  AgentTurnLogEntry,
  AgentTurnLogPage,
  ReadAgentTurnLogPageRequest,
} from "../domain/agentTurnLog";
import {
  agentTurnActivityWindowOf,
  useAgentTurnEarlierActivity,
  type AgentHistoryActivitySource,
  type AgentTurnEarlierActivity,
} from "./useAgentHistoryActivity";

function tool(seq: number): AgentTurnLogEntry {
  return { seq, event: { kind: "toolCall", toolId: `t${seq}`, name: "Bash", inputSummary: "ls" } };
}

function fakeLog(total: number) {
  return vi.fn(async (request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage> => {
    const { anchor, maxEvents } = request;
    const end = anchor.at === "tail" ? total : anchor.at === "before" ? anchor.seq - 1 : total;
    const start = anchor.at === "after" ? anchor.seq + 1 : Math.max(1, end - maxEvents + 1);
    const last = anchor.at === "after" ? Math.min(total, start + maxEvents - 1) : end;
    const entries = Array.from({ length: Math.max(0, last - start + 1) }, (_, index) =>
      tool(start + index),
    );
    return {
      entries,
      firstSeq: entries[0]?.seq ?? 0,
      lastSeq: entries[entries.length - 1]?.seq ?? 0,
      hasEarlier: start > 1,
      hasLater: last < total,
      loss: { kind: "none" },
      clipped: false,
    };
  });
}

function source(readPage: AgentHistoryActivitySource["readPage"], turnId = "turn"): AgentHistoryActivitySource {
  return {
    scope: { rootKey: "/root", ownerId: "owner", threadId: "thread", turnId },
    generation: 1,
    leaseToken: 7,
    readPage,
  };
}

let host: HTMLDivElement;
let root: Root;
let latest: AgentTurnEarlierActivity | null = null;

function Probe({ value }: { readonly value: AgentHistoryActivitySource | null }) {
  latest = useAgentTurnEarlierActivity(value);
  return null;
}

function render(value: AgentHistoryActivitySource | null): void {
  act(() => root.render(<Probe value={value} />));
}

function current(): AgentTurnEarlierActivity {
  expect(latest).not.toBeNull();
  return latest as AgentTurnEarlierActivity;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  latest = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ENTRY_BYTES = agentTurnEventUtf8Bytes(tool(1).event);

describe("useAgentTurnEarlierActivity", () => {
  it("reads back past the retained window plus one page on first activation", async () => {
    const readPage = fakeLog(1000);
    render(source(readPage));

    await act(() => current().loadEarlier(ENTRY_BYTES * 300));

    const window = agentTurnActivityWindowOf(current().state);
    expect(readPage).toHaveBeenCalledTimes(3);
    expect(readPage.mock.calls.map(([request]) => request.anchor)).toEqual([
      { at: "tail" },
      { at: "before", seq: 801 },
      { at: "before", seq: 601 },
    ]);
    expect(window?.entries[0]?.seq).toBe(401);
    expect(window?.entries[window.entries.length - 1]?.seq).toBe(1000);
    expect(window?.hasEarlier).toBe(true);
  });

  it("prepends one page per request and stays within the window caps", async () => {
    const readPage = fakeLog(5000);
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    for (let step = 0; step < 6; step += 1) {
      await act(() => current().loadEarlier(0));
    }

    const window = agentTurnActivityWindowOf(current().state);
    expect(window?.entries).toHaveLength(1000);
    expect(window?.entries[0]?.seq).toBe(3401);
    expect(window?.hasLater).toBe(true);
  });

  it("ignores a second load while one is in flight", async () => {
    let release: () => void = () => undefined;
    const readPage = vi.fn(
      (request: ReadAgentTurnLogPageRequest) =>
        new Promise<AgentTurnLogPage>((resolve) => {
          release = () => void fakeLog(10)(request).then(resolve);
        }),
    );
    render(source(readPage));

    act(() => {
      void current().loadEarlier(0);
      void current().loadEarlier(0);
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(current().state.kind).toBe("loading");
    await act(async () => release());
  });

  it("keeps the previous window when a page fails and retries the same direction", async () => {
    const log = fakeLog(2000);
    const readPage = vi.fn(log);
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    const before = agentTurnActivityWindowOf(current().state);

    readPage.mockRejectedValueOnce(new Error("busy"));
    await act(() => current().loadEarlier(0));
    expect(current().state).toMatchObject({ kind: "failed", direction: "earlier" });
    expect(agentTurnActivityWindowOf(current().state)).toBe(before);

    await act(() => current().loadEarlier(0));
    expect(agentTurnActivityWindowOf(current().state)?.entries[0]?.seq).toBe(1401);
  });

  it("fails closed on a page that does not advance", async () => {
    const readPage = vi.fn(fakeLog(1000));
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    readPage.mockResolvedValueOnce({
      entries: [tool(900)],
      firstSeq: 900,
      lastSeq: 900,
      hasEarlier: true,
      hasLater: true,
      loss: { kind: "none" },
      clipped: false,
    });

    await act(() => current().loadEarlier(0));
    expect(current().state.kind).toBe("failed");
  });

  it("drops a page that resolves after the source changed", async () => {
    let release: () => void = () => undefined;
    const readPage = vi.fn(
      (request: ReadAgentTurnLogPageRequest) =>
        new Promise<AgentTurnLogPage>((resolve) => {
          release = () => void fakeLog(10)(request).then(resolve);
        }),
    );
    render(source(readPage, "turn-a"));
    act(() => {
      void current().loadEarlier(0);
    });

    render(source(readPage, "turn-b"));
    expect(current().state.kind).toBe("latest");
    await act(async () => release());
    expect(current().state.kind).toBe("latest");
  });

  it("drops a page that resolves after unmount", async () => {
    let release: () => void = () => undefined;
    const readPage = vi.fn(
      (request: ReadAgentTurnLogPageRequest) =>
        new Promise<AgentTurnLogPage>((resolve) => {
          release = () => void fakeLog(10)(request).then(resolve);
        }),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(source(readPage));
    act(() => {
      void current().loadEarlier(0);
    });
    act(() => root.unmount());
    await act(async () => release());
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    root = createRoot(host);
  });

  it("slides forward with loadLater and returns to the live window with latest", async () => {
    const readPage = fakeLog(3000);
    render(source(readPage));
    await act(() => current().loadEarlier(0));
    for (let step = 0; step < 5; step += 1) {
      await act(() => current().loadEarlier(0));
    }
    expect(agentTurnActivityWindowOf(current().state)?.hasLater).toBe(true);

    await act(() => current().loadLater());
    const window = agentTurnActivityWindowOf(current().state);
    expect(window?.entries[window.entries.length - 1]?.seq).toBe(2800);

    act(() => current().latest());
    expect(current().state.kind).toBe("latest");
  });
});
```

(The unmount test re-creates `root` because `afterEach` unmounts it again.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/application/useAgentHistoryActivity.test.tsx`
Expected: FAIL - `useAgentTurnEarlierActivity` is not exported.

- [ ] **Step 3: Implement**

Replace `src/application/useAgentHistoryActivity.ts` with:

```ts
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES,
  agentTurnActivityPageBytes,
  agentTurnActivityPageRejection,
  agentTurnActivityWindowFirstSeq,
  agentTurnActivityWindowLastSeq,
  appendAgentTurnActivityPage,
  openAgentTurnActivityWindow,
  prependAgentTurnActivityPage,
  type AgentTurnActivityWindow,
} from "../domain/agentTurnActivityWindow";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
  type ReadAgentTurnLogPageRequest,
} from "../domain/agentTurnLog";

export interface AgentHistoryActivitySource {
  readonly scope: AgentTurnLogScope;
  readonly generation: number;
  readonly leaseToken: number | null;
  readPage(request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage>;
}

export type AgentTurnActivityDirection = "earlier" | "later";

export type AgentTurnEarlierActivityState =
  | { readonly kind: "latest" }
  | {
      readonly kind: "loading";
      readonly direction: AgentTurnActivityDirection;
      readonly window: AgentTurnActivityWindow | null;
    }
  | { readonly kind: "ready"; readonly window: AgentTurnActivityWindow }
  | {
      readonly kind: "failed";
      readonly direction: AgentTurnActivityDirection;
      readonly window: AgentTurnActivityWindow | null;
    };

export interface AgentTurnEarlierActivity {
  readonly state: AgentTurnEarlierActivityState;
  loadEarlier(memoryBytes: number): Promise<void>;
  loadLater(): Promise<void>;
  latest(): void;
}

type PageReader = (anchor: AgentTurnLogAnchor) => Promise<AgentTurnLogPage | null>;

type WindowStep =
  | { readonly kind: "window"; readonly window: AgentTurnActivityWindow }
  | { readonly kind: "rejected" }
  | { readonly kind: "dropped" };

interface OwnedState {
  readonly identity: string;
  readonly state: AgentTurnEarlierActivityState;
}

const LATEST: AgentTurnEarlierActivityState = { kind: "latest" };
const REJECTED: WindowStep = { kind: "rejected" };
const DROPPED: WindowStep = { kind: "dropped" };

export function agentTurnActivityWindowOf(
  state: AgentTurnEarlierActivityState,
): AgentTurnActivityWindow | null {
  if (state.kind === "latest") return null;
  return state.window;
}

export function agentHistoryActivitySourceIdentity(
  source: AgentHistoryActivitySource | null,
): string | null {
  if (source === null) return null;
  return JSON.stringify([
    source.scope.rootKey,
    source.scope.ownerId,
    source.scope.threadId,
    source.scope.turnId,
    source.generation,
    source.leaseToken,
  ]);
}

export function useAgentTurnEarlierActivity(
  source: AgentHistoryActivitySource | null,
): AgentTurnEarlierActivity {
  const identity = agentHistoryActivitySourceIdentity(source);
  const currentSource = useRef(source);
  const current = useRef<OwnedState | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const [owned, setOwned] = useState<OwnedState | null>(null);

  useLayoutEffect(() => {
    currentSource.current = source;
    if (current.current === null) return;
    if (current.current.identity === identity) return;
    epoch.current += 1;
    current.current = null;
    setOwned(null);
  }, [identity, source]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, []);

  const latest = useCallback(() => {
    epoch.current += 1;
    current.current = null;
    setOwned(null);
  }, []);

  const load = useCallback(
    async (direction: AgentTurnActivityDirection, memoryBytes: number): Promise<void> => {
      const reader = currentSource.current;
      const owner = agentHistoryActivitySourceIdentity(reader);
      if (!mounted.current || reader === null || owner === null) return;
      const previous = current.current?.identity === owner ? current.current.state : LATEST;
      if (previous.kind === "loading") return;
      const window = agentTurnActivityWindowOf(previous);
      const ticket = ++epoch.current;
      const owns = (): boolean =>
        mounted.current &&
        ticket === epoch.current &&
        agentHistoryActivitySourceIdentity(currentSource.current) === owner;
      const publish = (state: AgentTurnEarlierActivityState): void => {
        const next = { identity: owner, state };
        current.current = next;
        setOwned(next);
      };
      const read: PageReader = async (anchor) => {
        const page = await reader.readPage({
          scope: reader.scope,
          anchor,
          maxEvents: AGENT_TURN_LOG_LIMITS.pageEvents,
          maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
        });
        if (agentTurnActivityPageRejection(page, anchor) !== null) return null;
        return page;
      };
      publish({ kind: "loading", direction, window });
      try {
        const step = await nextWindow(direction, window, memoryBytes, read, owns);
        if (step.kind === "dropped") return;
        if (!owns()) return;
        if (step.kind === "rejected") {
          publish({ kind: "failed", direction, window });
          return;
        }
        publish({ kind: "ready", window: step.window });
      } catch {
        if (!owns()) return;
        publish({ kind: "failed", direction, window });
      }
    },
    [],
  );

  const loadEarlier = useCallback((memoryBytes: number) => load("earlier", memoryBytes), [load]);
  const loadLater = useCallback(() => load("later", 0), [load]);
  const state = owned?.identity === identity ? owned.state : LATEST;
  return { state, loadEarlier, loadLater, latest };
}

async function nextWindow(
  direction: AgentTurnActivityDirection,
  window: AgentTurnActivityWindow | null,
  memoryBytes: number,
  read: PageReader,
  owns: () => boolean,
): Promise<WindowStep> {
  if (window === null) return openWindow(read, memoryBytes, owns);
  if (direction === "earlier") return earlierWindow(window, read, owns);
  return laterWindow(window, read, owns);
}

async function openWindow(
  read: PageReader,
  memoryBytes: number,
  owns: () => boolean,
): Promise<WindowStep> {
  let window: AgentTurnActivityWindow | null = null;
  let anchor: AgentTurnLogAnchor = { at: "tail" };
  let readBytes = 0;
  let reached = false;
  for (let index = 0; index < MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES; index += 1) {
    const page = await read(anchor);
    if (!owns()) return DROPPED;
    if (page === null) return REJECTED;
    window =
      window === null ? openAgentTurnActivityWindow(page) : prependAgentTurnActivityPage(window, page);
    readBytes += agentTurnActivityPageBytes(page);
    if (!page.hasEarlier || page.entries.length === 0) break;
    if (reached) break;
    if (readBytes >= memoryBytes) reached = true;
    anchor = { at: "before", seq: page.firstSeq };
  }
  if (window === null) return REJECTED;
  return { kind: "window", window };
}

async function earlierWindow(
  window: AgentTurnActivityWindow,
  read: PageReader,
  owns: () => boolean,
): Promise<WindowStep> {
  const first = agentTurnActivityWindowFirstSeq(window);
  if (!window.hasEarlier || first === null) return { kind: "window", window };
  const page = await read({ at: "before", seq: first });
  if (!owns()) return DROPPED;
  if (page === null) return REJECTED;
  return { kind: "window", window: prependAgentTurnActivityPage(window, page) };
}

async function laterWindow(
  window: AgentTurnActivityWindow,
  read: PageReader,
  owns: () => boolean,
): Promise<WindowStep> {
  const last = agentTurnActivityWindowLastSeq(window);
  if (!window.hasLater || last === null) return { kind: "window", window };
  const page = await read({ at: "after", seq: last });
  if (!owns()) return DROPPED;
  if (page === null) return REJECTED;
  return { kind: "window", window: appendAgentTurnActivityPage(window, page) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/application/useAgentHistoryActivity.test.tsx src/domain/agentTurnActivityWindow.test.ts`
Expected: PASS. (`useAgentThreadHistory.ts` still imports only the unchanged `AgentHistoryActivitySource` type; `npx tsc --noEmit -p .` must stay green except for the old `useAgentHistoryActivity` consumer `AgentHistoryActivity.tsx`, which Task 14 deletes - so run Task 13 and Task 14 before `npm run check`.)

---
### Task 14: B7 UI - "Load earlier activity" in the turn, seq-keyed rows, no scroll jump

**Files:**
- Create: `src/components/agentMode/conversation/AgentTurnEarlierActivity.tsx` (+ `AgentTurnEarlierActivity.test.tsx`)
- Create: `src/components/agentMode/conversation/useAgentScrollAnchor.ts` (+ `useAgentScrollAnchor.test.tsx`)
- Create: `src/components/agentMode/conversation/useAgentActivitySources.ts`
- Create: `src/components/agentMode/conversation/agentTurnFinalResponse.ts` (+ `agentTurnFinalResponse.test.ts`)
- Modify: `src/components/agentMode/agentTurnProjection.ts` (optional `keyOf` parameter only)
- Modify: `src/components/agentMode/agentTurnItemKeys.ts` (`agentTurnLogItemKey`)
- Modify: `src/components/agentMode/agentTurnLogNotice.ts` (+ `agentTurnLogNotice.test.ts`)
- Modify: `src/components/agentMode/AgentTurnView.tsx`, `conversation/AgentTurnWork.tsx`, `AgentThreadSession.tsx`
- Modify: `conversation/conversation.css` (`.cv-earlier`; delete the Task 5 `.agent-turn-earlier*` stopgap)
- Delete: `src/components/agentMode/AgentHistoryActivity.tsx`, `src/components/agentMode/AgentHistoryActivity.test.tsx`
- Modify tests: `AgentHistoryPager.test.tsx` (three saved-activity tests), `AgentThreadSession.turnLog.test.tsx` (one new test)

**Interfaces:**
- Consumes: Task 13 (`useAgentTurnEarlierActivity`, `agentTurnActivityWindowOf`, `agentHistoryActivitySourceIdentity`, `AgentHistoryActivitySource`, `AgentTurnEarlierActivityState`), Task 12 (`agentTurnActivityWindowEvents`, `AgentTurnActivityWindow`), `agentTurnEventUtf8Bytes`, `agentTurnLogLossNotice(loss)`.
- Produces:
  - `agentTurnProjection(events, revealEventIndex?, workspaceRoot?, settlement?, firstEventOffset?, renderedLimit?, keyOf?: (offset: number) => string)`
  - `agentTurnLogItemKey(seq: number): string` → `"w<seq>"` (never parsed as an event index)
  - `agentTurnLogNoticeModel(facts, eventsTruncated, readerAvailable = false)` and `agentTurnLossNotice(facts, eventsTruncated, readerAvailable = false)`: when the display is "savedNotShown" and a reader is available the loss notice is `null` (the control replaces it)
  - `agentFinalResponseItems(items)`, `agentItemsBeforeFinalResponse(items)`
  - `useAgentScrollAnchor(revision: unknown): { capture(from: HTMLElement): void; cancel(): void }`
  - `useAgentActivitySources(history, threadId, turns): ReadonlyMap<string, AgentHistoryActivitySource | null>` (identity-stable per turn, only for `eventsTruncated` turns)
  - `<AgentTurnEarlierControl state logAvailable canRevealMemory hiddenCount onRevealMemory onLoadEarlier />`, `<AgentTurnLaterControl state running onLoadLater onLatest />`
  - `AgentTurnViewProps.activitySource?: AgentHistoryActivitySource | null` replaces `historyWork`; `AgentTurnWork` props drop `historyWork` and add `readonly trailing: ReactNode`.

- [ ] **Step 1: Write the failing unit tests**

Create `src/components/agentMode/conversation/agentTurnFinalResponse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentTurnItem } from "../agentTurnProjection";
import { agentFinalResponseItems, agentItemsBeforeFinalResponse } from "./agentTurnFinalResponse";

const tool: AgentTurnItem = {
  kind: "tool",
  key: "w1",
  toolId: "t1",
  name: "Bash",
  inputSummary: "ls",
  outcome: null,
  rowKind: "command",
  status: "ok",
  label: "Ran ls",
  argument: null,
  command: "ls",
  output: null,
};
const update: AgentTurnItem = { kind: "assistantText", key: "w2", text: "Next", paragraphs: ["Next"] };
const answer: AgentTurnItem = { kind: "assistantText", key: "w3", text: "Done", paragraphs: ["Done"] };

describe("final response split", () => {
  it("splits at the last assistant text", () => {
    expect(agentFinalResponseItems([tool, update, tool, answer])).toEqual([answer]);
    expect(agentItemsBeforeFinalResponse([tool, update, tool, answer])).toEqual([tool, update, tool]);
  });

  it("keeps everything as work when there is no final response", () => {
    expect(agentFinalResponseItems([tool])).toEqual([]);
    expect(agentItemsBeforeFinalResponse([tool])).toEqual([tool]);
  });
});
```

Create `src/components/agentMode/conversation/useAgentScrollAnchor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentScrollAnchor, type AgentScrollAnchor } from "./useAgentScrollAnchor";

let host: HTMLDivElement;
let root: Root;
let anchor: AgentScrollAnchor | null = null;

function Probe({ revision }: { readonly revision: number }) {
  anchor = useAgentScrollAnchor(revision);
  return null;
}

function rectAt(element: HTMLElement, read: () => number): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: read(), bottom: read() + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: read() }),
  });
}

function scene() {
  const container = document.createElement("div");
  container.className = "agent-session__scroll";
  Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: 500 });
  rectAt(container, () => 0);
  const events = document.createElement("div");
  events.className = "agent-turn__events";
  const control = document.createElement("button");
  const row = document.createElement("div");
  row.className = "agent-tool-row";
  events.append(control, row);
  container.append(events);
  document.body.append(container);
  return { container, control, row };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("useAgentScrollAnchor", () => {
  it("keeps the first visible row at the same offset after earlier rows are prepended", () => {
    const { container, control, row } = scene();
    let rowTop = 40;
    rectAt(control, () => -30);
    rectAt(row, () => rowTop);
    act(() => root.render(<Probe revision={1} />));

    act(() => anchor?.capture(control));
    rowTop = 340;
    act(() => root.render(<Probe revision={2} />));

    expect(container.scrollTop).toBe(800);
  });

  it("falls back to the control when the anchored row was replaced", () => {
    const { container, control, row } = scene();
    let controlTop = 10;
    rectAt(control, () => controlTop);
    rectAt(row, () => 40);
    act(() => root.render(<Probe revision={1} />));

    act(() => anchor?.capture(control));
    row.remove();
    controlTop = 10;
    act(() => root.render(<Probe revision={2} />));

    expect(container.scrollTop).toBe(500);
  });

  it("forgets a capture that was cancelled", () => {
    const { container, control, row } = scene();
    let rowTop = 40;
    rectAt(control, () => 0);
    rectAt(row, () => rowTop);
    act(() => root.render(<Probe revision={1} />));

    act(() => {
      anchor?.capture(control);
      anchor?.cancel();
    });
    rowTop = 340;
    act(() => root.render(<Probe revision={2} />));

    expect(container.scrollTop).toBe(500);
  });
});
```

Create `src/components/agentMode/conversation/AgentTurnEarlierActivity.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAgentTurnActivityWindow } from "../../../domain/agentTurnActivityWindow";
import { AgentTurnEarlierControl, AgentTurnLaterControl } from "./AgentTurnEarlierActivity";

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

const window = openAgentTurnActivityWindow({
  entries: [{ seq: 5, event: { kind: "toolCall", toolId: "t5", name: "Bash", inputSummary: "ls" } }],
  firstSeq: 5,
  lastSeq: 5,
  hasEarlier: true,
  hasLater: true,
  loss: { kind: "none" },
  clipped: false,
});

describe("AgentTurnEarlierControl", () => {
  it("reveals retained rows first, then pages the log, with the label as the loading state", () => {
    const reveal = vi.fn();
    const load = vi.fn();
    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory
          hiddenCount={300}
          logAvailable
          onLoadEarlier={load}
          onRevealMemory={reveal}
          state={{ kind: "latest" }}
        />,
      ),
    );
    act(() => host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.click());
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();

    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory={false}
          hiddenCount={0}
          logAvailable
          onLoadEarlier={load}
          onRevealMemory={reveal}
          state={{ kind: "loading", direction: "earlier", window: null }}
        />,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>("button.cv-load-earlier");
    expect(button?.textContent).toBe("Loading earlier activity…");
    expect(button?.disabled).toBe(true);
  });

  it("offers a retry after a failed page and says when saved activity has a gap", () => {
    const load = vi.fn();
    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory={false}
          hiddenCount={0}
          logAvailable
          onLoadEarlier={load}
          onRevealMemory={() => undefined}
          state={{ kind: "failed", direction: "earlier", window: { ...window, gap: true } }}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load earlier activity.");
    act(() =>
      [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === "Retry")?.click(),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Some activity is missing from the saved history.");
  });

  it("renders nothing when there is nothing earlier to show", () => {
    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory={false}
          hiddenCount={0}
          logAvailable={false}
          onLoadEarlier={() => undefined}
          onRevealMemory={() => undefined}
          state={{ kind: "latest" }}
        />,
      ),
    );
    expect(host.innerHTML).toBe("");
  });
});

describe("AgentTurnLaterControl", () => {
  it("offers later and latest activity for a window that is not at the tail", () => {
    const later = vi.fn();
    const latest = vi.fn();
    act(() =>
      root.render(
        <AgentTurnLaterControl onLatest={latest} onLoadLater={later} running={false} state={{ kind: "ready", window }} />,
      ),
    );
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).toEqual(["Show later activity", "Show latest activity"]);
  });

  it("offers the latest activity again while the turn is still running", () => {
    act(() =>
      root.render(
        <AgentTurnLaterControl
          onLatest={() => undefined}
          onLoadLater={() => undefined}
          running
          state={{ kind: "ready", window: { ...window, hasLater: false } }}
        />,
      ),
    );
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Show latest activity",
    ]);
  });
});
```

Add to `agentTurnLogNotice.test.ts`:

```ts
  it("leaves the saved-but-not-shown case to the load control when a reader exists", () => {
    const facts = factsFixture({ hydration: "partial" });
    expect(agentTurnLossNotice(facts, true)).toBe(AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE);
    expect(agentTurnLossNotice(facts, true, true)).toBeNull();
  });
```

(use the fixture helper that the file's "says the earlier activity is saved but not shown until the window is rebuilt" test already uses; name it `factsFixture` only if the file has no helper.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation/agentTurnFinalResponse.test.ts src/components/agentMode/conversation/useAgentScrollAnchor.test.tsx src/components/agentMode/conversation/AgentTurnEarlierActivity.test.tsx src/components/agentMode/agentTurnLogNotice.test.ts`
Expected: FAIL - modules missing; notice returns the text.

- [ ] **Step 3: Implement the helpers**

Create `src/components/agentMode/conversation/agentTurnFinalResponse.ts`:

```ts
import type { AgentTurnItem } from "../agentTurnProjection";

function finalResponseIndex(items: ReadonlyArray<AgentTurnItem>): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) continue;
    if (item.kind === "assistantText") return index;
    if (item.kind === "result" && !item.isError && item.text.trim() !== "") return index;
  }
  return -1;
}

export function agentFinalResponseItems(
  items: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentTurnItem> {
  const index = finalResponseIndex(items);
  if (index < 0) return [];
  return items.slice(index);
}

export function agentItemsBeforeFinalResponse(
  items: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentTurnItem> {
  const index = finalResponseIndex(items);
  if (index < 0) return items;
  return items.slice(0, index);
}
```

Create `src/components/agentMode/conversation/useAgentScrollAnchor.ts`:

```ts
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

const ROW_SELECTOR =
  "[data-agent-event], .agent-tool-row, .agent-activity-group, .agent-thought, .cv-work-row";

interface CapturedAnchor {
  readonly container: HTMLElement;
  readonly row: HTMLElement | null;
  readonly rowTop: number;
  readonly fallback: HTMLElement;
  readonly fallbackTop: number;
}

export interface AgentScrollAnchor {
  capture(from: HTMLElement): void;
  cancel(): void;
}

export function useAgentScrollAnchor(revision: unknown): AgentScrollAnchor {
  const captured = useRef<CapturedAnchor | null>(null);

  useLayoutEffect(() => {
    const anchor = captured.current;
    if (anchor === null) return;
    captured.current = null;
    const target = restoreTarget(anchor);
    if (target === null) return;
    const delta = target.element.getBoundingClientRect().top - target.top;
    if (!Number.isFinite(delta) || delta === 0) return;
    anchor.container.scrollTop += delta;
  }, [revision]);

  const capture = useCallback((from: HTMLElement): void => {
    const container = from.closest<HTMLElement>(".agent-session__scroll");
    if (container === null) return;
    const scope = from.closest<HTMLElement>(".agent-turn__events") ?? from;
    const row = firstVisibleRow(scope, container.getBoundingClientRect().top, from);
    captured.current = {
      container,
      row,
      rowTop: row === null ? 0 : row.getBoundingClientRect().top,
      fallback: from,
      fallbackTop: from.getBoundingClientRect().top,
    };
  }, []);

  const cancel = useCallback((): void => {
    captured.current = null;
  }, []);

  return useMemo(() => ({ capture, cancel }), [capture, cancel]);
}

function firstVisibleRow(
  scope: HTMLElement,
  containerTop: number,
  from: HTMLElement,
): HTMLElement | null {
  for (const candidate of scope.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    if (candidate === from || candidate.contains(from)) continue;
    if (candidate.getBoundingClientRect().bottom > containerTop) return candidate;
  }
  return null;
}

function restoreTarget(
  anchor: CapturedAnchor,
): { readonly element: HTMLElement; readonly top: number } | null {
  if (anchor.row !== null && anchor.row.isConnected) return { element: anchor.row, top: anchor.rowTop };
  if (anchor.fallback.isConnected) return { element: anchor.fallback, top: anchor.fallbackTop };
  return null;
}
```

Create `src/components/agentMode/conversation/useAgentActivitySources.ts`:

```ts
import { useRef } from "react";
import {
  agentHistoryActivitySourceIdentity,
  type AgentHistoryActivitySource,
} from "../../../application/useAgentHistoryActivity";
import type { AgentThreadHistorySurface } from "../../../application/useAgentThreadHistory";
import type { AgentTurn } from "../../../domain/agentThread";

interface CachedSource {
  readonly identity: string;
  readonly source: AgentHistoryActivitySource;
}

export function useAgentActivitySources(
  history: AgentThreadHistorySurface | undefined,
  threadId: string,
  turns: ReadonlyArray<AgentTurn>,
): ReadonlyMap<string, AgentHistoryActivitySource | null> {
  const cache = useRef(new Map<string, CachedSource>());
  const retained = new Map<string, CachedSource>();
  const sources = new Map<string, AgentHistoryActivitySource | null>();
  for (const turn of turns) {
    const source = turn.eventsTruncated
      ? (history?.activitySource?.(threadId, turn.turnId) ?? null)
      : null;
    const identity = agentHistoryActivitySourceIdentity(source);
    if (source === null || identity === null) {
      sources.set(turn.turnId, null);
      continue;
    }
    const cached = cache.current.get(turn.turnId);
    const stable = cached?.identity === identity ? cached.source : source;
    retained.set(turn.turnId, { identity, source: stable });
    sources.set(turn.turnId, stable);
  }
  cache.current = retained;
  return sources;
}
```

Create `src/components/agentMode/conversation/AgentTurnEarlierActivity.tsx`:

```tsx
import {
  agentTurnActivityWindowOf,
  type AgentTurnEarlierActivityState,
} from "../../../application/useAgentHistoryActivity";
import type { AgentTurnActivityWindow } from "../../../domain/agentTurnActivityWindow";
import { agentTurnLogLossNotice } from "../agentTurnLogNotice";

export const AGENT_ACTIVITY_GAP_NOTICE = "Some activity is missing from the saved history.";
export const AGENT_ACTIVITY_CLIPPED_NOTICE = "Some saved activity was shortened for display.";

export interface AgentTurnEarlierControlProps {
  readonly state: AgentTurnEarlierActivityState;
  readonly logAvailable: boolean;
  readonly canRevealMemory: boolean;
  readonly hiddenCount: number;
  onRevealMemory(from: HTMLElement): void;
  onLoadEarlier(from: HTMLElement): void;
}

export function AgentTurnEarlierControl({
  canRevealMemory,
  hiddenCount,
  logAvailable,
  onLoadEarlier,
  onRevealMemory,
  state,
}: AgentTurnEarlierControlProps) {
  const window = agentTurnActivityWindowOf(state);
  const loading = state.kind === "loading" && state.direction === "earlier";
  const failed = state.kind === "failed" && state.direction === "earlier";
  const fromLog = window !== null || !canRevealMemory;
  const offered = window === null ? canRevealMemory || logAvailable : window.hasEarlier;
  const notice = windowNotice(window);
  const unreachable = window === null && !canRevealMemory && !logAvailable && hiddenCount > 0;
  if (!offered && !failed && notice === null && !unreachable) return null;
  return (
    <div className="cv-earlier">
      {offered && (
        <button
          className="cv-load-earlier"
          disabled={loading}
          onClick={(event) => {
            if (fromLog) {
              onLoadEarlier(event.currentTarget);
              return;
            }
            onRevealMemory(event.currentTarget);
          }}
          type="button"
        >
          {loading ? "Loading earlier activity…" : "Load earlier activity"}
        </button>
      )}
      {failed && (
        <p className="agent-note agent-note--warning" role="alert">
          Could not load earlier activity.{" "}
          <button
            className="cv-banner-action"
            onClick={(event) => onLoadEarlier(event.currentTarget)}
            type="button"
          >
            Retry
          </button>
        </p>
      )}
      {notice !== null && <p className="agent-note agent-note--warning">{notice}</p>}
      {unreachable && (
        <p className="agent-note">
          {hiddenCount} earlier {hiddenCount === 1 ? "event is" : "events are"} not shown.
        </p>
      )}
    </div>
  );
}

export interface AgentTurnLaterControlProps {
  readonly state: AgentTurnEarlierActivityState;
  readonly running: boolean;
  onLoadLater(): void;
  onLatest(): void;
}

export function AgentTurnLaterControl({
  onLatest,
  onLoadLater,
  running,
  state,
}: AgentTurnLaterControlProps) {
  const window = agentTurnActivityWindowOf(state);
  if (window === null) return null;
  const loading = state.kind === "loading" && state.direction === "later";
  const failed = state.kind === "failed" && state.direction === "later";
  return (
    <div className="cv-earlier cv-earlier--later">
      {window.hasLater && (
        <button className="cv-load-earlier" disabled={loading} onClick={onLoadLater} type="button">
          {loading ? "Loading later activity…" : "Show later activity"}
        </button>
      )}
      {failed && (
        <p className="agent-note agent-note--warning" role="alert">
          Could not load later activity.
        </p>
      )}
      {(window.hasLater || running) && (
        <button className="cv-load-earlier" onClick={onLatest} type="button">
          Show latest activity
        </button>
      )}
    </div>
  );
}

function windowNotice(window: AgentTurnActivityWindow | null): string | null {
  if (window === null) return null;
  if (window.loss.kind !== "none") return agentTurnLogLossNotice(window.loss) ?? AGENT_ACTIVITY_GAP_NOTICE;
  if (window.gap) return AGENT_ACTIVITY_GAP_NOTICE;
  if (window.clipped) return AGENT_ACTIVITY_CLIPPED_NOTICE;
  return null;
}
```

In `agentTurnItemKeys.ts` add:

```ts
export function agentTurnLogItemKey(seq: number): string {
  return `w${Number.isSafeInteger(seq) && seq > 0 ? seq : 0}`;
}
```

In `agentTurnProjection.ts` add the parameter `keyOf?: (offset: number) => string,` after `renderedLimit` and change the one line `const key = agentTurnItemKey(offset, firstEventOffset);` to `const key = keyOf === undefined ? agentTurnItemKey(offset, firstEventOffset) : keyOf(offset);` (touch nothing else in this file - P4 owns the `subagentGroup` lines next to it).

In `agentTurnLogNotice.ts`: add a third parameter `readerAvailable = false` to `agentTurnLogNoticeModel` and `agentTurnLossNotice`, pass it through, and change `if (display === "savedNotShown") return AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE;` to `if (display === "savedNotShown") return readerAvailable ? null : AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE;`.

- [ ] **Step 4: Run the unit tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/components/agentMode/agentTurnLogNotice.test.ts src/components/agentMode/agentTurnProjection.test.ts src/components/agentMode/agentTranscriptPresentation.test.ts`
Expected: PASS (drop paths that do not exist).

- [ ] **Step 5: Wire the turn view**

In `src/components/agentMode/AgentTurnView.tsx`:
1. Imports: remove `AgentHistoryWork`; add `useAgentTurnEarlierActivity`, `agentTurnActivityWindowOf`, `type AgentHistoryActivitySource` (`../../application/useAgentHistoryActivity`), `agentTurnActivityWindowEvents` (`../../domain/agentTurnActivityWindow`), `agentTurnEventUtf8Bytes` (`../../domain/agentThread`), `agentTurnLogItemKey` (`./agentTurnItemKeys`), `AgentTurnEarlierControl`, `AgentTurnLaterControl` (`./conversation/AgentTurnEarlierActivity`), `useAgentScrollAnchor` (`./conversation/useAgentScrollAnchor`), `agentFinalResponseItems`, `agentItemsBeforeFinalResponse` (`./conversation/agentTurnFinalResponse`).
2. Props: replace `readonly historyWork: AgentHistoryWork;` with `readonly activitySource?: AgentHistoryActivitySource | null;` and destructure `activitySource = null` instead of `historyWork`.
3. After `const running = settlement === "running";` add:

```tsx
  const readerSource =
    activitySource !== null &&
    activitySource.scope.turnId === turn.turnId &&
    turn.eventsTruncated
      ? activitySource
      : null;
  const earlier = useAgentTurnEarlierActivity(readerSource);
  const activityWindow = agentTurnActivityWindowOf(earlier.state);
  const memoryBytes = useMemo(
    () => turn.events.reduce((total, event) => total + agentTurnEventUtf8Bytes(event), 0),
    [turn.events],
  );
  const anchorRevision = useMemo(
    () => ({ activityWindow, renderedLimit }),
    [activityWindow, renderedLimit],
  );
  const scrollAnchor = useAgentScrollAnchor(anchorRevision);
  const earlierFailed = earlier.state.kind === "failed";
  useEffect(() => {
    if (earlierFailed) scrollAnchor.cancel();
  }, [earlierFailed, scrollAnchor]);
```

4. Replace the `savedWork`, `savedItems`, `savedRawLines` memos and the `visibleItems` line with:

```tsx
  const windowEvents = useMemo(
    () => (activityWindow === null ? null : agentTurnActivityWindowEvents(activityWindow)),
    [activityWindow],
  );
  const windowAtTail = activityWindow !== null && !activityWindow.hasLater && !running;
  const savedWork = useMemo(
    () =>
      windowEvents === null
        ? null
        : agentTurnProjection(
            windowEvents.events,
            null,
            workspaceRoot,
            savedToolSettlement(turn.status),
            0,
            MAX_REVEALED_EVENTS_PER_TURN,
            (offset) => agentTurnLogItemKey(windowEvents.seqs[offset] ?? 0),
          ),
    [turn.status, windowEvents, workspaceRoot],
  );
  const savedItems = useMemo(() => {
    if (savedWork === null) return null;
    if (windowAtTail) return agentItemsBeforeFinalResponse(savedWork.items);
    return savedWork.items;
  }, [savedWork, windowAtTail]);
  const visibleItems = useMemo(() => {
    if (activityWindow === null) return workFold?.visibleItems ?? projection.items;
    if (foregroundRunning) return [];
    return agentFinalResponseItems(projection.items);
  }, [activityWindow, foregroundRunning, projection.items, workFold]);
  const savedRawLines = useMemo(
    () =>
      savedWork?.rawLines.filter(
        (line) => !isAgentRawOutputNoise(provider, line.stream, line.raw),
      ) ?? [],
    [provider, savedWork],
  );
```

5. Replace the `{projection.hiddenCount > 0 && (<AgentTurnEarlierEvents .../>)}` block (and delete the `AgentTurnEarlierEvents` function and `canShowEarlier`/`showEarlier`) with, as the FIRST child of `<div className="agent-turn__events">`:

```tsx
            <AgentTurnEarlierControl
              canRevealMemory={
                activityWindow === null &&
                projection.hiddenCount > 0 &&
                renderedLimit < MAX_REVEALED_EVENTS_PER_TURN
              }
              hiddenCount={activityWindow === null ? projection.hiddenCount : 0}
              logAvailable={readerSource !== null}
              onLoadEarlier={(from) => {
                scrollAnchor.capture(from);
                void earlier.loadEarlier(memoryBytes);
              }}
              onRevealMemory={(from) => {
                scrollAnchor.capture(from);
                setRenderedLimit((limit) =>
                  agentRenderedEventLimit(limit + MAX_RENDERED_EVENTS_PER_TURN),
                );
              }}
              state={earlier.state}
            />
```

6. `<AgentTurnWork>` call: render condition `(workFold !== null || activityWindow !== null)`; props `items={savedItems ?? workFold?.workItems ?? []}`, `settlement={activityWindow === null ? toolSettlement : savedToolSettlement(turn.status)}`, `stream={activityWindow === null ? stream : "settled"}`, `turn={turn}`, `autoOpen={activityWindow !== null || foregroundRunning || agentActivityAttentionCount(workFold?.workItems ?? []) > 0}`, the label's hidden count `activityWindow === null ? projection.hiddenCount : 0`, delete `historyWork={historyWork}`, and add

```tsx
                trailing={
                  <AgentTurnLaterControl
                    onLatest={earlier.latest}
                    onLoadLater={() => void earlier.loadLater()}
                    running={running}
                    state={earlier.state}
                  />
                }
```

   The line `{workFold === null && !historyWork.available && liveStatus}` becomes `{workFold === null && activityWindow === null && liveStatus}`.
7. `<AgentTurnLogNotices ... />` gets `readerAvailable={readerSource !== null}` and passes it as the third argument of `agentTurnLogNoticeModel`.

In `conversation/AgentTurnWork.tsx`: delete the `historyWork` prop and the summary `onClick`, delete `{historyWork.controls}`, add `readonly trailing: ReactNode;` and render `{trailing}` directly after the `<AgentActivityItems .../>` inside `.agent-work__events` (before `{liveStatus}`).

- [ ] **Step 6: Wire the session**

In `AgentThreadSession.tsx`: delete `import { AgentHistoryActivity } from "./AgentHistoryActivity";`, add `import { useAgentActivitySources } from "./conversation/useAgentActivitySources";`, add `const activitySources = useAgentActivitySources(history, threadId, displayedTurns);` next to the other hooks, and replace the `<AgentHistoryActivity key=... turn=... source=...>{(historyWork) => (<>...</>)}</AgentHistoryActivity>` wrapper with a keyed fragment:

```tsx
              {displayedTurns.map((turn) => (
                <Fragment key={turn.turnId}>
                  <AgentTurnView
                    activitySource={activitySources.get(turn.turnId) ?? null}
                    attachmentImages={agentTurnCarriesAttachments(turn) ? attachmentImageViewer : null}
                    artifactScope={artifactScope}
                    highlight={highlightFor(turn.turnId)}
                    onOpenAgents={agents.openPanel}
                    subagents={agents.subagentsFor(turn.turnId)}
                    prose={prose}
                    provider={record.provider.kind}
                    executionTarget={thread.execution?.kind ?? "local"}
                    renderProbe={turnRenderProbe}
                    textClipboard={textClipboard}
                    turn={turn}
                    turnLog={turnLog}
                    workspaceRoot={record.target.worktreePath ?? record.owner.repositoryRoot}
                  />
                  {isTerminalAgentTurnStatus(turn.status) && getTurnChanges && (
                    <AgentRecordedTurnChanges
                      active={activeDiffTurnId === turn.turnId}
                      getTurnChanges={getTurnChanges}
                      key={`${threadId}:${turn.turnId}`}
                      onOpenDiff={(summary) => onOpenTurnDiff?.(threadId, summary)}
                      revision={turnChangesRevision}
                      threadId={threadId}
                      turnId={turn.turnId}
                    />
                  )}
                </Fragment>
              ))}
```

(`Fragment` from `react`.) Delete `src/components/agentMode/AgentHistoryActivity.tsx` and `AgentHistoryActivity.test.tsx`.

- [ ] **Step 7: Styles**

Delete the `.agent-turn-earlier*` stopgap from `conversation/conversation.css` and append:

```css
.cv-earlier {
  display: grid;
  gap: var(--cv-space-2);
  min-width: 0;
  padding-bottom: var(--cv-space-2);
}

.cv-earlier--later {
  padding: var(--cv-space-2) 0 0;
}
```

Add to `conversationStyles.test.ts`: `expect(declaredValue(CONVERSATION, ".cv-earlier", "display")).toBe("grid");` inside "keeps the load-earlier controls quiet".

- [ ] **Step 8: Rewrite the saved-activity integration tests**

In `src/components/agentMode/AgentHistoryPager.test.tsx` replace the three tests that use `activitySource` with:

```tsx
it("offers the latest activity again while a running turn shows saved activity", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const turn = logTurn({
    turnId: "live",
    status: { kind: "running" },
    events: [{ kind: "assistantText", text: "Current live output" }],
    eventsTruncated: true,
  });
  const view = { ...original, thread: { ...original.thread, turns: [turn] } };
  const readPage = vi.fn().mockResolvedValue({
    entries: [{ seq: 1, event: { kind: "contextCompactionStatus", status: "compacting", message: null } }],
    firstSeq: 1,
    lastSeq: 1,
    hasEarlier: false,
    hasLater: false,
    clipped: false,
    loss: { kind: "none" },
  });
  const history: AgentThreadHistorySurface = {
    page: null,
    older: vi.fn(),
    latest: vi.fn(),
    activitySource: () => ({
      scope: {
        rootKey: view.thread.owner.rootKey,
        ownerId: view.thread.owner.ownerId,
        threadId: view.thread.threadId,
        turnId: turn.turnId,
      },
      generation: 1,
      leaseToken: null,
      readPage,
    }),
  };
  try {
    await act(async () =>
      root.render(
        <AgentThreadSession thread={view} history={history} composerRepositoryLabel="app" onReviewInDiff={vi.fn()} />,
      ),
    );
    expect(readPage).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.click());
    expect(readPage).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("Compacting context…");
    expect(host.querySelectorAll(".agent-tool-row--working")).toHaveLength(1);
    const latest = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show latest activity",
    );
    expect(latest).toBeDefined();
    await act(async () => latest?.click());
    expect(host.textContent).toContain("Current live output");
    expect(turn.status.kind).toBe("running");
  } finally {
    act(() => root.unmount());
  }
});

it("loads earlier work only on request, keeps final prose once, and keeps page-ending updates and raw diagnostics", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const turn = logTurn({
    turnId: "saved",
    prompt: "Preserved prompt",
    eventsTruncated: true,
    status: { kind: "exited", exitCode: 0 },
    events: [{ kind: "assistantText", text: "Final answer stays visible" }],
  });
  const readPage = vi.fn().mockResolvedValueOnce({
    entries: [
      { seq: 1, event: { kind: "reasoning", text: "Earlier reasoning" } },
      { seq: 2, event: { kind: "error", message: "An earlier failure" } },
      { seq: 3, event: { kind: "unknownLine", stream: "stderr", raw: "Historical diagnostic", clipped: false } },
      { seq: 4, event: { kind: "assistantText", text: "Intermediate page-ending update" } },
    ],
    firstSeq: 1,
    lastSeq: 4,
    hasEarlier: false,
    hasLater: true,
    clipped: false,
    loss: { kind: "none" },
  });
  const history: AgentThreadHistorySurface = {
    page: null,
    older: vi.fn(),
    latest: vi.fn(),
    activitySource: () => ({
      scope: { rootKey: "/workspace", ownerId: "owner", threadId: original.thread.threadId, turnId: turn.turnId },
      generation: 1,
      leaseToken: null,
      readPage,
    }),
  };
  try {
    await act(async () =>
      root.render(
        <AgentThreadSession
          thread={{ ...original, thread: { ...original.thread, turns: [turn] } }}
          history={history}
          composerRepositoryLabel="app"
          onReviewInDiff={vi.fn()}
        />,
      ),
    );
    expect(readPage).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.click());
    expect(readPage).toHaveBeenCalledOnce();
    const work = host.querySelector<HTMLDetailsElement>(".agent-work");
    expect(work?.open).toBe(true);
    expect(work?.textContent).toContain("Intermediate page-ending update");
    expect(work?.textContent).toContain("Historical diagnostic");
    expect(host.textContent).toContain("Preserved prompt");
    expect(host.textContent?.match(/Final answer stays visible/g)).toHaveLength(1);
    readPage.mockResolvedValueOnce({
      entries: [{ seq: 10, event: turn.events[0] }],
      firstSeq: 10,
      lastSeq: 10,
      hasEarlier: true,
      hasLater: false,
      clipped: false,
      loss: { kind: "none" },
    });
    await act(async () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Show later activity")?.click(),
    );
    expect(host.textContent?.match(/Final answer stays visible/g)).toHaveLength(1);
    expect(host.textContent).toContain("Some activity is missing from the saved history.");
    expect(host.querySelector<HTMLDetailsElement>(".agent-work")?.open).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});

it("does not add a control or request history merely because a reader exists", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = surfaceThreadView();
  const turn = logTurn({ events: [], eventsTruncated: false });
  const readPage = vi.fn();
  try {
    await act(async () =>
      root.render(
        <AgentThreadSession
          thread={{ ...original, thread: { ...original.thread, turns: [turn] } }}
          history={{
            page: null,
            older: vi.fn(),
            latest: vi.fn(),
            activitySource: () => ({
              scope: { rootKey: "/root", ownerId: "owner", threadId: original.thread.threadId, turnId: turn.turnId },
              generation: 1,
              leaseToken: null,
              readPage,
            }),
          }}
          composerRepositoryLabel="app"
          onReviewInDiff={vi.fn()}
        />,
      ),
    );
    expect(host.querySelector(".agent-work")).toBeNull();
    expect(host.querySelector("button.cv-load-earlier")).toBeNull();
    expect(readPage).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});
```

In `AgentThreadSession.turnLog.test.tsx` add (reuse its `render`/facts helpers; the turn is settled and window-truncated, the facts say "saved but not shown", and a history surface with an `activitySource` is passed):

```tsx
  it("replaces the saved-but-not-shown notice with the load control when the log is readable", () => {
    renderWithReader();
    expect(host.textContent).not.toContain(AGENT_TURN_LOG_SAVED_NOT_SHOWN_NOTICE);
    expect(host.querySelector("button.cv-load-earlier")?.textContent).toBe("Load earlier activity");
  });
```

where `renderWithReader()` is the file's render call used by "says the earlier activity is saved but not shown while the window holds less", plus `history={{ page: null, older: vi.fn(), latest: vi.fn(), activitySource: (threadId, turnId) => ({ scope: { rootKey: "/root", ownerId: "owner", threadId, turnId }, generation: 1, leaseToken: null, readPage: vi.fn() }) }}`.

- [ ] **Step 9: Run the focused tests**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/conversation src/application/useAgentHistoryActivity.test.tsx src/domain/agentTurnActivityWindow.test.ts src/components/agentMode/AgentHistoryPager.test.tsx src/components/agentMode/AgentThreadSession.turnLog.test.tsx src/components/agentMode/AgentThreadSession.test.tsx src/components/agentMode/AgentThreadSession.hydration.test.tsx src/components/agentMode/AgentThreadSession.viewport.test.tsx src/components/agentMode/AgentThreadSession.transcript.test.tsx src/components/agentMode/agentThreadTurns.test.tsx src/application/agentTurnLogLazySummaries.test.tsx && npx tsc --noEmit -p .; echo tsc=$?`
Expected: PASS and `tsc=0`. `grep -rn "AgentHistoryActivity\b\|useAgentHistoryActivity(" src` returns nothing.

---
### Task 15: Performance evidence (lead)

**Files:**
- Create (temporary, never committed): `src/components/agentMode/zzP3Perf.local.test.tsx`; baseline worktree `/tmp/p3-baseline`

**Interfaces:**
- Consumes: the Task 0 baseline commit hash (`git rev-parse HEAD` recorded before Stream A started), `surfaceThreadView` (`src/components/agentMode/agentSurfaceTestFixtures.tsx`), `logTurn` (`src/test/agentTurnLogStoreHarness.ts`).
- Produces: a before/after table (median mount ms, median streaming-append ms, turn re-render count per append, DOM element count) for the final report; the regression gate "each P3 value ≤ 1.2 × baseline and re-renders per append unchanged".

- [ ] **Step 1: Write the probe**

Create `src/components/agentMode/zzP3Perf.local.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { logTurn } from "../../test/agentTurnLogStoreHarness";
import { AgentThreadSession } from "./AgentThreadSession";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

function events(turn: number): AgentTurnEvent[] {
  const list: AgentTurnEvent[] = [];
  for (let index = 0; index < 100; index += 1) {
    const toolId = `t${turn}-${index}`;
    list.push({ kind: "toolCall", toolId, name: "Bash", inputSummary: `npm test -- ${index}` });
    list.push({ kind: "toolResult", toolId, outputSummary: "ok", isError: false });
  }
  list.push({ kind: "assistantText", text: `Answer ${turn} with \`code\` and a [link](src/app.ts).` });
  return list;
}

function turns(): AgentTurn[] {
  return Array.from({ length: 64 }, (_, index) =>
    logTurn({
      turnId: `turn-${index}`,
      prompt: `Prompt ${index}`,
      status: { kind: "exited", exitCode: 0 },
      startedAtEpochMs: 1_000 + index,
      endedAtEpochMs: 2_000 + index,
      events: events(index),
    }),
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

it("measures conversation mount and streaming append", () => {
  const mounts: number[] = [];
  const appends: number[] = [];
  let probeCalls = 0;
  let elements = 0;
  for (let run = 0; run < 5; run += 1) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const base = surfaceThreadView();
    const list = turns();
    const view = { ...base, thread: { ...base.thread, turns: list } };
    const probe = vi.fn();
    let start = performance.now();
    act(() =>
      root.render(
        <AgentThreadSession composerRepositoryLabel="app" onReviewInDiff={vi.fn()} thread={view} turnRenderProbe={probe} />,
      ),
    );
    mounts.push(performance.now() - start);
    elements = host.querySelectorAll("*").length;
    probe.mockClear();
    const last = list[list.length - 1] as AgentTurn;
    const grown = { ...last, status: { kind: "running" as const }, events: [...last.events, { kind: "assistantText" as const, text: " more" }] };
    const next = { ...view, thread: { ...view.thread, turns: [...list.slice(0, -1), grown] } };
    start = performance.now();
    act(() =>
      root.render(
        <AgentThreadSession composerRepositoryLabel="app" onReviewInDiff={vi.fn()} thread={next} turnRenderProbe={probe} />,
      ),
    );
    appends.push(performance.now() - start);
    probeCalls = probe.mock.calls.length;
    act(() => root.unmount());
    host.remove();
  }
  console.log(
    JSON.stringify({ mountMs: median(mounts), appendMs: median(appends), probeCalls, elements }),
  );
  expect(probeCalls).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Measure the baseline**

```bash
cd /Users/matusmockor/Developer/editor
git worktree add --detach /tmp/p3-baseline <baseline-commit-from-Task-0>
ln -s /Users/matusmockor/Developer/editor/node_modules /tmp/p3-baseline/node_modules
cp src/components/agentMode/zzP3Perf.local.test.tsx /tmp/p3-baseline/src/components/agentMode/
cd /tmp/p3-baseline && npx vitest run src/components/agentMode/zzP3Perf.local.test.tsx 2>&1 | grep mountMs
```

Expected: one JSON line. If the fixture helpers differ in the baseline tree, adapt only the probe's imports there.

- [ ] **Step 3: Measure P3**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/zzP3Perf.local.test.tsx 2>&1 | grep mountMs`
Expected: `mountMs` and `appendMs` ≤ 1.2 × baseline, `probeCalls` equal to the baseline value (only the appended turn re-renders), `elements` reported (P3 removes the always-visible head row per turn and the file-tree card, so it should not grow). If a value regresses, profile with the React profiler in the QA app before changing code (memory: "profile before optimizing") and route the fix to the owning task.

- [ ] **Step 4: Clean up**

```bash
cd /Users/matusmockor/Developer/editor
rm src/components/agentMode/zzP3Perf.local.test.tsx
git worktree remove --force /tmp/p3-baseline
git status --short | grep zzP3Perf; echo leftover=$?
```

Expected: `leftover=1` (nothing left). Record the table for the final report.

---

### Task 16: Full repository gates (lead)

**Files:** none changed; a failing gate goes back to the owning task's agent.

**Interfaces:**
- Consumes: all changes of Tasks 1-14.
- Produces: a gate log with exit codes.

- [ ] **Step 1: Confirm only owned files changed**

Run: `cd /Users/matusmockor/Developer/editor && git status --short && git diff --stat`
Expected: only files listed in the Ownership section (plus sibling phases' files, which the lead does not stage for P3); no build output, logs, `zzP3Perf` or scratch files.

- [ ] **Step 2: TypeScript gates**

```bash
cd /Users/matusmockor/Developer/editor
npm run check; echo check=$?
npm run lint -- --max-warnings 0; echo lint=$?
npm run lint:exhaustive-deps; echo deps=$?
npm run build; echo build=$?
npm run size:hotspots; echo hotspots=$?
npm run format:check; echo format=$?
npm run format:check:changed; echo formatChanged=$?
npm test -- --run; echo test=$?
git diff --check; echo diffcheck=$?
```

Expected: every value `0`. `size:hotspots` must pass without touching `scripts/hotspot-size-baseline.json`; `AgentThreadSession.tsx` must be below its pre-P3 4874 structural tokens (Task 0 Step 3). If `npm test` fails only in Node watch tests with `EADDRINUSE 9229`, free the port (kill only orphaned `node` test processes) and rerun sequentially.

- [ ] **Step 3: Rust gates (no Rust changes in P3; run them because CLAUDE.md requires all applicable gates)**

```bash
cd /Users/matusmockor/Developer/editor/src-tauri
cargo check --all-targets; echo check=$?
cargo test --lib; echo lib=$?
cargo test --tests; echo tests=$?
cargo fmt --all -- --check; echo fmt=$?
cargo clippy --all-targets -- -D warnings; echo clippy=$?
```

Expected: every value `0`.

- [ ] **Step 4: Legacy-token sweep of P3 files**

Run: `cd /Users/matusmockor/Developer/editor && grep -n "var(--agent-\|var(--codevo-[a-eg-z]\|var(--color-" src/components/agentMode/conversation/*.css src/components/agentMode/composer/*.css src/components/agentMode/agentToolRows.css src/components/agentMode/agentQuestionCard.css src/components/agentMode/agentComposerCommands.css; echo sweep=$?`
Expected: `sweep=1` (no matches; `--codevo-fs-scale` is the only allowed `--codevo-` name and starts with `f`).

---

### Task 17: Independent read-only review (Opus 5.5)

**Files:** none (read-only reviewer); fixes go back to the owning task agent.

**Interfaces:**
- Consumes: `git diff` of Tasks 1-14, this plan, spec §3.1.4 and §3.2 B7, the mockup.
- Produces: a findings list P0/P1/P2 with file:line evidence.

- [ ] **Step 1: Dispatch the reviewer**

Dispatch one Opus 5.5 subagent (`model: "opus"`, not an author of Tasks 1-14) with:

```text
Read-only adversarial review of Codevo redesign P3 (conversation, composer, B7) in /Users/matusmockor/Developer/editor. Do not modify files and do not run mutating git commands. Read CLAUDE.md, docs/superpowers/plans/2026-09-24-redesign-p3-conversation.md, docs/redesign/v3-monolith-clean.html and `git diff` plus the new untracked files under src/components/agentMode/conversation/, src/components/agentMode/composer/ and src/domain/agentTurnActivityWindow*.
Verify every finding in code before reporting. Report P0 (wrong behavior, data loss, crash), P1 (isolation, boundedness, race, stale async result, missing regression test, lost capability, accessibility regression), P2 (quality, mockup mismatch), each with file:line and a concrete failing scenario. Focus:
1. B7: every await in useAgentTurnEarlierActivity revalidates mounted + ticket + source identity; A -> B -> A and turn switches drop late pages; one read in flight; the window never exceeds 1000 entries / 2 MiB; rejected/lossy/gapped/clipped pages are labelled, never shown as complete; the final answer is never duplicated or lost in log mode; running turns always offer "Show latest activity"; seq keys ("w<seq>") never collide with memory keys ("e<n>") and find/highlight ignores them; the scroll anchor never restores a stale capture (failure, "Show latest", user scroll).
2. Composer: approval/question replace the editor without unmounting the draft, attachments or launch controls; Enter/Escape do nothing while an interaction is active; one decision per double click; focus moves into the panel only when focus would otherwise be lost; the controller memo equality covers every new prop (banners, renderDrawerEnd, interactions) so no stale render and no render storm; accessible names listed in the plan are unchanged; the attach button, stop and send keep their keyboard shortcuts.
3. Transcript: metadata truly hidden until hover/focus but reachable by keyboard (focus-within); no capability lost (per-file diff still reachable from the diff panel, answered-question and settled-approval information, raw output, compaction rows, minimap, find reveal, queued-message actions, imported history paging, "Earlier turns were dropped" note, thread text size setting via --codevo-fs-scale).
4. CSS: only --cv-* tokens (plus --codevo-fs-scale), no colour literals outside the media chips, motion via tokens, reduced motion honoured, long commands/paths/labels wrap or truncate inside 768px, dark and light palettes both readable (check hover/active tints against P2's tokens).
5. Gates and hygiene: AgentThreadSession.tsx smaller than before, no hotspot baseline change, no code comments, no else branches, no any, no files outside the Ownership list, P4's subagentGroup hunk untouched by P3.
Return the findings list only.
```

- [ ] **Step 2: Resolve findings**

For each P0/P1 finding: confirm it in code (memory: audits overstate - verify first), send the fix to the owning task agent with a failing test first, rerun that task's focused tests. Record rejected findings with a one-line reason.

- [ ] **Step 3: Rerun the gates**

Repeat Task 16 Steps 2-4. Expected: all exit codes `0` (sweep `1`).

---

### Task 18: QA build and Codex Computer Use QA

**Files:**
- Create (outside the repo): `/Users/matusmockor/tmp/codevo-qa-p3/` fixture project, `/Users/matusmockor/tmp/codevo-qa/qa_prompt_p3.txt`

**Interfaces:**
- Consumes: the reviewed tree from Task 17.
- Produces: a Slovak QA report with PASS/FAIL/BLOCKED per step and screenshots in `/Users/matusmockor/tmp/codevo-qa/shots-p3/`.

- [ ] **Step 1: Build the QA bundle**

Run: `cd /Users/matusmockor/Developer/editor && npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'; echo exit=$?; ls -d "src-tauri/target/debug/bundle/macos/Codevo QA.app"`
Expected: the `.app` path is listed. `exit=1` caused only by the missing updater signing key is acceptable; a compile error is not.

- [ ] **Step 2: Prepare the fixture project**

```bash
mkdir -p /Users/matusmockor/tmp/codevo-qa-p3/src/routes /Users/matusmockor/tmp/codevo-qa-p3/test
cd /Users/matusmockor/tmp/codevo-qa-p3
printf '{\n  "name": "orders-api",\n  "private": true,\n  "scripts": { "test": "node --test" }\n}\n' > package.json
printf 'export const router = [];\n' > src/routes/orders.ts
printf 'import test from "node:test";\ntest("ok", () => {});\n' > test/orders.test.js
cp /Users/matusmockor/tmp/codevo-qa-p0/pripona.png ./chart.png 2>/dev/null || cp "$(ls /Users/matusmockor/Library/Application\ Support/dev.mockor.editor/agent-attachments/threads/*/*.png | head -1)" ./chart.png
git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.invalid commit -qm fixture
```

Expected: a git repo with `chart.png`.

- [ ] **Step 3: Launch the QA app (lead, own Bash in the GUI session)**

Run: `open "/Users/matusmockor/Developer/editor/src-tauri/target/debug/bundle/macos/Codevo QA.app" && sleep 5 && osascript -e 'tell application "Codevo QA" to activate' && pgrep -f "Codevo QA.app/Contents/MacOS" | head -1`
Expected: a PID; put it in place of `<PID>` below. Open `/Users/matusmockor/tmp/codevo-qa-p3` in agent mode and trust it if the tester cannot.

- [ ] **Step 4: Write the QA prompt**

Write `/Users/matusmockor/tmp/codevo-qa/qa_prompt_p3.txt`:

```text
You are a UI QA tester using Computer Use on macOS. Report in Slovak.

HARD RULES
- FIRST ACTION: use Computer Use to get the app state / take one screenshot of the QA app. If Computer Use tools are unavailable, denied, or the first screenshot/app-state call fails, STOP IMMEDIATELY and reply only: "COMPUTER_USE_UNAVAILABLE: <exact error>". Do not retry or work around it.
- ATTACH ONLY. The QA app is ALREADY RUNNING: "Codevo QA" (bundle id dev.mockor.editor.qa, process id <PID>). Never launch, open, build, restart or close any app.
- NEVER touch the app "Codevo Editor" (bundle id dev.mockor.editor) - that is the user's live session. Only interact with "Codevo QA".
- Before EVERY screenshot bring "Codevo QA" to the front (activate it) and confirm it is the frontmost window.
- Do not edit files, do not run git commands, do not change settings except the palette/theme steps below.
- Save screenshots into /Users/matusmockor/tmp/codevo-qa/shots-p3/ (create it) named NN-step.png and list them.
- Compare each state with the mockup description given in the step; report any clipping, overlap, wrong colour contrast, misalignment or text that differs.
- If a step is blocked (agent CLI not signed in, trust dialog), mark it BLOCKED with the reason and continue. Time budget ~45 minutes.

SETUP: project /Users/matusmockor/tmp/codevo-qa-p3 (git, "orders-api") open in agent mode; palette Graphite · Teal, Dark.

STEPS (for each: action, expected, observed, PASS/FAIL, screenshot)
1. Empty thread. Click New thread. Expected: large centred question "What should we build in orders-api?" with the project name dotted-underlined, the composer directly under it (rounded slab, placeholder "Ask for changes, send follow-ups, or attach images", model/effort/access controls bottom-left, paperclip and a round send arrow bottom-right, a thin drawer under the slab with the checkout on the left). No status bar.
2. Attachment tile + lightbox. Attach /Users/matusmockor/tmp/codevo-qa-p3/chart.png with the paperclip. Expected: a 64x64 thumbnail tile with a small round x in its corner inside the composer. Click the tile: a dark scrim preview opens with a round close button above the image's top-right corner and the file name under it; Escape closes it.
3. Running state. Type "List the files in this repo, then run npm test and summarize." and send (Claude Code). While it runs: the send button is replaced by a round stop square; placeholder "Queue a follow-up"; the transcript shows the user message as a right-aligned bubble with the image thumbnail ABOVE the text; a live row ("Thinking" with a brain icon, or the running tool) pulses. Screenshot.
4. Work rows and metadata. When it finishes: a collapsed row like "Ran N commands" with a right chevron and a thin line under it; the answer prose; hovering the answer reveals a small grey line "HH:MM · <model> · <duration>" and hovering your bubble reveals "HH:MM" + a copy icon; without hover these are invisible. Click the work row: it expands to rows with icons; the chevron rotates.
5. Code block and file link. Send "Show me a two-line TypeScript example in a code block and link src/routes/orders.ts." Expected: code on a subtle rounded slab, the copy button appears only on hover at its top-right; the file link is a small accent chip.
6. Changes row. Send "Create src/middleware/idempotency.ts exporting an empty function and add one line to src/routes/orders.ts." When done: a compact row "2 changed files +N −M" with "Open diff" at the right under the answer. Click it: the diff panel opens for that turn and the row gets a slightly stronger background.
7. Approval in the composer. Switch the access control to a mode that asks before commands (for Codex choose the approval mode; for Claude choose the ask mode), send "Run: curl https://example.com". Expected: the composer slab itself turns into the approval: a small warning-coloured label (e.g. "Command") + title, the command in monospace, then "Decline" and a primary "Approve" bottom-right and a "…" menu with "Approve for this session". Type nothing; before it appears, type "draft text" in the composer: after you click Decline the composer returns with "draft text" still there.
8. Queued edit. Start a long task ("Write 1500 words about Slovakia."), while it runs type "Also add a chart" + attach chart.png and send (queued). Click the pencil on the queued message. Expected: a tab-like banner attached above the slab "Editing queued message · sends after this turn · Cancel", the image as a thumbnail tile inside the editor, the round button labelled "Save queued message". Press Cancel, then Stop.
9. Background agents (Claude Code). Send "Use two subagents in parallel: one lists files, one reads package.json; wait for both." While they run: a banner attached above the composer "2 agents running · <names> · View"; the transcript shows "Waiting for 2 agents" (or the agents row). Click View: the agents panel opens.
10. Load earlier activity (B7). Open the thread from step 8 or send "Run `for i in $(seq 1 1500); do echo line $i; done` in 1500 separate echo commands, one tool call each." (stop after ~1200 tool calls if needed). Reopen the thread (switch away and back). Expected: at the top of that answer a quiet "Load earlier activity" text button (no warning text "saved but not shown here yet"). Scroll so the first work row is mid-screen, click it: the label changes to "Loading earlier activity…", earlier rows appear ABOVE, and the row you were looking at does not jump. Click again a few times; at some point "Show later activity" / "Show latest activity" appear at the bottom of the work list; "Show latest activity" returns to the normal view.
11. Palettes. Repeat screenshots of steps 3, 4 and 7 in Graphite · Teal Light and in Slate · Blue Dark (Settings > Appearance). Expected: all text readable, hover tints visible, banner and drawer edges visible in light mode.

REPORT FORMAT: per step PASS/FAIL/BLOCKED, expected vs observed in 1-2 sentences, screenshot names; then a list of other visual problems. Keep it factual.
```

- [ ] **Step 5: Run the QA orchestrator**

```bash
python3 /Users/matusmockor/tmp/codevo-qa/qa_orchestrator_v2.py /Users/matusmockor/tmp/codevo-qa/qa_prompt_p3.txt /Users/matusmockor/tmp/codevo-qa-p3 > /tmp/qa-p3.log 2>&1
```

Run it in the background and watch `/tmp/qa-p3.log` only for `===== QA REPORT =====`, `COMPUTER_USE_UNAVAILABLE`, `[qa] ERROR`, `TIMEOUT` and `[qa] turn completed`. If Computer Use is unavailable from this context, give the user the prompt to run in their own interactive `codex` session (ATTACH ONLY to the running "Codevo QA") and wait for the pasted report.

- [ ] **Step 6: Handle findings and clean up**

For each FAIL: verify the root cause in code, fix it through the owning task agent with a regression test, rerun Tasks 16-17, rebuild, and rerun only the failing QA steps. When QA passes: `osascript -e 'quit app "Codevo QA"'`, then delete `/tmp/qa-p3.log`, `/Users/matusmockor/tmp/codevo-qa-p3` and `/Users/matusmockor/tmp/codevo-qa/shots-p3` after recording the report.

---

### Task 19: Commit to main (lead)

**Files:** the files in the Ownership section only.

**Interfaces:**
- Consumes: green gates (Task 16), resolved review (Task 17), passing QA (Task 18), perf table (Task 15).
- Produces: commits on `main`; no push, no tag, no release.

- [ ] **Step 1: Check for concurrent commits and foreign hunks**

Run: `cd /Users/matusmockor/Developer/editor && git log --oneline -8 && git status --short && git diff --stat`
Expected: sibling-phase commits may exist (P4-P6 run in parallel); every file you stage belongs to P3. For shared files (`AgentModeView.tsx`, `agentThread.css`, `agentThreadStyles.test.ts`, `agentModeResponsiveStyles.test.ts`, `AgentTurnItemView.tsx`, `agentTurnProjection.ts`, `agentComposer.css`) inspect `git diff <file>` and stage only P3 hunks with `git add -p <file>` answered from the diff (never interactive rebase); if a sibling's hunks are interleaved and cannot be separated, coordinate with that phase's lead before committing.

- [ ] **Step 2: Commit the transcript slice**

```bash
cd /Users/matusmockor/Developer/editor
git add src/components/agentMode/conversation src/components/agentMode/AgentThreadSession.tsx src/components/agentMode/AgentThreadSessionEmpty.tsx src/components/agentMode/AgentTurnView.tsx src/components/agentMode/AgentTurnParts.tsx src/components/agentMode/AgentActivityItems.tsx src/components/agentMode/agentActivityGrouping.ts src/components/agentMode/agentActivityGrouping.test.ts src/components/agentMode/AgentToolRow.tsx src/components/agentMode/AgentThought.tsx src/components/agentMode/AgentBackgroundActivity.tsx src/components/agentMode/AgentBackgroundWorkBanner.tsx src/components/agentMode/AgentTurnAttachments.tsx src/components/agentMode/AgentAttachmentLightbox.tsx src/components/agentMode/AgentImportedHistory.tsx src/components/agentMode/AgentRecordedTurnChanges.tsx src/components/agentMode/AgentHistoryPager.tsx src/components/agentMode/agentToolRows.css src/components/agentMode/agentThought.css src/components/agentMode/agentActivityGroups.css src/components/agentMode/agentTranscript.css src/components/agentMode/agentBackgroundWorkBanner.css src/components/agentMode/agentToolRowsStyles.test.ts
git add -p src/components/agentMode/agentThread.css src/components/agentMode/agentThreadStyles.test.ts src/components/agentMode/agentModeResponsiveStyles.test.ts
git add src/components/agentMode/*.test.tsx
git commit -m "feat(conversation): t3code transcript with hover metadata, work rows and changes row

Rebuilds the agent conversation on the Codevo tokens: right-aligned bubbles
with image grids, fold rows like \"Ran 3 commands\", thought and live rows,
quiet prose and code blocks, a compact changed-files row that opens the
turn diff, bottom-docked agents and background banners and the empty-thread
hero. Metadata appears on hover or focus only."
```

(Before `git add src/components/agentMode/*.test.tsx`, run `git status --short src/components/agentMode/*.test.tsx` and stage only the test files named in Tasks 1-7; unstage others with `git restore --staged <file>`.)

- [ ] **Step 3: Commit the composer slice**

```bash
git add src/ui/foundation/SubmitButton.tsx src/ui/foundation/buttons.test.tsx src/components/agentMode/composer src/components/agentMode/AgentComposer.tsx src/components/agentMode/AgentComposerController.tsx src/components/agentMode/AgentComposerSubmitControls.tsx src/components/agentMode/AgentComposerAttachments.tsx src/components/agentMode/AgentComposerQueuedEditBar.tsx src/components/agentMode/AgentQuestionCard.tsx src/components/agentMode/agentQuestionCard.css src/components/agentMode/agentComposerCommands.css src/components/agentMode/agentApprovalPresenter.ts src/components/agentMode/agentApprovalPresenter.test.ts src/components/agentMode/AgentThreadQuestions.tsx src/components/agentMode/AgentThreadApprovals.tsx src/components/agentMode/AgentThreadApprovals.test.tsx src/components/agentMode/AgentApprovalCard.tsx src/components/agentMode/AgentApprovalCard.test.tsx src/components/agentMode/agentApprovalCard.css
git add -p src/components/agentMode/agentComposer.css src/components/agentMode/AgentModeView.tsx
git commit -m "feat(composer): t3code composer slab with approvals, queued edits and extension slots

Moves the composer onto a rounded slab with a banner stack and a drawer,
round foundation send/stop buttons, 64px attachment tiles, the queued-edit
banner, and approval/question panels inside the slab that keep the draft.
Adds banners, placeholder, layout, renderDrawerEnd and interactions slots
for the clone, usage and branch features."
```

- [ ] **Step 4: Commit B7**

```bash
git add src/domain/agentTurnActivityWindow.ts src/domain/agentTurnActivityWindow.test.ts src/application/useAgentHistoryActivity.ts src/application/useAgentHistoryActivity.test.tsx src/components/agentMode/agentTurnItemKeys.ts src/components/agentMode/agentTurnLogNotice.ts src/components/agentMode/agentTurnLogNotice.test.ts src/components/agentMode/AgentHistoryActivity.tsx src/components/agentMode/AgentHistoryActivity.test.tsx src/components/agentMode/AgentHistoryPager.test.tsx src/components/agentMode/AgentThreadSession.turnLog.test.tsx
git add -p src/components/agentMode/agentTurnProjection.ts
git commit -m "fix(conversation): page earlier turn activity from the turn log

Long turns showed \"Earlier activity of this turn is saved but not shown
here yet.\" with no way to see it. A quiet \"Load earlier activity\" control
now reveals retained rows and then pages older events from the turn log
into a bounded window (1000 events, 2 MiB) keyed by log sequence, keeps
the reading position, and fails closed on stale, foreign or inconsistent
pages."
```

- [ ] **Step 5: Verify**

Run: `git log --oneline -5 && git status --short`
Expected: three new P3 commits on `main` without AI attribution; remaining changes belong to sibling phases or the user. Do not push or tag.

---

## Self-Review

1. Spec coverage: §3.1.4 user bubble + thumbnails + lightbox → Tasks 1, 5; work rows, thought rows → Task 3; subagent batches → rendered unchanged through P4's `AgentSubagentDisclosure` with the Task 1 work-row vocabulary (P4 owns the batch row, B3); compact "N files changed +a −d" row opening the diff → Task 6 (copy "N changed files" per mockup); metadata on hover only → Task 2; round send/stop → Tasks 8-9; attachment tiles → Task 10; approval, question → Task 11; background agents → Task 7 (banner + live row) and Task 3 (agents live row); queued edit → Task 10; empty thread → Task 7 + Task 9 hero layout. §3.2 B7 → Tasks 12-14. §4 tokens/no colours, hotspots shrink (Task 7 Step 10, Task 16), old styles removed per surface (Tasks 1-11 delete migrated groups). §5 P3 depends on P2 → Task 0. §6 component tests (every task), visual QA in palette 1 dark + light and one other palette (Task 18 step 11), AA via existing token contrast tests plus QA, keyboard (focus-within reveal, focus move into approval, menus from foundation), performance before/after (Task 15), full gates (Task 16). §7 Opus-only agents, Codex QA, no release (Tasks 17-19).
2. Placeholder scan: the only substituted values are `<PID>` (Task 18 Step 3) and `<baseline-commit-from-Task-0>` (Task 0 Step 3); two JSX "moved code" markers in Task 9 Step 4 and one in Task 11 Step 7 are explicitly instructions to paste existing code, not comments to commit.
3. Type consistency: `AgentComposerDrawerContext`, `AgentComposerLayout`, `AgentComposerFrameProps` (Task 9) are used by Tasks 10-11; `AgentComposerInteraction` (Task 11) is consumed by `AgentComposer` and the controller; `AgentTurnActivityWindow`, `agentTurnActivityWindowEvents` (Task 12) → `useAgentTurnEarlierActivity`, `agentTurnActivityWindowOf`, `AgentTurnEarlierActivityState` (Task 13) → `AgentTurnEarlierControl`, `AgentTurnLaterControl` (Task 14); `AgentLiveRow`/`AgentLiveRowTone` (Task 3) → Task 7 awaiting row; `agentClockTime` (Task 2) → Task 2 test maps; `.cv-load-earlier` (Task 5) → Task 14; `agentHistoryActivitySourceIdentity` (Task 13) → `useAgentActivitySources` (Task 14).
4. Review Focus: running turn / A→B→A late page → Task 13 "drops a page that resolves after the source changed", Task 14 "offers the latest activity again while the turn is still running"; repeated clicks / failures / caps → Task 12 "evicts the newest entries past the entry and byte caps", Task 13 "ignores a second load while one is in flight", "keeps the previous window when a page fails"; scroll jump → Task 14 `useAgentScrollAnchor` tests; draft kept under approval / double click → Task 11 "keeps the typed draft while an approval replaces the editor", "sends one decision for a double click"; long content → Task 9 "truncates the drawer and foot controls", Task 11 "keeps long approval commands inside the slab", Task 6 count ellipsis, Task 2 meta ellipsis.

## Deviations from the mockup (intentional)

- The answer's copy button stays at the end of each assistant text block (hover-only) instead of at the start of the metadata row; the metadata row carries time · model · duration. Reason: a turn can hold several assistant texts and each has its own copy target.
- While a turn runs in steer mode the composer keeps both the round stop and the round send (queue) button, as today; the mockup shows stop only. Reason: mouse users must still be able to queue a follow-up.
- The changes row renders right after the turn (sibling of the turn article) so `AgentTurnView` memoization stays intact; on hover the metadata row therefore sits above the changes row rather than below it.
- "@ files" is dropped from the placeholder (no `@` mention support in the composer).
- Answered-question summaries ("Answer sent") are no longer shown after the question closes; the transcript already contains the agent's use of the answer. Settled approvals that were withdrawn/expired/timed out still show as a warning banner above the slab.

## Open questions

- Command-approval copy switches to the mockup's "Approve" / "Decline" / "Approve for this session" (plan and MCP copy unchanged). Confirm that this wording change is wanted.
- The B7 window slides (at most 1000 log entries); very long turns therefore show "Show later activity" at the bottom after enough "Load earlier activity" clicks. A future step could add a jump-to-start; not in P3.
- `--codevo-fs-scale` remains the thread text-size variable; renaming it to a `--cv-` name belongs to P9 (settings) or P10 (cleanup).

## Lead decisions (2026-09-24)

1. Approval wording follows the mockup/t3code: "Approve", "Decline", and "Approve for this session" in
   the "…" menu. Keep accessible names and tests consistent; no behavior change.
2. Accept the planned differences from the mockup (copy button on each answer block, stop + send both
   visible while running so a follow-up can be queued, changes row after the turn, no "@ files" in the
   placeholder, answered-question summary not retained).
3. B7: collapse consecutive snapshot updates of the same item (e.g. repeated todo-list updates) into the
   latest one when rows come from the log, if this can be done in the pure window module without
   changing log semantics; otherwise list it as a known limitation.
4. Commit without waiting for the owner once gates, review and QA pass (no push, no tag).
