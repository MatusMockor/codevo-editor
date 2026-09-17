# Changelog

All notable changes to Codevo Editor are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0-beta.51] - 2026-09-18

### Added

- Browse and edit server workspace files with conflict detection and retained
  unsaved changes. Compare local edits with the current server version before saving.
- Open a real server terminal, reconnect to a running session, resize it and review
  retained output. Closing a panel leaves the server terminal running.
- Browse server Git history and inspect commit file changes in the diff viewer.
- Connect matching local and server projects in Settings > Environments so their
  threads share one sidebar group, with server threads marked by an icon.

### Fixed

- Preserve the selected provider and model when switching execution environments,
  including defaults loaded after the composer opens.
- Keep panel selection scoped to its conversation and prevent stale remote replies
  from appearing in another project or a local editor panel.
- Explain expired provider authentication and protocol failures in the context of
  the actual execution environment.
- Keep documentation annotations in Claude rules from being mistaken for file
  imports, and retain actionable native error messages when remote launch fails.
- Keep remote comparison models alive until their editor detaches, and give
  server history diffs a visible editor area.

### Compatibility

- Remote Files, History and Terminal require the updated Codevo runner. Text editing
  currently supports files up to 64 KiB; terminal support provides one primary
  session per project/task. Sessions survive client disconnects, not runner restarts.
- Project connections are explicit; similarly named repositories are not joined
  automatically.

## [0.2.0-beta.50] - 2026-09-17

### Added

- Group consecutive commands, file operations and MCP calls into collapsible
  activity summaries for local and server conversations. Keep running activity
  visible and preserve separate subagent and conversation boundaries.
- Page long activity groups in batches of 50 without nested scrolling, and retain
  disclosure state as the conversation updates.

### Fixed

- Prevent Claude Code from terminating background subagents after ten minutes.
  Local task execution now permits runs up to twelve hours while retaining Stop.
- Keep subagent progress authoritative after launch acknowledgements instead of
  showing background work as completed too early.
- Keep failed activities outside collapsed groups and show attention counts in
  work summaries. Settle completed child sessions without stale running labels.

## [0.2.0-beta.49] - 2026-09-17

### Added

- Choose Server checkout or Isolated worktree on compatible runners. New server
  threads default to the registered checkout; existing threads keep their mode.
- Remember the last selected thread for each project while the app is open,
  including server projects. Returning to a project restores its selection.
- Wrap long lines in response code and text blocks by default, with a per-block
  toggle to preserve unwrapped layouts. Copying keeps the original text.

### Fixed

- Show Astra before Sol in the model picker while preserving saved selections
  and favorites.
- Move Claude instruction-source settings out of the composer and into
  Settings > Environments > Advanced, preserving existing project mappings.
- Direct server provider upgrade errors to the server and avoid duplicate
  generic failure messages when the provider already explains the failure.
- Respect explicit New thread selections and avoid restoring deleted, archived,
  or foreign project threads while handling delayed server history loading.

### Compatibility

- Server checkout requires a runner advertising task-isolation support. Older
  runners continue to use isolated worktrees.
- Project thread selections are remembered for the current app session only.

## [0.2.0-beta.48] - 2026-09-17

### Added

- Open screenshot previews directly from the message composer before sending.
  Navigate between images with arrow keys, close with Escape, and keep the draft
  unchanged. The same preview works with local and server execution selected.

### Fixed

- Keep explicit project selections instead of jumping back to the previously
  selected server project. Project and execution environment now change together.
- Show operation errors beside the relevant composer instead of across the top
  of the application. Prevent stale errors from appearing after switching projects.
- Close outdated image previews when attachments are removed, sent, replaced,
  or their project, thread or execution environment changes.
- Avoid duplicating provider update notifications inside conversations.

## [0.2.0-beta.47] - 2026-09-16

### Added

- Answer structured Codex and Claude Code questions inside the existing thread,
  with choices and optional custom text, locally and on compatible Linux runners.
- Restore pending server questions after reconnect and resume the same provider
  invocation without submitting a duplicate prompt.
- Synchronize supported saved Claude instruction files before remote turns, with
  an explicit local instruction source for server projects.
