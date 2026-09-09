# Changelog

All notable changes to Codevo Editor are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0-beta.26] - 2026-09-09

### Added

- Browse and filter composer commands with `/`, with keyboard navigation and direct access to
  model, permission, thread, and provider controls. Show Claude-specific actions only for Claude
  and context compaction only in an existing Claude thread.

- Browse project changes and open a project terminal from the right panel without selecting a
  thread. Support terminals for threads in nested repositories and their isolated worktrees.

### Fixed

- Synchronize the selected agent project with its workspace so Files, History, Diff and Terminal
  follow the selection. Preserve the selected thread while activating its workspace and hide
  previous-project content during loading or failed activation.

## [0.2.0-beta.25] - 2026-09-09

### Fixed

- On macOS, install verified application updates during preparation and defer only
  the restart, so choosing Later and reopening the app uses the new version.
- Restore the pending-restart state when checking again after postponement, without
  downloading or installing the same update twice.

## [0.2.0-beta.24] - 2026-09-09

### Changed

- Support up to 64 concurrent threads across projects and repositories, replacing
  the manual 4–8 task limit. Explain that this shared capacity does not control
  provider-managed subagents; retain exclusive access to each active checkout.

### Fixed

- Reduce background provider-check CPU work with hardware-accelerated SHA hashing
  on ARM64 and removal of duplicate executable validation, preserving content and
  ownership checks.

## [0.2.0-beta.23] - 2026-09-09

### Fixed

- Keep the model picker visible in narrow composers, with secondary settings under
  a separate more-controls menu.
- Overlay the right panel over part of the chat in narrow windows instead of
  automatically maximizing it, preserving drafts and panel resize behavior.
- Allow dragging the window from the right-panel header while keeping controls,
  editor tabs, and menus interactive.
- Allow maximizing and restoring the surface chooser before selecting a surface.
- Keep the open-editors switcher above the editor when the right panel overlays chat.

## [0.2.0-beta.22] - 2026-09-08

### Added

- Select and import multiple terminal sessions as separate threads, with filtering,
  selection counts, duplicate protection, and partial-import retry support.

### Fixed

- Move the application window by dragging the free space across the agent thread
  header while keeping its buttons and menus interactive.

## [0.2.0-beta.21] - 2026-09-08

### Added

- Switch local and remote working branches explicitly from agent History on macOS
  and Linux, with the working branch shown separately from the history filter.

### Fixed

- Refresh repository trees and clean open files when a user or agent switches
  branches, including selected external worktrees, while preserving unsaved text.
- Keep file watching active in large projects and handle Git metadata changes in
  nested repositories and linked worktrees.

## [0.2.0-beta.20] - 2026-09-07

### Added

- Browse a visual commit graph with branch and tag labels, local and remote branch
  filters, and expandable commit details in the agent History panel.

### Changed

- Keep History navigation compact and load older commits into the same graph.

## [0.2.0-beta.19] - 2026-09-07

### Added

- Browse repository commits, changed files, and historical diffs from History in the
  agent right panel, with a searchable repository chooser for folders containing
  multiple projects.
- Explain failed, stopped, and interrupted thread counts on hover, and let users
  hide or restore the indicator from the status bar context menu per project.

### Fixed

- Use a subtle neutral divider highlight when resizing the agent thread sidebar.
- Fix Linux backend compilation and debug launch while keeping macOS builds working.

## [0.2.0-beta.18] - 2026-09-07

### Changed

- Run frontend and Rust release checks concurrently while retaining both as build prerequisites.
- Avoid redrawing unchanged composer controls while typing and unchanged response text while streaming.
- Prepare explicitly opened agent projects without a separate Trust step, while preserving workspace ownership and explicit revocations.

### Added

- Search and paginated results in the checkout menu for projects with many repositories.
- Remember the last repository selected for each project, with validated fallback when it is removed.

### Fixed

- Dim read stopped and failed thread titles while retaining their colored status labels.
- Select the newly added project in the agent sidebar after its exact open request completes.
- Keep model choices while a project is still preparing instead of reverting to the default model.
- Keep debug DMG smoke builds independent of updater signing keys.
- Test debugger descriptor quotas independently from completion latency limits.

## [0.2.0-beta.17] - 2026-09-07

### Changed

- Refresh the workbench, settings, agent threads, and notifications with the Airy
  design, an overlay title bar, and a resizable thread sidebar.
- Make the checkout picker wider and roomier, with separate checkout and repository
  groups, consistent menu styling, and viewport-aware scrolling.
- Move nested repository selection into the checkout picker and use the project
  folder as the default target for new agent threads.

