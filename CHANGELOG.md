# Changelog

All notable changes to Codevo Editor are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