- Display the runner's execution deadline in server settings. Updated runners
  default to twelve hours, configurable from one minute to seven days.

### Fixed

- Keep recent output flowing during long runs while bounding retained memory;
  replay gaps are reported instead of silently freezing the transcript.
- Preserve server execution identity while loading and retain model choices when
  switching execution environments.
- Settle questions correctly on Stop, timeout and provider completion, and clean
  up Linux provider processes even when output pipes are paused.

### Compatibility

- Update the editor before upgrading the runner. The runner update requires a
  database backup and migration; restarting it interrupts active tasks.
- Pending local questions belong to the running local process. Server restart
  recovery does not automatically resume an interrupted provider invocation.

## [0.2.0-beta.46] - 2026-09-16

### Added

- Preview generated PNG, JPEG, WebP and self-contained interactive HTML inside
  existing conversations, for both Codex and Claude Code. Select a generated file
  beneath the response to open its preview; images can be enlarged.
- Preserve generated files before the next turn can overwrite them. Updated
  runners also capture previews while the editor is disconnected.
- Show current context usage when the provider supplies sufficient data, and
  explicit compacting, completed and failed states for Claude conversations.

### Improved

- Integrate terminal colors and spacing with the editor theme, add two-pane
  splitting and compact session navigation, and preserve explicit shell color
  settings.
- Keep generated HTML isolated from the editor and network, with bounded file
  storage and one active preview per conversation.

### Fixed

- Avoid duplicate terminal cleanup and preserve input routing between split panes.
- Reject stale artifact responses and retain immutable previews after source files
  or worktrees are removed.

### Limitations

- Remote previews require an updated codevo-runner with output-artifact support;
  releasing the editor does not update an existing server installation.
- Previews display files created by available tools; this release does not add an
  image-generation service. HTML must include its assets inline.
- Manual Compact remains local-only. Automatic artifact discovery has bounded
  output limits and reports incomplete capture when those limits are reached.

## [0.2.0-beta.45] - 2026-09-16

### Improved

- Send with Enter in every composer mode; use Shift+Enter or Alt+Enter for a new
  line. Held keys and input composition do not send messages.
- Start the composer at four lines and retain text drafts when switching projects
  and threads during the editor session.
- Show compact tool rows with command labels, available tool descriptions,
  expandable output, running progress and interrupted states.
- Refine thread colors, message typography, code blocks, full-width tables and
  project selection across editor themes.

### Added

- Return a queued local text message to the composer for editing, preserving an
  existing draft.

### Fixed

- Allow Compact from an empty local composer without consuming staged attachments.
- Preserve tool descriptions when saving and loading conversation history.
- Keep newer drafts intact when Compact finishes asynchronously.
- Keep failed and stopped states visible on tools with a description.

### Limitations

- Compact and editing queued messages are available only for local conversations.
  Queued messages with attachments cannot yet be edited.

## [0.2.0-beta.44] - 2026-09-15

### Added

- Show queued follow-up messages in the conversation and their count above the
  composer, with a shortcut to the pending messages.
- Queue server follow-ups durably on compatible runners, retaining attachments
  and conversation context while the editor is disconnected.

### Improved

- Let the composer grow with longer drafts before scrolling, within viewport limits.
- Allow switching providers before the first message without losing the draft or
  its attachments.
- Keep queued messages paused after Stop or a failed turn until explicitly resumed.

### Fixed

- Handle large command-output frames without terminating supported Codex
  conversations, while retaining bounded output and strict control-frame limits.
- Preserve screenshot attachments when queued local messages are dispatched.

### Limitations

- Durable server queues require an updated runner advertising pending-message
  support. Local queued messages are retained only while the editor is running.

## [0.2.0-beta.43] - 2026-09-15

### Improved

- Automatically attempt to connect saved servers once when the editor starts,
  while keeping this computer as the default execution target.
- Respect manually disconnected servers for the rest of the editor session.

## [0.2.0-beta.42] - 2026-09-15

### Fixed

- Resize and compress oversized server image attachments before uploading them,
  respecting the runner's image size and dimension limits.
- Use JPEG when server attachments need conversion, avoiding unsupported WebP
  uploads while preserving the existing local attachment behavior.