### Fixed

- Browse the complete project in Files before starting a thread and for in-place
  threads, while isolated worktree threads keep their own checkout tree.
- Keep Files visible without an open document and retain its label in narrow panels.
- Start Codex threads in trusted project folders without Git, show their status
  accurately, and refresh checkout choices when the Git state changes.
- Preserve project authority when open projects overlap and reject stale or foreign
  repository-status results.
- Improve provider sign-in detection, update installed CLIs from the application,
  and avoid refusing updates during discovery refreshes.
- Preserve turn usage telemetry, clarify provider errors, and keep successful turn
  output quiet while retaining access to details.

## [0.2.0-beta.16] - 2026-09-05

### Added

- Add GPT-6 Astra to the Codex model picker, search, favorites, and saved thread
  settings, with the exact model selection forwarded for new and resumed sessions.

### Fixed

- Recognize GPT-6 Astra when it is selected in the local Codex configuration instead
  of falling back to an older model. Existing explicit selections and permissions
  remain unchanged.

## [0.2.0-beta.15] - 2026-09-05

### Fixed

- Restore original user messages and assistant responses in imported terminal chats,
  including older imports, and retain them after restarting without provider requests.
- Keep later local turns separate, support nested project directories, and preserve
  literal HTML/XML user messages in imported history.
- Stabilize the test-discovery byte-budget regression that blocked beta.14 publication
  without relaxing the production limits or the test timeout.

### Changed

- Show loading, retry, and partial-history states for imported conversations. Very large
  sessions use a bounded text snapshot and may show only part of the original chat.

## [0.2.0-beta.14] - 2026-09-05

### Fixed

- Display original user messages and assistant responses in imported terminal chats,
  including sessions imported before this update.
- Keep the imported conversation available after restarting the application without
  starting a provider request or adding duplicate local turns.
- Handle sessions that move between nested project directories and retain literal
  HTML/XML user messages in the imported transcript.

### Changed

- Show loading, retry, and partial-history states explicitly. Imported history is a
  bounded text snapshot; very large sessions may show only part of the conversation.

## [0.2.0-beta.13] - 2026-09-05

### Changed

- Scope the thread sidebar to one selected project and simplify project switching.
- Restyle the terminal-session picker and make it accessible from the thread header.

### Fixed

- Keep the session list readable in narrow windows by placing the preview below it.
- Open session history from project-root threads in projects with nested repositories.

## [0.2.0-beta.12] - 2026-09-04

### Added

- Added capability-aware Claude model controls for current and legacy models, including
  model-specific reasoning, context-window, fast-mode, thinking, Ultracode, and
  Ultrathink options that are forwarded to the CLI.
- Added provider-reported Claude turn cost and separate weekly Fable, Opus, and Sonnet
  usage windows when the account exposes them.

### Changed

- Use concrete provider models in the picker instead of a visible default sentinel,
  make full access the composer default, and align permission, hover, selection, and
  model-group presentation with the streamlined agent workflow.
- Refresh provider usage after completed turns and count cached Claude input when
  aggregating local token activity.

### Fixed

- Discover terminal sessions across the whole open project, including nested Git
  repositories and sessions stored at the project root.
- Filter foreign Codex history before applying the bounded result limit so unrelated
  recent sessions cannot hide valid project sessions.

## [0.2.0-beta.11] - 2026-09-03

### Changed

- Replaced the startup corner placeholder with a centered branded loading indicator.
- Keep an active conversation pinned to its newest turn and streamed output unless the
  reader deliberately scrolls back.

### Fixed

- Prevent successful follow-ups from restoring already submitted prompt text after a
  legitimate project-owner rebind.
- Render identical Claude assistant and final-result events only once while retaining
  distinct or failed result messages.
- Prevent concurrent provider executable validation from corrupting the shared read
  position and falsely reporting an installed CLI as missing.

## [0.2.0-beta.10] - 2026-09-03

### Changed

- Reworked Usage from a narrow diagnostic popover into a full workspace page beside
  the project rail, matching T3 Code's spacious two-column subscription-limit layout.
- Added provider marks and colors, placed Codex before Claude Code, simplified empty
  local activity, and moved technical turn evidence into collapsed details.

## [0.2.0-beta.9] - 2026-09-02

### Fixed

- Persist the latest validated Claude Code and Codex subscription-limit snapshots
  locally so Usage remains informative after an application restart without polling
  either provider.

## [0.2.0-beta.8] - 2026-09-02

### Changed

- Simplified subscription limits to the compact T3 Code-style provider layout with
  concise reset times, last-updated context, and high-usage emphasis.