## [0.2.0-beta.41] - 2026-09-15

### Improved

- Receive server conversation updates through a persistent connection and avoid
  repeatedly loading unchanged completed turns.
- Keep unchanged conversation content stable while new server output arrives,
  preserving the existing thread interface.

### Added

- Search stored user and assistant messages on connected servers, including
  history that has not been loaded in the editor, using literal text queries.

### Fixed

- Load and highlight older server messages when opening a history search result.

### Limitations

- Searching the full server history requires a connected, updated runner.
  A complete offline copy of server history is not available.

## [0.2.0-beta.40] - 2026-09-14

### Added

- Send a message to a running local agent without starting a separate conversation,
  with ordered follow-ups and a Stop control in the composer.
- Use the Codex app-server transport for local conversations, including resumed
  sessions, structured progress, subagent activity and usage details. The previous
  command-line transport remains selectable in Settings > Agents.
- Give Claude threads on this computer the Claude in Chrome browser tools, on by
  default and switchable per thread under Browser in the model capabilities menu.

### Fixed

- Keep the final Codex response visible below collapsed work details when its
  completion event contains no text.
- Send selected remote image attachments as image data instead of local paths,
  and discard stale selections when the destination conversation changes.
- Stop local task-owned processes reliably and retire idle app-server hosts.
- Persist the replacement local session when provider history is unavailable,
  so subsequent messages continue the recovered conversation.
- Apply updated provider executables after the existing host is safely retired.

### Limitations

- Messages to an already running agent are supported for local threads. Server
  threads still require the current turn to finish before a follow-up.
- Remote image drag-and-drop remains unsupported; use the paperclip or paste.
  Native file-picker verification remains incomplete because the macOS dialog
  did not allow the selected test file to be opened during automated testing.
- Opening server files for editing and server terminals is not supported yet.

## [0.2.0-beta.39] - 2026-09-13

### Added

- Connect Linux runners over SSH in Settings > Environments and choose a server
  below the prompt. This computer remains the default execution environment.
- Submit remote tasks with image attachments, reconnect to saved task history,
  and inspect output and code changes while execution continues on the server.
- Keep server conversations in the existing sidebar, chat and composer, with a
  server icon identifying their execution environment.
- Continue remote conversations using the same provider session and worktree,
  preserving earlier changes and supporting images in follow-up messages.

### Improved

- Keep uncertain follow-up submissions safe to retry without duplicating execution,
  and explain when a server or older conversation cannot support continuation.
- Preserve the selected model and execution options when sending work to a server.
- Restore full historical messages and prevent the macOS entrance animation from
  leaving the agent screen invisible.

### Limitations

- Server projects must already be registered. Automatically cloning a local project
  onto the server is not included in this release.
- Opening server files for editing and server terminals is not supported yet.

## [0.2.0-beta.38] - 2026-09-12

### Fixed

- Clarify that an updated provider CLI is used by the next message, including in
  existing conversations; no new session is required.

## [0.2.0-beta.37] - 2026-09-12

### Added

- Show the execution environment below the prompt, with This computer as the default
  and a locked indicator for existing threads.
- Add Settings > Environments with local execution details and a placeholder for
  remote servers. Server connections and remote execution are not available yet.

### Improved

- Keep the execution environment and checkout controls visible below the prompt in
  both compact and wide layouts.

## [0.2.0-beta.36] - 2026-09-11

### Improved

- Refine the image lightbox with an image-aligned close button, filename caption,
  and previous/next navigation using buttons or arrow keys.

### Fixed

- Keep enlarged images visible at their intended size in the macOS webview.
- Apply the agent theme consistently to the image lightbox and its controls.

## [0.2.0-beta.35] - 2026-09-11

### Added

- Attach up to eight images or files through paste, drag-and-drop or the file picker.
  Send supported images natively to the selected provider and other files as path references.
- Preview attached images in the composer and conversation, enlarge them in an in-app
  lightbox or open them in the system viewer, and show attachment details in imported sessions.

### Fixed

- Preserve attachment ownership across project changes and reject stale attachment drafts.
  Store claimed files with their thread and clean up abandoned attachments.