- Limit snapshots now update from provider activity instead of when the Usage panel
  opens: Claude observations are consumed from turn events, while Codex is refreshed
  through its rate-limit control plane after a successful Codex turn.

### Fixed

- Opening or reopening Usage no longer launches provider CLI processes or performs
  account-limit reads.

## [0.2.0-beta.7] - 2026-09-02

### Added

- Added real Claude Code and Codex account-limit visibility, including current
  session or five-hour usage, weekly usage, and reset times.
- Added searchable project and terminal-session pickers scoped to projects currently
  open in the editor.
- Added subagent activity summaries to the thread timeline.

### Changed

- Made local checkout the default launch environment and moved related safety details
  into the relevant picker instead of the conversation surface.
- Simplified the agent-first workbench, composer metadata, sidebar continuity, and
  integrated terminal chrome.
- Clear the composer immediately after a message is accepted for dispatch.

### Fixed

- Restored continuation of saved threads when project tabs are reopened or change
  active state, while preserving exact workspace ownership.
- Initialized provider availability during application startup and stabilized agent
  root and worktree registration across relaunches.

## [0.2.0-beta.6] - 2026-09-01

### Added

- Added bounded discovery and import of eligible Claude Code and Codex terminal CLI
  sessions as resumable project threads.

### Changed

- Made the agent manager the permanent primary workbench, including startup without a
  workspace and migration from previously persisted expanded-editor layouts.
- Kept Files, Source Control, and Scripts inside the agent right panel and removed the
  fullscreen editor control, command, and keyboard shortcut.

## [0.2.0-beta.5] - 2026-08-31

### Changed

- Made the model, effort, and permission picker popovers softer and more rounded, with
  hover and active states that fill each row's full width.
- Removed the redundant overall close button from the right panel. The PanelRight
  button now closes and reopens the panel while preserving its surface tabs and state.

## [0.2.0-beta.4] - 2026-08-31

### Added

- Added automatic Claude Code and Codex CLI discovery with persisted provider paths,
  version probes, and opt-in beta update controls.
- Added a signed, recoverable GitHub beta updater channel.

### Fixed

- Restored the Files surface and nested workspace file opening in the real Tauri app.
- Made the docked right panel reflow the conversation column and expand across it when
  maximized, matching the intended workbench layout.
- Built both macOS app and DMG bundle targets so release jobs retain the app required
  to produce and verify signed updater archives.

## [0.2.0-beta.3] - 2026-08-30

### Added

- Added automatic Claude Code and Codex CLI discovery with persisted provider paths,
  version probes, and opt-in beta update controls.
- Added a signed, recoverable GitHub beta updater channel.

### Fixed

- Restored the Files surface and nested workspace file opening in the real Tauri app.
- Made the docked right panel reflow the conversation column and expand across it when
  maximized, matching the intended workbench layout.
- Raised the Node.js heap bound for release checks so the full TypeScript project can
  be validated on GitHub macOS runners.

## [0.2.0-beta.2] - 2026-08-30

### Added

- Added automatic Claude Code and Codex CLI discovery with persisted provider paths,
  version probes, and opt-in beta update controls.
- Added a signed updater feed contract for GitHub beta releases.

### Fixed

- Restored the Files surface and nested workspace file opening in the real Tauri app.
- Made the docked right panel reflow the conversation column and expand across it when
  maximized, matching the intended workbench layout.

## [0.2.0-beta.1] - 2026-08-29

### Added

- Added the agent-first workbench with project-scoped thread navigation, search,
  conversation history, composer controls, and persisted workspace layout.
- Added Files, Diff, and Terminal thread surfaces with a shared editor group, worktree
  terminals, panel tabs, maximize, and restore behavior.
- Added Claude and Codex provider settings, health and version probes, authentication
  state, model selection, permissions, and resumable streaming turns.
- Added typed worktree package-script launch targets and editor tabs for the Files
  surface.

### Changed

- Expanded the worktree ship flow with commit, local integration, conflict reporting,
  and worktree removal while preserving explicit ownership checks.
- Reduced initial JavaScript startup work through deferred feature loading and an
  enforced pre-paint bundle budget.
- Decomposed the workbench controller into focused workspace, editor, navigation,
  command, authority, and presentation coordinators.

### Fixed

- Hardened provider process cleanup, workspace authority revalidation, and exact lease
  settlement across asynchronous operations.
- Removed timing-dependent package graph, process timeout, debugger port, watch, and
  function-breakpoint tests and fixed the production races they exposed.
- Prevented stale function-breakpoint sweeps from publishing after hidden-step
  ownership changes.