- Allow attachment image previews to render in the native webview.
- Anchor the turn minimap to the session edge and use the compact menu when the side gutter
  is too narrow or the pointer does not support hover.

## [0.2.0-beta.34] - 2026-09-11

### Fixed

- Include imported history and live follow-ups in one minimap sequence, with navigation
  and current-turn tracking across the whole conversation.
- Offer to open an existing project when its registered directory is selected in the
  add-project dialog, while preserving other validation errors.
- Remove the unintended focus ring inside the thread search field while retaining
  keyboard focus indicators on its buttons.

## [0.2.0-beta.33] - 2026-09-11

### Added

- Adjust text size for the agent workspace in Appearance settings, with controls and
  layout dimensions scaling alongside the text. Add a visible Back button in settings.
- Navigate long conversations with a turn minimap, prompt previews, current-turn markers
  and keyboard controls. Group markers in long conversations.

### Changed

- Increase default agent text sizes and simplify the composer by removing its repeated
  thread context line.
- Present find-in-thread as a compact overlay while keeping highlighted results clear of
  it. Show when the search result count reaches its limit.

## [0.2.0-beta.32] - 2026-09-10

### Added

- Render imported conversations with the same Markdown formatting and message layout as
  live threads. Search imported text with find-in-thread and navigate directly to matches.

### Changed

- Show prompts as right-aligned bubbles and answers beneath compact agent headers, replacing
  the numbered sticky bands. Omit timestamps and durations when imported history lacks them.

### Fixed

- Fit Markdown tables to the reading column and wrap long cell contents where possible.
- Recheck visible Markdown after jumping to the newest message so the visible response is
  formatted immediately, and reveal whole turns from their start.

## [0.2.0-beta.31] - 2026-09-10

### Added

- Separate conversation turns with numbered prompt bands that stay visible while reading
  each answer. Expand long prompts on demand and distinguish prompts across all themes.
- Show release notes for the versions included in an update, with a clear notice when
  only part of a longer release history is available.

### Fixed

- Detect newer releases even when a downloaded update is waiting for restart. Keep the
  prepared update available to restart if the newer-version check fails or times out.
- Compare prerelease versions numerically and validate release-note text before publishing
  update metadata.

## [0.2.0-beta.30] - 2026-09-10

### Added

- Select multiple threads with Shift-click, Cmd/Ctrl-click or the keyboard and archive
  or delete the selection together. Report skipped threads and preserve running threads.
- Display agent responses as Markdown, including tables, code blocks, lists and headings,
  while retaining streaming output and find-in-thread support.

### Changed

- Parse settled responses near the visible area and reuse cached documents to reduce work
  when opening long threads. Continue processing streaming responses and active search hits.

## [0.2.0-beta.29] - 2026-09-10

### Added

- Capture Claude subagent status, duration, token usage, tool counts and parent links in
  saved threads. Show the agent type and task description and avoid counting child tools
  again in the parent summary. Existing saved threads remain compatible.

### Fixed

- Show a themed application frame during startup and preserve the selected appearance
  while loading workspaces and surfaces, reducing blank screens and theme flashes.
- Launch the current unbundled debug binary on macOS instead of an older app bundle.

## [0.2.0-beta.28] - 2026-09-09

### Fixed

- Reduce CPU usage when checking CLI updates. The sidebar button and periodic checks now compare
  the known installed version with small online metadata, without launching CLI processes,
  scanning executables or checking sign-in status.
- Keep full CLI diagnostics available in Settings and validate the selected update before
  installation. Discard outdated update checks when diagnostics, settings or installation change.
- Share discovery during full provider refreshes, coalesce repeated checks and remove redundant
  executable scans while preserving content, path and launch validation.
- Avoid unnecessary package-manager probes and repeated installed-version commands during
  diagnostics, and spread the remaining maintenance hashing into short cancellable intervals.

## [0.2.0-beta.27] - 2026-09-09

### Fixed

- Load Git status when the agent Diff panel opens and refresh it after workspace file changes,
  without requiring the editor's Source Control panel. Show loading until the first status read
  completes instead of incorrectly reporting that the project has no Git repository.

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
