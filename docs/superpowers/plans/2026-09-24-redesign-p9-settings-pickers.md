# Redesign P9 - Settings, Composer Pickers, Update Channel (F7) and Branch Picker (F8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Settings screen (General, Providers, Environments, Keybindings, Index & languages, Snippets, Usage, Archive) and the composer pickers (model, effort, access, environment/checkout, branch) to match `docs/redesign/v3-settings-pickers.html`, add the composer usage-limits notice, the Stable/Beta update channel (F7) wired end to end through a typed Rust command, and the composer branch picker (F8) including a typed worktree start point.

**Architecture:** Settings keeps its registry-driven structure (`settingsRegistry.ts` + `settingsRegistryRows.ts` + `SettingsPageHost`) and its draft/save pipeline; P9 changes the section list, the shell (P2 `TopBar` in a settings nav column and a settings main column), the section/row primitives and the stylesheet (legacy `--codevo-*` references replaced by P1 `--cv-*` tokens), and adds Usage and Archive pages fed through `SettingsEnvironment`. The update channel is a closed union in TS (`AppSettings.appUpdateChannel`) passed with every check to a new Rust command `app_update_check` that picks the endpoint from a closed Rust enum and returns the same metadata shape as the plugin, so the plugin's own download/install commands keep working on the returned resource id. The composer pickers keep their application wiring and props (P3 positions them in `.cv-composer__controls` and the drawer); P9 restyles them into one picker stylesheet, rewrites the effort menu and the environment/checkout popover, and adds the branch picker whose "New worktree" selection becomes a typed `AgentWorktreeBase` carried from the start request to the Rust worktree command.

**Tech Stack:** React 19, TypeScript 5.8 strict, Vite 8, Vitest 4 + jsdom, lucide-react, plain CSS on `--cv-*` tokens, Rust (Tauri 2, `tauri-plugin-updater` 2.10.1, `serde`, `url`, `time` 0.3), git CLI.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1.11, §3.3 F7 and F8, §4, §5 P9, §6, §7). Visual source of truth: `docs/redesign/v3-settings-pickers.html` (states General, Providers, Keys, Usage, Archive, Model, Effort, Access, Env, Branch, Limits).

## Global Constraints

- Scope (spec §3.1.11): "General (palettes, appearance, sizes, fonts, syntax theme, updates, workspace, editing), Providers (Claude Code / Codex detection, sign-in, versions, favorite models, legacy models), Environments, Keybindings (search, edit, modified), Index & languages, Snippets, Usage (limit bars), Archive; composer pickers for model, effort, access mode, environment and branch; usage limits notice."
- F7 (spec §3.3, §4): "Update channel Stable / Beta" with "a typed enum on both TS and Rust sides".
- F8 (spec §3.3): "Branch picker in the composer environment area."
- Out of scope (spec §3.3): "PHP-specific settings pages" are not redesigned. The PHP section stays reachable (no capability lost) and only inherits the new primitives and tokens.
- Presentation-first (spec §4): domain, application and Rust change only for F7 and F8 (plus the `SettingsSection` values `usage` and `archive`, and exposing `refreshAccountUsage`).
- Tokens (spec §4, P1): "no feature component defines its own colors". Every new or touched rule uses `--cv-*` tokens. Never write a literal `var(--...` for a name that no stylesheet declares, not even in a test string (the token scan in `src/domain/themeContrast.test.ts` treats any `var(--name` text under `src` as a use); use a regex literal such as `/var\(--cv-/` in tests.
- Hotspots (spec §4): `App.tsx`, `useWorkbenchController.ts`, `AgentThreadSession.tsx` must not grow; P9 does not touch them. `src/application/useAgentProviderManagement.ts` is 5 tokens under the 10000 limit: P9 must not add code to it. `src-tauri/src/lib.rs` is baseline-tracked: add Rust modules through `src-tauri/src/lib_composition/command_facades.rs`, never `lib.rs`.
- Old styles (spec §4): "Old styles are removed as each surface is migrated". Settings and picker rules that reference `--codevo-*` are rewritten in this phase; the P9-owned rule groups (`.agent-picker*`, `.agent-model-picker*`, `.agent-traits-picker*`, `.agent-composer__launch*`, `__compact*`, `__lock*`, `__target*`, `__divider`, `.agent-environment*`, picker rules scoped under `.agent-composer__footer`, and `agentCheckoutSearch.css`) move out of `agentComposer.css` into `src/components/agentMode/pickers/agentPickers.css`.
- Agents (spec §7.1): implementation and review agents are Opus 5.5; UI QA is Codex with Computer Use against the QA bundle `dev.mockor.editor.qa`.
- Release (spec §7.3): "a single beta release at the end of the program (P10), not per phase." No push, no tag, no release in P9.
- Git (CLAUDE.md): work on `main`; subagents never run mutating git commands; only the lead commits after review and full gates; no AI, Claude, Anthropic or co-author attribution in commit messages.
- Review (CLAUDE.md): never run `coderabbit` or `cr`; the reviewer is a separate read-only agent.
- Code style (user rules): no code comments except bare tooling annotations; guard clauses, no `else`; closed unions with exhaustive `switch` + `never`; no `any`.
- Tests (user rules): real collaborators; fake only true external boundaries (Tauri `invoke`, the updater plugin resource, git processes are real in Rust tests); React tests settle with `act`; tests never `throw`.
- Formatting (repo memory): `npx prettier --write` only on files you created; for modified files run `npm run format:check:changed` and prettier-write only the files it lists. Never prettier a directory.
- Security (CLAUDE.md): IPC request structs are closed (`deny_unknown_fields`), refs passed to git are validated and terminated with `--end-of-options`, no shell strings, no raw endpoints from the frontend (the frontend sends only the channel enum).
- Isolation (CLAUDE.md): async work in hooks captures owner (project root key, repository root, generation) before `await` and revalidates after; A -> B -> A must not publish stale branch lists, usage snapshots or update results.

## Review Focus

- Switching the update channel while a check or a downloaded candidate is pending: the in-flight result must be dropped, the old candidate disposed, and the next check must use the new channel; the stable channel with no stable release yet must read as "up to date", never as an error loop. Pinned in Task 3 (`useAppUpdater` channel-change test) and Task 2 (`missing_release_is_up_to_date` test).
- A branch name typed into the branch picker that looks like an option or a revision expression (`-b`, `--upload-pack=x`, `HEAD~1`, `a..b`, `@{-1}`, `refs/tags/v1`, control characters, 600 bytes): it must be rejected in TS before IPC and again in Rust before any git process runs; git receives only `--end-of-options <validated ref>`. Pinned in Task 17 (`parseAgentWorktreeBase` table test) and Task 18 (Rust `WorktreeStartPoint` parse tests and the hostile-ref integration test).
- Project A -> B -> A while the branch list or a branch switch is loading: a late list or switch result for A must not render in B, and a switch must never run against a repository that is not the composer's current target. Pinned in Task 17 (`useComposerBranchPicker` owner test).
- Usage snapshots that are partial or odd (Claude windows without `resetsAtEpochMs`, a 0% window, 100% used, more windows than fit, provider never observed): bars must render without a pace line when time is unknown, clamp to 0-100, and the page must say why a provider has no bars. Pinned in Task 9 (`usageLimitBarModel` table test and `UsageSettingsPage` states test).
- Keyboard-only use of every picker and settings nav: Arrow/Home/End roving in the settings nav, Escape closing only the innermost popover and returning focus to its trigger, Enter/Space selecting radio rows, and the recorder in Keybindings ignoring the search field. Pinned in Task 5 (nav roving test), Task 14 (effort menu keyboard test), Task 16 (environment picker test), Task 8 (recorder test).

---

## Current code map (read before starting)

- Settings screen: `src/components/settings/WorkbenchSettingsScreen.tsx` (157 lines) renders `SettingsSectionSidebar` + a `tabpanel` page with `<h1>Settings</h1>` and `SettingsPageHost`. It is portaled by `src/components/WorkbenchSettingsHost.tsx` into the shell slot `.workbench-frame__settings` (P2 keeps `WorkbenchShellFrame` `surface="settings"` + `settingsRef`; the slot spans the full window under the macOS chrome). `WorkbenchSettingsHost` is lazily mounted by `src/components/WorkbenchAppUpdaterHost.tsx`.
- Registry: `settingsRegistry.ts` (sections `general | appearance | agents | environments | keymap | index | php | snippets`), `settingsRegistryRows.ts` (612 lines, every searchable row), `settingsPages.tsx` (exhaustive host), `settingsSearch.ts`/`useSettingsSearch.ts` (search index over rows), `settingsTargetContext.ts` (deep-link row focus).
- Primitives: `src/components/settings/primitives/*` (`SettingsRow`, `SettingsSectionHeading`, `SettingsSwitch`, `SettingsSelect`, `SettingsNumberField`, `SettingsSegmented`, `SettingsButton`, `SettingsPopover`, `SettingsKbd`, `SettingsChipGroup`, text fields). Styles: `src/components/settings/settings.css` (1861 lines) driven by a `--settings-*` variable block that maps to legacy `--codevo-*`.
- Pages: General (`GeneralAppUpdateRows`, `GeneralWorkspaceRows`, `GeneralEditingRows`, `GeneralStatusBarRows`), Appearance (`AppearanceSettingsPage` + `AppearancePaletteSwatches` from P1), Agents (`AgentsSettingsPage`, `AgentProviderCard`, `AgentProviderCardDetails`, `CodexTransportControls`, `AgentThreadDefaultsRows`), Environments, Keybindings (`KeybindingsSettingsPage`, `KeybindingsTable`, `KeybindingRow`, `useKeybindingRecorder`, `keybindingsPresentation`), Index & languages, PHP, Snippets.
- Usage today: `src/components/agentMode/AgentUsagePanel.tsx` (441 lines) inside a sidebar popover; data `WorkbenchAgentsSurface.accountUsage` from `src/application/useWorkbenchAgents.ts` (limit windows from `read_agent_provider_usage`, `src/domain/agentAccountUsage.ts`), local activity from `aggregateAgentUsage` (`src/domain/agentUsage.ts`).
- Archive today: archived shelf in the sidebar (P4 extracts it to `AgentThreadArchivedShelf.tsx`); `useAgentThreads` exposes `unarchive(threadId)`.
- Updater: `src/domain/appUpdater.ts` (`AppUpdaterGateway.check()`), `src/infrastructure/tauriAppUpdaterGateway.ts` (bridge `check()` = plugin JS `check`), `src/application/useAppUpdater.ts`, `src/application/workbenchController/useWorkbenchAppUpdaterComposition.ts`, `src/workbenchComposition.ts:105`; Rust `tauri.conf.json` `plugins.updater.endpoints = [".../releases/download/beta/latest.json"]`, plugin registered in `src-tauri/src/lib_composition/runtime.rs:139`, capability `updater:allow-check` in `src-tauri/capabilities/default.json`. Stable releases publish `latest.json` only on their non-prerelease GitHub release (`/releases/latest/download/latest.json`, 404 until a stable release exists; the plugin maps a non-2xx to `Error::ReleaseNotFound`).
- Pickers: `AgentLaunchControls.tsx` (model, traits, permission `AgentPickerMenu`), `AgentModelPicker.tsx` (573 lines; rail, search, favorites, legacy toggle), `AgentTraitsPicker.tsx` (258 lines; radio groups), `AgentPickerMenu.tsx` + `AgentPickerRows.tsx` + `agentPickerOption.ts` (generic listbox; also used by P4/P6/P8 surfaces), `AgentExecutionEnvironmentPicker.tsx` ("Run on"), `AgentComposerControls.tsx` (`AgentComposerCheckout`, `AgentComposerLockedCheckout`), `agentComposerCheckout.tsx` (checkout options), `agentLaunchPresentation.ts` (831 lines; rows, labels, `agentLaunchModeChoices`), `domain/agentLaunch.ts`, `domain/claudeModelCatalog.ts` + `claudeModelManifest.json`. Styles in `agentComposer.css` (picker groups), `agentExecutionEnvironmentPicker.css`, `agentCheckoutSearch.css`.
- Worktrees: TS `createThreadWorktree` (`src/application/agentThreadWorktreeProvisioning.ts`) -> `GitWorktreeGateway.addAgentWorktree(repositoryRoot, taskId)` -> IPC `add_git_worktree` -> Rust `add_agent_worktree_receipt` -> `CommandGitWorktreeGateway::add_agent_worktree(root, task_id)` which always starts from `repository_head(&root)`.
- Branch switching for agent projects exists as `chrome.branchCheckout = { gateway, guard, dirtyRevision }` built in `AgentWorkbenchScreen.tsx:471` (guard = trust + `agentBranchCheckoutBlockedReason`) and `useAgentBranchCheckout`.

## Ownership (every file P9 creates or modifies)

Agreements with sibling planners (recorded 2026-09-24):

- P3 (conversation/composer): P3 owns `AgentComposer.tsx`, `composer/AgentComposerFrame.tsx`, `AgentComposerController.tsx` and all composer layout CSS. P3 exposes `.cv-composer__controls` (renders `launchControls` unchanged), `.cv-composer__drawer` with `.cv-composer__drawer-start` (a plain `const drawerStart = (<>...</>)` in `AgentComposer.tsx` holding `AgentExecutionEnvironmentPicker`, `.agent-composer__divider` and `checkout` where `const checkout = followUp ? <AgentComposerLockedCheckout/> : targetControls`; the drawer element keeps the legacy class `div.cv-composer__drawer.agent-composer__footer`) and `.cv-composer__drawer-end` filled from the render prop `AgentComposerProps.renderDrawerEnd?: (context: AgentComposerDrawerContext) => ReactNode` / `AgentComposerControllerProps.renderDrawerEnd?` (compared by identity, so the mount site memoizes it), with `AgentComposerDrawerContext { repositoryRoot: string | null; isolation: AgentTaskIsolation; locked: boolean; disabled: boolean }` exported from `src/components/agentMode/composer/AgentComposerFrame.tsx` and built in a `drawerContext` `useMemo` in `AgentComposer.tsx`; and a banner slot `AgentComposerProps.banners?: ReactNode` / `AgentComposerControllerProps.banners?: ReactNode` rendered at the top of `.cv-composer__banners`. P9 owns the picker components and makes these small hunks after P3 is committed: swap the environment picker and `targetControls` for `AgentEnvironmentCheckoutPicker` + `AgentRepositoryPicker` inside `drawerStart`/`targetControls` (Task 16); add `worktreeBase` + `onWorktreeBaseChange` to `AgentComposerDrawerContext` and the `drawerContext` memo (Task 17); add the `usage` composer command handler and the `onShowUsageLimits?(): void` prop (Task 19); add `worktreeBase` state and forwarding in `useAgentComposerState.ts` (Task 18) unless P3 reports it touched that file, in which case P9 writes the hunk against P3's final shape. P3 deletes from `agentComposer.css` only: `.agent-composer` root, `__box*`, `__textarea*`, `__row*`, `__attach*`, `__spacer`, `__send*`, `__stop*`, `__alternate*`, `__caption*`, `__reason*`, `__bytes*`, the bare `.agent-composer__footer` layout rule, `.agent-compaction-offer*`, `__queued-edit*`, `__attachments`, `__attachment-*`, `.agent-composer-attachment*`. P9 owns (untouched by P3): `.agent-picker*`, `.agent-model-picker*`, `.agent-traits-picker*`, `.agent-composer__launch*`, `__compact*`, `__lock*`, `__target*`, `__divider`, `.agent-environment*`, and any rule combining `.agent-composer__footer` with a picker selector. In `AgentComposer.test.tsx` "Airy styling contract" P3 deletes only the first two blocks (box/textarea, send); the picker blocks are P9's.
- P2 (app shell): P9 reuses `TopBar` from `src/ui/shell/TopBar.tsx` (`region="sidebar"` for the settings nav column, `region="main"` without `windowEdge` for the page column; slots `leading`, children, `actions` (hover-revealed), `trailing`; `TopBarSeparator`). P9 does not edit `WorkbenchShellFrame.tsx` or shell CSS. P2 removes the status bar renders but keeps `workspaceSettings.statusBar` as the visibility map; P9 keeps the toggles, retitles the section "Editor header items" and adds a row for `agentAttention` ("Threads needing attention in the sidebar"). `AgentModeView.tsx` is P2-owned; the hunk that passes `renderDrawerEnd`, `banners` and `onShowUsageLimits` to `AgentComposerController` there is P9's (Tasks 17 and 19).
- P4 (sidebar): P4 extracts the usage popover into `src/components/agentMode/AgentRailUsagePopover.tsx` and the archived shelf into `src/components/agentMode/AgentThreadArchivedShelf.tsx` and keeps them working until P9 lands. P9 owns a delete-only hunk after P4 is committed: remove the `<AgentRailUsagePopover .../>` mount in `AgentThreadsSidebar.tsx` and the `<AgentThreadArchivedShelf .../>` mount in `AgentThreadList`, delete both files and their tests/CSS rules, and delete archived-section code in `agentRailSections` only if nothing else reads it (Tasks 9 and 10). P4 does not touch `useWorkbenchAgents.ts`; the `refreshAccountUsage` hunk is P9's. P9 owns the `usage`/`archive` `SettingsSection` values.
- P5 (command palette): P5 lands before P9 and owns (a) the `selectModel` extraction and `useComposerPaletteBinding(...)` call in `AgentLaunchControls.tsx`, (b) moving four helpers from `AgentModelPicker.tsx` into `src/components/agentMode/agentModelProviderState.ts` with the import hunk. P9 restyles on top and keeps both intact. P9 does not change `keybindingStrokes`. The agent `branches?: PaletteBranchSource` slot stays unbound in P9 (follow-up for P10: bind it to `useComposerBranchPicker`).
- P6 (right panel/git): P6 lands before P9 and owns `src/domain/gitBranchPicker.ts` (`GitBranchPickerItem`, `gitBranchPickerItems`, `validateNewBranchName`) and a new `add_git_branch_worktree` command. P9 consumes `gitBranchPickerItems` and `validateNewBranchName` unchanged. Both phases edit `src/domain/gitWorktree.ts`, `src/infrastructure/tauriGitWorktreeGateway.ts`, `src/infrastructure/tauriGitWorktreeIpcContract.ts` and `src-tauri/src/git_worktree.rs` in different functions; P9 rebases its hunks on P6's committed shape. P6 adds `pub(crate) fn resolve_worktree_start_point(root: &Path, reference: &str) -> Result<String, String>` to `git_worktree.rs` (at most 256 bytes, no control characters/whitespace/`..`/leading `-`, `refs/heads/*`, `refs/remotes/*` or a bare local branch, `rev-parse --verify --quiet --end-of-options <ref>^{commit}`, tags rejected, returns the hex sha); Task 18 calls it and additionally restricts agent worktree bases to `refs/heads/*` and `refs/remotes/*`. P6 does not change `addAgentWorktree`; a thread cannot target a pre-existing worktree (reported by P6 as a gap). P8 does not use the `AgentComposerController` `banners` slot (its banners go through `AgentCloneComposer`).
- P8 (projects): no conflict. P8 adds two optional `AppSettings` fields (`lastCloneParentPath`, `recentWorkspaceOpenedAt`) in `src/domain/settings.ts`; whichever lands second rebases a few lines. The `banners` slot on `AgentComposerController` is P9's alone. The "Trusted workspace" settings switch stays a direct toggle.

Files P9 creates:

| Path | Responsibility |
|---|---|
| `src/domain/appUpdateChannel.ts` (+ `.test.ts`) | `AppUpdateChannel` closed union, labels, normalization. |
| `src/infrastructure/tauriAppUpdateChannelCheck.ts` (+ `.test.ts`) | IPC `app_update_check` call, metadata parser, `Update` construction. |
| `src-tauri/src/lib_composition/app_update_channel_commands.rs` | Rust channel enum, endpoint selection, `app_update_check` command, tests. |
| `src/components/settings/settingsShell.css` | Settings nav column, main column, page, sections, groups, rows (t3code layout). |
| `src/components/settings/SettingsPageActions.tsx` (+ test) | Top-bar actions per section (Restore defaults, Run CLI diagnostics, usage refresh). |
| `src/components/settings/pages/generalDefaults.ts` (+ test) | `restoreGeneralAppDefaults`. |
| `src/components/settings/pages/GeneralThemeSection.tsx` | Theme section (mode segmented control + palette cards). |
| `src/components/settings/pages/GeneralTextEditorRows.tsx` | Text & editor rows (moved from the Appearance page). |
| `src/components/settings/pages/useMonospaceFontFamilies.ts` | Font list hook (moved out of `AppearanceSettingsPage.tsx`). |
| `src/components/settings/AgentProviderModelsList.tsx` (+ test) | Provider models with favorite stars, Default/NEW badges, legacy toggle. |
| `src/components/settings/pages/KeybindingsList.tsx` | Keybindings grouped list (replaces `KeybindingsTable.tsx`). |
| `src/components/settings/pages/UsageSettingsPage.tsx` (+ test) | Usage page. |
| `src/components/settings/pages/ArchiveSettingsPage.tsx` (+ test) | Archive page. |
| `src/components/usage/usagePresentation.ts` (+ test) | Pure usage presentation (bars, pace, labels, spend summary). |
| `src/components/usage/UsageLimitBars.tsx` | Limit bar grid shared by the Usage page and the composer notice. |
| `src/components/usage/usage.css` | Limit bars, totals. |
| `src/components/agentMode/pickers/agentPickers.css` | All composer picker styles on `--cv-*`. |
| `src/components/agentMode/AgentEnvironmentCheckoutPicker.tsx` (+ test) | Merged "Run on" + "Checkout" drawer popover. |
| `src/domain/agentWorktreeBase.ts` (+ test) | `AgentWorktreeBase` closed type and parser. |
| `src/application/useComposerBranchPicker.ts` (+ test) | Branch list load, switch, create, worktree base selection with owner revalidation. |
| `src/components/agentMode/AgentComposerBranchPicker.tsx` (+ test) | Branch picker popover in the composer drawer. |
| `src/components/agentMode/usage/useComposerUsageLimitsNotice.ts` (+ test) | Notice visibility (auto at >= 90%, `/usage`, dismissal). |
| `src/components/agentMode/usage/AgentComposerUsageLimitsNotice.tsx` | Notice on the foundation `ComposerBanner`. |
| `src/components/settings/pages/archivePresentation.ts` (+ test) | Archived thread grouping and age labels. |
| `src/components/settings/pages/settingsPageTestSupport.ts` | Shared `SettingsPageProps` test fixture. |
| `src/components/settings/settingsStyles.test.ts` | Token-only contract for settings/usage stylesheets. |
| `src/ui/foundation/MenuRadioItem.tsx`, `src/ui/foundation/MenuSwitchItem.tsx`, `src/ui/foundation/menuChoiceItems.test.tsx` | Radio and switch rows for the foundation menu (new files next to P1's `MenuItem`). |
| `src/components/agentMode/AgentAccessMenu.tsx` (+ test) | Access mode menu. |
| `src/components/agentMode/AgentTraitsPicker.test.tsx` | Effort menu tests. |
| `src/components/agentMode/composerBranchItems.ts` | Ref-typed branch rows for the composer picker. |

Files P9 modifies: `src/domain/settings.ts`, `src/domain/settings.test.ts`, `src/domain/appUpdater.ts`, `src/infrastructure/tauriAppUpdaterGateway.ts` (+ both tests), `src/application/useAppUpdater.ts` (+ test), `src/application/workbenchController/useWorkbenchAppUpdaterComposition.ts`, `src/components/WorkbenchAppUpdaterHost.tsx`, `src/workbenchComposition.ts`, `src/App.appUpdaterComposition.test.ts`, the AppSettings fixtures in `src/application/useAgentProviderManagement.test.tsx`, `src/application/workbenchController/useWorkbenchSettingsPersistence.ts` (+ test), `src/infrastructure/settingsAppUpdaterPreferencesGateway.test.ts`, `src/infrastructure/browserSettingsGateway.test.ts`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/lib_composition/command_facades.rs`, `src-tauri/src/lib_composition/runtime.rs`, `src-tauri/capabilities/default.json`, `docs/release.md`; settings: `settingsRegistry.ts`, `settingsRegistryRows.ts`, `settingsRegistry.test.ts`, `settingsSearch.test.ts`, `settingsPages.tsx`, `pages/settingsPages.parity.test.tsx`, `WorkbenchSettingsScreen.tsx` (+ test), `SettingsSectionSidebar.tsx`, `SettingsSearchInput.tsx`, `SettingsExitButton.tsx`, `settingsPageProps.ts`, `settingsEnvironment.ts`, `workbenchSettingsModel.ts`, `primitives/SettingsRow.tsx`, `primitives/SettingsSectionHeading.tsx`, `primitives/settingsPrimitives.test.tsx`, `settings.css`, `pages/environmentsSettings.css`, `pages/GeneralSettingsPage.tsx` (+ test), `pages/GeneralAppUpdateRows.tsx` (+ test), `pages/GeneralStatusBarRows.tsx`, `pages/AppearancePaletteSwatches.tsx` (+ test), `pages/AgentsSettingsPage.tsx` (+ test), `AgentProviderCard.tsx` (+ test), `AgentProviderCardDetails.tsx`, `agentProviderSettingsPersistence.ts`, `AgentThreadDefaultsRows.tsx`, `pages/KeybindingsSettingsPage.tsx` (+ test), `pages/KeybindingRow.tsx`, `pages/keybindingsPresentation.ts`, `src/components/cssBorderAllowlist.ts` (entries removed only), `src/components/cssContractTestSupport.ts` (`TOKEN_SHEETS` entry kept, path unchanged); usage/archive: `src/application/useWorkbenchAgents.ts`, `src/components/agentMode/AgentThreadsSidebar.tsx` and P4's `AgentThreadList` (delete-only hunks); pickers: `AgentLaunchControls.tsx` (+ test), `AgentModelPicker.tsx` (+ test), `AgentTraitsPicker.tsx`, `AgentPickerMenu.tsx`, `AgentPickerRows.tsx`, `agentPickerOption.ts`, `agentLaunchPresentation.ts` (+ test), `src/domain/agentLaunch.ts`, `src/domain/claudeModelCatalog.ts` (+ test), `src/domain/claudeModelManifest.json`, `agentComposer.css` (picker groups removed), `AgentComposer.tsx`, `AgentModeView.tsx`, `src/domain/agentComposerCommand.ts` (+ test), `AgentComposerController.tsx` (pass-through `onShowUsageLimits`), `AgentComposerControls.tsx` (`AgentRepositoryPicker`, `repositoriesOnly`), `agentComposerCheckout.tsx` (labels), `composer/AgentComposerFrame.tsx` (two drawer-context fields), `src/ui/foundation/overlays.css` (two rules for tall/description menu rows); F8: `src/application/useAgentBranchCheckout.ts` (gateway type), `src/domain/gitWorktree.ts`, `src/infrastructure/tauriGitWorktreeGateway.ts`, `src/infrastructure/tauriGitWorktreeIpcContract.ts` (+ tests), `src/application/agentThreadWorktreeProvisioning.ts` (+ test), `src/application/agentThreadPorts.ts`, `src/application/useAgentTurnDispatch.ts`, `src/components/agentMode/useAgentComposerState.ts`, `src-tauri/src/git_worktree.rs`, `src-tauri/src/lib_composition/git_worktree_commands.rs`.

Files P9 deletes: `src/components/settings/pages/AppearanceSettingsPage.tsx`, `src/components/settings/pages/KeybindingsTable.tsx`, `src/components/agentMode/AgentUsagePanel.tsx` (+ test), `src/components/agentMode/AgentExecutionEnvironmentPicker.tsx` (tests merged into the new picker test), `src/components/agentMode/agentExecutionEnvironmentPicker.css`, `src/components/agentMode/agentCheckoutSearch.css`, and P4's `AgentRailUsagePopover.tsx` / `AgentThreadArchivedShelf.tsx` (+ tests).

## Execution Order

Three streams with disjoint write scopes. P9 starts only after P1 and P3 are committed (and P5/P6 committed, because P9 rebases on their hunks in `AgentLaunchControls.tsx`, `AgentModelPicker.tsx` and the worktree files).

- Stream A (F7, updater): Task 1 -> Task 2 (Rust, independent of Task 1 files) -> Task 3.
- Stream B (Settings): Task 4 (after Task 1, both touch `src/domain/settings.ts`) -> Task 5 -> Tasks 6, 7, 8, 11 in parallel (disjoint page files; Task 6 also needs Task 3 for the channel row) -> Task 9 -> Task 10.
- Stream C (pickers): Task 12 -> Tasks 13, 14, 15 in parallel (13 owns `AgentModelPicker.tsx` + catalog; 14 owns `AgentTraitsPicker.tsx`; 15 owns `agentLaunchPresentation.ts` mode choices and `AgentLaunchControls.tsx`; Task 13 edits `agentLaunchPresentation.ts` only in `agentModelRows`, so run 13 before 15 or give 15 that file after 13 finishes) -> Task 16 -> Task 17 -> Task 18 -> Task 19 (17 and 19 both edit `AgentModeView.tsx`; run sequentially).
- Wrap-up (lead): Task 20 gates -> Task 21 independent review -> Task 22 QA -> Task 23 commits.
- Every implementer reports changed files and the exact focused test output; the lead reruns focused tests before dependent tasks start.

Scope note for the owner: this phase is large (3 streams, 19 implementation tasks, TS + Rust). The plan is structured so it can ship as three commits (Settings, F7, Pickers + F8) and, if preferred, be executed as three separate sessions P9a (Tasks 4-11), P9b (Tasks 1-3), P9c (Tasks 12-19).

---
### Task 1: Update channel domain and setting (F7, TS)

**Files:**
- Create: `src/domain/appUpdateChannel.ts`, `src/domain/appUpdateChannel.test.ts`
- Modify: `src/domain/settings.ts` (interface `AppSettings` ~line 124, `defaultAppSettings` ~line 286, `normalizeAppSettings` ~line 434), `src/domain/settings.test.ts`
- Modify (fixtures that build a full `AppSettings` literal and stop compiling): `src/application/useAgentProviderManagement.test.tsx`, `src/application/workbenchController/useWorkbenchSettingsPersistence.test.tsx`, `src/infrastructure/settingsAppUpdaterPreferencesGateway.test.ts`, `src/infrastructure/browserSettingsGateway.test.ts`, plus any other file `npm run check` lists

**Interfaces:**
- Produces: `AppUpdateChannel = "stable" | "beta"`, `APP_UPDATE_CHANNELS`, `DEFAULT_APP_UPDATE_CHANNEL = "beta"`, `APP_UPDATE_CHANNEL_LABELS`, `isAppUpdateChannel(value: unknown): value is AppUpdateChannel`, `normalizeAppUpdateChannel(value: unknown): AppUpdateChannel`; `AppSettings.appUpdateChannel: AppUpdateChannel`.

- [ ] **Step 1: Write the failing domain test**

```ts
// src/domain/appUpdateChannel.test.ts
import { describe, expect, it } from "vitest";
import {
  APP_UPDATE_CHANNELS,
  APP_UPDATE_CHANNEL_LABELS,
  DEFAULT_APP_UPDATE_CHANNEL,
  isAppUpdateChannel,
  normalizeAppUpdateChannel,
} from "./appUpdateChannel";

describe("appUpdateChannel", () => {
  it("is a closed pair of channels with user-facing labels", () => {
    expect(APP_UPDATE_CHANNELS).toEqual(["stable", "beta"]);
    expect(APP_UPDATE_CHANNEL_LABELS).toEqual({ stable: "Stable", beta: "Beta" });
    expect(isAppUpdateChannel("stable")).toBe(true);
    expect(isAppUpdateChannel("beta")).toBe(true);
    expect(isAppUpdateChannel("Beta")).toBe(false);
  });

  it.each([undefined, null, "", "nightly", "STABLE", 1, {}, ["beta"], "constructor", "__proto__"])(
    "falls back to the beta channel for %j",
    (value) => {
      expect(normalizeAppUpdateChannel(value)).toBe(DEFAULT_APP_UPDATE_CHANNEL);
    },
  );

  it("keeps a valid channel", () => {
    expect(normalizeAppUpdateChannel("stable")).toBe("stable");
  });
});
```

Add to `src/domain/settings.test.ts` inside the existing `describe` for app settings:

```ts
it("persists the update channel and repairs an unknown value", () => {
  expect(defaultAppSettings().appUpdateChannel).toBe("beta");
  expect(normalizeAppSettings({ appUpdateChannel: "stable" }).appUpdateChannel).toBe("stable");
  expect(normalizeAppSettings({ appUpdateChannel: "nightly" }).appUpdateChannel).toBe("beta");
  expect(normalizeAppSettings({}).appUpdateChannel).toBe("beta");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/appUpdateChannel.test.ts src/domain/settings.test.ts`
Expected: FAIL (`Cannot find module './appUpdateChannel'`, and `appUpdateChannel` undefined).

- [ ] **Step 3: Implement the domain module**

```ts
// src/domain/appUpdateChannel.ts
export const APP_UPDATE_CHANNELS = ["stable", "beta"] as const;
export type AppUpdateChannel = (typeof APP_UPDATE_CHANNELS)[number];

export const DEFAULT_APP_UPDATE_CHANNEL: AppUpdateChannel = "beta";

export const APP_UPDATE_CHANNEL_LABELS: Readonly<Record<AppUpdateChannel, string>> = {
  stable: "Stable",
  beta: "Beta",
};

export function isAppUpdateChannel(value: unknown): value is AppUpdateChannel {
  return value === "stable" || value === "beta";
}

export function normalizeAppUpdateChannel(value: unknown): AppUpdateChannel {
  if (isAppUpdateChannel(value)) return value;
  return DEFAULT_APP_UPDATE_CHANNEL;
}
```

- [ ] **Step 4: Add the field to `AppSettings`**

In `src/domain/settings.ts`:

```ts
import {
  DEFAULT_APP_UPDATE_CHANNEL,
  normalizeAppUpdateChannel,
  type AppUpdateChannel,
} from "./appUpdateChannel";
```

In `interface AppSettings` directly under `appUpdaterSkippedVersion: string | null;` add `appUpdateChannel: AppUpdateChannel;`. In `defaultAppSettings()` under `appUpdaterSkippedVersion: null,` add `appUpdateChannel: DEFAULT_APP_UPDATE_CHANNEL,`. In the object returned by `normalizeAppSettings` under the `appUpdaterSkippedVersion:` line add `appUpdateChannel: normalizeAppUpdateChannel(value.appUpdateChannel),`.

- [ ] **Step 5: Repair the fixtures**

Run: `npm run check`
Expected: errors only of the form `Property 'appUpdateChannel' is missing in type ...`. In each listed object literal add `appUpdateChannel: "beta",` next to its `appUpdaterSkippedVersion` entry. Rerun `npm run check` until it exits 0.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/domain/appUpdateChannel.test.ts src/domain/settings.test.ts src/infrastructure/browserSettingsGateway.test.ts src/infrastructure/settingsAppUpdaterPreferencesGateway.test.ts`
Expected: PASS.

- [ ] **Step 7: Report changed files to the lead (no commit; the lead commits after Task 20-22).**

---

### Task 2: Rust `app_update_check` command with a closed channel enum (F7, Rust)

**Files:**
- Create: `src-tauri/src/lib_composition/app_update_channel_commands.rs`
- Modify: `src-tauri/src/lib_composition/command_facades.rs` (module list at the top), `src-tauri/src/lib_composition/runtime.rs` (`generate_handler!`, next to `crate::application_commands::app_update_install_mode` ~line 436), `src-tauri/Cargo.toml` (dependencies), `src-tauri/Cargo.lock`, `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces IPC: command `app_update_check`, args `{ request: { channel: "stable" | "beta" } }` (closed), result `null | { rid: number, currentVersion: string, version: string, date: string | null, body: string | null, rawJson: object }`.
- Produces Rust: `AppUpdateChannel { Stable, Beta }`, `endpoints_for(channel) -> Result<AppUpdateEndpoints, String>`, `missing_release_is_up_to_date(channel, &tauri_plugin_updater::Error) -> bool`, constants `STABLE_UPDATE_ENDPOINT`, `BETA_UPDATE_ENDPOINT`.

- [ ] **Step 1: Write the module with its failing tests first (tests at the bottom reference functions that do not exist yet)**

Create `src-tauri/src/lib_composition/app_update_channel_commands.rs` containing only the `#[cfg(test)] mod tests` block below plus `use super::*;` placeholders compile-failing:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(value: serde_json::Value) -> Result<AppUpdateCheckRequest, serde_json::Error> {
        serde_json::from_value(value)
    }

    #[test]
    fn channel_wire_is_closed_and_lowercase() {
        assert_eq!(
            request(json!({ "channel": "stable" })).expect("stable").channel,
            AppUpdateChannel::Stable
        );
        assert_eq!(
            request(json!({ "channel": "beta" })).expect("beta").channel,
            AppUpdateChannel::Beta
        );
        assert!(request(json!({ "channel": "Stable" })).is_err());
        assert!(request(json!({ "channel": "nightly" })).is_err());
        assert!(request(json!({ "channel": "beta", "endpoint": "https://example.com" })).is_err());
        assert!(request(json!({})).is_err());
    }

    #[test]
    fn beta_keeps_the_configured_endpoint_and_stable_overrides_it() {
        assert_eq!(
            endpoints_for(AppUpdateChannel::Beta).expect("beta"),
            AppUpdateEndpoints::Configured
        );
        assert_eq!(
            endpoints_for(AppUpdateChannel::Stable).expect("stable"),
            AppUpdateEndpoints::Override(vec![Url::parse(STABLE_UPDATE_ENDPOINT).expect("url")])
        );
    }

    #[test]
    fn configured_updater_endpoint_is_the_beta_manifest() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("config");
        assert_eq!(
            config["plugins"]["updater"]["endpoints"],
            json!([BETA_UPDATE_ENDPOINT])
        );
    }

    #[test]
    fn both_endpoints_are_https_github_release_manifests() {
        for endpoint in [STABLE_UPDATE_ENDPOINT, BETA_UPDATE_ENDPOINT] {
            let url = Url::parse(endpoint).expect("url");
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.host_str(), Some("github.com"));
            assert!(url.path().ends_with("/latest.json"));
        }
    }

    #[test]
    fn a_missing_stable_release_reads_as_up_to_date_only_on_stable() {
        assert!(missing_release_is_up_to_date(
            AppUpdateChannel::Stable,
            &tauri_plugin_updater::Error::ReleaseNotFound
        ));
        assert!(!missing_release_is_up_to_date(
            AppUpdateChannel::Beta,
            &tauri_plugin_updater::Error::ReleaseNotFound
        ));
        assert!(!missing_release_is_up_to_date(
            AppUpdateChannel::Stable,
            &tauri_plugin_updater::Error::EmptyEndpoints
        ));
    }

    #[test]
    fn metadata_serializes_with_the_plugin_shape() {
        let metadata = AppUpdateMetadata {
            rid: 7,
            current_version: "0.2.0-beta.72".to_string(),
            version: "0.2.0".to_string(),
            date: None,
            body: Some("Notes".to_string()),
            raw_json: json!({ "version": "0.2.0" }),
        };
        assert_eq!(
            serde_json::to_value(metadata).expect("json"),
            json!({
                "rid": 7,
                "currentVersion": "0.2.0-beta.72",
                "version": "0.2.0",
                "date": null,
                "body": "Notes",
                "rawJson": { "version": "0.2.0" }
            })
        );
    }
}
```

Register the module in `command_facades.rs` directly after the `agent_turn_log_commands` pair:

```rust
#[path = "app_update_channel_commands.rs"]
mod app_update_channel_commands;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib app_update_channel_commands`
Expected: FAIL to compile (`cannot find type AppUpdateCheckRequest`).

- [ ] **Step 3: Add the `time` dependency**

In `src-tauri/Cargo.toml` `[dependencies]` add `time = { version = "0.3", features = ["formatting"] }` (the lock already resolves `time 0.3.49` through the updater plugin; `cargo check` updates `Cargo.lock` features only).

- [ ] **Step 4: Implement the command above the tests**

```rust
use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;
use url::Url;

pub(crate) const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/MatusMockor/codevo-editor/releases/latest/download/latest.json";
pub(crate) const BETA_UPDATE_ENDPOINT: &str =
    "https://github.com/MatusMockor/codevo-editor/releases/download/beta/latest.json";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AppUpdateChannel {
    Stable,
    Beta,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppUpdateCheckRequest {
    channel: AppUpdateChannel,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum AppUpdateEndpoints {
    Configured,
    Override(Vec<Url>),
}

pub(crate) fn endpoints_for(channel: AppUpdateChannel) -> Result<AppUpdateEndpoints, String> {
    match channel {
        AppUpdateChannel::Beta => Ok(AppUpdateEndpoints::Configured),
        AppUpdateChannel::Stable => Url::parse(STABLE_UPDATE_ENDPOINT)
            .map(|url| AppUpdateEndpoints::Override(vec![url]))
            .map_err(|_| "The stable update endpoint is invalid.".to_string()),
    }
}

pub(crate) fn missing_release_is_up_to_date(
    channel: AppUpdateChannel,
    error: &tauri_plugin_updater::Error,
) -> bool {
    channel == AppUpdateChannel::Stable
        && matches!(error, tauri_plugin_updater::Error::ReleaseNotFound)
}

#[tauri::command]
pub(crate) async fn app_update_check(
    webview: Webview,
    request: AppUpdateCheckRequest,
) -> Result<Option<AppUpdateMetadata>, String> {
    let mut builder = webview.updater_builder();
    if let AppUpdateEndpoints::Override(endpoints) = endpoints_for(request.channel)? {
        builder = builder
            .endpoints(endpoints)
            .map_err(|error| error.to_string())?;
    }
    let updater = builder.build().map_err(|error| error.to_string())?;
    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) if missing_release_is_up_to_date(request.channel, &error) => None,
        Err(error) => return Err(error.to_string()),
    };
    let Some(update) = update else {
        return Ok(None);
    };
    let date = update
        .date
        .map(|date| date.format(&Rfc3339))
        .transpose()
        .map_err(|_| "The update release date is invalid.".to_string())?;
    let metadata = AppUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(Some(metadata))
}
```

- [ ] **Step 5: Register the command and narrow the capability**

In `runtime.rs` `generate_handler!`, directly after `crate::application_commands::app_update_install_mode,` add `app_update_channel_commands::app_update_check,` (the same way `agent_provider_usage_commands::read_agent_provider_usage` is referenced). In `src-tauri/capabilities/default.json` remove the line `"updater:allow-check",` (the frontend no longer calls the plugin's own check; `updater:allow-download` and `updater:allow-install` stay because `Update.download()`/`install()` still use the plugin commands on the returned resource id).

- [ ] **Step 6: Run the Rust tests to verify they pass**

Run: `cd src-tauri && cargo test --lib app_update_channel_commands && cargo clippy --all-targets -- -D warnings`
Expected: 6 tests PASS, clippy clean.

- [ ] **Step 7: Report changed files to the lead.**

---

### Task 3: Channel-aware updater bridge, gateway, hook and composition (F7, TS)

**Files:**
- Create: `src/infrastructure/tauriAppUpdateChannelCheck.ts`, `src/infrastructure/tauriAppUpdateChannelCheck.test.ts`
- Modify: `src/domain/appUpdater.ts:32-37` (gateway port), `src/infrastructure/tauriAppUpdaterGateway.ts` (bridge type lines 25-29, `check` 64-123, `probeSupersedingRelease` 165-182), `src/infrastructure/tauriAppUpdaterGateway.test.ts`, `src/infrastructure/tauriAppUpdaterGateway.preparation.test.ts`, `src/application/useAppUpdater.ts`, `src/application/useAppUpdater.test.tsx`, `src/application/workbenchController/useWorkbenchAppUpdaterComposition.ts`, `src/components/WorkbenchAppUpdaterHost.tsx`, `src/workbenchComposition.ts:85,105-108`, `src/App.appUpdaterComposition.test.ts`, `docs/release.md:164-169`

**Interfaces:**
- Consumes: `AppUpdateChannel` (Task 1); IPC `app_update_check` (Task 2).
- Produces: `AppUpdaterGateway.check(channel: AppUpdateChannel): Promise<AppUpdateCheckResult>`; `TauriUpdaterBridge.check(channel: AppUpdateChannel): Promise<unknown>`; `UseAppUpdaterOptions.channel: AppUpdateChannel`; `useWorkbenchAppUpdaterComposition(composition, persistSkippedVersion, channel)`; `createChannelUpdateCheck(invokeCommand, construct?)`, `parseAppUpdateMetadata(value)`, `APP_UPDATE_CHECK_COMMAND = "app_update_check"`.

- [ ] **Step 1: Write the failing bridge test**

```ts
// src/infrastructure/tauriAppUpdateChannelCheck.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_CHECK_COMMAND,
  createChannelUpdateCheck,
  parseAppUpdateMetadata,
} from "./tauriAppUpdateChannelCheck";

const metadata = {
  rid: 3,
  currentVersion: "0.2.0-beta.72",
  version: "0.2.0-beta.73",
  date: null,
  body: "Notes",
  rawJson: { version: "0.2.0-beta.73" },
};

describe("createChannelUpdateCheck", () => {
  it("sends only the closed channel and builds an update from the metadata", async () => {
    const invokeCommand = vi.fn(async () => metadata);
    const construct = vi.fn((value: unknown) => ({ constructed: value }));
    const check = createChannelUpdateCheck(invokeCommand, construct);

    const result = await check("stable");

    expect(invokeCommand).toHaveBeenCalledWith(APP_UPDATE_CHECK_COMMAND, {
      request: { channel: "stable" },
    });
    expect(construct).toHaveBeenCalledWith({
      rid: 3,
      currentVersion: "0.2.0-beta.72",
      version: "0.2.0-beta.73",
      body: "Notes",
      rawJson: { version: "0.2.0-beta.73" },
    });
    expect(result).toEqual({ constructed: expect.objectContaining({ rid: 3 }) });
  });

  it("returns null when the channel has no newer release", async () => {
    const construct = vi.fn();
    const check = createChannelUpdateCheck(async () => null, construct);
    await expect(check("beta")).resolves.toBeNull();
    expect(construct).not.toHaveBeenCalled();
  });
});

describe("parseAppUpdateMetadata", () => {
  it.each([
    ["an array", []],
    ["an unknown field", { ...metadata, endpoint: "https://example.com" }],
    ["a negative rid", { ...metadata, rid: -1 }],
    ["a fractional rid", { ...metadata, rid: 1.5 }],
    ["a missing version", { ...metadata, version: undefined }],
    ["a numeric date", { ...metadata, date: 5 }],
    ["an array manifest", { ...metadata, rawJson: [] }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseAppUpdateMetadata(value)).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/infrastructure/tauriAppUpdateChannelCheck.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement the bridge**

```ts
// src/infrastructure/tauriAppUpdateChannelCheck.ts
import { Update } from "@tauri-apps/plugin-updater";
import type { AppUpdateChannel } from "../domain/appUpdateChannel";

export const APP_UPDATE_CHECK_COMMAND = "app_update_check";

export type AppUpdateMetadata = ConstructorParameters<typeof Update>[0];

export type InvokeAppUpdateCheck = (
  command: typeof APP_UPDATE_CHECK_COMMAND,
  args: { readonly request: { readonly channel: AppUpdateChannel } },
) => Promise<unknown>;

const METADATA_KEYS: ReadonlySet<string> = new Set([
  "rid",
  "currentVersion",
  "version",
  "date",
  "body",
  "rawJson",
]);

export function createChannelUpdateCheck(
  invokeCommand: InvokeAppUpdateCheck,
  construct: (metadata: AppUpdateMetadata) => unknown = (metadata) => new Update(metadata),
): (channel: AppUpdateChannel) => Promise<unknown> {
  return async (channel) => {
    const metadata = await invokeCommand(APP_UPDATE_CHECK_COMMAND, { request: { channel } });
    if (metadata === null) return null;
    return construct(parseAppUpdateMetadata(metadata));
  };
}

export function parseAppUpdateMetadata(value: unknown): AppUpdateMetadata {
  const record = metadataRecord(value);
  if (!Number.isSafeInteger(record.rid) || (record.rid as number) < 0) throw invalid("rid");
  if (typeof record.currentVersion !== "string") throw invalid("currentVersion");
  if (typeof record.version !== "string") throw invalid("version");
  const rawJson = record.rawJson;
  if (typeof rawJson !== "object" || rawJson === null || Array.isArray(rawJson)) {
    throw invalid("rawJson");
  }
  const date = optionalText(record.date, "date");
  const body = optionalText(record.body, "body");
  return {
    rid: record.rid as number,
    currentVersion: record.currentVersion,
    version: record.version,
    rawJson: rawJson as Record<string, unknown>,
    ...(date === undefined ? {} : { date }),
    ...(body === undefined ? {} : { body }),
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid application update metadata.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !METADATA_KEYS.has(key))) {
    throw new TypeError("Invalid application update metadata fields.");
  }
  return record;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw invalid(field);
  return value;
}

function invalid(field: string): TypeError {
  return new TypeError(`Invalid application update metadata at ${field}.`);
}
```

Run: `npx vitest run src/infrastructure/tauriAppUpdateChannelCheck.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing hook test (channel is part of the updater authority)**

Add to `src/application/useAppUpdater.test.tsx` (imports: `useState` from `react`, `type AppUpdateCheckResult` from `../domain/appUpdater`, `type AppUpdateChannel` from `../domain/appUpdateChannel`). Also add `channel: "beta",` to the options object in the existing `render` helper (before `...overrides`).

```tsx
it("checks on the selected channel and drops a check that settles after the channel changed", async () => {
  const gateway = gatewayWithUpdate();
  const control: { settle: ((result: AppUpdateCheckResult) => void) | null } = { settle: null };
  gateway.check.mockImplementationOnce(
    () =>
      new Promise<AppUpdateCheckResult>((resolve) => {
        control.settle = resolve;
      }),
  );
  const preferencesGateway = preferenceGateway();
  const selector: { set: ((channel: AppUpdateChannel) => void) | null } = { set: null };
  function ChannelHarness() {
    const [channel, setChannel] = useState<AppUpdateChannel>("beta");
    selector.set = setChannel;
    surface = useAppUpdater({
      channel,
      currentVersion: "0.1.0",
      gateway,
      persistSkippedVersion: vi.fn(async () => undefined),
      preferencesGateway,
      scheduleAfterUiInteractive: neverSchedule,
    });
    return null;
  }
  act(() => root.render(<ChannelHarness />));

  let firstCheck: Promise<void> | undefined;
  act(() => {
    firstCheck = surface?.check();
  });
  expect(gateway.check).toHaveBeenLastCalledWith("beta");

  act(() => selector.set?.("stable"));
  expect(surface?.state.kind).toBe("idle");
  expect(gateway.dispose).toHaveBeenCalled();

  await act(async () => {
    control.settle?.({
      kind: "available",
      candidate: {
        candidateRevision: 1,
        currentVersion: "0.1.0",
        version: "0.1.1-beta.1",
        date: null,
        notesSpan: { kind: "single", notes: "Beta" },
      },
    });
    await firstCheck;
  });
  expect(surface?.state.kind).toBe("idle");

  await act(async () => surface?.check());
  expect(gateway.check).toHaveBeenLastCalledWith("stable");
  expect(surface?.state.kind).toBe("available");
});
```

Run: `npx vitest run src/application/useAppUpdater.test.tsx`
Expected: FAIL (type error on `channel`, and `check` called with no argument).

- [ ] **Step 5: Make the channel part of the port, gateway and hook**

`src/domain/appUpdater.ts`: add `import type { AppUpdateChannel } from "./appUpdateChannel";` and change the port method to `check(channel: AppUpdateChannel): Promise<AppUpdateCheckResult>;`.

`src/infrastructure/tauriAppUpdaterGateway.ts`:
- Bridge: `check(channel: AppUpdateChannel): Promise<unknown>;`.
- `async check(channel: AppUpdateChannel): Promise<AppUpdateCheckResult>`; inside it call `this.probeSupersedingRelease(installed.snapshot.version, channel)` and `const rawUpdate = await this.bridge.check(channel);`.
- `private async probeSupersedingRelease(installedVersion: string, channel: AppUpdateChannel)` with `() => this.bridge.check(channel)` in `settleBoundedProbe`.

`src/application/useAppUpdater.ts`:

```ts
import type { AppUpdateChannel } from "../domain/appUpdateChannel";
```

- Add `readonly channel: AppUpdateChannel;` to `UseAppUpdaterOptions` and `channel` to the destructured options.
- `const authorityRef = useRef({ channel, currentVersion, gateway, preferencesGateway });`
- The layout effect compares `authorityRef.current.channel === channel` in the early-return condition, assigns `authorityRef.current = { channel, currentVersion, gateway, preferencesGateway };`, and lists `channel` in its dependency array.
- In `performCheck`: `const result = await owner.gateway.check(owner.channel);`.

`src/application/workbenchController/useWorkbenchAppUpdaterComposition.ts`:

```ts
import type { AppUpdateChannel } from "../../domain/appUpdateChannel";

export function useWorkbenchAppUpdaterComposition(
  composition: WorkbenchAppUpdaterComposition,
  persistSkippedVersion: (version: string) => Promise<void>,
  channel: AppUpdateChannel,
): AppUpdaterSurface {
  return useAppUpdater({
    channel,
    currentVersion: composition.appVersion,
    gateway: composition.appUpdaterGateway,
    preferencesGateway: composition.appUpdaterPreferencesGateway,
    persistSkippedVersion,
  });
}
```

`src/components/WorkbenchAppUpdaterHost.tsx`: pass the third argument `workbench.appSettings.appUpdateChannel`.

`src/workbenchComposition.ts`: remove `import { check } from "@tauri-apps/plugin-updater";`, add `import { createChannelUpdateCheck } from "./infrastructure/tauriAppUpdateChannelCheck";` and build the gateway with:

```ts
const appUpdaterGateway = new TauriAppUpdaterGateway(
  {
    check: createChannelUpdateCheck((command, args) => invoke(command, args)),
    relaunch,
    getInstallMode: () => invoke("app_update_install_mode"),
  },
  CODEVO_APP_VERSION,
);
```

- [ ] **Step 6: Update the existing gateway tests and add the probe-channel test**

In `tauriAppUpdaterGateway.test.ts` and `tauriAppUpdaterGateway.preparation.test.ts` change every `gateway.check()` to `gateway.check("beta")`. Add:

```ts
it("uses the requested channel for both the check and the superseding probe", async () => {
  const update = bridgeUpdate("0.1.0", "0.2.0", { version: "0.2.0" });
  const probe = bridgeUpdate("0.1.0", "0.3.0", { version: "0.3.0" });
  const bridge = {
    getInstallMode: async () => "prepareBeforeRestart",
    check: vi.fn().mockResolvedValueOnce(update).mockResolvedValue(probe),
    relaunch: vi.fn(async () => undefined),
  };
  const gateway = new TauriAppUpdaterGateway(bridge, "0.1.0");
  const first = await gateway.check("stable");
  if (first.kind !== "available") return expect(first.kind).toBe("available");
  await gateway.download(first.candidate.candidateRevision);
  await gateway.check("stable");
  expect(bridge.check.mock.calls).toEqual([["stable"], ["stable"]]);
});
```

`bridgeUpdate(currentVersion, version, rawJson)` is the existing helper at the bottom of `tauriAppUpdaterGateway.test.ts`.

In `src/App.appUpdaterComposition.test.ts` add to the existing source assertions:

```ts
expect(host).toContain("workbench.appSettings.appUpdateChannel");
const composition = readFileSync(new URL("./workbenchComposition.ts", import.meta.url), "utf8");
expect(composition).toContain("createChannelUpdateCheck(");
expect(composition).not.toContain('from "@tauri-apps/plugin-updater"');
```

- [ ] **Step 7: Run the focused tests**

Run: `npx vitest run src/infrastructure/tauriAppUpdateChannelCheck.test.ts src/infrastructure/tauriAppUpdaterGateway.test.ts src/infrastructure/tauriAppUpdaterGateway.preparation.test.ts src/application/useAppUpdater.test.tsx src/App.appUpdaterComposition.test.ts src/components/WorkbenchAppUpdaterHost.test.tsx`
Expected: PASS. Then `npm run check` exits 0.

- [ ] **Step 8: Update the release documentation**

Replace the paragraph in `docs/release.md` that starts "GitHub's `/releases/latest` endpoint excludes prereleases." with:

```markdown
GitHub's `/releases/latest` endpoint excludes prereleases, so the application has two
update channels selected in Settings > General > Update track. Beta (default) reads
`/releases/download/beta/latest.json`, the endpoint configured in `tauri.conf.json`
(the local QA override config replaces it). Stable reads
`/releases/latest/download/latest.json`; until a stable release exists that endpoint
returns 404, which the app reports as "up to date". The frontend sends only the channel
enum to the `app_update_check` command; Rust owns the endpoint URLs. After publishing
an exact version release, the workflow copies its manifest to the `beta` channel and
verifies the downloaded copy. For an existing channel, verification happens before
moving its tag; a new channel stays in draft until verification succeeds. The manifest
continues to point to the exact version's archive. An existing channel manifest is
backed up and restored if its replacement upload or verification fails.
```

- [ ] **Step 9: Report changed files to the lead.**

---
### Task 4: Settings sections, rows and routing

**Files:**
- Modify: `src/domain/settings.ts:69-78` (`SettingsSection`), `src/components/settings/settingsRegistry.ts`, `src/components/settings/settingsRegistryRows.ts`, `src/components/settings/settingsPages.tsx`, `src/components/settings/settingsRegistry.test.ts`, `src/components/settings/settingsSearch.test.ts`, `src/components/settings/pages/settingsPages.parity.test.tsx`
- Create (placeholders filled by Tasks 9 and 10; they must compile now): `src/components/settings/pages/UsageSettingsPage.tsx`, `src/components/settings/pages/ArchiveSettingsPage.tsx`

**Interfaces:**
- Produces: `SettingsSection` gains `"usage" | "archive"`. `SettingsSectionId = "general" | "agents" | "environments" | "keymap" | "index" | "snippets" | "usage" | "archive" | "php"` (the `appearance` section id is gone; `resolveSettingsRoute("appearance")` returns `{ section: "general", row: "appearance.palette" }`). New row ids: `general.updateChannel`, `general.threadAttention`, `usage.limits`, `usage.localActivity`, `archive.threads`. All `appearance.*` rows now have `section: "general"`. Section order and labels: General, Providers (id `agents`), Environments, Keybindings, Index & languages, Snippets, Usage, Archive, PHP.

- [ ] **Step 1: Write the failing registry tests**

Add to `src/components/settings/settingsRegistry.test.ts`:

```ts
it("lists the redesigned sections in mockup order with PHP kept last", () => {
  expect(SETTINGS_SECTIONS.map((section) => [section.id, section.label])).toEqual([
    ["general", "General"],
    ["agents", "Providers"],
    ["environments", "Environments"],
    ["keymap", "Keybindings"],
    ["index", "Index & languages"],
    ["snippets", "Snippets"],
    ["usage", "Usage"],
    ["archive", "Archive"],
    ["php", "PHP"],
  ]);
});

it("routes the legacy appearance section to the General palette row", () => {
  expect(resolveSettingsRoute("appearance")).toEqual({ section: "general", row: "appearance.palette" });
  expect(resolveSettingsRoute("usage")).toEqual({ section: "usage", row: null });
  expect(resolveSettingsRoute("archive")).toEqual({ section: "archive", row: null });
});

it("files every appearance row and the new update channel row under General", () => {
  const general = settingsRowsForSection("general").map((row) => row.id);
  expect(general).toEqual(
    expect.arrayContaining([
      "appearance.palette",
      "appearance.colorScheme",
      "appearance.syntaxTheme",
      "appearance.agentThreadFontSize",
      "appearance.editorFontFamily",
      "appearance.editorFontSize",
      "general.appUpdates",
      "general.updateChannel",
      "general.statusBar",
      "general.threadAttention",
    ]),
  );
  expect(settingsRowDescriptor("general.updateChannel").title).toBe("Update track");
  expect(settingsRowDescriptor("general.statusBar").title).toBe("Editor header items");
  expect(settingsRowsForSection("usage").map((row) => row.id)).toEqual([
    "usage.limits",
    "usage.localActivity",
  ]);
  expect(settingsRowsForSection("archive").map((row) => row.id)).toEqual(["archive.threads"]);
});
```

Add to `src/components/settings/settingsSearch.test.ts`:

```ts
it("finds the update track by channel words", () => {
  const hits = searchSettingsRows("beta", SETTINGS_ROWS, false);
  expect(hits.map((hit) => hit.row.id)).toContain("general.updateChannel");
});
```

(`searchSettingsRows(query, rows, hasWorkspace)` from `settingsSearch.ts`; `SETTINGS_ROWS` from `settingsRegistry.ts`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/settingsRegistry.test.ts src/components/settings/settingsSearch.test.ts`
Expected: FAIL (old section list, unknown row ids).

- [ ] **Step 3: Extend the domain section union**

In `src/domain/settings.ts` add `| "usage"` and `| "archive"` to `SettingsSection`.

- [ ] **Step 4: Rewrite the section list and routing**

In `settingsRegistry.ts`:

```ts
import {
  Archive,
  Bot,
  Braces,
  Code2,
  Gauge,
  Keyboard,
  Layers,
  Monitor,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SettingsSectionId =
  | "general"
  | "agents"
  | "environments"
  | "keymap"
  | "index"
  | "snippets"
  | "usage"
  | "archive"
  | "php";

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSectionDescriptor> = [
  { id: "general", label: "General", icon: SlidersHorizontal, description: "Theme, text, updates, workspace, and editing." },
  { id: "agents", label: "Providers", icon: Bot, description: "Claude Code and Codex, models, and defaults for new threads." },
  { id: "environments", label: "Environments", icon: Monitor, description: "Where your agent threads run." },
  { id: "keymap", label: "Keybindings", icon: Keyboard, description: "Every command shortcut, its conflicts, and its default." },
  { id: "index", label: "Index & languages", icon: Layers, description: "Indexing limits, JavaScript and TypeScript, linters, and git mappings." },
  { id: "snippets", label: "Snippets", icon: Braces, description: "User live templates shared across every project." },
  { id: "usage", label: "Usage", icon: Gauge, description: "Subscription limits and local activity." },
  { id: "archive", label: "Archive", icon: Archive, description: "Archived threads from every project." },
  { id: "php", label: "PHP", icon: Code2, description: "PHP engine, language level, tool paths, and analysis." },
];
```

Replace `resolveSettingsRoute`:

```ts
export function resolveSettingsRoute(section: SettingsSection): SettingsRoute {
  switch (section) {
    case "general":
    case "agents":
    case "environments":
    case "keymap":
    case "index":
    case "php":
    case "snippets":
    case "usage":
    case "archive":
      return { section, row: null };
    case "appearance":
      return { section: "general", row: "appearance.palette" };
    case "git":
      return { section: "index", row: "index.gitDirectoryMappings" };
    default:
      return section satisfies never;
  }
}
```

- [ ] **Step 5: Re-file and add rows**

In `settingsRegistryRows.ts`:
- Change the second argument of every `row("appearance.…", "appearance", …)` to `"general"`.
- Change the `general.statusBar` title to `"Editor header items"` and its description to `"Choose which readouts the editor header shows."` (agreed with P7: P7 moves the status items into the editor sub-header; P9 owns this copy, P7 drops its hunk).
- Add after `general.appUpdates`:

```ts
row(
  "general.updateChannel",
  "general",
  "Update track",
  "Use stable releases or beta builds. Switch back anytime.",
  ["update", "channel", "track", "beta", "stable", "release"],
),
```

- Add after `general.statusBar`:

```ts
row(
  "general.threadAttention",
  "general",
  "Threads needing attention in the sidebar",
  "Show the count of threads waiting for you in the sidebar footer.",
  ["attention", "approval", "sidebar", "threads", "badge"],
  "workspace",
),
```

- Add at the end of the table:

```ts
row(
  "usage.limits",
  "usage",
  "Subscription limits",
  "Plan limit windows reported by Claude Code and Codex.",
  ["usage", "limit", "quota", "rate", "weekly", "5-hour"],
),
row(
  "usage.localActivity",
  "usage",
  "Local activity",
  "Saved threads and turns on this device, not subscription billing.",
  ["cost", "tokens", "turns", "activity", "spend"],
),
row(
  "archive.threads",
  "archive",
  "Archived threads",
  "Threads you archived, grouped by project.",
  ["archive", "archived", "unarchive", "restore", "threads"],
),
```

- [ ] **Step 6: Route the host and add compile-only page stubs**

Create `pages/UsageSettingsPage.tsx`:

```tsx
import type { SettingsPageProps } from "../settingsPageProps";

export function UsageSettingsPage(_props: SettingsPageProps) {
  return null;
}
```

Create `pages/ArchiveSettingsPage.tsx` the same way with `ArchiveSettingsPage`. (Tasks 9 and 10 replace both bodies.)

In `settingsPages.tsx` remove the `appearance` case and the `AppearanceSettingsPage` import, add:

```tsx
case "usage":
  return <UsageSettingsPage {...props} />;
case "archive":
  return <ArchiveSettingsPage {...props} />;
```

`AppearanceSettingsPage.tsx` is deleted in Task 6; until then it is simply unused.

- [ ] **Step 7: Update the parity test and run the tests**

In `pages/settingsPages.parity.test.tsx` replace the expected section list with the nine ids above and drop `appearance`. Run:

`npx vitest run src/components/settings/settingsRegistry.test.ts src/components/settings/settingsSearch.test.ts src/components/settings/pages/settingsPages.parity.test.tsx`
Expected: PASS. `npm run check` exits 0 (callers that pass `"appearance"` to `setSettingsInitialSection` still type-check because the domain union keeps it).

- [ ] **Step 8: Report changed files to the lead.**

---

### Task 5: Settings shell, primitives and stylesheet on `--cv-*`

**Files:**
- Create: `src/components/settings/settingsShell.css`, `src/components/settings/SettingsPageActions.tsx`, `src/components/settings/SettingsPageActions.test.tsx`, `src/components/settings/pages/generalDefaults.ts`, `src/components/settings/pages/generalDefaults.test.ts`
- Modify: `src/components/settings/WorkbenchSettingsScreen.tsx`, `WorkbenchSettingsScreen.test.tsx`, `SettingsSectionSidebar.tsx`, `SettingsSearchInput.tsx`, `SettingsExitButton.tsx`, `primitives/SettingsRow.tsx`, `primitives/SettingsSectionHeading.tsx`, `primitives/settingsPrimitives.test.tsx`, `settings.css` (token block lines 1-44, shell/section/row rules lines 73-480, switch 650-685, every `--codevo-*` reference), `src/App.css:12` (add the new sheet import after `settings.css`), `src/components/cssBorderAllowlist.ts` (remove entries whose selectors no longer exist)

**Interfaces:**
- Consumes: `TopBar` from `src/ui/shell/TopBar.tsx` (P2): `<TopBar region="sidebar" | "main" label={string} leading? actions? trailing?>{children}</TopBar>`; foundation `Kbd`, `Button`, `IconButton`.
- Produces: `SettingsSectionHeading` props `{ title: string; actions?: ReactNode; children: ReactNode; bare?: boolean }` (`bare` renders children without the rounded group, used by palette cards and lists that bring their own group); `SettingsRow` props add `description?: ReactNode` (overrides the registry description) and keep `meta`, `layout`, `rowId`; `SettingsPageActions({ section, actions, draft, env })`.

- [ ] **Step 1: Write the failing screen tests**

In `WorkbenchSettingsScreen.test.tsx` replace the first test and add two:

```tsx
it("renders the settings nav column and a main column with a breadcrumb heading", () => {
  render();

  expect(document.activeElement?.textContent).toBe("Settings/General");
  expect(tablist()?.getAttribute("aria-orientation")).toBe("vertical");
  expect(tabLabels()).toEqual([
    "General",
    "Providers",
    "Environments",
    "Keybindings",
    "Index & languages",
    "Snippets",
    "Usage",
    "Archive",
    "PHP",
  ]);
  expect(host.querySelector(".settings-nav-column .settings-search input")?.getAttribute("placeholder")).toBe("Search");
  expect(host.querySelector(".settings-nav-column__foot button")?.textContent).toBe("Back");
  expect(panel()?.getAttribute("aria-labelledby")).toBe(selectedTab()?.id);
});

it("updates the breadcrumb when another section is selected", () => {
  render();
  keyDown(selectedTab(), "ArrowDown");
  expect(host.querySelector(".settings-crumb__here")?.textContent).toBe("Providers");
});

it("opens the legacy appearance route on the General palette row", () => {
  render("appearance");
  expect(selectedTab()?.textContent).toBe("General");
  expect(host.querySelector('[data-settings-row="appearance.palette"]')).not.toBeNull();
});
```

(`render(section?: SettingsSection)` is the file's existing helper; extend it with that optional parameter if it has none. Update the arrow-key test's expected labels: `ArrowDown` from General now selects "Providers", and wrapping `ArrowUp` from General selects "PHP".)

In `primitives/settingsPrimitives.test.tsx` add:

```tsx
it("renders a section as a heading plus one rounded group of rows", () => {
  mount(
    <SettingsSectionHeading title="Editing">
      <SettingsRow rowId="general.autoSave">
        <span>control</span>
      </SettingsRow>
    </SettingsSectionHeading>,
  );
  const section = host.querySelector("section.settings-section");
  expect(section?.querySelector(".settings-section__head h2")?.textContent).toBe("Editing");
  expect(section?.querySelector(".settings-group > .settings-row")).not.toBeNull();
});

it("lets a row override its registry description", () => {
  mount(
    <SettingsRow description="Checked 4m ago." rowId="general.appUpdates">
      <span>control</span>
    </SettingsRow>,
  );
  expect(host.querySelector(".settings-row__description")?.textContent).toBe("Checked 4m ago.");
});
```

(`mount`/`host` are the helpers already used in that file; reuse its existing render helper name.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/WorkbenchSettingsScreen.test.tsx src/components/settings/primitives/settingsPrimitives.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rebuild the primitives**

`primitives/SettingsSectionHeading.tsx`:

```tsx
import { useId, type ReactNode } from "react";

export interface SettingsSectionHeadingProps {
  readonly actions?: ReactNode;
  readonly bare?: boolean;
  readonly children: ReactNode;
  readonly title: string;
}

export function SettingsSectionHeading({
  actions,
  bare = false,
  children,
  title,
}: SettingsSectionHeadingProps) {
  const headingId = `${useId()}-heading`;

  return (
    <section aria-labelledby={headingId} className="settings-section">
      <header className="settings-section__head">
        <h2 className="settings-section__title" id={headingId}>
          {title}
        </h2>
        {actions === undefined ? null : <div className="settings-section__actions">{actions}</div>}
      </header>
      {bare ? children : <div className="settings-group">{children}</div>}
    </section>
  );
}
```

`primitives/SettingsRow.tsx`: add `readonly description?: ReactNode;` to the props, destructure it, compute `const descriptionText = description ?? descriptor.description;` and `const descriptionId = descriptionText === null ? null : `${baseId}-description`;`, and render `{descriptionText}` inside the existing `<p className="settings-row__description">`. The rest of the markup stays (`.settings-row`, `__text`, `__head`, `__title`, `__description`, `__control`).

- [ ] **Step 4: Rebuild the shell**

`SettingsExitButton.tsx`:

```tsx
import { ArrowLeft } from "lucide-react";

export interface SettingsExitButtonProps {
  onExit(): void;
}

export function SettingsExitButton({ onExit }: SettingsExitButtonProps) {
  return (
    <button className="settings-nav__item" onClick={onExit} type="button">
      <ArrowLeft aria-hidden="true" size={16} />
      Back
    </button>
  );
}
```

`SettingsSearchInput.tsx`: replace the `SettingsKbd` import and usage with the foundation `Kbd` (`import { Kbd } from "../../ui/foundation/Kbd";` and `<Kbd>/</Kbd>`); keep every input attribute.

`SettingsSectionSidebar.tsx`: change only the returned wrapper so the column carries a top bar, the search, the nav and a footer:

```tsx
return (
  <aside aria-label="Settings" className="settings-nav-column">
    <TopBar label="Settings navigation" region="sidebar" />
    <div className="settings-nav-column__body">
      {search}
      {results}
      <div
        aria-label="Settings sections"
        aria-orientation="vertical"
        className="settings-nav"
        hidden={searching}
        role="tablist"
      >
        {/* existing SETTINGS_SECTIONS.map(...) unchanged */}
      </div>
    </div>
    <div className="settings-nav-column__foot">
      <SettingsExitButton onExit={onExit} />
    </div>
  </aside>
);
```

(Write the existing `SETTINGS_SECTIONS.map` block in place of the JSX comment; no comment may remain in the source. Add `import { TopBar } from "../../ui/shell/TopBar";`.)

`WorkbenchSettingsScreen.tsx`: replace the returned JSX with:

```tsx
return (
  <div className="settings-screen" ref={surfaceRef}>
    <SettingsSectionSidebar
      activeSection={section}
      onExit={onClose}
      onSelectSection={selectSection}
      panelId={SETTINGS_PANEL_ID}
      results={
        <SettingsSearchResults
          activeIndex={search.activeIndex}
          hidden={!search.searching}
          hits={search.hits}
          id={SETTINGS_RESULTS_ID}
          onActivate={search.setActiveIndex}
          onSelect={search.selectHit}
        />
      }
      search={
        <SettingsSearchInput
          activeOptionId={search.activeOptionId}
          expanded={search.searching}
          inputRef={searchInputRef}
          onKeyDown={search.handleKeyDown}
          onQueryChange={search.setQuery}
          query={search.query}
          resultsId={SETTINGS_RESULTS_ID}
        />
      }
      searching={search.searching}
    />
    <main className="settings-main">
      <TopBar
        label="Settings"
        region="main"
        trailing={<SettingsPageActions actions={actions} draft={draft} env={env} section={section} />}
      >
        <h1 className="settings-crumb" ref={headingRef} tabIndex={-1}>
          <span className="settings-crumb__parent">Settings</span>
          <span aria-hidden="true" className="settings-crumb__sep">
            /
          </span>
          <span className="settings-crumb__here">{settingsSectionDescriptor(section).label}</span>
        </h1>
      </TopBar>
      <div
        aria-labelledby={settingsSectionTabId(section)}
        className="settings-screen__page"
        data-settings-page-scroll=""
        id={SETTINGS_PANEL_ID}
        role="tabpanel"
      >
        <div className="settings-screen__inner">
          <SettingsTargetContext.Provider value={target}>
            <SettingsPageHost actions={actions} draft={draft} env={env} section={section} />
          </SettingsTargetContext.Provider>
        </div>
      </div>
    </main>
  </div>
);
```

Imports to add: `TopBar` from `../../ui/shell/TopBar`, `SettingsPageActions` from `./SettingsPageActions`, `settingsSectionDescriptor` from `./settingsRegistry`.

- [ ] **Step 5: Write the failing page-actions test, then implement**

```tsx
// src/components/settings/SettingsPageActions.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import { SettingsPageActions } from "./SettingsPageActions";
import type { SettingsDraft, SettingsDraftActions, SettingsEnvironment } from "./settingsPageProps";

describe("SettingsPageActions", () => {
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

  it("restores General visual defaults without touching providers or keymap", () => {
    const updateAppSettings = vi.fn();
    const appSettings = {
      ...defaultAppSettings(),
      editorFontSize: 22,
      appearance: { palette: "zinc-orange" as const, colorScheme: "light" as const, syntaxTheme: "dracula" as const },
      agentCliKind: "codex" as const,
    };
    act(() =>
      root.render(
        <SettingsPageActions
          actions={actionsWith({ updateAppSettings })}
          draft={draftWith(appSettings)}
          env={{} as SettingsEnvironment}
          section="general"
        />,
      ),
    );
    act(() => buttonNamed("Restore defaults")?.click());
    const restored = updateAppSettings.mock.calls[0]?.[0];
    expect(restored.editorFontSize).toBe(defaultAppSettings().editorFontSize);
    expect(restored.appearance).toEqual(defaultAppSettings().appearance);
    expect(restored.agentCliKind).toBe("codex");
  });

  it("renders nothing for sections without page actions", () => {
    act(() =>
      root.render(
        <SettingsPageActions
          actions={actionsWith({})}
          draft={draftWith(defaultAppSettings())}
          env={{} as SettingsEnvironment}
          section="snippets"
        />,
      ),
    );
    expect(host.textContent).toBe("");
  });

  function buttonNamed(name: string): HTMLButtonElement | null {
    return [...host.querySelectorAll("button")].find((button) => button.textContent === name) ?? null;
  }
});

function draftWith(appSettings: SettingsDraft["appSettings"]): SettingsDraft {
  return { appSettings, ignorePatternsText: "", trusted: false, workspaceSettings: defaultWorkspaceSettings() };
}

function actionsWith(overrides: Partial<SettingsDraftActions>): SettingsDraftActions {
  return {
    publishAppSettings: vi.fn(),
    save: vi.fn(),
    updateAppSettings: vi.fn(),
    updateIgnorePatternsText: vi.fn(),
    updateTrusted: vi.fn(),
    updateWorkspaceSettings: vi.fn(),
    ...overrides,
  };
}
```


Implement `src/components/settings/pages/generalDefaults.ts`:

```ts
import { defaultAppSettings, type AppSettings } from "../../../domain/settings";

export function restoreGeneralAppDefaults(current: AppSettings): AppSettings {
  const defaults = defaultAppSettings();
  return {
    ...current,
    appearance: defaults.appearance,
    agentThreadFontSize: defaults.agentThreadFontSize,
    editorFontFamily: defaults.editorFontFamily,
    editorFontLigatures: defaults.editorFontLigatures,
    editorFontSize: defaults.editorFontSize,
    minimapEnabled: defaults.minimapEnabled,
    runtimePolicy: defaults.runtimePolicy,
    terminalShellIntegrationEnabled: defaults.terminalShellIntegrationEnabled,
    wordWrapEnabled: defaults.wordWrapEnabled,
  };
}
```

Add `src/components/settings/pages/generalDefaults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultAppSettings } from "../../../domain/settings";
import { restoreGeneralAppDefaults } from "./generalDefaults";

describe("restoreGeneralAppDefaults", () => {
  it("resets only the General page app settings", () => {
    const current = {
      ...defaultAppSettings(),
      editorFontSize: 30,
      minimapEnabled: true,
      appUpdateChannel: "stable" as const,
      agentModelFavoriteKeys: ["claudeCode/claude-opus-5-5" as const],
    };
    const restored = restoreGeneralAppDefaults(current);
    expect(restored.editorFontSize).toBe(defaultAppSettings().editorFontSize);
    expect(restored.minimapEnabled).toBe(false);
    expect(restored.appUpdateChannel).toBe("stable");
    expect(restored.agentModelFavoriteKeys).toEqual(current.agentModelFavoriteKeys);
  });
});
```

(The update channel is deliberately not restored: switching channel is an explicit decision.) If `AgentModelFavoriteKey` literal typing rejects the literal, build the key with `agentModelFavoriteKey("claudeCode", "claude-opus-5-5")` from `src/components/agentMode/agentLaunchPresentation.ts`.

Implement `src/components/settings/SettingsPageActions.tsx`:

```tsx
import { RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { AGENT_PROVIDERS } from "./agentProviderSettingsPersistence";
import { restoreGeneralAppDefaults } from "./pages/generalDefaults";
import type { SettingsPageProps } from "./settingsPageProps";
import type { SettingsSectionId } from "./settingsRegistry";
import { UsagePageActions } from "./pages/UsageSettingsPage";

export interface SettingsPageActionsProps extends SettingsPageProps {
  readonly section: SettingsSectionId;
}

export function SettingsPageActions({ actions, draft, env, section }: SettingsPageActionsProps) {
  switch (section) {
    case "general":
      return (
        <Button
          icon={<RotateCcw aria-hidden="true" size={14} />}
          onClick={() => actions.updateAppSettings(restoreGeneralAppDefaults(draft.appSettings))}
          size="sm"
          variant="ghost"
        >
          Restore defaults
        </Button>
      );
    case "agents":
      return (
        <Button
          disabled={env.providerManagement === null}
          icon={<RefreshCw aria-hidden="true" size={14} />}
          onClick={() => {
            for (const provider of AGENT_PROVIDERS) void env.providerManagement?.refresh(provider);
          }}
          size="sm"
          variant="ghost"
        >
          Run CLI diagnostics
        </Button>
      );
    case "usage":
      return <UsagePageActions env={env} />;
    case "environments":
    case "keymap":
    case "index":
    case "snippets":
    case "archive":
    case "php":
      return null;
    default:
      return section satisfies never;
  }
}
```

`UsagePageActions` does not exist until Task 9. For Task 5 add to the Task 4 stub file `pages/UsageSettingsPage.tsx`:

```tsx
import type { SettingsEnvironment } from "../settingsPageProps";

export function UsagePageActions(_props: { readonly env: SettingsEnvironment }) {
  return null;
}
```

Remove the now duplicated "Run CLI diagnostics" button from the `SettingsSectionHeading` actions in `AgentsSettingsPage.tsx` (keep the `providerChecksSummaryLabel` note there).

- [ ] **Step 6: Rewrite the stylesheet tokens and layout**

In `settings.css` replace lines 1-44 (the `.settings-screen` block) with:

```css
.settings-screen {
  --settings-bg: var(--cv-canvas);
  --settings-sidebar: var(--cv-side);
  --settings-surface: var(--cv-raised);
  --settings-well: var(--cv-tint-1);
  --settings-fg: var(--cv-fg-strong);
  --settings-body-fg: var(--cv-fg);
  --settings-muted-fg: var(--cv-fg-muted);
  --settings-subtle-fg: var(--cv-fg-subtle);
  --settings-disabled-fg: var(--cv-fg-disabled);
  --settings-field-bg: var(--cv-tint-1);
  --settings-primary: var(--cv-accent-fill);
  --settings-primary-fg: var(--cv-on-accent);
  --settings-primary-soft: var(--cv-accent-soft);
  --settings-success: var(--cv-ok);
  --settings-warning: var(--cv-warn);
  --settings-danger: var(--cv-danger);
  --settings-row-hover: var(--cv-row-hover);
  --settings-row-selected: var(--cv-row-active);
  --settings-popover: var(--cv-popover);
  --settings-r-sm: var(--cv-r-sm);
  --settings-r-md: var(--cv-r-control);
  --settings-r-lg: var(--cv-r-card);
  --settings-r-xl: var(--cv-r-group);
  --settings-r-pill: var(--cv-r-pill);
  --settings-mono: var(--cv-font-mono);
  --settings-sans: var(--cv-font-ui);
  --settings-card-shadow: none;
  --settings-popup-shadow: var(--cv-shadow-pop);
  --settings-focus-ring: var(--cv-ring-focus);
  --settings-page-max: 896px;

  display: grid;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--cv-canvas);
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-ui);
  font-size: var(--cv-t-sm);
  grid-template-columns: var(--cv-sidebar-w) minmax(0, 1fr);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
```

Delete these rule groups from `settings.css` (they move to `settingsShell.css`): `.settings-screen__sidebar`, `.app-shell--agent-mode .settings-screen__sidebar`, `.settings-back*`, `.settings-search*`, `.settings-nav*`, `.settings-screen__page`, `.settings-screen__inner`, `.settings-screen__title`, `.settings-section*`, `.settings-row*` (including `.settings-row + .settings-row`), `.settings-switch*`. Then replace every remaining `var(--codevo-…)` with the matching token from this table and confirm with `grep -c "var(--codevo-" src/components/settings/settings.css` printing `0`:

| legacy | token |
|---|---|
| `--codevo-canvas` | `--cv-canvas` |
| `--codevo-side` | `--cv-side` |
| `--codevo-raised` | `--cv-raised` |
| `--codevo-well` | `--cv-tint-1` |
| `--codevo-hover` | `--cv-row-hover` |
| `--codevo-active` | `--cv-row-active` |
| `--codevo-fg-strong` / `-fg` / `-fg-muted` / `-fg-subtle` / `-fg-disabled` | `--cv-fg-strong` / `--cv-fg` / `--cv-fg-muted` / `--cv-fg-subtle` / `--cv-fg-disabled` |
| `--codevo-primary` / `-primary-fg` / `-primary-soft` | `--cv-accent-fill` / `--cv-on-accent` / `--cv-accent-soft` |
| `--codevo-ok` / `-warn` / `-danger` | `--cv-ok` / `--cv-warn` / `--cv-danger` |
| `--codevo-danger-soft` | `color-mix(in srgb, var(--cv-danger) 12%, transparent)` |
| `--codevo-r-sm` / `-r-md` / `-r-lg` / `-r-xl` / `-r-pill` | `--cv-r-sm` / `--cv-r-control` / `--cv-r-card` / `--cv-r-group` / `--cv-r-pill` |
| `--codevo-mono` / `-sans` | `--cv-font-mono` / `--cv-font-ui` |
| `--codevo-shadow-card` | `none` |
| `--codevo-shadow-float` | `--cv-shadow-pop` |
| `--codevo-focus-ring` | `--cv-ring-focus` |
| `--codevo-separator-inset` | `var(--cv-hair)` as a plain border color |

Create `src/components/settings/settingsShell.css` (all values from the mockup `screen-settings-pickers` block, mapped to tokens):

```css
.settings-nav-column {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--cv-side);
  box-shadow: inset -1px 0 0 var(--cv-hair);
}

.settings-nav-column__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--cv-space-1);
  overflow: auto;
  padding: 0 var(--cv-space-4);
}

.settings-nav-column__foot {
  padding: var(--cv-space-3) var(--cv-space-4) var(--cv-space-5);
}

.settings-search {
  display: flex;
  height: 32px;
  flex: none;
  align-items: center;
  margin-bottom: var(--cv-space-3);
  padding: 0 var(--cv-space-4);
  border-radius: var(--cv-r-sm);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  gap: var(--cv-space-4);
}

.settings-search:hover,
.settings-search:focus-within {
  background: var(--cv-tint-1);
}

.settings-search:focus-within {
  box-shadow: var(--cv-ring-hair-strong);
}

.settings-search__input {
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  background: none;
  color: var(--cv-fg-strong);
  font: inherit;
}

.settings-search__input::placeholder {
  color: var(--cv-fg-subtle);
}

.settings-search__input:focus-visible {
  outline: none;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: var(--cv-space-1);
}

.settings-nav__item {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  padding: 0 var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  gap: var(--cv-space-4);
  text-align: left;
}

.settings-nav__item > svg {
  color: var(--cv-fg-subtle);
}

.settings-nav__item:hover {
  background: var(--cv-row-hover);
  color: var(--cv-fg-strong);
}

.settings-nav__item[aria-selected="true"] {
  background: var(--cv-row-active);
  color: var(--cv-fg-strong);
}

.settings-nav__item[aria-selected="true"] > svg {
  color: var(--cv-fg-strong);
}

.settings-nav__item:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.settings-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.settings-crumb {
  display: flex;
  min-width: 0;
  align-items: center;
  margin: 0;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  gap: var(--cv-space-4);
}

.settings-crumb:focus-visible {
  outline: none;
}

.settings-crumb__parent,
.settings-crumb__sep {
  color: var(--cv-fg-subtle);
}

.settings-screen__page {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.settings-screen__inner {
  display: flex;
  max-width: var(--settings-page-max);
  flex-direction: column;
  margin: 0 auto;
  padding: var(--cv-space-7) var(--cv-space-7) 48px;
  gap: var(--cv-space-8);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-section__head {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--cv-space-6);
  gap: var(--cv-space-6);
}

.settings-section__title {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-sm);
  font-weight: 400;
  gap: var(--cv-space-4);
  letter-spacing: -0.005em;
}

.settings-section__actions {
  display: flex;
  align-items: center;
  gap: var(--cv-space-3);
}

.settings-section__note {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.settings-group {
  border: 1px solid var(--cv-hair);
  border-radius: var(--cv-r-group);
  background: var(--cv-tint-1);
}

:root[data-cv-scheme="light"] .settings-group {
  background: var(--cv-raised);
}

.settings-group > * + * {
  border-top: 1px solid var(--cv-hair);
}

.settings-row {
  display: grid;
  align-items: center;
  padding: var(--cv-space-5) var(--cv-space-6);
  gap: var(--cv-space-8);
  grid-template-columns: minmax(0, 1fr) auto;
}

.settings-row[data-layout="stacked"] {
  display: block;
}

.settings-row[data-layout="stacked"] > .settings-row__control {
  justify-content: flex-start;
  margin-top: var(--cv-space-5);
}

.settings-row:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.settings-row[data-target] {
  animation: settings-target-pulse var(--cv-motion-slow) var(--cv-ease) 2;
}

@keyframes settings-target-pulse {
  50% {
    background: var(--cv-accent-soft);
  }
}

.settings-row__head {
  display: flex;
  min-height: 20px;
  align-items: center;
  gap: var(--cv-space-3);
}

.settings-row__title {
  margin: 0;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  letter-spacing: -0.005em;
}

.settings-row__meta {
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
}

.settings-row__description {
  max-width: 576px;
  margin: var(--cv-space-2) 0 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-md);
  line-height: 1.45;
}

.settings-row__description code {
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
}

.settings-row__control {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--cv-space-4);
}

.settings-switch {
  position: relative;
  width: 30px;
  height: 18px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-pill);
  background: var(--cv-switch-track);
  box-shadow: var(--cv-switch-edge);
  transition: background-color var(--cv-motion-base);
}

.settings-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--cv-switch-knob);
  box-shadow: var(--cv-shadow-knob);
  transition: transform var(--cv-motion-base) var(--cv-ease);
}

.settings-switch[data-state="on"] {
  background: var(--cv-accent-fill);
}

.settings-switch[data-state="on"] .settings-switch__thumb {
  transform: translateX(12px);
}

.settings-switch:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.settings-switch:disabled {
  opacity: 0.5;
}
```

In `src/App.css` add `@import "./components/settings/settingsShell.css";` directly after the `settings.css` import. In `src/components/cssBorderAllowlist.ts` remove the `SEPARATOR_INSET_CONSUMERS` entry for `.settings-row + .settings-row` (the selector no longer exists); keep the `.settings-provider + .settings-provider` entry until Task 7.

- [ ] **Step 7: Run the focused tests and the CSS contract suites**

Run: `npx vitest run src/components/settings src/components/cssTokenContract.test.ts src/ui/tokens src/domain/themeContrast.test.ts`
Expected: PASS. If a CSS contract test reports a removed selector still listed in an allowlist, delete that allowlist entry (allowlists only shrink); if it reports a new colour literal, replace it with a token.

- [ ] **Step 8: Report changed files to the lead.**

---
### Task 6: General page (theme cards, text & editor, updates with track, workspace, editing, editor status items)

**Files:**
- Create: `src/components/settings/pages/GeneralThemeSection.tsx`, `src/components/settings/pages/GeneralTextEditorRows.tsx`, `src/components/settings/pages/useMonospaceFontFamilies.ts`
- Modify: `pages/GeneralSettingsPage.tsx`, `pages/GeneralSettingsPage.test.tsx`, `pages/GeneralAppUpdateRows.tsx`, `pages/GeneralAppUpdateRows.test.tsx`, `pages/GeneralStatusBarRows.tsx`, `pages/AppearancePaletteSwatches.tsx`, `pages/AppearancePaletteSwatches.test.tsx`, `settingsRegistryRows.ts` (`general.appUpdates` title), `settings.css` (palette card rules replace `.settings-swatch*`, update rules)
- Delete: `pages/AppearanceSettingsPage.tsx`; move the still-relevant cases of `pages/AppearanceSettingsPage.test.tsx` into `GeneralSettingsPage.test.tsx` and delete the old test file

**Interfaces:**
- Consumes: `AppUpdateChannel`, `APP_UPDATE_CHANNELS`, `APP_UPDATE_CHANNEL_LABELS`, `isAppUpdateChannel` (Task 1); `SettingsRow.description`, `SettingsSectionHeading.bare` (Task 5); foundation `SegmentedControl`, `Stepper`.
- Produces: `GeneralAppUpdateRows({ updater, channel, onChangeChannel })`; `useMonospaceFontFamilies(gateway, currentFamily): { options; refresh() }` (moved verbatim from `AppearanceSettingsPage.tsx`).

- [ ] **Step 1: Write the failing General page tests**

Add to `pages/GeneralSettingsPage.test.tsx` (reuse its existing `render(props)` helper and `SettingsPageProps` fixtures; add `appUpdater: null` in the env fixture if missing):

```tsx
it("renders the mockup sections in order", () => {
  render();
  expect([...host.querySelectorAll(".settings-section__title")].map((node) => node.textContent)).toEqual([
    "Theme",
    "Text & editor",
    "Updates",
    "Workspace",
    "Editing",
    "Editor header items",
  ]);
});

it("switches the appearance mode from the Theme header", () => {
  const updateAppSettings = vi.fn();
  render({ actions: { updateAppSettings } });
  act(() => radioNamed("Light")?.click());
  expect(updateAppSettings.mock.calls[0]?.[0].appearance.colorScheme).toBe("light");
});

it("selects a palette card and exposes the six palettes as a radiogroup", () => {
  const updateAppSettings = vi.fn();
  render({ actions: { updateAppSettings } });
  const group = host.querySelector('[role="radiogroup"][aria-label="Palette"]');
  expect(group?.querySelectorAll('[role="radio"]').length).toBe(6);
  act(() => radioNamed("Ink · Mint palette")?.click());
  expect(updateAppSettings.mock.calls[0]?.[0].appearance.palette).toBe("ink-mint");
});

it("changes the update track through a closed select", () => {
  const updateAppSettings = vi.fn();
  render({ actions: { updateAppSettings } });
  const select = host.querySelector<HTMLSelectElement>('[data-settings-row="general.updateChannel"] select');
  act(() => {
    if (select === null) return;
    select.value = "stable";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(updateAppSettings.mock.calls[0]?.[0].appUpdateChannel).toBe("stable");
});

it("toggles the sidebar attention item in editor status items", () => {
  const updateWorkspaceSettings = vi.fn();
  render({ actions: { updateWorkspaceSettings }, env: { hasWorkspace: true } });
  const toggle = host.querySelector<HTMLButtonElement>('[data-settings-row="general.threadAttention"] [role="switch"]');
  act(() => toggle?.click());
  expect(updateWorkspaceSettings.mock.calls[0]?.[0].statusBar.agentAttention).toBe(
    !defaultWorkspaceSettings().statusBar.agentAttention,
  );
});

function radioNamed(name: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`[role="radio"][aria-label="${name}"]`) ??
    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((node) => node.textContent === name) ??
    null;
}
```

(If the file's `render` helper takes no overrides, extend it to accept `{ actions?: Partial<SettingsDraftActions>; env?: Partial<SettingsEnvironment> }` merged over its fixtures.)

Replace the first two tests in `GeneralAppUpdateRows.test.tsx` so they target the new row (title "Codevo", version meta, status as description):

```tsx
it("renders the version row and the update track without an implicit check", () => {
  const updater = updaterSurface({ kind: "idle", currentVersion: "0.2.0-beta.1" });
  render(updater);
  expect(host.querySelector('[data-settings-row="general.appUpdates"] .settings-row__title')?.textContent).toBe("Codevo");
  expect(host.querySelector('[data-settings-row="general.appUpdates"] .settings-row__meta')?.textContent).toBe("0.2.0-beta.1");
  expect(host.querySelector<HTMLSelectElement>('[data-settings-row="general.updateChannel"] select')?.value).toBe("beta");
  expect(updater.check).not.toHaveBeenCalled();
  act(() => button("Check for updates").click());
  expect(updater.check).toHaveBeenCalledOnce();
});
```

and make the file's `render(updater)` helper render `<GeneralAppUpdateRows channel="beta" onChangeChannel={vi.fn()} updater={updater} />`. In the "available" test replace the `"Available version"` text assertion with `expect(host.querySelector('[data-settings-row="general.appUpdates"] .settings-row__description')?.textContent).toBe("Codevo 0.2.0 is available.")`.

In `AppearancePaletteSwatches.test.tsx` change selectors `.settings-swatch` to `.settings-palette-card` and add:

```tsx
it("shows each palette name with a check on the selected card", () => {
  render("graphite-teal", "dark");
  const selected = host.querySelector('.settings-palette-card[aria-checked="true"]');
  expect(selected?.textContent).toContain("Graphite · Teal");
  expect(selected?.querySelector(".settings-palette-card__check")).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/pages/GeneralSettingsPage.test.tsx src/components/settings/pages/GeneralAppUpdateRows.test.tsx src/components/settings/pages/AppearancePaletteSwatches.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Palette cards**

Replace the `return (...)` of `AppearancePaletteSwatches` with (keep `nextPalette`, `move` and the props):

```tsx
return (
  <div
    aria-label="Palette"
    className="settings-palettes"
    onKeyDown={move}
    ref={groupRef}
    role="radiogroup"
  >
    {PALETTE_IDS.map((palette) => {
      const selected = palette === value;
      return (
        <button
          aria-checked={selected}
          aria-label={`${PALETTE_LABELS[palette]} palette`}
          className="settings-palette-card"
          data-value={palette}
          key={palette}
          onClick={() => onChange(palette)}
          role="radio"
          style={paletteCardStyle(palette, scheme)}
          tabIndex={selected ? 0 : -1}
          type="button"
        >
          <span aria-hidden="true" className="settings-palette-card__wire">
            <span className="settings-palette-card__side">
              <i data-strong="true" />
              <i />
              <i />
            </span>
            <span className="settings-palette-card__main">
              <i data-bubble="true" />
              <i />
              <span className="settings-palette-card__composer" />
            </span>
          </span>
          <span className="settings-palette-card__name">
            <span aria-hidden="true" className="settings-palette-card__dot" />
            {PALETTE_LABELS[palette]}
            {selected ? <Check aria-hidden="true" className="settings-palette-card__check" size={14} /> : null}
          </span>
        </button>
      );
    })}
  </div>
);
```

and add:

```tsx
function paletteCardStyle(palette: PaletteId, scheme: ResolvedColorScheme): CSSProperties {
  return {
    ["--settings-wire-canvas" as string]: surfaceColor(palette, scheme, "canvas"),
    ["--settings-wire-side" as string]: surfaceColor(palette, scheme, "side"),
    ["--settings-wire-raised" as string]: surfaceColor(palette, scheme, "raised"),
    ["--settings-wire-accent" as string]: paletteTokens(palette, scheme).accentFill,
  };
}
```

(imports: `Check` from `lucide-react`, `type CSSProperties` from `react`). The existing test for `aria-label` must now expect `"<label> palette"`; update it.

Replace the `.settings-swatch*` rules in `settings.css` with:

```css
.settings-palettes {
  display: grid;
  gap: var(--cv-space-4);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.settings-palette-card {
  display: flex;
  flex-direction: column;
  padding: var(--cv-space-4) var(--cv-space-4) 10px;
  border: 0;
  border-radius: var(--cv-r-group);
  background: var(--cv-tint-1);
  box-shadow: var(--cv-ring-hair);
  gap: var(--cv-space-4);
  text-align: left;
}

:root[data-cv-scheme="light"] .settings-palette-card {
  background: var(--cv-raised);
}

.settings-palette-card:hover {
  background: var(--cv-tint-2);
}

.settings-palette-card[aria-checked="true"] {
  box-shadow: inset 0 0 0 1.5px var(--cv-focus);
}

.settings-palette-card:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.settings-palette-card__wire {
  display: flex;
  height: 72px;
  overflow: hidden;
  border-radius: var(--cv-r-control);
  background: var(--settings-wire-canvas);
  box-shadow: var(--cv-ring-hair-strong);
}

.settings-palette-card__side {
  display: flex;
  width: 30%;
  flex-direction: column;
  padding: 10px var(--cv-space-4);
  background: var(--settings-wire-side);
  gap: var(--cv-space-3);
}

.settings-palette-card__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: var(--cv-space-5) 14px;
  gap: var(--cv-space-3);
}

.settings-palette-card__wire i {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--cv-hair-strong);
}

.settings-palette-card__wire i[data-strong="true"] {
  background: var(--cv-fg-subtle);
}

.settings-palette-card__wire i[data-bubble="true"] {
  width: 46%;
  height: 12px;
  align-self: flex-end;
  border-radius: var(--cv-r-sm);
}

.settings-palette-card__composer {
  position: relative;
  height: 20px;
  margin-top: auto;
  border-radius: 7px;
  background: var(--settings-wire-raised);
  box-shadow: var(--cv-ring-hair-strong);
}

.settings-palette-card__composer::after {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--settings-wire-accent);
  content: "";
}

.settings-palette-card__name {
  display: flex;
  align-items: center;
  padding: 0 var(--cv-space-1);
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  font-weight: 500;
  gap: var(--cv-space-4);
}

.settings-palette-card[aria-checked="true"] .settings-palette-card__name {
  color: var(--cv-fg-strong);
}

.settings-palette-card__dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
  background: var(--settings-wire-accent);
}

.settings-palette-card__check {
  margin-left: auto;
  color: var(--cv-accent);
}
```

- [ ] **Step 4: Theme section and Text & editor rows**

Move `useMonospaceFontFamilies` (and its `MonospaceFontFamilies` interface) verbatim from `AppearanceSettingsPage.tsx` into `pages/useMonospaceFontFamilies.ts` and export it.

```tsx
// src/components/settings/pages/GeneralThemeSection.tsx
import {
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  resolveColorScheme,
  type AppearanceSettings,
} from "../../../domain/appearance";
import { usePrefersLightTheme } from "../../../application/usePrefersLightTheme";
import { SegmentedControl } from "../../../ui/foundation/SegmentedControl";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
import { AppearancePaletteSwatches } from "./AppearancePaletteSwatches";

const MODE_OPTIONS = COLOR_SCHEME_PREFERENCES.map((value) => ({
  value,
  label: COLOR_SCHEME_LABELS[value],
}));

export function GeneralThemeSection({ actions, draft }: SettingsPageProps) {
  const appSettings = draft.appSettings;
  const prefersLight = usePrefersLightTheme();
  const scheme = resolveColorScheme(appSettings.appearance.colorScheme, prefersLight);
  const paletteRef = useSettingsRowTarget("appearance.palette");
  const modeRef = useSettingsRowTarget("appearance.colorScheme");
  const update = (patch: Partial<AppearanceSettings>): void =>
    actions.updateAppSettings({
      ...appSettings,
      appearance: { ...appSettings.appearance, ...patch },
    });

  return (
    <SettingsSectionHeading
      actions={
        <div data-settings-row="appearance.colorScheme" ref={modeRef} tabIndex={-1}>
          <SegmentedControl
            label="Appearance mode"
            onChange={(colorScheme) => update({ colorScheme })}
            options={MODE_OPTIONS}
            value={appSettings.appearance.colorScheme}
          />
        </div>
      }
      bare
      title="Theme"
    >
      <div data-settings-row="appearance.palette" ref={paletteRef} tabIndex={-1}>
        <AppearancePaletteSwatches
          onChange={(palette) => update({ palette })}
          scheme={scheme}
          value={appSettings.appearance.palette}
        />
      </div>
    </SettingsSectionHeading>
  );
}
```

`GeneralTextEditorRows.tsx` is the second `SettingsSectionHeading` of today's `AppearanceSettingsPage` plus its thread font size and syntax theme rows, under the title `"Text & editor"`, in this row order: `appearance.agentThreadFontSize`, `appearance.editorFontFamily`, `appearance.editorFontSize`, `appearance.syntaxTheme`, `appearance.editorFontLigatures`, `appearance.minimap`, `appearance.wordWrap`. Replace the two `SettingsNumberField` controls with the foundation stepper:

```tsx
<SettingsRow rowId="appearance.agentThreadFontSize">
  <Stepper
    label="Thread text size"
    max={MAX_AGENT_THREAD_FONT_SIZE}
    min={MIN_AGENT_THREAD_FONT_SIZE}
    onChange={(value) =>
      actions.updateAppSettings({
        ...appSettings,
        agentThreadFontSize: normalizeAgentThreadFontSize(value),
      })
    }
    unit="px"
    value={appSettings.agentThreadFontSize}
  />
</SettingsRow>
```

and the same shape for `appearance.editorFontSize` (`label="Editor font size"`, `minEditorFontSize`/`maxEditorFontSize`, `normalizeEditorFontSize`). The font family row keeps `SettingsSelect` + the "Refresh list" `SettingsButton`; the syntax theme row keeps `SettingsSelect` with `SYNTAX_THEME_OPTIONS`; the three switches keep `SettingsSwitch`. Then delete `pages/AppearanceSettingsPage.tsx`.

- [ ] **Step 5: Updates section with the track**

In `settingsRegistryRows.ts` change the `general.appUpdates` title to `"Codevo"`. Replace `GeneralAppUpdateRows` and `AppUpdateControl` (keep `AppUpdateAction`, `appUpdaterPresentation`, `presentation`, `AppUpdateNotes` unchanged):

```tsx
export interface GeneralAppUpdateRowsProps {
  readonly channel: AppUpdateChannel;
  readonly updater: AppUpdaterSurface | null;
  onChangeChannel(channel: AppUpdateChannel): void;
}

const CHANNEL_OPTIONS = APP_UPDATE_CHANNELS.map((value) => ({
  value,
  label: APP_UPDATE_CHANNEL_LABELS[value],
}));

export function GeneralAppUpdateRows({ channel, onChangeChannel, updater }: GeneralAppUpdateRowsProps) {
  return (
    <SettingsSectionHeading title="Updates">
      {updater === null ? (
        <SettingsRow description="Updates unavailable in this build." rowId="general.appUpdates">
          {null}
        </SettingsRow>
      ) : (
        <AppUpdateRow updater={updater} />
      )}
      <SettingsRow rowId="general.updateChannel">
        <SettingsSelect
          onChange={(value) => {
            if (!isAppUpdateChannel(value)) return;
            onChangeChannel(value);
          }}
          options={CHANNEL_OPTIONS}
          value={channel}
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}

function AppUpdateRow({ updater }: { readonly updater: AppUpdaterSurface }) {
  const presentation = appUpdaterPresentation(updater.state);
  const description =
    presentation.status ??
    (presentation.version === null ? "Check for a new Codevo release." : `Codevo ${presentation.version} is available.`);
  return (
    <>
      <SettingsRow
        description={<span aria-live="polite">{description}</span>}
        meta={<code className="settings-row__meta">{updater.state.currentVersion}</code>}
        rowId="general.appUpdates"
      >
        {presentation.skippable ? (
          <SettingsButton onClick={() => void updater.skipVersion()} variant="ghostMuted">
            Skip this version
          </SettingsButton>
        ) : null}
        <AppUpdateAction presentation={presentation} updater={updater} />
      </SettingsRow>
      <AppUpdateNotes span={presentation.notesSpan} />
    </>
  );
}
```

Imports: `APP_UPDATE_CHANNELS`, `APP_UPDATE_CHANNEL_LABELS`, `isAppUpdateChannel`, `type AppUpdateChannel` from `../../../domain/appUpdateChannel`; `SettingsSelect`. Wrap the notes in the group by giving `.settings-update__notes`, `.settings-update__notes-span` `padding: var(--cv-space-5) var(--cv-space-6)` in `settings.css` (they render as a sibling row inside `.settings-group`). Delete the now unused `.settings-update__versions`, `.settings-update__version*`, `.settings-update__status*`, `.settings-update__actions` rules.

- [ ] **Step 6: Editor header items with the attention row**

In `GeneralStatusBarRows.tsx` change the section title to `"Editor header items"` and add after the chip row:

```tsx
<SettingsRow rowId="general.threadAttention">
  <SettingsSwitch
    checked={workspaceSettings.statusBar.agentAttention}
    disabled={!env.hasWorkspace}
    onChange={(agentAttention) =>
      actions.updateWorkspaceSettings({
        ...workspaceSettings,
        statusBar: { ...workspaceSettings.statusBar, agentAttention },
      })
    }
  />
</SettingsRow>
```

- [ ] **Step 7: Compose the page**

```tsx
// src/components/settings/pages/GeneralSettingsPage.tsx
import type { SettingsPageProps } from "../settingsPageProps";
import { GeneralAppUpdateRows } from "./GeneralAppUpdateRows";
import { GeneralEditingRows } from "./GeneralEditingRows";
import { GeneralStatusBarRows } from "./GeneralStatusBarRows";
import { GeneralTextEditorRows } from "./GeneralTextEditorRows";
import { GeneralThemeSection } from "./GeneralThemeSection";
import { GeneralWorkspaceRows } from "./GeneralWorkspaceRows";

export function GeneralSettingsPage(props: SettingsPageProps) {
  const appSettings = props.draft.appSettings;
  return (
    <>
      <GeneralThemeSection {...props} />
      <GeneralTextEditorRows {...props} />
      <GeneralAppUpdateRows
        channel={appSettings.appUpdateChannel}
        onChangeChannel={(appUpdateChannel) =>
          props.actions.updateAppSettings({ ...appSettings, appUpdateChannel })
        }
        updater={props.env.appUpdater}
      />
      <GeneralWorkspaceRows {...props} />
      <GeneralEditingRows {...props} />
      <GeneralStatusBarRows {...props} />
    </>
  );
}
```

`GeneralWorkspaceRows` and `GeneralEditingRows` keep their rows; change their section titles to `"Workspace"` and `"Editing"` if they differ, and replace `SettingsNumberField` for `general.defaultTabSize` with `Stepper` (`label="Tab size"`, `minWorkspaceTabSize`/`maxWorkspaceTabSize`).

- [ ] **Step 8: Run the focused tests**

Run: `npx vitest run src/components/settings`
Expected: PASS. `npm run check` exits 0 (no import of the deleted `AppearanceSettingsPage`).

- [ ] **Step 9: Report changed files to the lead.**

---

### Task 7: Providers page (cards, models with favorites and legacy, new threads, CLI updates)

**Files:**
- Create: `src/components/settings/AgentProviderModelsList.tsx`, `src/components/settings/AgentProviderModelsList.test.tsx`
- Modify: `AgentProviderCard.tsx`, `AgentProviderCard.test.tsx`, `AgentProviderCardDetails.tsx`, `agentProviderSettingsPersistence.ts`, `pages/AgentsSettingsPage.tsx`, `pages/AgentsSettingsPage.test.tsx`, `AgentThreadDefaultsRows.tsx`, `settings.css` (`.settings-provider*` rules), `src/components/cssBorderAllowlist.ts`

**Interfaces:**
- Consumes: `agentModelRows(provider, configuredModel, providerVersion, catalog)`, `agentModelRowIsFavorite(row, keys)`, `AgentModelRow` (with `isNew` from Task 13 if Task 13 already landed; otherwise render NEW only when `"isNew" in row && row.isNew === true`, and switch to the plain field after Task 13), `configuredProviderModel`, `configuredProviderVersion` from `src/components/agentMode/agentModelProviderState.ts` (P5), `useAgentClaudeModelCatalog()`.
- Produces: `withToggledModelFavorite(settings: AppSettings, key: AgentModelFavoriteKey): AppSettings | null`; `AgentProviderModelsList({ rows, favoriteKeys, onToggleFavorite })`; `AgentProviderCardProps` gains `favoriteKeys: ReadonlySet<string>` and `onToggleFavorite(key: AgentModelFavoriteKey): void`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/settings/AgentProviderModelsList.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentModelRows } from "../agentMode/agentLaunchPresentation";
import { AgentProviderModelsList } from "./AgentProviderModelsList";

describe("AgentProviderModelsList", () => {
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

  it("lists current models with ids and stars, and folds legacy models behind a toggle", () => {
    const rows = agentModelRows("claudeCode");
    const onToggleFavorite = vi.fn();
    act(() =>
      root.render(
        <AgentProviderModelsList
          favoriteKeys={new Set(["claudeCode/claude-opus-5-5"])}
          onToggleFavorite={onToggleFavorite}
          rows={rows}
        />,
      ),
    );
    const current = rows.filter((row) => row.isLegacy !== true && row.value !== "default");
    const legacyCount = rows.filter((row) => row.isLegacy === true).length;
    expect(host.querySelectorAll(".settings-models__row").length).toBe(current.length);
    expect(host.textContent).toContain("claude-opus-5-5");
    expect(
      host.querySelector('[aria-label="Favorite Claude Opus 5.5"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    const legacy = [...host.querySelectorAll("button")].find((node) =>
      node.textContent?.includes(`${legacyCount} legacy models`),
    );
    expect(legacy?.getAttribute("aria-expanded")).toBe("false");
    act(() => legacy?.click());
    expect(host.querySelectorAll(".settings-models__row").length).toBe(current.length + legacyCount);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Favorite Claude Sonnet 5"]')?.click());
    expect(onToggleFavorite).toHaveBeenCalledWith("claudeCode/claude-sonnet-5");
  });
});
```

Add to `src/components/settings/agentProviderSettingsPersistence.test.ts` (create the file if it does not exist, with the standard vitest imports):

```ts
it("toggles one favorite and bumps the revision", () => {
  const base = { ...defaultAppSettings(), agentModelFavoriteKeys: [], agentModelFavoritesRevision: 4 };
  const added = withToggledModelFavorite(base, "claudeCode/claude-opus-5-5");
  expect(added?.agentModelFavoriteKeys).toEqual(["claudeCode/claude-opus-5-5"]);
  expect(added?.agentModelFavoritesRevision).toBe(5);
  const removed = added === null ? null : withToggledModelFavorite(added, "claudeCode/claude-opus-5-5");
  expect(removed?.agentModelFavoriteKeys).toEqual([]);
  expect(removed?.agentModelFavoritesRevision).toBe(6);
});

it("refuses to add beyond the favorites limit", () => {
  const keys = Array.from({ length: MAX_AGENT_MODEL_FAVORITES }, (_, index) => `codex/model-${index}` as const);
  const full = { ...defaultAppSettings(), agentModelFavoriteKeys: keys, agentModelFavoritesRevision: 1 };
  expect(withToggledModelFavorite(full, "claudeCode/claude-opus-5-5")).toBeNull();
});
```

(If the `codex/model-${index}` template literal does not satisfy `AgentModelFavoriteKey`, build keys with `agentModelFavoriteKey("codex", ...)` using real `CODEX_MODEL_CHOICES` repeated with the Claude manifest choices until the limit is reached.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/settings/AgentProviderModelsList.test.tsx src/components/settings/agentProviderSettingsPersistence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the persistence helper**

```ts
export function withToggledModelFavorite(
  settings: AppSettings,
  key: AgentModelFavoriteKey,
): AppSettings | null {
  const revision = nextAgentModelFavoritesRevision(settings.agentModelFavoritesRevision);
  if (revision === null) return null;
  const current = settings.agentModelFavoriteKeys;
  if (current.includes(key)) {
    return {
      ...settings,
      agentModelFavoriteKeys: current.filter((candidate) => candidate !== key),
      agentModelFavoritesRevision: revision,
    };
  }
  if (current.length >= MAX_AGENT_MODEL_FAVORITES) return null;
  return {
    ...settings,
    agentModelFavoriteKeys: [...current, key],
    agentModelFavoritesRevision: revision,
  };
}
```

(imports `MAX_AGENT_MODEL_FAVORITES`, `type AgentModelFavoriteKey` from `../../domain/agentSettings`).

- [ ] **Step 4: Implement the models list**

```tsx
// src/components/settings/AgentProviderModelsList.tsx
import { ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import type { AgentModelFavoriteKey } from "../../domain/agentSettings";
import {
  agentModelRowIsFavorite,
  type AgentModelRow,
} from "../agentMode/agentLaunchPresentation";

export interface AgentProviderModelsListProps {
  readonly favoriteKeys: ReadonlySet<string>;
  readonly rows: ReadonlyArray<AgentModelRow>;
  onToggleFavorite(key: AgentModelFavoriteKey): void;
}

export function AgentProviderModelsList({
  favoriteKeys,
  onToggleFavorite,
  rows,
}: AgentProviderModelsListProps) {
  const [legacyOpen, setLegacyOpen] = useState(false);
  const current = rows.filter((row) => row.isLegacy !== true && row.value !== "default");
  const legacy = rows.filter((row) => row.isLegacy === true);
  const visible = legacyOpen ? [...current, ...legacy] : current;

  return (
    <div aria-label="Models" className="settings-models" role="list">
      {visible.map((row) => {
        const favorite = agentModelRowIsFavorite(row, favoriteKeys);
        return (
          <div className="settings-models__row" key={row.favoriteKey} role="listitem">
            <button
              aria-label={`Favorite ${row.label}`}
              aria-pressed={favorite}
              className="settings-models__star"
              onClick={() => onToggleFavorite(row.favoriteKey)}
              type="button"
            >
              <Star aria-hidden="true" size={14} />
            </button>
            <span className="settings-models__label">{row.label}</span>
            <code className="settings-models__id">{row.value}</code>
            <span className="settings-models__spacer" />
            {row.isNew === true ? <span className="settings-badge settings-badge--new">NEW</span> : null}
            {row.isDefault === true ? <span className="settings-badge">Default</span> : null}
          </div>
        );
      })}
      {legacy.length === 0 ? null : (
        <button
          aria-expanded={legacyOpen}
          className="settings-models__legacy"
          onClick={() => setLegacyOpen((open) => !open)}
          type="button"
        >
          <span>{legacyOpen ? "Hide legacy models" : `${legacy.length} legacy models`}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}
```

`row.favoriteKey` must be typed `AgentModelFavoriteKey` on `AgentModelRow` (it is built by `agentModelFavoriteKey`); if it is typed `string`, narrow the row field's type to `AgentModelFavoriteKey` in `agentLaunchPresentation.ts` (one-line type change). `row.isDefault` and `row.isNew` are added to `AgentModelRow` in Task 13 (`isDefault` = manifest `isDefault`, Codex `false`); if Task 7 runs before Task 13, add both optional fields to `AgentModelRow` and their mapping in `agentModelRows` as part of this task and tell the Task 13 implementer.

- [ ] **Step 5: Restyle the provider card**

In `AgentProviderCard.tsx`:
- Add props `readonly favoriteKeys: ReadonlySet<string>;` and `onToggleFavorite(key: AgentModelFavoriteKey): void;`.
- In the head, render the status as one line below the name row: `<p className="settings-provider__desc"><span className="settings-provider__dot" data-tone={providerStatusTone(enabled, view)} />{providerHeadline(view, enabled)}</p>` and remove the dot from the glyph wrapper (keep the `LoaderCircle` spinner inside the status line when the tone is `checking`).
- Order the side controls as the mockup: Sign in button, enable `SettingsSwitch`, chevron `SettingsButton`.
- In the details pass `models={<AgentProviderModelsList favoriteKeys={favoriteKeys} onToggleFavorite={onToggleFavorite} rows={rows} />}` where `const catalog = useAgentClaudeModelCatalog(); const rows = agentModelRows(provider, configuredProviderModel(management, provider), configuredProviderVersion(management, provider), catalog);`.

In `AgentProviderCardDetails.tsx` add `readonly models?: ReactNode;` and render, after the executable field:

```tsx
{models === undefined ? null : (
  <div className="settings-provider__field">
    <span className="settings-provider__field-label">Models</span>
    <span className="settings-provider__hint">Starred models appear first in the composer.</span>
    {models}
  </div>
)}
```

In `AgentsSettingsPage.tsx` pass to each card:

```tsx
favoriteKeys={new Set(draft.appSettings.agentModelFavoriteKeys)}
onToggleFavorite={(key) => {
  const next = withToggledModelFavorite(appSettingsRef.current, key);
  if (next === null) return;
  writeAppSettings(next);
}}
```

Rename the page's first section title from `"Agents"` to `"Providers"`, move the `agents.healthCheckInterval` and `agents.checkCliUpdates` rows into a new trailing `<SettingsSectionHeading title="CLI updates">` (after `AgentThreadDefaultsRows`), and in `AgentThreadDefaultsRows.tsx` set its section title to `"New threads"`.

Replace the `.settings-provider*` rules in `settings.css` with the mockup layout (keep class names):

```css
.settings-provider {
  display: flex;
  flex-direction: column;
}

.settings-provider__head {
  display: flex;
  align-items: flex-start;
  padding: var(--cv-space-5) var(--cv-space-6);
  gap: var(--cv-space-5);
}

.settings-provider__body {
  min-width: 0;
  flex: 1;
}

.settings-provider__line {
  display: flex;
  min-height: 20px;
  align-items: center;
  gap: var(--cv-space-4);
}

.settings-provider__glyph {
  display: grid;
  width: 20px;
  height: 20px;
  flex: none;
  place-items: center;
}

.settings-provider__name {
  margin: 0;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-sm);
  font-weight: 500;
}

.settings-provider__version {
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
}

.settings-provider__desc {
  display: flex;
  align-items: center;
  margin: var(--cv-space-1) 0 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-md);
  gap: var(--cv-space-3);
  line-height: 1.45;
}

.settings-provider__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--cv-fg-subtle);
}

.settings-provider__dot[data-tone="success"] {
  background: var(--cv-ok);
}

.settings-provider__dot[data-tone="warning"] {
  background: var(--cv-warn);
}

.settings-provider__dot[data-tone="danger"] {
  background: var(--cv-danger);
}

.settings-provider__side {
  display: flex;
  min-height: 20px;
  flex: none;
  align-items: center;
  gap: var(--cv-space-3);
}

.settings-provider__details {
  display: flex;
  flex-direction: column;
  padding: var(--cv-space-2) var(--cv-space-6) 14px 48px;
  gap: var(--cv-space-5);
}

.settings-models {
  border: 1px solid var(--cv-hair);
  border-radius: var(--cv-r-card);
}

.settings-models > * + * {
  border-top: 1px solid var(--cv-hair);
}

.settings-models__row,
.settings-models__legacy {
  display: flex;
  width: 100%;
  height: 36px;
  align-items: center;
  padding: 0 var(--cv-space-5);
  border: 0;
  background: none;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-md);
  gap: 10px;
  text-align: left;
}

.settings-models__legacy {
  color: var(--cv-fg-muted);
}

.settings-models__star {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-subtle);
  place-items: center;
}

.settings-models__star:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.settings-models__star[aria-pressed="true"] {
  color: var(--cv-warn);
}

.settings-models__star[aria-pressed="true"] svg {
  fill: currentColor;
}

.settings-models__id {
  color: var(--cv-fg-subtle);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-2xs);
}

.settings-models__spacer {
  flex: 1;
}

.settings-badge {
  display: inline-flex;
  height: 18px;
  align-items: center;
  padding: 0 var(--cv-space-3);
  border-radius: 5px;
  box-shadow: var(--cv-ring-hair-strong);
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-2xs);
  font-weight: 500;
}

.settings-badge--new {
  background: var(--cv-accent-soft);
  box-shadow: none;
  color: var(--cv-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
```

Wrap the two provider cards in `AgentsSettingsPage` inside the section group (they are children of `SettingsSectionHeading`, so `.settings-group > * + *` draws the divider); remove the `.settings-provider + .settings-provider` rule and its `cssBorderAllowlist.ts` entry.

- [ ] **Step 6: Update the card/page tests and run**

In `AgentProviderCard.test.tsx` and `pages/AgentsSettingsPage.test.tsx`: pass `favoriteKeys={new Set()}` and `onToggleFavorite={vi.fn()}` in the card fixtures; replace assertions on the section title `"Agents"` with `"Providers"`; replace the "Run CLI diagnostics" button assertion in the page test with the equivalent assertion in `SettingsPageActions.test.tsx` (`section="agents"`: clicking "Run CLI diagnostics" calls `providerManagement.refresh` for `"claudeCode"` and `"codex"`); add to `AgentsSettingsPage.test.tsx`:

```tsx
it("stars a model from the expanded provider card", () => {
  const { updateAppSettings } = renderPage();
  act(() => buttonNamed("Show Claude Code details")?.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Favorite Claude Opus 5.5"]')?.click());
  const saved = updateAppSettings.mock.calls.at(-1)?.[0];
  expect(saved.agentModelFavoriteKeys).toContain("claudeCode/claude-opus-5-5");
});
```

(`renderPage`/`buttonNamed` are that file's helpers; if favorites persist through `publishAppSettings` in the writer, assert on that mock instead.)

Run: `npx vitest run src/components/settings`
Expected: PASS.

- [ ] **Step 7: Report changed files to the lead.**

---

### Task 8: Keybindings page (grouped rows, inline recorder, modified badge)

**Files:**
- Create: `src/components/settings/pages/KeybindingsList.tsx`
- Modify: `pages/KeybindingsSettingsPage.tsx`, `pages/KeybindingsSettingsPage.test.tsx`, `pages/KeybindingRow.tsx`, `pages/keybindingsPresentation.ts` (add one export), `settings.css` (`.settings-kb*` rules)
- Delete: `pages/KeybindingsTable.tsx`

**Interfaces:**
- Consumes: `keybindingCategories`, `keybindingCountLabel`, `KeybindingViewModel`, `useKeybindingRecorder` (unchanged). `keybindingStrokes` stays unchanged (P5 reads it).
- Produces: `keybindingWhenLabel(binding: KeybindingViewModel): string` (`"Always"` for rebindable, `"Reserved"` otherwise); `KeybindingsList({ categories, onChangeShortcut })`.

- [ ] **Step 1: Write the failing tests**

Replace the table-structure assertions in `KeybindingsSettingsPage.test.tsx` with:

```tsx
it("renders one group per category with rows instead of a table", () => {
  render();
  expect(host.querySelector("table")).toBeNull();
  const groups = host.querySelectorAll(".settings-kb__group");
  expect(groups.length).toBeGreaterThan(0);
  const firstRow = groups[0]?.querySelector(".settings-kb__row");
  expect(firstRow?.querySelector(".settings-kb__label")?.textContent).not.toBe("");
  expect(firstRow?.querySelector(".settings-kb__when")?.textContent).toMatch(/^When(Always|Reserved)$/u);
});

it("records a new shortcut inline and marks the row modified", () => {
  const updateAppSettings = vi.fn();
  render({ actions: { updateAppSettings } });
  const edit = host.querySelector<HTMLButtonElement>('button[aria-label^="Edit shortcut for Toggle sidebar"]');
  act(() => edit?.click());
  const recorder = host.querySelector<HTMLInputElement>('input[aria-label^="Recording shortcut for Toggle sidebar"]');
  expect(document.activeElement).toBe(recorder);
  act(() => {
    recorder?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "j", metaKey: true }));
  });
  act(() => buttonNamed("Save")?.click());
  expect(updateAppSettings).toHaveBeenCalledOnce();
});

it("does not start recording while typing in the search field", () => {
  render();
  const search = host.querySelector<HTMLInputElement>('input[aria-label="Search keybindings"]');
  act(() => {
    search?.focus();
    search?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "k", metaKey: true }));
  });
  expect(host.querySelector('input[aria-label^="Recording shortcut"]')).toBeNull();
});

it("shows the empty state for an unmatched search", () => {
  render();
  typeInto(host.querySelector('input[aria-label="Search keybindings"]'), "zzzz-no-match");
  expect(host.querySelector(".settings-kb__empty")?.textContent).toBe("No matching shortcuts");
});
```

(`render`, `buttonNamed`, `typeInto` are the file's helpers; use the label of a real rebindable command from `keymapCommands` if "Toggle sidebar" is named differently there.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/settings/pages/KeybindingsSettingsPage.test.tsx`
Expected: FAIL (table still rendered).

- [ ] **Step 3: Implement the list and the row**

Add to `keybindingsPresentation.ts`:

```ts
export function keybindingWhenLabel(binding: KeybindingViewModel): string {
  return binding.rebindable ? "Always" : "Reserved";
}
```

```tsx
// src/components/settings/pages/KeybindingsList.tsx
import type { KeymapCommandId } from "../../../domain/keymap";
import { KeybindingRow } from "./KeybindingRow";
import type { KeybindingCategory } from "./keybindingsPresentation";
import { useKeybindingRecorder } from "./useKeybindingRecorder";

export interface KeybindingsListProps {
  readonly categories: ReadonlyArray<KeybindingCategory>;
  onChangeShortcut(commandId: KeymapCommandId, shortcut: string): void;
}

export function KeybindingsList({ categories, onChangeShortcut }: KeybindingsListProps) {
  const recorder = useKeybindingRecorder(onChangeShortcut);

  if (categories.length === 0) {
    return (
      <div className="settings-group">
        <p className="settings-kb__empty">No matching shortcuts</p>
      </div>
    );
  }

  return (
    <div className="settings-kb">
      {categories.map((group) => (
        <section aria-label={group.category} className="settings-kb__group" key={group.category}>
          <h3 className="settings-kb__category">{group.category}</h3>
          <div className="settings-group">
            {group.bindings.map((binding) => (
              <KeybindingRow
                binding={binding}
                key={binding.commandId}
                onReset={() => onChangeShortcut(binding.commandId, binding.defaultShortcut)}
                onUnbind={() => onChangeShortcut(binding.commandId, "")}
                recorder={recorder}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

In `KeybindingRow.tsx` change the root from `<tr>` to `<div className="settings-kb__row" data-command={binding.commandId} data-editing={recording === null ? undefined : "true"}>` with this structure (keep the existing recorder input, Save/Cancel buttons, conflict icon, popover menu and all their props and labels):

```tsx
<div className="settings-kb__text">
  <h4 className="settings-kb__label">
    {binding.label}
    {binding.modified ? <span className="settings-badge">Modified</span> : null}
  </h4>
  <p className="settings-kb__when">
    <span className="settings-kb__when-label">When</span>
    <span className="settings-kb__when-value">{keybindingWhenLabel(binding)}</span>
  </p>
</div>
<div className="settings-kb__controls">
  {binding.conflictTitle === null ? null : (/* existing conflict span */)}
  {binding.rebindable && recording === null ? (/* existing Ellipsis SettingsButton + SettingsPopover */) : null}
  {recording === null ? (/* existing edit button with KeybindingChips, without the "Edit" text span */) : (/* existing recorder span */)}
</div>
```

(Write the existing JSX blocks in place of the JSX comments; the source must not contain comments.) Remove the `settings-kb__id` span (the command id stays in the edit button's `aria-label`).

`KeybindingsSettingsPage.tsx`: keep the search input and count inside `SettingsSectionHeading actions`, render `<KeybindingsList .../>` directly (no `SettingsRow`), set `bare` on the heading, and add `data-settings-row="keymap.bindings"` + `ref={useSettingsRowTarget("keymap.bindings")}` + `tabIndex={-1}` on a wrapper `div` around the list. Delete `KeybindingsTable.tsx`.

Replace every `.settings-kb*` rule in `settings.css` with:

```css
.settings-kb {
  display: flex;
  flex-direction: column;
  gap: var(--cv-space-6);
}

.settings-kb__category {
  margin: 0 0 var(--cv-space-3);
  padding: 0 var(--cv-space-6);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-weight: 500;
}

.settings-kb__row {
  display: grid;
  align-items: center;
  padding: 10px var(--cv-space-6);
  gap: var(--cv-space-8);
  grid-template-columns: minmax(0, 1fr) auto;
}

.settings-kb__row[data-editing="true"] {
  background: var(--cv-tint-1);
}

.settings-kb__label {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  gap: var(--cv-space-3);
}

.settings-kb__when {
  display: flex;
  align-items: center;
  margin: var(--cv-space-1) 0 0;
  gap: var(--cv-space-3);
}

.settings-kb__when-label {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.settings-kb__when-value {
  color: var(--cv-fg-muted);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-2xs);
}

.settings-kb__controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--cv-space-4);
}

.settings-kb__controls .settings-btn[aria-haspopup],
.settings-kb__controls .settings-btn[aria-expanded] {
  opacity: 0;
  transition: opacity var(--cv-motion-fast);
}

.settings-kb__row:hover .settings-kb__controls .settings-btn[aria-expanded],
.settings-kb__row:focus-within .settings-kb__controls .settings-btn[aria-expanded] {
  opacity: 1;
}

.settings-kb__edit {
  display: inline-flex;
  height: 28px;
  align-items: center;
  margin-right: calc(var(--cv-space-3) * -1);
  padding: 0 var(--cv-space-3);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  gap: 3px;
}

.settings-kb__edit:hover {
  background: var(--cv-tint-2);
}

.settings-kb__edit:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.settings-kb__recorder {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-3);
}

.settings-kb__warn {
  display: inline-flex;
  color: var(--cv-warn);
}

.settings-kb__unbound {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.settings-kb__empty {
  margin: 0;
  padding: 40px var(--cv-space-6);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-md);
  text-align: center;
}
```

(The Ellipsis button has `aria-expanded` from `SettingsButton expanded`; it fades in on hover/focus like the mockup's `.row-menu`.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/settings/pages/KeybindingsSettingsPage.test.tsx src/components/settings`
Expected: PASS.

- [ ] **Step 5: Report changed files to the lead.**

---
### Task 9: Usage page, shared usage presentation and `refreshAccountUsage`

**Files:**
- Create: `src/components/usage/usagePresentation.ts`, `src/components/usage/usagePresentation.test.ts`, `src/components/usage/UsageLimitBars.tsx`, `src/components/usage/usage.css`, `src/components/settings/pages/UsageSettingsPage.test.tsx`
- Modify: `src/components/settings/pages/UsageSettingsPage.tsx` (replace the Task 4/5 stubs), `src/components/settings/settingsPageProps.ts`, `src/components/settings/settingsEnvironment.ts`, `src/components/settings/workbenchSettingsModel.ts`, `src/application/useWorkbenchAgents.ts` (interface `WorkbenchAgentsSurface` ~line 131 and the returned `useMemo` ~line 537), `src/application/useWorkbenchAgents.test.ts`, `src/App.css` (import `components/usage/usage.css` after the settings sheets)
- Delete (after P4 is committed): `src/components/agentMode/AgentUsagePanel.tsx`, `src/components/agentMode/AgentUsagePanel.test.tsx`, P4's `src/components/agentMode/AgentRailUsagePopover.tsx` (+ its test) and its mount line in `AgentThreadsSidebar.tsx`, and the `.agent-usage-*` rules in the agent mode stylesheets that only those files used (find with `grep -rn "agent-usage" src --include=*.css`; the shell must not have other readers)

**Interfaces:**
- Consumes: `AgentAccountUsageWindow`, `AgentAccountUsageLoadState` (`src/domain/agentAccountUsage.ts`), `aggregateAgentUsage`, `AgentUsagePeriod`, `AgentUsageProvider` (`src/domain/agentUsage.ts`), `useAgentTurnLogThreadEvidence`, `AgentTurnLogFactsSource` (`src/application/agentTurnLogStatusStore.ts`), `AgentThreadView` (`src/application/agentThreadPorts.ts`), foundation `SegmentedControl`, `IconButton`.
- Produces:
  - `WorkbenchAgentsSurface.refreshAccountUsage(provider: "claudeCode" | "codex"): void`.
  - `SettingsEnvironment.agentActivity: SettingsAgentActivity | null` with `SettingsAgentActivity { threads: ReadonlyArray<AgentThreadView>; accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>; turnLog: AgentTurnLogFactsSource | null; refreshAccountUsage(provider): void; unarchive(threadId: string): boolean }`.
  - `usageLimitBarModel(window, nowEpochMs): UsageLimitBarModel`, `updatedLabel(observedAtEpochMs, nowEpochMs)`, `latestUsageFetch(accountUsage): number | null`, `localSpendSummary(providers)`, `formatInteger`, `formatUsd`, `durationLabel`, `usageProviderLabel(provider)`.
  - `UsageLimitBars({ windows, nowEpochMs, compact? })`.

- [ ] **Step 1: Write the failing presentation test**

```ts
// src/components/usage/usagePresentation.test.ts
import { describe, expect, it } from "vitest";
import type { AgentAccountUsageWindow } from "../../domain/agentAccountUsage";
import { latestUsageFetch, updatedLabel, usageLimitBarModel } from "./usagePresentation";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const HOUR = 3_600_000;

function window(overrides: Partial<AgentAccountUsageWindow>): AgentAccountUsageWindow {
  return {
    id: "five_hour",
    label: "5-hour limit",
    usedPercent: 38,
    windowDurationMinutes: 300,
    resetsAtEpochMs: NOW + 2 * HOUR,
    resetsLabel: null,
    ...overrides,
  };
}

describe("usageLimitBarModel", () => {
  it("places the pace line at the elapsed share and flags spending ahead of pace", () => {
    const model = usageLimitBarModel(window({ usedPercent: 72 }), NOW);
    expect(model.elapsedPercent).toBe(60);
    expect(model.aheadOfPace).toBe(true);
    expect(model.hot).toBe(false);
    expect(model.usedLabel).toBe("72% used");
    expect(model.resetsLabel).toBe("Resets in 2h 0m");
  });

  it("omits the pace line when the reset time is only a label (Claude)", () => {
    const model = usageLimitBarModel(
      window({ resetsAtEpochMs: null, resetsLabel: "Sep 28 at 8am (Europe/Bratislava)" }),
      NOW,
    );
    expect(model.elapsedPercent).toBeNull();
    expect(model.aheadOfPace).toBe(false);
    expect(model.resetsLabel).toBe("Resets Sep 28 at 8am (Europe/Bratislava)");
  });

  it.each([
    [0, false],
    [89.9, false],
    [90, true],
    [100, true],
  ])("marks %s%% as hot=%s", (usedPercent, hot) => {
    expect(usageLimitBarModel(window({ usedPercent }), NOW).hot).toBe(hot);
  });

  it("clamps the elapsed share when the reset already passed or the window is unknown", () => {
    expect(usageLimitBarModel(window({ resetsAtEpochMs: NOW - HOUR }), NOW).elapsedPercent).toBe(100);
    expect(usageLimitBarModel(window({ windowDurationMinutes: null }), NOW).elapsedPercent).toBeNull();
  });

  it("describes the bar for assistive technology", () => {
    expect(usageLimitBarModel(window({}), NOW).ariaLabel).toBe(
      "5-hour limit: 38% used, 60% of the window elapsed, resets in 2h 0m",
    );
  });
});

describe("usage freshness", () => {
  it("reports the newest ready snapshot", () => {
    expect(
      latestUsageFetch({
        claudeCode: { kind: "ready", snapshot: { provider: "claudeCode", fetchedAtEpochMs: NOW - 5 * 60_000, windows: [] } },
        codex: { kind: "idle" },
      }),
    ).toBe(NOW - 5 * 60_000);
    expect(latestUsageFetch({ claudeCode: { kind: "idle" }, codex: { kind: "unavailable" } })).toBeNull();
    expect(updatedLabel(NOW - 2 * 60_000, NOW)).toBe("Updated 2m ago");
    expect(updatedLabel(NOW, NOW)).toBe("Updated just now");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/usage/usagePresentation.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement the presentation module**

Move `formatInteger`, `formatPercent`, `formatUsd`, `durationLabel`, `localSpendSummary`, `updatedLabel` verbatim from `AgentUsagePanel.tsx` into `src/components/usage/usagePresentation.ts` (exported), then add:

```ts
import type {
  AgentAccountUsageLoadState,
  AgentAccountUsageWindow,
} from "../../domain/agentAccountUsage";
import type { AgentUsageProvider } from "../../domain/agentUsage";

export interface UsageLimitBarModel {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly usedLabel: string;
  readonly elapsedPercent: number | null;
  readonly resetsLabel: string;
  readonly hot: boolean;
  readonly aheadOfPace: boolean;
  readonly ariaLabel: string;
}

const HOT_USED_PERCENT = 90;
const PACE_TOLERANCE_PERCENT = 5;

export function usageLimitBarModel(
  window: AgentAccountUsageWindow,
  nowEpochMs: number,
): UsageLimitBarModel {
  const usedPercent = clampPercent(window.usedPercent);
  const elapsedPercent = elapsedShare(window, nowEpochMs);
  const usedLabel = `${formatPercent(usedPercent)} used`;
  const resetsLabel = resetLabel(window.resetsAtEpochMs, window.resetsLabel, nowEpochMs);
  const elapsedText = elapsedPercent === null ? "" : `, ${Math.round(elapsedPercent)}% of the window elapsed`;
  return {
    id: window.id,
    label: window.label,
    usedPercent,
    usedLabel,
    elapsedPercent,
    resetsLabel,
    hot: usedPercent >= HOT_USED_PERCENT,
    aheadOfPace: elapsedPercent !== null && usedPercent > elapsedPercent + PACE_TOLERANCE_PERCENT,
    ariaLabel: `${window.label}: ${usedLabel}${elapsedText}, ${lowerFirst(resetsLabel)}`,
  };
}

export function latestUsageFetch(
  accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>,
): number | null {
  let latest: number | null = null;
  for (const state of Object.values(accountUsage)) {
    if (state.kind !== "ready") continue;
    latest = latest === null ? state.snapshot.fetchedAtEpochMs : Math.max(latest, state.snapshot.fetchedAtEpochMs);
  }
  return latest;
}

export function usageProviderLabel(provider: AgentUsageProvider["provider"]): string {
  return provider === "claudeCode" ? "Claude Code" : "Codex";
}

function elapsedShare(window: AgentAccountUsageWindow, nowEpochMs: number): number | null {
  if (window.windowDurationMinutes === null || window.windowDurationMinutes <= 0) return null;
  if (window.resetsAtEpochMs === null) return null;
  const durationMs = window.windowDurationMinutes * 60_000;
  const remainingMs = window.resetsAtEpochMs - nowEpochMs;
  return clampPercent(Math.round((1 - remainingMs / durationMs) * 1_000) / 10);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function resetLabel(epochMs: number | null, label: string | null, nowEpochMs: number): string {
  if (epochMs !== null) {
    const remainingMs = epochMs - nowEpochMs;
    if (remainingMs > 0 && remainingMs < 24 * 60 * 60 * 1_000) {
      const totalMinutes = Math.ceil(remainingMs / 60_000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `Resets in ${hours > 0 ? `${hours}h ` : ""}${minutes}m`;
    }
    return `Resets ${new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(epochMs)}`;
  }
  return label === null ? "Reset unavailable" : `Resets ${label}`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
```

(`resetLabel` is the panel's function moved here unchanged; `formatPercent` must be the moved function.) Run the test: PASS.

- [ ] **Step 4: Implement the bars and the stylesheet**

```tsx
// src/components/usage/UsageLimitBars.tsx
import { TrendingUp } from "lucide-react";
import { Fragment } from "react";
import type { AgentAccountUsageWindow } from "../../domain/agentAccountUsage";
import { usageLimitBarModel } from "./usagePresentation";

export interface UsageLimitBarsProps {
  readonly compact?: boolean;
  readonly nowEpochMs: number;
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
}

export function UsageLimitBars({ compact = false, nowEpochMs, windows }: UsageLimitBarsProps) {
  return (
    <div className="cv-usage-limits" data-compact={compact ? "true" : undefined}>
      {windows.map((window) => {
        const model = usageLimitBarModel(window, nowEpochMs);
        return (
          <Fragment key={model.id}>
            <span className="cv-usage-limits__label">
              <span className="cv-usage-limits__name">{model.label}</span>
              <span className="cv-usage-limits__value">{model.usedLabel}</span>
            </span>
            <div
              aria-label={model.ariaLabel}
              className="cv-usage-bar"
              role="img"
              tabIndex={0}
              title={`${model.ariaLabel}. The line is where even spending would be.`}
            >
              <span
                className="cv-usage-bar__fill"
                data-hot={model.hot ? "true" : undefined}
                style={{ width: `${model.usedPercent}%` }}
              />
              {model.elapsedPercent === null ? null : (
                <span className="cv-usage-bar__pace" style={{ left: `${model.elapsedPercent}%` }} />
              )}
            </div>
            <span className="cv-usage-limits__reset">
              {model.aheadOfPace ? (
                <TrendingUp aria-label="Ahead of pace" role="img" size={14} />
              ) : null}
              {model.resetsLabel}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
```

```css
/* src/components/usage/usage.css */
.cv-usage-limits {
  display: grid;
  align-items: center;
  margin-top: 10px;
  column-gap: var(--cv-space-6);
  grid-template-columns: 176px minmax(0, 1fr) 112px;
  row-gap: var(--cv-space-2);
}

.cv-usage-limits[data-compact="true"] {
  margin-top: var(--cv-space-1);
  column-gap: var(--cv-space-5);
  grid-template-columns: minmax(0, 176px) minmax(48px, 1fr) auto;
  row-gap: 0;
}

.cv-usage-limits__label {
  display: flex;
  min-width: 0;
  align-items: center;
  font-size: var(--cv-t-xs);
  gap: var(--cv-space-4);
}

.cv-usage-limits__name {
  overflow: hidden;
  color: var(--cv-fg-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-usage-limits__value {
  margin-left: auto;
  color: var(--cv-fg-strong);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  white-space: nowrap;
}

.cv-usage-bar {
  position: relative;
  height: 24px;
  border-radius: var(--cv-r-pill);
}

.cv-usage-bar::before {
  position: absolute;
  border-radius: var(--cv-r-pill);
  background: var(--cv-s4);
  content: "";
  inset: 9px 0;
}

.cv-usage-bar:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.cv-usage-bar__fill {
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 0;
  border-radius: var(--cv-r-pill);
  background: var(--cv-accent-fill);
}

.cv-usage-bar__fill[data-hot="true"] {
  background: var(--cv-danger);
}

.cv-usage-bar__pace {
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 1px;
  background: var(--cv-fg-muted);
  transform: translateX(-50%);
}

.cv-usage-limits__reset {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
  gap: var(--cv-space-3);
  white-space: nowrap;
}

.cv-usage-totals {
  display: grid;
  gap: var(--cv-space-7);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.cv-usage-totals__item {
  display: flex;
  flex-direction: column;
  gap: var(--cv-space-1);
}

.cv-usage-totals__key {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-usage-totals__value {
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-title);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 28px;
}

.cv-usage-provider-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-variant-numeric: tabular-nums;
}

.cv-usage-provider-row > * {
  width: 96px;
  text-align: right;
}

.cv-usage-provider-row > strong {
  width: 72px;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-md);
  font-weight: 500;
}
```

- [ ] **Step 5: Expose `refreshAccountUsage` and plumb the settings environment**

`src/application/useWorkbenchAgents.ts`: add `readonly refreshAccountUsage: (provider: "claudeCode" | "codex") => void;` to `WorkbenchAgentsSurface`, and in the returned `useMemo` add `refreshAccountUsage: refreshProviderUsageAfterTurn,` with `refreshProviderUsageAfterTurn` added to the dependency array.

Extend the existing post-turn usage refresh test in `src/application/useWorkbenchAgents.test.ts` (the one that asserts a `readAgentProviderUsage` call) with a second `act` that calls `surface.refreshAccountUsage("codex")` and asserts `readAgentProviderUsage` was called again with `{ provider: "codex", providerGeneration: <the same generation the test already uses> }` and that `surface.accountUsage.codex.kind` becomes `"ready"`.

`src/components/settings/workbenchSettingsModel.ts`: widen `agents` to:

```ts
readonly agents?: {
  readonly providerSignIn: AgentProviderSignInSurface;
  readonly agentProjects?: { readonly projects: readonly AgentProjectDescriptor[] };
  readonly threads?: ReadonlyArray<AgentThreadView>;
  readonly accountUsage?: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
  readonly turnLog?: AgentTurnLogFactsSource | null;
  readonly refreshAccountUsage?: (provider: "claudeCode" | "codex") => void;
  readonly unarchive?: (threadId: string) => boolean;
};
```

`src/components/settings/settingsPageProps.ts`: add the `SettingsAgentActivity` interface (shape in Interfaces above) and `readonly agentActivity: SettingsAgentActivity | null;` to `SettingsEnvironment`.

`src/components/settings/settingsEnvironment.ts`:

```ts
agentActivity: settingsAgentActivity(workbench.agents),
```

```ts
function settingsAgentActivity(agents: WorkbenchSettingsModel["agents"]): SettingsAgentActivity | null {
  if (agents === undefined) return null;
  if (agents.threads === undefined || agents.accountUsage === undefined) return null;
  if (agents.refreshAccountUsage === undefined || agents.unarchive === undefined) return null;
  return {
    threads: agents.threads,
    accountUsage: agents.accountUsage,
    turnLog: agents.turnLog ?? null,
    refreshAccountUsage: agents.refreshAccountUsage,
    unarchive: agents.unarchive,
  };
}
```

Every test fixture that builds a `SettingsEnvironment` literal gets `agentActivity: null` (run `npm run check` to list them).

- [ ] **Step 6: Write the failing page test**

```tsx
// src/components/settings/pages/UsageSettingsPage.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsAgentActivity, SettingsEnvironment } from "../settingsPageProps";
import { UsagePageActions, UsageSettingsPage } from "./UsageSettingsPage";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

describe("UsageSettingsPage", () => {
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

  function activity(overrides: Partial<SettingsAgentActivity> = {}): SettingsAgentActivity {
    return {
      threads: [],
      accountUsage: {
        claudeCode: {
          kind: "ready",
          snapshot: {
            provider: "claudeCode",
            fetchedAtEpochMs: Date.now(),
            windows: [
              { id: "five_hour", label: "5-hour limit", usedPercent: 38, windowDurationMinutes: 300, resetsAtEpochMs: null, resetsLabel: "8pm" },
              { id: "seven_day", label: "Weekly limit", usedPercent: 92, windowDurationMinutes: 10_080, resetsAtEpochMs: null, resetsLabel: "Sep 28" },
            ],
          },
        },
        codex: { kind: "idle" },
      },
      turnLog: null,
      refreshAccountUsage: vi.fn(),
      unarchive: vi.fn(() => true),
      ...overrides,
    };
  }

  function render(agentActivity: SettingsAgentActivity | null) {
    const props = settingsPagePropsFixture({ env: { agentActivity } });
    act(() => root.render(<UsageSettingsPage {...props} />));
  }

  it("renders one limits section per provider with bars or a reason", () => {
    render(activity());
    const titles = [...host.querySelectorAll(".settings-section__title")].map((node) => node.textContent);
    expect(titles).toEqual(["Claude Code", "Codex", "Local activity"]);
    expect(host.querySelectorAll(".cv-usage-bar").length).toBe(2);
    expect(host.querySelector('.cv-usage-bar__fill[data-hot="true"]')).not.toBeNull();
    expect(host.textContent).toContain("Available after the next provider turn.");
  });

  it("explains when agent data is not loaded", () => {
    render(null);
    expect(host.textContent).toContain("Usage appears after agent mode has loaded.");
  });

  it("refreshes both providers from the top bar action", () => {
    const refreshAccountUsage = vi.fn();
    const env = settingsPagePropsFixture({ env: { agentActivity: activity({ refreshAccountUsage }) } }).env;
    act(() => root.render(<UsagePageActions env={env as SettingsEnvironment} />));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]')?.click());
    expect(refreshAccountUsage.mock.calls).toEqual([["claudeCode"], ["codex"]]);
  });
});
```

Create the shared fixture `src/components/settings/pages/settingsPageTestSupport.ts` (test support, used by Tasks 9 and 10):

```ts
import { vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../../domain/settings";
import type { SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";

export function settingsPagePropsFixture(overrides: {
  readonly env?: Partial<SettingsEnvironment>;
} = {}): SettingsPageProps {
  return {
    actions: {
      publishAppSettings: vi.fn(),
      save: vi.fn(),
      updateAppSettings: vi.fn(),
      updateIgnorePatternsText: vi.fn(),
      updateTrusted: vi.fn(),
      updateWorkspaceSettings: vi.fn(),
    },
    draft: {
      appSettings: defaultAppSettings(),
      ignorePatternsText: "",
      trusted: false,
      workspaceSettings: defaultWorkspaceSettings(),
    },
    env: {
      agentActivity: null,
      agentProjects: [],
      appUpdater: null,
      gitDetectedRepositoryMappings: [],
      hasWorkspace: false,
      onCopyInstallCommand: vi.fn(),
      onOpenJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
      onOpenNodeLaunchConfigurations: vi.fn(),
      onRestartJavaScriptTypeScriptService: vi.fn(async () => undefined),
      phpTools: null,
      providerManagement: null,
      providerSignIn: null,
      systemFontGateway: { listMonospaceFontFamilies: async () => [] },
      workspaceDescriptor: null,
      workspaceRoot: null,
      ...overrides.env,
    },
  };
}
```

Run: `npx vitest run src/components/settings/pages/UsageSettingsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implement the page**

```tsx
// src/components/settings/pages/UsageSettingsPage.tsx
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAgentTurnLogThreadEvidence } from "../../../application/agentTurnLogStatusStore";
import type { AgentAccountUsageLoadState } from "../../../domain/agentAccountUsage";
import { aggregateAgentUsage, type AgentUsagePeriod } from "../../../domain/agentUsage";
import { IconButton } from "../../../ui/foundation/IconButton";
import { SegmentedControl } from "../../../ui/foundation/SegmentedControl";
import { AgentProviderGlyph } from "../../agentMode/AgentProviderGlyph";
import { UsageLimitBars } from "../../usage/UsageLimitBars";
import {
  durationLabel,
  formatInteger,
  formatUsd,
  latestUsageFetch,
  localSpendSummary,
  updatedLabel,
  usageProviderLabel,
} from "../../usage/usagePresentation";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsAgentActivity, SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";

const PROVIDERS = ["claudeCode", "codex"] as const;
const PERIOD_OPTIONS: ReadonlyArray<{ readonly value: AgentUsagePeriod; readonly label: string }> = [
  { value: "today", label: "Today" },
  { value: "7days", label: "7 days" },
  { value: "30days", label: "30 days" },
];
const CLOCK_TICK_MS = 30_000;

export function UsageSettingsPage({ env }: SettingsPageProps) {
  const activity = env.agentActivity;
  const limitsRef = useSettingsRowTarget("usage.limits");
  const nowEpochMs = useClock(CLOCK_TICK_MS);

  if (activity === null) {
    return (
      <SettingsSectionHeading title="Usage">
        <p className="settings-empty">Usage appears after agent mode has loaded.</p>
      </SettingsSectionHeading>
    );
  }

  return (
    <>
      <div className="settings-stack" data-settings-row="usage.limits" ref={limitsRef} tabIndex={-1}>
        {PROVIDERS.map((provider) => (
          <ProviderLimits
            key={provider}
            nowEpochMs={nowEpochMs}
            provider={provider}
            state={activity.accountUsage[provider]}
          />
        ))}
      </div>
      <LocalActivity activity={activity} nowEpochMs={nowEpochMs} />
    </>
  );
}

export function UsagePageActions({ env }: { readonly env: SettingsEnvironment }) {
  const nowEpochMs = useClock(CLOCK_TICK_MS);
  const activity = env.agentActivity;
  if (activity === null) return null;
  const fetchedAt = latestUsageFetch(activity.accountUsage);
  return (
    <span className="settings-page-actions">
      {fetchedAt === null ? null : (
        <span className="settings-section__note">{updatedLabel(fetchedAt, nowEpochMs)}</span>
      )}
      <IconButton
        icon={<RefreshCw aria-hidden="true" size={14} />}
        label="Refresh usage"
        onClick={() => {
          for (const provider of PROVIDERS) activity.refreshAccountUsage(provider);
        }}
      />
    </span>
  );
}

function ProviderLimits({
  nowEpochMs,
  provider,
  state,
}: {
  readonly nowEpochMs: number;
  readonly provider: (typeof PROVIDERS)[number];
  readonly state: AgentAccountUsageLoadState;
}) {
  return (
    <SettingsSectionHeading title={usageProviderLabel(provider)}>
      <div className="settings-row" data-layout="stacked">
        <span className="settings-usage-provider">
          <AgentProviderGlyph decorative kind={provider} />
        </span>
        <ProviderLimitsBody nowEpochMs={nowEpochMs} state={state} />
      </div>
    </SettingsSectionHeading>
  );
}

function ProviderLimitsBody({
  nowEpochMs,
  state,
}: {
  readonly nowEpochMs: number;
  readonly state: AgentAccountUsageLoadState;
}) {
  switch (state.kind) {
    case "idle":
      return <p className="settings-row__description">Available after the next provider turn.</p>;
    case "loading":
      return <p className="settings-row__description">Updating…</p>;
    case "unavailable":
      return <p className="settings-row__description">No limits reported by the latest turn.</p>;
    case "ready":
      return <UsageLimitBars nowEpochMs={nowEpochMs} windows={state.snapshot.windows} />;
    default:
      return state satisfies never;
  }
}

function LocalActivity({
  activity,
  nowEpochMs,
}: {
  readonly activity: SettingsAgentActivity;
  readonly nowEpochMs: number;
}) {
  const [period, setPeriod] = useState<AgentUsagePeriod>("7days");
  const threads = useMemo(() => activity.threads.map((view) => view.thread), [activity.threads]);
  const threadIds = useMemo(() => threads.map((thread) => thread.threadId), [threads]);
  const evidence = useAgentTurnLogThreadEvidence(activity.turnLog, threadIds);
  const usage = useMemo(
    () => aggregateAgentUsage(threads, period, nowEpochMs, evidence),
    [evidence, nowEpochMs, period, threads],
  );
  const spend = useMemo(() => localSpendSummary(usage.providers), [usage.providers]);
  const activityRef = useSettingsRowTarget("usage.localActivity");

  return (
    <SettingsSectionHeading
      actions={
        <SegmentedControl label="Period" onChange={setPeriod} options={PERIOD_OPTIONS} value={period} />
      }
      title="Local activity"
    >
      <div className="settings-row" data-layout="stacked" data-settings-row="usage.localActivity" ref={activityRef} tabIndex={-1}>
        <div className="cv-usage-totals">
          <Total label="Estimated cost" value={spend.costUsd === null ? "—" : formatUsd(spend.costUsd)} />
          <Total label="Processed tokens" value={spend.tokens === null ? "—" : formatInteger(spend.tokens)} />
          <Total label="Completed turns" value={formatInteger(spend.completedTurns)} />
        </div>
        <p className="settings-row__description">
          Saved threads and turns on this device, not subscription billing.
          {usage.savedHistoryIncomplete ? " Saved history is incomplete because older turns were evicted." : ""}
        </p>
      </div>
      {PROVIDERS.map((provider) => {
        const metrics = usage.providers[provider].total;
        const cli = metrics.cliUsage;
        const tokens =
          cli.measuredTurns === 0 || cli.inputTokens === null || cli.outputTokens === null
            ? null
            : cli.inputTokens + cli.outputTokens;
        return (
          <div className="settings-row" key={provider}>
            <span className="settings-usage-provider">
              <AgentProviderGlyph decorative kind={provider} />
              <span className="settings-row__title">{usageProviderLabel(provider)}</span>
            </span>
            <span className="cv-usage-provider-row">
              <span>{formatInteger(metrics.turnsStarted)} turns</span>
              <span>{tokens === null ? "—" : `${formatInteger(tokens)} tokens`}</span>
              <span>{durationLabel(metrics.wallTime.totalMs)}</span>
              <strong>{cli.costMeasuredTurns === 0 || cli.costUsd === null ? "—" : formatUsd(cli.costUsd)}</strong>
            </span>
          </div>
        );
      })}
    </SettingsSectionHeading>
  );
}

function Total({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="cv-usage-totals__item">
      <span className="cv-usage-totals__key">{label}</span>
      <span className="cv-usage-totals__value">{value}</span>
    </div>
  );
}

function useClock(tickMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs]);
  return now;
}
```

Add to `settingsShell.css`:

```css
.settings-empty {
  margin: 0;
  padding: var(--cv-space-5) var(--cv-space-6);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-md);
}

.settings-stack {
  display: flex;
  flex-direction: column;
  gap: var(--cv-space-8);
}

.settings-stack:focus-visible {
  outline: none;
}

.settings-usage-provider {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.settings-page-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-space-3);
}
```

- [ ] **Step 8: Run the focused tests, then remove the old panel after P4**

Run: `npx vitest run src/components/usage src/components/settings src/application/useWorkbenchAgents.test.ts`
Expected: PASS.

Then (P4 committed): delete `AgentUsagePanel.tsx` + test, P4's `AgentRailUsagePopover.tsx` + test, remove its mount line in `AgentThreadsSidebar.tsx`, remove orphaned `.agent-usage-*` CSS, and run `npm run check && npx vitest run src/components/agentMode` (expected PASS; any sidebar test that opened the usage popover is deleted with it).

- [ ] **Step 9: Report changed files to the lead.**

---

### Task 10: Archive page

**Files:**
- Create: `src/components/settings/pages/archivePresentation.ts`, `src/components/settings/pages/archivePresentation.test.ts`, `src/components/settings/pages/ArchiveSettingsPage.test.tsx`
- Modify: `src/components/settings/pages/ArchiveSettingsPage.tsx` (replace the stub)
- Delete (after P4 is committed): P4's `src/components/agentMode/AgentThreadArchivedShelf.tsx` (+ test) and its mount line in `AgentThreadList`, plus archived-section code in `agentRailSections` only if no other module reads it (`grep -rn "archived" src/components/agentMode/agentRailSections*`)

**Interfaces:**
- Consumes: `SettingsAgentActivity` (Task 9), `AgentThreadView`.
- Produces: `archivedThreadGroups(views, nowEpochMs): ReadonlyArray<ArchivedThreadGroup>`, `ArchivedThreadGroup { projectLabel: string; threads: ReadonlyArray<{ threadId: string; title: string; createdLabel: string }> }`, `ARCHIVE_PAGE_SIZE = 50`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/settings/pages/archivePresentation.test.ts
import { describe, expect, it } from "vitest";
import { archivedThreadGroups } from "./archivePresentation";

const NOW = Date.UTC(2026, 8, 24);
const DAY = 86_400_000;

function view(threadId: string, repositoryLabel: string, archived: boolean, ageDays: number) {
  return {
    repositoryLabel,
    thread: { threadId, title: `Thread ${threadId}`, archived, createdAtEpochMs: NOW - ageDays * DAY },
  };
}

describe("archivedThreadGroups", () => {
  it("keeps only archived threads, groups them by project, newest first", () => {
    const groups = archivedThreadGroups(
      [
        view("a", "orders-api", true, 14),
        view("b", "web-dashboard", true, 30),
        view("c", "orders-api", false, 1),
        view("d", "orders-api", true, 21),
      ],
      NOW,
    );
    expect(groups.map((group) => group.projectLabel)).toEqual(["orders-api", "web-dashboard"]);
    expect(groups[0]?.threads.map((thread) => thread.threadId)).toEqual(["a", "d"]);
    expect(groups[0]?.threads[0]?.createdLabel).toBe("Created 2w ago");
  });

  it("returns no groups when nothing is archived", () => {
    expect(archivedThreadGroups([view("x", "orders-api", false, 1)], NOW)).toEqual([]);
  });
});
```

The helper takes the minimal structural shape `{ repositoryLabel: string; thread: { threadId: string; title: string; archived: boolean; createdAtEpochMs: number } }` so the test does not need a full `AgentThreadView`.

```tsx
// src/components/settings/pages/ArchiveSettingsPage.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import { ArchiveSettingsPage } from "./ArchiveSettingsPage";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

describe("ArchiveSettingsPage", () => {
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

  it("unarchives a thread", () => {
    const unarchive = vi.fn(() => true);
    const threads = [
      {
        repositoryLabel: "orders-api",
        thread: { threadId: "t1", title: "Swap morgan for pino-http", archived: true, createdAtEpochMs: Date.now() },
      },
    ] as unknown as ReadonlyArray<AgentThreadView>;
    const props = settingsPagePropsFixture({
      env: {
        agentActivity: {
          threads,
          accountUsage: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
          turnLog: null,
          refreshAccountUsage: vi.fn(),
          unarchive,
        },
      },
    });
    act(() => root.render(<ArchiveSettingsPage {...props} />));
    expect(host.querySelector(".settings-section__title")?.textContent).toBe("orders-api");
    act(() => [...host.querySelectorAll("button")].find((node) => node.textContent === "Unarchive")?.click());
    expect(unarchive).toHaveBeenCalledWith("t1");
  });

  it("shows an empty state", () => {
    const props = settingsPagePropsFixture({
      env: {
        agentActivity: {
          threads: [],
          accountUsage: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
          turnLog: null,
          refreshAccountUsage: vi.fn(),
          unarchive: vi.fn(() => true),
        },
      },
    });
    act(() => root.render(<ArchiveSettingsPage {...props} />));
    expect(host.textContent).toContain("No archived threads.");
  });
});
```

Run: `npx vitest run src/components/settings/pages/archivePresentation.test.ts src/components/settings/pages/ArchiveSettingsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

```ts
// src/components/settings/pages/archivePresentation.ts
export const ARCHIVE_PAGE_SIZE = 50;

export interface ArchivableThreadView {
  readonly repositoryLabel: string;
  readonly thread: {
    readonly threadId: string;
    readonly title: string;
    readonly archived: boolean;
    readonly createdAtEpochMs: number;
  };
}

export interface ArchivedThreadRow {
  readonly threadId: string;
  readonly title: string;
  readonly createdLabel: string;
}

export interface ArchivedThreadGroup {
  readonly projectLabel: string;
  readonly threads: ReadonlyArray<ArchivedThreadRow>;
}

export function archivedThreadGroups(
  views: ReadonlyArray<ArchivableThreadView>,
  nowEpochMs: number,
): ReadonlyArray<ArchivedThreadGroup> {
  const byProject = new Map<string, ArchivableThreadView[]>();
  for (const view of views) {
    if (!view.thread.archived) continue;
    const bucket = byProject.get(view.repositoryLabel);
    if (bucket === undefined) {
      byProject.set(view.repositoryLabel, [view]);
      continue;
    }
    bucket.push(view);
  }
  return [...byProject.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([projectLabel, bucket]) => ({
      projectLabel,
      threads: bucket
        .sort((left, right) => right.thread.createdAtEpochMs - left.thread.createdAtEpochMs)
        .map((view) => ({
          threadId: view.thread.threadId,
          title: view.thread.title,
          createdLabel: `Created ${ageLabel(nowEpochMs - view.thread.createdAtEpochMs)} ago`,
        })),
    }));
}

function ageLabel(elapsedMs: number): string {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
```

```tsx
// src/components/settings/pages/ArchiveSettingsPage.tsx
import { useMemo, useState } from "react";
import { Button } from "../../../ui/foundation/Button";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
import { ARCHIVE_PAGE_SIZE, archivedThreadGroups, type ArchivedThreadGroup } from "./archivePresentation";

export function ArchiveSettingsPage({ env }: SettingsPageProps) {
  const activity = env.agentActivity;
  const anchorRef = useSettingsRowTarget("archive.threads");
  const threads = activity?.threads ?? [];
  const groups = useMemo(() => archivedThreadGroups(threads, Date.now()), [threads]);

  if (activity === null) {
    return (
      <SettingsSectionHeading title="Archived threads">
        <p className="settings-empty">Archived threads appear after agent mode has loaded.</p>
      </SettingsSectionHeading>
    );
  }

  return (
    <div className="settings-stack" data-settings-row="archive.threads" ref={anchorRef} tabIndex={-1}>
      {groups.length === 0 ? (
        <SettingsSectionHeading title="Archived threads">
          <p className="settings-empty">No archived threads.</p>
        </SettingsSectionHeading>
      ) : (
        groups.map((group) => (
          <ArchiveGroup group={group} key={group.projectLabel} onUnarchive={activity.unarchive} />
        ))
      )}
    </div>
  );
}

function ArchiveGroup({
  group,
  onUnarchive,
}: {
  readonly group: ArchivedThreadGroup;
  onUnarchive(threadId: string): boolean;
}) {
  const [shown, setShown] = useState(ARCHIVE_PAGE_SIZE);
  const hidden = group.threads.length - shown;
  return (
    <SettingsSectionHeading title={group.projectLabel}>
      {group.threads.slice(0, shown).map((thread) => (
        <div className="settings-row" key={thread.threadId}>
          <div className="settings-row__text">
            <h3 className="settings-row__title">{thread.title}</h3>
            <p className="settings-row__description">{thread.createdLabel}</p>
          </div>
          <div className="settings-row__control">
            <Button onClick={() => onUnarchive(thread.threadId)} size="sm">
              Unarchive
            </Button>
          </div>
        </div>
      ))}
      {hidden <= 0 ? null : (
        <button className="settings-models__legacy" onClick={() => setShown((count) => count + ARCHIVE_PAGE_SIZE)} type="button">
          Show {Math.min(hidden, ARCHIVE_PAGE_SIZE)} more
        </button>
      )}
    </SettingsSectionHeading>
  );
}
```

`.settings-stack` was added to `settingsShell.css` in Task 9.

- [ ] **Step 3: Run the tests, then remove P4's shelf**

Run: `npx vitest run src/components/settings/pages`
Expected: PASS. Then (P4 committed) delete `AgentThreadArchivedShelf.tsx` (+ test) and its mount, run `npm run check && npx vitest run src/components/agentMode` (PASS).

- [ ] **Step 4: Report changed files to the lead.**

---

### Task 11: Environments, Index & languages, Snippets, PHP and shared controls on the new tokens

**Files:**
- Modify: `src/components/settings/settings.css` (`.settings-select`, `.settings-input`, `.settings-numfield*`, `.settings-btn*`, `.settings-segmented*`, `.settings-chip*`, `.settings-kbd`, `.settings-popover*`, `.settings-mappings*`, `.settings-snippet*`), `src/components/settings/pages/environmentsSettings.css`, `src/components/settings/pages/EnvironmentsSettingsPage.tsx` (section wrapper only), `src/components/settings/pages/EnvironmentsSettingsPage.test.tsx`

**Interfaces:** none new; all pages keep their rows and props.

- [ ] **Step 1: Write the failing style-contract test**

Create `src/components/settings/settingsStyles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sheets = [
  "src/components/settings/settings.css",
  "src/components/settings/settingsShell.css",
  "src/components/settings/pages/environmentsSettings.css",
  "src/components/usage/usage.css",
];

describe("settings stylesheets", () => {
  it.each(sheets)("%s uses only --cv tokens or the local --settings aliases", (sheet) => {
    const source = readFileSync(sheet, "utf8");
    const legacy = source.match(/var\(--(codevo|color|agent)-[\w-]+/gu) ?? [];
    expect(legacy).toEqual([]);
  });

  it.each(sheets)("%s declares no raw colours outside the palette card wire", (sheet) => {
    const source = readFileSync(sheet, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    const literals = source.match(/#[0-9a-f]{3,8}\b|rgba?\(/giu) ?? [];
    expect(literals).toEqual([]);
  });
});
```

Run: `npx vitest run src/components/settings/settingsStyles.test.ts`
Expected: FAIL while any `--codevo-*` reference or literal colour (the select chevron mask uses `%23000` inside a data URL, which the regex does not match; `rgba(` literals do) remains.

- [ ] **Step 2: Restyle the shared controls**

In `settings.css` apply these exact declaration changes (mockup `.sel`, `.inp`, `.stepper`, `.btn.xs`):
- `.settings-select, .settings-input`: `font-size: var(--cv-t-md); box-shadow: var(--cv-ring-hair-strong); background: var(--cv-tint-1);`
- `.settings-select:hover`: `background: var(--cv-tint-2);`
- `.settings-input:focus-visible, .settings-select:focus-within`: `box-shadow: var(--cv-ring-focus);`
- `.settings-numfield`: `height: 28px; border-radius: var(--cv-r-control); box-shadow: var(--cv-ring-hair-strong); background: var(--cv-tint-1);`
- `.settings-numfield__step`: `width: 28px; height: 28px; color: var(--cv-fg-subtle);` and `:hover` `color: var(--cv-fg-strong); background: var(--cv-tint-2);`
- `.settings-btn--micro, .settings-btn--xsq`: `height: 24px; border-radius: var(--cv-r-sm);`
- Replace any remaining `rgba(...)` literal with the nearest token (`var(--cv-tint-1|2|3)`, `var(--cv-hair|hair-strong)`, `var(--cv-shadow-pop)`).

In `environmentsSettings.css` keep the `--settings-*` references (they now resolve to `--cv-*`) and change any literal colour to tokens.

`EnvironmentsSettingsPage.tsx`: make sure its content is wrapped in `SettingsSectionHeading` sections so it renders inside `.settings-group` like the other pages (it receives only `projects`; keep that prop). Update its test selectors if they referenced `.settings-section__rows`.

- [ ] **Step 3: Run the settings suite and the CSS contracts**

Run: `npx vitest run src/components/settings src/components/cssTokenContract.test.ts src/domain/themeContrast.test.ts`
Expected: PASS.

- [ ] **Step 4: Report changed files to the lead.**

---
### Task 12: Picker stylesheet and foundation radio/switch menu items

**Files:**
- Create: `src/components/agentMode/pickers/agentPickers.css`, `src/ui/foundation/MenuRadioItem.tsx`, `src/ui/foundation/MenuSwitchItem.tsx`, `src/ui/foundation/menuChoiceItems.test.tsx`
- Modify: `src/components/agentMode/agentComposer.css` (move every P9-owned group listed in Ownership into `agentPickers.css`, rewritten on `--cv-*`: `.agent-picker*`, `.agent-model-picker*`, `.agent-traits-picker*`, `.agent-composer__launch*`, `.agent-composer__compact*`, `.agent-composer__lock*`, `.agent-composer__target*`, `.agent-composer__divider`, `.agent-environment*`, and every rule combining `.agent-composer__footer` with a picker selector; after this, `agentComposer.css` holds no P9 rule), `src/components/agentMode/AgentComposer.test.tsx` (update the picker blocks of the "Airy styling contract" to read `pickers/agentPickers.css` instead of `agentComposer.css`), `src/components/agentMode/AgentPickerMenu.tsx` (import the new stylesheet once), `src/components/agentMode/AgentCheckoutSearchControls.tsx` (drop its `agentCheckoutSearch.css` import)
- Delete: `src/components/agentMode/agentCheckoutSearch.css` (its rules move into `agentPickers.css`)

**Interfaces:**
- Consumes: `useMenuContext` (`src/ui/foundation/menuContext.ts`), `cx`, foundation `overlays.css` classes `cv-menu__item`, `cv-menu__icon`, `cv-menu__text`, `cv-menu__check`, `cv-menu__end`.
- Produces: `MenuRadioItem({ checked: boolean; children; description?: string; icon?: ReactNode; disabled?: boolean; onSelect(): void })` (role `menuitemradio`, closes the menu); `MenuSwitchItem({ checked: boolean; children; disabled?: boolean; onToggle(next: boolean): void })` (role `menuitemcheckbox`, switch visual, keeps the menu open).

- [ ] **Step 1: Write the failing foundation test**

```tsx
// src/ui/foundation/menuChoiceItems.test.tsx
// @vitest-environment jsdom
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, press } from "./foundationTestSupport";
import { Menu } from "./Menu";
import { MenuLabel, MenuSeparator } from "./MenuItem";
import { MenuRadioItem } from "./MenuRadioItem";
import { MenuSwitchItem } from "./MenuSwitchItem";

function Harness({ onPick, onToggle }: { onPick(value: string): void; onToggle(next: boolean): void }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  return (
    <>
      <button ref={anchorRef} type="button">
        Effort
      </button>
      <Menu anchorRef={anchorRef} label="Effort" onClose={() => setOpen(false)} open={open}>
        <MenuLabel>Effort</MenuLabel>
        <MenuRadioItem checked={false} onSelect={() => onPick("low")}>
          Low
        </MenuRadioItem>
        <MenuRadioItem checked description="Reasons longer." onSelect={() => onPick("high")}>
          High
        </MenuRadioItem>
        <MenuSeparator />
        <MenuSwitchItem checked={false} onToggle={onToggle}>
          Fast mode
        </MenuSwitchItem>
      </Menu>
    </>
  );
}

describe("menu choice items", () => {
  const ui = mountUi();
  afterEach(() => ui.render(null));

  it("renders radio rows with a check and a description, and closes after a pick", () => {
    const onPick = vi.fn();
    ui.render(<Harness onPick={onPick} onToggle={vi.fn()} />);
    const radios = [...document.querySelectorAll('[role="menuitemradio"]')];
    expect(radios.map((node) => node.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(radios[1]?.textContent).toContain("Reasons longer.");
    click(radios[0] as Element);
    expect(onPick).toHaveBeenCalledWith("low");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("toggles a switch row without closing the menu and supports keyboard focus", () => {
    const onToggle = vi.fn();
    ui.render(<Harness onPick={vi.fn()} onToggle={onToggle} />);
    const toggle = document.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    press(document.querySelector('[role="menu"]') as Element, "End");
    expect(document.activeElement).toBe(toggle);
  });
});
```

(`mountUi` returns `{ host, render, unmount }`; if the file pattern in this directory creates it per test, follow that pattern.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/foundation/menuChoiceItems.test.tsx`
Expected: FAIL (`Cannot find module './MenuRadioItem'`).

- [ ] **Step 3: Implement the items**

```tsx
// src/ui/foundation/MenuRadioItem.tsx
import { Check } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { cx } from "./classNames";
import { useMenuContext } from "./menuContext";
import "./overlays.css";

export interface MenuRadioItemProps {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  onSelect(): void;
}

export function MenuRadioItem({
  checked,
  children,
  description,
  disabled = false,
  icon,
  onSelect,
}: MenuRadioItemProps) {
  const menu = useMenuContext();
  const handlePointerEnter = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!disabled) event.currentTarget.focus();
    menu.openSubmenu(null);
  };
  const select = (): void => {
    if (disabled) return;
    onSelect();
    menu.closeAll();
  };
  return (
    <button
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      className={cx("cv-menu__item", description !== undefined && "cv-menu__item--tall")}
      data-cv-menu={menu.menuId}
      onClick={select}
      onPointerEnter={handlePointerEnter}
      role="menuitemradio"
      tabIndex={-1}
      type="button"
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-menu__icon">
          {icon}
        </span>
      )}
      <span className="cv-menu__text">
        {children}
        {description === undefined ? null : <span className="cv-menu__description">{description}</span>}
      </span>
      {checked ? (
        <span aria-hidden="true" className="cv-menu__check">
          <Check size={14} />
        </span>
      ) : null}
    </button>
  );
}
```

```tsx
// src/ui/foundation/MenuSwitchItem.tsx
import type { PointerEvent, ReactNode } from "react";
import { useMenuContext } from "./menuContext";
import "./controls.css";
import "./overlays.css";

export interface MenuSwitchItemProps {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  onToggle(next: boolean): void;
}

export function MenuSwitchItem({ checked, children, disabled = false, onToggle }: MenuSwitchItemProps) {
  const menu = useMenuContext();
  const handlePointerEnter = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!disabled) event.currentTarget.focus();
    menu.openSubmenu(null);
  };
  return (
    <button
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      className="cv-menu__item"
      data-cv-menu={menu.menuId}
      onClick={() => {
        if (disabled) return;
        onToggle(!checked);
      }}
      onPointerEnter={handlePointerEnter}
      role="menuitemcheckbox"
      tabIndex={-1}
      type="button"
    >
      <span className="cv-menu__text">{children}</span>
      <span aria-hidden="true" className="cv-menu__end">
        <span aria-checked={checked} className="cv-switch" role="presentation" />
      </span>
    </button>
  );
}
```

(`cv-switch` styles come from `controls.css`; it keys its "on" state off `[aria-checked="true"]`. If `controls.css` keys it differently, mirror that attribute on the inner span.) Add to `src/ui/foundation/overlays.css`:

```css
.cv-menu__item--tall {
  align-items: flex-start;
  padding-top: var(--cv-space-3);
  padding-bottom: var(--cv-space-3);
}

.cv-menu__description {
  display: block;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  line-height: var(--cv-lh-xs);
}
```

Run: `npx vitest run src/ui/foundation` (PASS, including `foundationStyles.test.ts` which checks token-only styling).

- [ ] **Step 4: Create the picker stylesheet**

Create `src/components/agentMode/pickers/agentPickers.css` with the rules for every class the picker components render (class inventory: `agent-picker`, `agent-picker--open`, `agent-picker__trigger`, `--ghost`, `--plan`, `--danger`, `agent-picker__icon`, `__value`, `__prefix`, `__chevron`, `__menu`, `__menu--start|end|checkout`, `__group`, `__option`, `__option--active|plan|danger`, `__mark`, `__mark--icon`, `__text`, `__label`, `__description`, `__detail`, `__selection`, `__warn`, `__confirmation*`, `agent-model-picker*`, `agent-checkout-search`, `agent-checkout-pages`). Values come from the mockup (`.ctl`, `.pop`, `.mi`, `.mp`, `.mrw`, `.refs`):

```css
.agent-picker {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.agent-picker__trigger {
  display: inline-flex;
  height: 28px;
  max-width: 220px;
  align-items: center;
  padding: 0 var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-control);
  background: none;
  color: var(--cv-fg-muted);
  font: inherit;
  font-size: var(--cv-t-md);
  gap: var(--cv-space-3);
  transition:
    background-color var(--cv-motion-fast) var(--cv-ease),
    color var(--cv-motion-fast) var(--cv-ease);
}

.agent-picker__trigger:hover:not(:disabled),
.agent-picker--open .agent-picker__trigger {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.agent-picker__trigger:focus-visible {
  outline: none;
  box-shadow: var(--cv-ring-focus);
}

.agent-picker__trigger:disabled {
  color: var(--cv-fg-disabled);
}

.agent-picker__trigger--plan {
  color: var(--cv-accent);
}

.agent-picker__trigger--danger {
  color: var(--cv-warn);
}

.agent-picker__value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-picker__icon,
.agent-picker__chevron {
  flex: none;
  color: var(--cv-fg-subtle);
}

.agent-picker__menu {
  position: fixed;
  z-index: var(--cv-z-popover);
  display: grid;
  width: max-content;
  min-width: 160px;
  max-width: min(336px, calc(100vw - 16px));
  max-height: min(360px, calc(100vh - 16px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--cv-space-2);
  border-radius: var(--cv-r-card);
  background: var(--cv-popover);
  box-shadow: var(--cv-shadow-pop);
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-md);
  gap: 0;
}

.agent-picker__group {
  padding: var(--cv-space-3) var(--cv-space-4) var(--cv-space-2);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-weight: 500;
}

.agent-picker__group + .agent-picker__option,
.agent-picker__option + .agent-picker__group {
  margin-top: var(--cv-space-2);
}

.agent-picker__option {
  display: flex;
  min-height: 28px;
  align-items: center;
  padding: var(--cv-space-2) var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-strong);
  font: inherit;
  gap: var(--cv-space-4);
  text-align: left;
}

.agent-picker__option:hover,
.agent-picker__option--active {
  background: var(--cv-tint-2);
}

.agent-picker__option--danger .agent-picker__label {
  color: var(--cv-warn);
}

.agent-picker__mark {
  display: grid;
  width: 14px;
  flex: none;
  color: var(--cv-fg-subtle);
  place-items: center;
}

.agent-picker__text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.agent-picker__label {
  display: flex;
  align-items: center;
  gap: var(--cv-space-3);
}

.agent-picker__description {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  line-height: var(--cv-lh-xs);
}

.agent-picker__detail {
  margin-left: auto;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-2xs);
}

.agent-picker__selection {
  margin-left: auto;
  color: var(--cv-fg-strong);
}

.agent-picker__warn {
  color: var(--cv-warn);
}

.agent-picker__confirmation {
  display: flex;
  margin: var(--cv-space-2) var(--cv-space-4);
  padding: var(--cv-space-4);
  border-radius: var(--cv-r-sm);
  background: var(--cv-warn-soft);
  gap: var(--cv-space-4);
}

.agent-picker__confirmation-label {
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-xs);
  font-weight: 500;
}

.agent-picker__confirmation-description {
  display: block;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.agent-checkout-search {
  position: sticky;
  top: calc(var(--cv-space-2) * -1);
  z-index: 1;
  display: flex;
  height: 36px;
  align-items: center;
  margin: 0 calc(var(--cv-space-2) * -1) var(--cv-space-2);
  padding: 0 10px;
  border-bottom: 1px solid var(--cv-hair);
  background: var(--cv-popover);
  color: var(--cv-fg-subtle);
  gap: var(--cv-space-4);
}

.agent-checkout-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--cv-fg-strong);
  font: inherit;
  outline: none;
}

.agent-checkout-pages {
  position: sticky;
  bottom: calc(var(--cv-space-2) * -1);
  display: flex;
  align-items: center;
  padding: var(--cv-space-4) 10px;
  border-top: 1px solid var(--cv-hair);
  background: var(--cv-popover);
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  gap: var(--cv-space-2);
}

.agent-checkout-pages span {
  flex: 1;
}

.agent-checkout-pages button {
  display: grid;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-strong);
  place-items: center;
}

.agent-checkout-pages button:hover:not(:disabled) {
  background: var(--cv-tint-2);
}
```

Then port the remaining P9-owned groups from `agentComposer.css` into `agentPickers.css`: `.agent-composer__launch*`, `.agent-composer__compact*`, `.agent-composer__lock*`, `.agent-composer__target*`, `.agent-composer__divider` and every rule combining `.agent-composer__footer` with a picker selector. Keep selectors and layout declarations; replace legacy variables using this map: `--agent-text-strong` / `--agent-text` / `--agent-text-muted` / `--agent-text-subtle` -> `--cv-fg-strong` / `--cv-fg` / `--cv-fg-muted` / `--cv-fg-subtle`; `--agent-well` -> `--cv-tint-1`; `--agent-hover` -> `--cv-tint-2`; `--agent-raised` -> `--cv-popover`; `--agent-radius-sm|md|lg` -> `--cv-r-sm` / `--cv-r-control` / `--cv-r-card`; `--agent-fs-xs` -> `--cv-t-xs`; `--agent-mono` -> `--cv-font-mono`; `--agent-motion-hover` -> `--cv-motion-fast`; `--ease-standard` -> `--cv-ease`; `--codevo-shadow-float` -> `--cv-shadow-pop`; `calc(Npx * var(--codevo-fs-scale))` -> `Npx`; any other `--agent-*`/`--codevo-*` -> the nearest `--cv-*` token. The divider becomes `width: 1px; height: 16px; background: var(--cv-hair-strong);` (mockup `.vsep`). Verify with `grep -nE "agent-picker|agent-model-picker|agent-traits-picker|agent-composer__(launch|compact|lock|target|divider)|agent-environment" src/components/agentMode/agentComposer.css` printing nothing and `grep -cE "var\(--(agent|codevo)-" src/components/agentMode/pickers/agentPickers.css` printing `0`. In `AgentComposer.test.tsx` "Airy styling contract" point the picker blocks at `pickers/agentPickers.css` and update their expected values to the ported declarations.

(The model-picker rules are added in Task 13.) Import it once from `AgentPickerMenu.tsx`: `import "./pickers/agentPickers.css";`. Delete the listed groups from `agentComposer.css` and the file `agentCheckoutSearch.css`.

- [ ] **Step 5: Verify nothing else depended on the removed rules**

Run: `grep -rn "agentCheckoutSearch.css" src; npx vitest run src/components/agentMode src/components/cssTokenContract.test.ts src/domain/themeContrast.test.ts`
Expected: grep prints nothing; tests PASS (the picker component tests assert roles and text, not styles).

- [ ] **Step 6: Report changed files to the lead.**

---

### Task 13: Model picker (360 x 346, rail, favorites, NEW badge, legacy row)

**Files:**
- Modify: `src/components/agentMode/AgentModelPicker.tsx`, `src/components/agentMode/AgentModelPicker.test.tsx`, `src/components/agentMode/agentLaunchPresentation.ts` (`AgentModelRow`, `agentModelRows`, `modelRows`), `src/components/agentMode/agentLaunchPresentation.test.ts`, `src/domain/agentLaunch.ts` (after `CODEX_MODEL_CHOICES`), `src/domain/claudeModelCatalog.ts` (`ClaudeManifestModel`, `OPTIONAL_KEYS`, parser), `src/domain/claudeModelCatalog.test.ts`, `src/domain/claudeModelManifest.json`, `src/components/agentMode/pickers/agentPickers.css` (append)

**Interfaces:**
- Produces: `ClaudeManifestModel.isNew?: boolean`; `CODEX_NEW_MODEL_CHOICES: ReadonlySet<CodexModelChoice>` (`"gpt-6-astra"`); `AgentModelRow.isNew: boolean`, `AgentModelRow.isDefault: boolean`; `agentLegacyModelsSummary(rows: ReadonlyArray<AgentModelRow>): string` (e.g. `"Opus 4.8, Sonnet 4.6 and 5 more"`).

- [ ] **Step 1: Write the failing tests**

`src/domain/claudeModelCatalog.test.ts`:

```ts
it("accepts an optional isNew flag and rejects a non-boolean one", () => {
  const manifest = structuredClone(BUNDLED_CLAUDE_MODEL_MANIFEST);
  const first = manifest.claudeCode[0];
  if (first === undefined) return expect(first).toBeDefined();
  expect(parseClaudeModelManifest({ ...manifest, claudeCode: [{ ...first, isNew: true }, ...manifest.claudeCode.slice(1)] }).claudeCode[0]?.isNew).toBe(true);
  expect(() =>
    parseClaudeModelManifest({ ...manifest, claudeCode: [{ ...first, isNew: "yes" }, ...manifest.claudeCode.slice(1)] }),
  ).toThrow();
});
```

(Use the manifest parse function name exported by `claudeModelCatalog.ts`; `parseClaudeModelManifest` is assumed. `structuredClone` of a readonly object needs a cast to a mutable shape; keep the spread form above which does not mutate.)

`src/components/agentMode/agentLaunchPresentation.test.ts`:

```ts
it("marks new and default models and summarizes legacy models", () => {
  const claude = agentModelRows("claudeCode");
  expect(claude.find((row) => row.value === "claude-fable-5-1")?.isNew).toBe(true);
  expect(claude.find((row) => row.value === "claude-sonnet-5")?.isDefault).toBe(true);
  expect(agentModelRows("codex").find((row) => row.value === "gpt-6-astra")?.isNew).toBe(true);
  const legacy = claude.filter((row) => row.isLegacy === true);
  expect(agentLegacyModelsSummary(legacy)).toMatch(/^Fable 5, Opus 4\.8 and \d+ more$/u);
});
```

`src/components/agentMode/AgentModelPicker.test.tsx`:

```tsx
it("shows the NEW badge and a legacy row with a summary", () => {
  renderPicker();
  act(() => trigger().click());
  const fable = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes("Claude Fable 5.1"));
  expect(fable?.querySelector(".agent-model-picker__new")?.textContent).toBe("NEW");
  const legacy = document.querySelector(".agent-model-picker__legacy");
  expect(legacy?.textContent).toContain("Legacy models");
  expect(legacy?.textContent).toMatch(/and \d+ more/u);
});
```

(`renderPicker`/`trigger` are the file's existing helpers.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/domain/claudeModelCatalog.test.ts src/components/agentMode/agentLaunchPresentation.test.ts src/components/agentMode/AgentModelPicker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the data**

`claudeModelCatalog.ts`: add `readonly isNew?: boolean;` to `ClaudeManifestModel`, add `"isNew"` to `OPTIONAL_KEYS`, and in the model parser next to the `isDefault` spread add:

```ts
...(model.isNew === undefined ? {} : { isNew: boolean(model.isNew, `${path}.isNew`) }),
```

`claudeModelManifest.json`: add `"isNew": true` to the `claude-fable-5-1` entry.

`agentLaunch.ts`:

```ts
export const CODEX_NEW_MODEL_CHOICES: ReadonlySet<CodexModelChoice> = new Set(["gpt-6-astra"]);
```

`agentLaunchPresentation.ts`: add `readonly isNew: boolean; readonly isDefault: boolean;` to `AgentModelRow`; in the Claude branch of `agentModelRows` add `isNew: entry.isNew === true, isDefault: entry.isDefault === true,`; in `modelRows` (Codex rows and the configured-default row) add `isNew: CODEX_NEW_MODEL_CHOICES.has(choice)` for Codex choices and `false` otherwise, `isDefault: false`. Add:

```ts
export function agentLegacyModelsSummary(rows: ReadonlyArray<AgentModelRow>): string {
  const names = rows.map((row) => row.label.replace(/^Claude /u, ""));
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
```

- [ ] **Step 4: Update the picker markup**

In `AgentModelPicker.tsx`:
- Row label: after the label text render `{row.isNew ? <span className="agent-model-picker__new">NEW</span> : null}`.
- `LegacyModelsToggle`: title "Legacy models", description `agentLegacyModelsSummary(legacyRows)`, trailing `ChevronRight` rotated 90deg when expanded (keep its `aria-expanded` and behaviour).
- Keep the P5 extraction (`agentModelProviderState.ts` imports) and every existing prop, shortcut and favorites behaviour.

Append to `agentPickers.css`:

```css
.agent-model-picker__dialog {
  position: fixed;
  z-index: var(--cv-z-popover);
  display: flex;
  width: 360px;
  height: 346px;
  max-height: calc(100vh - 16px);
  overflow: hidden;
  border-radius: var(--cv-r-card);
  background: var(--cv-popover);
  box-shadow: var(--cv-shadow-pop);
}

.agent-model-picker__rail {
  display: flex;
  width: 44px;
  flex: none;
  flex-direction: column;
  padding: var(--cv-space-2);
  border-right: 1px solid var(--cv-hair);
  background: var(--cv-tint-1);
  gap: var(--cv-space-2);
}

.agent-model-picker__rail-item {
  display: grid;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--cv-r-control);
  background: none;
  color: var(--cv-fg-subtle);
  place-items: center;
}

.agent-model-picker__rail-item:hover {
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.agent-model-picker__rail-item[aria-pressed="true"],
.agent-model-picker__rail-item[aria-selected="true"] {
  background: var(--cv-tint-3);
  color: var(--cv-fg-strong);
}

.agent-model-picker__pane {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.agent-model-picker__search {
  display: flex;
  height: 40px;
  flex: none;
  align-items: center;
  padding: 0 var(--cv-space-5);
  border-bottom: 1px solid var(--cv-hair);
  color: var(--cv-fg-subtle);
  gap: var(--cv-space-4);
}

.agent-model-picker__input {
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  background: none;
  color: var(--cv-fg-strong);
  font: var(--cv-t-md) var(--cv-font-ui);
  outline: none;
}

.agent-model-picker__list {
  flex: 1;
  overflow: auto;
  padding: var(--cv-space-2);
}

.agent-model-picker__row,
.agent-model-picker__legacy {
  display: flex;
  width: 100%;
  align-items: center;
  padding: 7px var(--cv-space-4);
  border: 0;
  border-radius: var(--cv-r-sm);
  background: none;
  color: var(--cv-fg-strong);
  gap: var(--cv-space-4);
  text-align: left;
}

.agent-model-picker__row:hover,
.agent-model-picker__row--active,
.agent-model-picker__legacy:hover {
  background: var(--cv-tint-2);
}

.agent-model-picker__text {
  min-width: 0;
  flex: 1;
}

.agent-model-picker__label {
  display: flex;
  align-items: center;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-xs);
  font-weight: 500;
  gap: var(--cv-space-3);
  line-height: var(--cv-lh-xs);
}

.agent-model-picker__description {
  display: flex;
  align-items: center;
  margin-top: 3px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  gap: var(--cv-space-3);
  line-height: var(--cv-lh-xs);
}

.agent-model-picker__new {
  display: inline-grid;
  height: 14px;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--cv-accent-soft);
  color: var(--cv-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  place-items: center;
}

.agent-model-picker__star {
  color: var(--cv-fg-subtle);
  opacity: 0;
}

.agent-model-picker__row:hover .agent-model-picker__star,
.agent-model-picker__row--active .agent-model-picker__star,
.agent-model-picker__star[aria-pressed="true"] {
  opacity: 1;
}

.agent-model-picker__star[aria-pressed="true"] {
  color: var(--cv-warn);
}

.agent-model-picker__star[aria-pressed="true"] svg {
  fill: currentColor;
}

.agent-model-picker__kbd {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-2xs);
}

.agent-model-picker__empty {
  padding: 40px var(--cv-space-6);
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-md);
  text-align: center;
}

.agent-model-picker__legacy-chevron--expanded {
  transform: rotate(90deg);
}
```

(If the picker currently positions its dialog through `useAgentPopover` inline `style`, keep that: the `position: fixed` rule matches its existing contract.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/domain/claudeModelCatalog.test.ts src/components/agentMode/agentLaunchPresentation.test.ts src/components/agentMode/AgentModelPicker.test.tsx src/components/agentMode/AgentLaunchControls.test.tsx`
Expected: PASS.

- [ ] **Step 6: Report changed files to the lead.**

---

### Task 14: Effort menu (effort radio group, context window, fast mode, thinking, browser)

**Files:**
- Modify: `src/components/agentMode/AgentTraitsPicker.tsx`, `src/components/agentMode/AgentLaunchControls.test.tsx` (the "Model capabilities" cases)
- Create: `src/components/agentMode/AgentTraitsPicker.test.tsx`

**Interfaces:**
- Consumes: `Menu`, `MenuLabel`, `MenuSeparator` (`src/ui/foundation/Menu.tsx`, `MenuItem.tsx`), `MenuRadioItem`, `MenuSwitchItem` (Task 12), `agentClaudeLaunchTraits`, `agentLaunchWith*` (unchanged), `useAgentControlOpenRequest` (unchanged).
- Produces: same `AgentTraitsPicker` props; trigger keeps `id="agent-launch-effort"` and `aria-label="Model capabilities"`; trigger text is the existing summary (for example `High · 1M`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/agentMode/AgentTraitsPicker.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_LAUNCH_OPTIONS, type AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentTraitsPicker } from "./AgentTraitsPicker";

describe("AgentTraitsPicker", () => {
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

  function render(onChange = vi.fn()) {
    const launch = {
      ...DEFAULT_AGENT_LAUNCH_OPTIONS,
      provider: "claudeCode",
      model: "claude-opus-5-5",
      effort: "high",
    } as AgentLaunchOptions & { readonly provider: "claudeCode" };
    act(() =>
      root.render(
        <AgentTraitsPicker
          configuredModel={null}
          disabled={false}
          executionTarget="local"
          launch={launch}
          onChange={onChange}
        />,
      ),
    );
    return onChange;
  }

  it("opens a menu with an effort radio group and the checked effort", () => {
    render();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Model capabilities"]')?.click());
    const menu = document.querySelector('[role="menu"][aria-label="Effort and options"]');
    expect(menu?.textContent).toContain("Effort");
    const checked = [...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].map(
      (node) => node.textContent,
    );
    expect(checked[0]).toContain("High");
  });

  it("changes effort and closes; Escape returns focus to the trigger", () => {
    const onChange = render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Model capabilities"]');
    act(() => trigger?.click());
    const low = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (node) => node.textContent === "Low",
    );
    act(() => low?.click());
    expect(onChange.mock.calls[0]?.[0].effort).toBe("low");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => trigger?.click());
    act(() => {
      document.querySelector('[role="menu"]')?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(document.activeElement).toBe(trigger);
  });
});
```

(Use the real `ClaudeLaunchOptions` field set of `DEFAULT_AGENT_LAUNCH_OPTIONS`; if the default is a Codex launch, build the Claude launch with `defaultAgentComposerLaunch("claudeCode")` from `./agentComposerLaunch` and override `model`/`effort`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/agentMode/AgentTraitsPicker.test.tsx`
Expected: FAIL (radio buttons, no `role="menu"`).

- [ ] **Step 3: Rewrite the picker body on the foundation menu**

Replace the popover in `AgentTraitsPicker.tsx` (keep props, `traits`, `effort`, `context`, `summary` computations, `EFFORT_LABELS`, `CONTEXT_LABELS`):

```tsx
const triggerRef = useRef<HTMLButtonElement | null>(null);
const [open, setOpen] = useState(false);
useAgentControlOpenRequest(openRequest, () => setOpen(true), onOpenRequestHandled);
const efforts = traits.efforts.filter((choice) => choice !== "ultracode" && choice !== "ultrathink");
const modes = traits.efforts.filter((choice) => choice === "ultracode" || choice === "ultrathink");
const pickEffort = (choice: ClaudeEffortChoice) =>
  onChange(agentLaunchWithEffort(launch, choice, configuredModel, catalog));

return (
  <div className="agent-picker">
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label="Model capabilities"
      className="agent-picker__trigger agent-picker__trigger--ghost"
      data-value={launch.effort}
      disabled={disabled}
      id="agent-launch-effort"
      onClick={() => setOpen((current) => !current)}
      ref={triggerRef}
      type="button"
    >
      <span className="agent-picker__value">{summary}</span>
      <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
    </button>
    <Menu
      anchorRef={triggerRef}
      label="Effort and options"
      onClose={() => setOpen(false)}
      open={open}
      placement="top-start"
    >
      {efforts.length > 0 ? <MenuLabel>Effort</MenuLabel> : null}
      {efforts.map((choice) => (
        <MenuRadioItem
          checked={effort === choice}
          description={traits.defaultEffort === choice ? "Default" : undefined}
          key={choice}
          onSelect={() => pickEffort(choice)}
        >
          {EFFORT_LABELS[choice]}
        </MenuRadioItem>
      ))}
      {modes.length > 0 ? <MenuSeparator /> : null}
      {modes.map((choice) => (
        <MenuRadioItem
          checked={effort === choice}
          description={EFFORT_MODE_DESCRIPTIONS[choice]}
          key={choice}
          onSelect={() => pickEffort(choice)}
        >
          {EFFORT_LABELS[choice]}
        </MenuRadioItem>
      ))}
      {traits.contextWindows.length > 0 && context !== null ? (
        <>
          <MenuSeparator />
          <MenuLabel>Context window</MenuLabel>
          {traits.contextWindows.map((choice) => (
            <MenuRadioItem
              checked={context === choice}
              key={choice}
              onSelect={() => onChange(agentLaunchWithContext(launch, choice, configuredModel, catalog))}
            >
              {CONTEXT_LABELS[choice]}
            </MenuRadioItem>
          ))}
        </>
      ) : null}
      {traits.fastMode || traits.thinkingMode || traits.chrome ? <MenuSeparator /> : null}
      {traits.fastMode ? (
        <MenuSwitchItem
          checked={launch.fastMode === true}
          onToggle={(next) => onChange(agentLaunchWithFastMode(launch, next, configuredModel, catalog))}
        >
          Fast mode
        </MenuSwitchItem>
      ) : null}
      {traits.thinkingMode ? (
        <MenuSwitchItem
          checked={launch.thinkingMode === true}
          onToggle={(next) => onChange(agentLaunchWithThinkingMode(launch, next, configuredModel, catalog))}
        >
          Thinking
        </MenuSwitchItem>
      ) : null}
      {traits.chrome ? (
        <MenuSwitchItem
          checked={launch.chrome !== false}
          onToggle={(next) => onChange(agentLaunchWithChrome(launch, next, configuredModel, catalog))}
        >
          Chrome browser tools
        </MenuSwitchItem>
      ) : null}
    </Menu>
  </div>
);
```

with

```ts
const EFFORT_MODE_DESCRIPTIONS: Readonly<Record<"ultracode" | "ultrathink", string>> = {
  ultracode: "Extra high plus multi-agent orchestration.",
  ultrathink: "Prefixes prompts with Ultrathink.",
};
```

Change `EFFORT_LABELS.xhigh` to `"Extra high"` (mockup casing). Remove `TraitGroup`, `TraitOption`, `useAgentPopover`, `focusFirstInPopover`, `trapPopoverTab`, `useLayoutEffect` imports that become unused. Imports to add: `useRef`, `useState` from `react`; `Menu` from `../../ui/foundation/Menu`; `MenuLabel`, `MenuSeparator` from `../../ui/foundation/MenuItem`; `MenuRadioItem`, `MenuSwitchItem`.

Delete the `.agent-traits-picker*` rules (already removed from `agentComposer.css` in Task 12; nothing replaces them because the foundation menu styles the surface).

- [ ] **Step 4: Update the launch-controls tests and run**

In `AgentLaunchControls.test.tsx`, the cases that query `role="radio"` inside "Model capabilities" now query `role="menuitemradio"` / `role="menuitemcheckbox"` inside `document` (the menu is portaled to `document.body`). Run:

`npx vitest run src/components/agentMode/AgentTraitsPicker.test.tsx src/components/agentMode/AgentLaunchControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Report changed files to the lead.**

---

### Task 15: Access menu (four access modes, Plan mode, CLI settings)

**Files:**
- Create: `src/components/agentMode/AgentAccessMenu.tsx`, `src/components/agentMode/AgentAccessMenu.test.tsx`
- Modify: `src/components/agentMode/agentLaunchPresentation.ts` (`agentLaunchModeChoices`, new `agentLaunchModeGroups`), `src/components/agentMode/agentLaunchPresentation.test.ts`, `src/components/agentMode/AgentLaunchControls.tsx` (replace the permission `AgentPickerMenu` block; keep P5's `selectModel` and `useComposerPaletteBinding` lines), `src/components/agentMode/AgentLaunchControls.test.tsx`

**Interfaces:**
- Produces: `agentLaunchModeGroups(provider, target): { access: ReadonlyArray<AgentLaunchChoice>; other: ReadonlyArray<AgentLaunchChoice> }` where Claude `access = supervised, acceptEdits, auto, bypassPermissions` and `other = plan, default`; Codex `access = readOnly, workspaceWrite, auto, dangerFullAccess` and `other = default`. `agentLaunchModeChoices` keeps returning `[...access, ...other]` so existing callers see the new rows. `AgentAccessMenu({ launch, target, disabled, openRequest?, onOpenRequestHandled?, onChange(mode: string) })`, trigger `id="agent-launch-mode"`, `aria-label="Agent permission mode"`, text = the selected choice label, icon = `Lock` / `LockOpen` by `agentLaunchAccess`.

- [ ] **Step 1: Write the failing tests**

```ts
// agentLaunchPresentation.test.ts
it("offers plan mode and the CLI default next to the access modes", () => {
  const claude = agentLaunchModeGroups("claudeCode", "local");
  expect(claude.access.map((choice) => choice.value)).toEqual(["supervised", "acceptEdits", "auto", "bypassPermissions"]);
  expect(claude.other.map((choice) => [choice.value, choice.label])).toEqual([
    ["plan", "Plan mode"],
    ["default", "Use Claude CLI settings"],
  ]);
  const codex = agentLaunchModeGroups("codex", "local");
  expect(codex.other.map((choice) => choice.value)).toEqual(["default"]);
});
```

```tsx
// src/components/agentMode/AgentAccessMenu.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentComposerLaunch } from "./agentComposerLaunch";
import { AgentAccessMenu } from "./AgentAccessMenu";

describe("AgentAccessMenu", () => {
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

  it("lists access modes, then plan and CLI settings, and selects plan mode", () => {
    const onChange = vi.fn();
    const launch = { ...defaultAgentComposerLaunch("claudeCode"), mode: "bypassPermissions" as const };
    act(() => root.render(<AgentAccessMenu disabled={false} launch={launch} onChange={onChange} target="local" />));
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Agent permission mode"]');
    expect(trigger?.textContent).toContain("Full access");
    act(() => trigger?.click());
    const rows = [...document.querySelectorAll('[role="menuitemradio"]')].map((node) => node.textContent);
    expect(rows[0]).toContain("Supervised");
    expect(rows[3]).toContain("Full access");
    expect(rows[4]).toContain("Plan mode");
    expect(rows[5]).toContain("Use Claude CLI settings");
    expect(document.querySelectorAll('[role="menu"] [role="separator"]').length).toBe(1);
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')][4]?.click());
    expect(onChange).toHaveBeenCalledWith("plan");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/agentMode/agentLaunchPresentation.test.ts src/components/agentMode/AgentAccessMenu.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the choices and the menu**

In `agentLaunchPresentation.ts` change `CLAUDE_MODE_TEXT.default.label` to `"Use Claude CLI settings"` and the Codex default label to `"Use Codex CLI settings"` (only the `label`, keep `meta`/`hint`). Add:

```ts
export interface AgentLaunchModeGroups {
  readonly access: ReadonlyArray<AgentLaunchChoice>;
  readonly other: ReadonlyArray<AgentLaunchChoice>;
}

export function agentLaunchModeGroups(
  provider: AgentCliKind,
  target: AgentExecutionTarget = "local",
): AgentLaunchModeGroups {
  if (provider === "claudeCode") {
    const text = targetModeText(CLAUDE_MODE_TEXT, REMOTE_CLAUDE_MODE_HINT, target);
    const tone = (mode: ClaudePermissionMode) =>
      agentLaunchTone({ provider, model: "default", mode, effort: "default" });
    return {
      access: choices(["supervised", "acceptEdits", "auto", "bypassPermissions"] as const, text, tone),
      other: choices(["plan", "default"] as const, text, tone),
    };
  }
  const text = targetModeText(CODEX_MODE_TEXT, REMOTE_CODEX_MODE_HINT, target);
  const tone = (mode: CodexExecutionMode) => agentLaunchTone({ provider, model: "default", mode });
  return {
    access: choices(["readOnly", "workspaceWrite", "auto", "dangerFullAccess"] as const, text, tone),
    other: choices(["default"] as const, text, tone),
  };
}
```

and make `agentLaunchModeChoices` return `[...groups.access, ...groups.other]` from `agentLaunchModeGroups(provider, target)`. (Check any test that asserted exactly four choices and update it to six/five.)

```tsx
// src/components/agentMode/AgentAccessMenu.tsx
import { ChevronDown, ClipboardList, Lock, LockOpen, PenLine, Settings2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentExecutionTarget, AgentLaunchOptions } from "../../domain/agentLaunch";
import { Menu } from "../../ui/foundation/Menu";
import { MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import {
  agentLaunchAccess,
  agentLaunchModeGroups,
  agentLaunchTone,
  type AgentLaunchChoice,
} from "./agentLaunchPresentation";
import { useAgentControlOpenRequest } from "./useAgentControlOpenRequest";

export interface AgentAccessMenuProps {
  readonly disabled: boolean;
  readonly launch: AgentLaunchOptions;
  readonly openRequest?: object | null;
  readonly target: AgentExecutionTarget;
  onChange(mode: string): void;
  onOpenRequestHandled?(): void;
}

export function AgentAccessMenu({
  disabled,
  launch,
  onChange,
  onOpenRequestHandled,
  openRequest = null,
  target,
}: AgentAccessMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  useAgentControlOpenRequest(openRequest, () => setOpen(true), onOpenRequestHandled);
  const groups = agentLaunchModeGroups(launch.provider, target);
  const selected = [...groups.access, ...groups.other].find((choice) => choice.value === launch.mode);
  const tone = agentLaunchTone(launch);
  const row = (choice: AgentLaunchChoice) => (
    <MenuRadioItem
      checked={choice.value === launch.mode}
      description={choice.value === "default" ? undefined : choice.hint}
      icon={modeIcon(choice.value)}
      key={choice.value}
      onSelect={() => onChange(choice.value)}
    >
      {choice.label}
    </MenuRadioItem>
  );
  return (
    <div className="agent-picker">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Agent permission mode"
        className={`agent-picker__trigger agent-picker__trigger--ghost${tone === null ? "" : ` agent-picker__trigger--${tone}`}`}
        disabled={disabled}
        id="agent-launch-mode"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        {agentLaunchAccess(launch) === "open" ? (
          <LockOpen aria-hidden="true" className="agent-picker__icon" size={14} />
        ) : (
          <Lock aria-hidden="true" className="agent-picker__icon" size={14} />
        )}
        <span className="agent-picker__value">{selected?.label ?? launch.mode}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
      </button>
      <Menu anchorRef={triggerRef} label="Access" onClose={() => setOpen(false)} open={open} placement="top-start">
        <MenuLabel>Access</MenuLabel>
        {groups.access.map(row)}
        <MenuSeparator />
        {groups.other.map(row)}
      </Menu>
    </div>
  );
}

function modeIcon(value: string) {
  if (value === "supervised" || value === "readOnly") return <Lock size={14} />;
  if (value === "acceptEdits" || value === "workspaceWrite") return <PenLine size={14} />;
  if (value === "auto") return <Sparkles size={14} />;
  if (value === "plan") return <ClipboardList size={14} />;
  if (value === "default") return <Settings2 size={14} />;
  return <LockOpen size={14} />;
}
```

(`agentLaunchTone` returns `"plan" | "danger" | null`, matching the trigger modifiers.) In `AgentLaunchControls.tsx` replace the `AgentPickerMenu` permission block and its hidden hint span with:

```tsx
<AgentAccessMenu
  disabled={disabled}
  launch={effectiveLaunch}
  onChange={(value) => onLaunchChange(agentLaunchWithMode(effectiveLaunch, value))}
  onOpenRequestHandled={onOpenRequestHandled}
  openRequest={openRequest?.kind === "permissions" ? openRequest : null}
  target={executionTarget}
/>
```

Remove the now unused imports (`AgentPickerMenu`, `agentPickerOption`, `toOption`, `modeOptionIcon`, `accessIcon`, `agentLaunchModeHint` if unused).

- [ ] **Step 4: Update the launch-controls tests and run**

In `AgentLaunchControls.test.tsx` replace listbox/option queries for "Agent permission mode" with `menuitemradio` queries on `document`. Run:

`npx vitest run src/components/agentMode/agentLaunchPresentation.test.ts src/components/agentMode/AgentAccessMenu.test.tsx src/components/agentMode/AgentLaunchControls.test.tsx src/components/agentMode/AgentComposer.test.tsx`
Expected: PASS (the `/plan` command path is unchanged).

- [ ] **Step 5: Report changed files to the lead.**

---

### Task 16: Environment and checkout popover in the drawer

**Files:**
- Create: `src/components/agentMode/AgentEnvironmentCheckoutPicker.tsx`, `src/components/agentMode/AgentEnvironmentCheckoutPicker.test.tsx`
- Modify: `src/components/agentMode/AgentComposer.tsx` (`drawerStart` element and `targetControls` only), `src/components/agentMode/AgentComposerControls.tsx` (add `AgentRepositoryPicker`), `src/components/agentMode/agentComposerCheckout.tsx` (label "Isolated worktree" -> "New worktree", export `agentComposerRepositoryOptions`)
- Delete: `src/components/agentMode/AgentExecutionEnvironmentPicker.tsx`, `src/components/agentMode/agentExecutionEnvironmentPicker.css`; move the still-relevant cases of `AgentExecutionEnvironmentPicker.test.tsx` into the new test and delete the old test

**Interfaces:**
- Consumes: `useRemoteRunnerContext()` (`servers`, `selectedServerId`, `selectServer`), `AgentTaskIsolation`, `agentComposerCheckoutOptions`, foundation `Menu`, `MenuLabel`, `MenuSeparator`, `MenuItem`, `MenuRadioItem`.
- Produces: `AgentEnvironmentCheckoutPicker({ disabled, isolation, worktreeAvailable, worktreeOnly, remote, onIsolationChange, onRefreshIsolation?, onOpenEnvironmentSettings })`; `AgentRepositoryPicker({ disabled, target, onSelectRepository })` (only rendered when `target.repositoryOptions.length > 0`; keeps the searchable/paged `AgentPickerMenu` for many repositories).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/agentMode/AgentEnvironmentCheckoutPicker.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEnvironmentCheckoutPicker } from "./AgentEnvironmentCheckoutPicker";

describe("AgentEnvironmentCheckoutPicker", () => {
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

  function render(overrides: Partial<Parameters<typeof AgentEnvironmentCheckoutPicker>[0]> = {}) {
    const props = {
      disabled: false,
      isolation: "in-place" as const,
      onIsolationChange: vi.fn(),
      onOpenEnvironmentSettings: vi.fn(),
      remote: false,
      worktreeAvailable: true,
      worktreeOnly: false,
      ...overrides,
    };
    act(() => root.render(<AgentEnvironmentCheckoutPicker {...props} />));
    return props;
  }

  it("shows the checkout on the trigger and groups Run on and Checkout", () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(trigger?.textContent).toContain("Local checkout");
    act(() => trigger?.click());
    const labels = [...document.querySelectorAll('[role="menu"] .cv-menu__label')].map((node) => node.textContent);
    expect(labels).toEqual(["Run on", "Checkout"]);
    const checked = [...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].map((node) => node.textContent);
    expect(checked).toEqual([expect.stringContaining("This computer"), expect.stringContaining("Local checkout")]);
  });

  it("switches to a new worktree and offers Manage environments", () => {
    const props = render();
    act(() => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click());
    const worktree = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((node) =>
      node.textContent?.includes("New worktree"),
    );
    act(() => worktree?.click());
    expect(props.onIsolationChange).toHaveBeenCalledWith("worktree");
    act(() => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click());
    const manage = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (node) => node.textContent === "Manage environments",
    );
    act(() => manage?.click());
    expect(props.onOpenEnvironmentSettings).toHaveBeenCalledOnce();
  });

  it("disables Local checkout when the project requires a worktree", () => {
    render({ isolation: "worktree", worktreeOnly: true });
    act(() => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click());
    const local = [...document.querySelectorAll('[role="menuitemradio"]')].find((node) =>
      node.textContent?.includes("Local checkout"),
    );
    expect(local?.getAttribute("aria-disabled")).toBe("true");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/agentMode/AgentEnvironmentCheckoutPicker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the picker**

```tsx
// src/components/agentMode/AgentEnvironmentCheckoutPicker.tsx
import { ChevronDown, Folder, GitBranch, Monitor, Server } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem, MenuLabel, MenuSeparator } from "../../ui/foundation/MenuItem";
import { MenuRadioItem } from "../../ui/foundation/MenuRadioItem";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";

export interface AgentEnvironmentCheckoutPickerProps {
  readonly disabled: boolean;
  readonly isolation: AgentTaskIsolation;
  readonly remote: boolean;
  readonly worktreeAvailable: boolean;
  readonly worktreeOnly: boolean;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onOpenEnvironmentSettings(): void;
  onRefreshIsolation?(): void;
}

export function AgentEnvironmentCheckoutPicker({
  disabled,
  isolation,
  onIsolationChange,
  onOpenEnvironmentSettings,
  onRefreshIsolation,
  remote,
  worktreeAvailable,
  worktreeOnly,
}: AgentEnvironmentCheckoutPickerProps) {
  const runner = useRemoteRunnerContext();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedServerId = runner?.selectedServerId ?? null;
  const localLabel = remote ? "Server checkout" : "Local checkout";
  const triggerLabel = isolation === "worktree" ? "New worktree" : localLabel;

  return (
    <div className="agent-picker">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Workspace: ${triggerLabel}`}
        className="agent-picker__trigger agent-picker__trigger--ghost"
        disabled={disabled}
        onClick={() => {
          if (!open) onRefreshIsolation?.();
          setOpen((current) => !current);
        }}
        ref={triggerRef}
        type="button"
      >
        {isolation === "worktree" ? (
          <GitBranch aria-hidden="true" className="agent-picker__icon" size={14} />
        ) : (
          <Folder aria-hidden="true" className="agent-picker__icon" size={14} />
        )}
        <span className="agent-picker__value">{triggerLabel}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
      </button>
      <Menu anchorRef={triggerRef} label="Workspace" onClose={() => setOpen(false)} open={open} placement="top-start">
        <MenuLabel>Run on</MenuLabel>
        <MenuRadioItem
          checked={selectedServerId === null}
          icon={<Monitor size={14} />}
          onSelect={() => runner?.selectServer(null)}
        >
          This computer
        </MenuRadioItem>
        {(runner?.servers ?? []).map((server) => (
          <MenuRadioItem
            checked={selectedServerId === server.id}
            description={server.connected ? "Linux server over SSH" : "Not connected"}
            disabled={!server.connected}
            icon={<Server size={14} />}
            key={server.id}
            onSelect={() => runner?.selectServer(server.id)}
          >
            {server.name}
          </MenuRadioItem>
        ))}
        <MenuSeparator />
        <MenuLabel>Checkout</MenuLabel>
        <MenuRadioItem
          checked={isolation === "in-place"}
          disabled={worktreeOnly}
          icon={<Folder size={14} />}
          onSelect={() => onIsolationChange("in-place")}
        >
          {localLabel}
        </MenuRadioItem>
        {worktreeAvailable || worktreeOnly ? (
          <MenuRadioItem
            checked={isolation === "worktree"}
            description="Runs in a new git worktree from the selected branch."
            icon={<GitBranch size={14} />}
            onSelect={() => onIsolationChange("worktree")}
          >
            New worktree
          </MenuRadioItem>
        ) : null}
        <MenuSeparator />
        <MenuItem onSelect={onOpenEnvironmentSettings}>Manage environments</MenuItem>
      </Menu>
    </div>
  );
}
```

(If the remote server type has no `connected` or `name` field under those names, use the names `AgentExecutionEnvironmentPicker.tsx` reads today; it reads `server.connected`, `server.name`, `server.id`.) Locked follow-ups keep `AgentComposerLockedCheckout` plus a read-only run-on label: move the `locked` branch of the old environment picker into `AgentComposerLockedCheckout` as an optional `executionServerName?: string | null` prop shown before the checkout label.

`AgentComposerControls.tsx`: add

```tsx
export function AgentRepositoryPicker({
  disabled,
  onSelectRepository,
  target,
}: {
  readonly disabled: boolean;
  readonly target: AgentComposerTarget | null;
  onSelectRepository(repositoryRoot: string): void;
}) {
  if (target === null || target.repositoryOptions.length === 0) return null;
  return (
    <AgentComposerCheckout
      disabled={disabled}
      isolation="in-place"
      onIsolationChange={() => undefined}
      onSelectRepository={onSelectRepository}
      repositoriesOnly
      target={target}
      worktreeAvailable={false}
      worktreeOnly={false}
    />
  );
}
```

and give `AgentComposerCheckout` an optional `repositoriesOnly?: boolean` prop: when true, `options` are only the "Run in repository" group (`agentComposerCheckoutOptions(...).filter((option) => option.group !== null)`), the label is `"Repository for this thread"`, and the trigger shows the selected repository label.

`AgentComposer.tsx`: in the plain `drawerStart` element replace `AgentExecutionEnvironmentPicker` and the following `.agent-composer__divider` with `AgentEnvironmentCheckoutPicker`, and make `targetControls` (the non-follow-up branch of `checkout`) render `AgentRepositoryPicker` instead of `AgentComposerCheckout`. The result for a new thread is:

```tsx
<>
  <AgentEnvironmentCheckoutPicker
    disabled={dispatching || allProvidersDisabled}
    isolation={isolation}
    onIsolationChange={onIsolationChange}
    onOpenEnvironmentSettings={onOpenEnvironmentSettings ?? onOpenProviderSettings}
    onRefreshIsolation={onRefreshIsolation}
    remote={executionTarget === "server"}
    worktreeAvailable={worktreeAvailable}
    worktreeOnly={worktreeOnly}
  />
  <AgentRepositoryPicker
    disabled={dispatching || allProvidersDisabled}
    onSelectRepository={onSelectRepository}
    target={target}
  />
</>
```

(use the exact local names already in scope in `AgentComposer.tsx`), keeping `const checkout = followUp ? <AgentComposerLockedCheckout .../> : targetControls` so follow-ups still show the locked checkout. In `agentComposerCheckout.tsx` rename the "Isolated worktree" label to "New worktree" (and the matching text in `AgentComposerLockedCheckout`'s `isolationLabel`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/agentMode/AgentEnvironmentCheckoutPicker.test.tsx src/components/agentMode/AgentComposer.test.tsx src/components/agentMode`
Expected: PASS after updating `AgentComposer.test.tsx` cases that looked for "Isolated worktree" or the "Checkout for this thread" listbox (they now use the "Workspace" menu, or `AgentRepositoryPicker` for nested repositories).

- [ ] **Step 5: Report changed files to the lead.**

---
### Task 17: Composer branch picker (F8 UI, local switch/create, worktree base selection)

**Files:**
- Create: `src/domain/agentWorktreeBase.ts`, `src/domain/agentWorktreeBase.test.ts`, `src/application/useComposerBranchPicker.ts`, `src/application/useComposerBranchPicker.test.tsx`, `src/components/agentMode/composerBranchItems.ts`, `src/components/agentMode/AgentComposerBranchPicker.tsx`, `src/components/agentMode/AgentComposerBranchPicker.test.tsx`
- Modify: `src/application/useAgentBranchCheckout.ts:5` (widen `AgentBranchCheckoutGateway`), the test fakes of that gateway (`grep -rln "switchBranch" src --include=*.test.*` inside `src/components/agentMode` and `src/application`), `src/components/agentMode/composer/AgentComposerFrame.tsx` (two fields on `AgentComposerDrawerContext`), `src/components/agentMode/AgentComposer.tsx` (`drawerContext` `useMemo`), `src/components/agentMode/useAgentComposerState.ts` (worktree base state), `src/components/agentMode/AgentModeView.tsx` (pass `renderDrawerEnd`), `src/components/agentMode/pickers/agentPickers.css` (append)

**Interfaces:**
- Consumes: P3 `AgentComposerDrawerContext { repositoryRoot: string | null; isolation: AgentTaskIsolation; locked: boolean; disabled: boolean }` and `renderDrawerEnd?: (context) => ReactNode` on `AgentComposerControllerProps`; `chrome.branchCheckout: { gateway; guard } | null` (`agentWorkbenchChrome.ts:117`); P6 `validateNewBranchName(name): { kind: "ok"; name: string } | { kind: "invalid"; reason: string }` and `gitBranchPickerItems(...)` from `src/domain/gitBranchPicker.ts`; foundation `Popover`.
- Produces:
  - `AgentBranchRef = `refs/heads/${string}` | `refs/remotes/${string}``; `AgentWorktreeBase = { kind: "head" } | { kind: "ref"; ref: AgentBranchRef }`; `HEAD_WORKTREE_BASE`; `MAX_AGENT_BRANCH_REF_BYTES = 256`; `parseAgentBranchRef(value: unknown): AgentBranchRef | null`; `localBranchRef(name)`, `remoteBranchRef(remote, name)`, `agentBranchRefLabel(ref)`.
  - `AgentBranchCheckoutGateway = Pick<GitGateway, "switchBranch" | "checkoutRemoteBranch" | "createBranch"> & Pick<GitHistoryGateway, "getBranches">`.
  - `useComposerBranchPicker({ target, gateway, guard }): ComposerBranchPicker` with `ComposerBranchPicker { list: ComposerBranchList; pending: boolean; error: string | null; load(): void; switchTo(item: ComposerBranchItem): Promise<void>; create(name: string): Promise<void> }`, `ComposerBranchList = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; branches: GitBranches } | { kind: "error"; message: string }`.
  - `ComposerBranchItem { ref: AgentBranchRef; name: string; kind: "local" | "remote"; current: boolean }` (exported from `useComposerBranchPicker.ts`), `composerBranchItems(branches: GitBranches, query: string): ReadonlyArray<ComposerBranchItem>` (max 200, in `composerBranchItems.ts`).
  - `AgentComposerDrawerContext` gains `worktreeBase: AgentWorktreeBase` and `onWorktreeBaseChange(base: AgentWorktreeBase): void`.
  - `AgentComposerBranchPicker({ context, branchCheckout })`.

- [ ] **Step 1: Write the failing domain test**

```ts
// src/domain/agentWorktreeBase.test.ts
import { describe, expect, it } from "vitest";
import {
  agentBranchRefLabel,
  localBranchRef,
  parseAgentBranchRef,
  remoteBranchRef,
} from "./agentWorktreeBase";

describe("parseAgentBranchRef", () => {
  it.each([
    "refs/heads/main",
    "refs/heads/feat/idempotency-keys",
    "refs/remotes/origin/release/2.4",
  ])("accepts %s", (value) => {
    expect(parseAgentBranchRef(value)).toBe(value);
  });

  it.each([
    ["an option", "-b"],
    ["an option-looking branch", "refs/heads/--upload-pack=x"],
    ["a revision expression", "refs/heads/HEAD~1"],
    ["a range", "refs/heads/a..b"],
    ["a reflog selector", "refs/heads/@{-1}"],
    ["a tag", "refs/tags/v1"],
    ["a bare name", "main"],
    ["a control character", "refs/heads/ma\u0007in"],
    ["whitespace", "refs/heads/my branch"],
    ["a trailing slash", "refs/heads/main/"],
    ["a lock suffix", "refs/heads/main.lock"],
    ["an empty segment", "refs/heads/a//b"],
    ["a dot segment", "refs/heads/.hidden"],
    ["an empty name", "refs/heads/"],
    ["an oversized ref", `refs/heads/${"a".repeat(600)}`],
    ["a non-string", 42],
  ])("rejects %s", (_label, value) => {
    expect(parseAgentBranchRef(value)).toBeNull();
  });

  it("builds and labels refs", () => {
    expect(localBranchRef("main")).toBe("refs/heads/main");
    expect(remoteBranchRef("origin", "release/2.4")).toBe("refs/remotes/origin/release/2.4");
    expect(agentBranchRefLabel("refs/remotes/origin/release/2.4")).toBe("origin/release/2.4");
    expect(localBranchRef("-x")).toBeNull();
  });
});
```

Run: `npx vitest run src/domain/agentWorktreeBase.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement the domain module**

```ts
// src/domain/agentWorktreeBase.ts
export type AgentBranchRef = `refs/heads/${string}` | `refs/remotes/${string}`;

export type AgentWorktreeBase =
  | { readonly kind: "head" }
  | { readonly kind: "ref"; readonly ref: AgentBranchRef };

export const HEAD_WORKTREE_BASE: AgentWorktreeBase = { kind: "head" };
export const MAX_AGENT_BRANCH_REF_BYTES = 256;

const LOCAL_PREFIX = "refs/heads/";
const REMOTE_PREFIX = "refs/remotes/";
const FORBIDDEN_CHARACTERS = /[\u0000- \u007f~^:?*[\\]/u;

export function parseAgentBranchRef(value: unknown): AgentBranchRef | null {
  if (typeof value !== "string") return null;
  if (new TextEncoder().encode(value).length > MAX_AGENT_BRANCH_REF_BYTES) return null;
  const prefix = refPrefix(value);
  if (prefix === null) return null;
  const name = value.slice(prefix.length);
  if (!validRefName(name)) return null;
  return value as AgentBranchRef;
}

export function localBranchRef(name: string): AgentBranchRef | null {
  return parseAgentBranchRef(`${LOCAL_PREFIX}${name}`);
}

export function remoteBranchRef(remote: string, name: string): AgentBranchRef | null {
  return parseAgentBranchRef(`${REMOTE_PREFIX}${remote}/${name}`);
}

export function agentBranchRefLabel(ref: AgentBranchRef): string {
  if (ref.startsWith(LOCAL_PREFIX)) return ref.slice(LOCAL_PREFIX.length);
  return ref.slice(REMOTE_PREFIX.length);
}

function refPrefix(value: string): string | null {
  if (value.startsWith(LOCAL_PREFIX)) return LOCAL_PREFIX;
  if (value.startsWith(REMOTE_PREFIX)) return REMOTE_PREFIX;
  return null;
}

function validRefName(name: string): boolean {
  if (name === "") return false;
  if (FORBIDDEN_CHARACTERS.test(name)) return false;
  if (name.includes("..") || name.includes("@{") || name === "@") return false;
  if (name.endsWith(".lock") || name.endsWith(".")) return false;
  if (/(^|\/)HEAD($|~|\^)/u.test(name)) return false;
  return name.split("/").every((segment) => segment !== "" && !segment.startsWith(".") && !segment.startsWith("-"));
}
```

Run the test: PASS.

- [ ] **Step 3: Write the failing hook test**

```tsx
// src/application/useComposerBranchPicker.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranches } from "../domain/git";
import type { AgentBranchCheckoutGateway } from "./useAgentBranchCheckout";
import { useComposerBranchPicker, type ComposerBranchPicker } from "./useComposerBranchPicker";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const branchesA: GitBranches = { current: "main", local: ["main", "feat/a"], remotes: { origin: ["main"] } };
const branchesB: GitBranches = { current: "develop", local: ["develop"], remotes: {} };

describe("useComposerBranchPicker", () => {
  let host: HTMLDivElement;
  let root: Root;
  let picker: ComposerBranchPicker | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    picker = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness(props: { gateway: AgentBranchCheckoutGateway; repositoryRoot: string; guard?: () => string | null }) {
    picker = useComposerBranchPicker({
      gateway: props.gateway,
      guard: props.guard ?? (() => null),
      target: { ownerKey: props.repositoryRoot, repositoryRoot: props.repositoryRoot },
    });
    return null;
  }

  function gateway(overrides: Partial<AgentBranchCheckoutGateway> = {}): AgentBranchCheckoutGateway {
    return {
      checkoutRemoteBranch: vi.fn(async () => []),
      createBranch: vi.fn(async () => undefined),
      getBranches: vi.fn(async (root: string) => (root === "/a" ? branchesA : branchesB)),
      switchBranch: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it("drops a branch list that settles after the repository changed (A -> B -> A)", async () => {
    const lateA = deferred<GitBranches>();
    const git = gateway({
      getBranches: vi.fn((root: string) => (root === "/a" ? lateA.promise : Promise.resolve(branchesB))),
    });
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    act(() => picker?.load());
    act(() => root.render(<Harness gateway={git} repositoryRoot="/b" />));
    await act(async () => picker?.load());
    expect(picker?.list).toEqual({ kind: "ready", branches: branchesB });
    await act(async () => lateA.resolve(branchesA));
    expect(picker?.list).toEqual({ kind: "ready", branches: branchesB });
  });

  it("refuses to switch when the guard blocks and never calls git", async () => {
    const git = gateway();
    act(() => root.render(<Harness gateway={git} guard={() => "A thread is running here."} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    await act(async () =>
      picker?.switchTo({ current: false, kind: "local", name: "feat/a", ref: "refs/heads/feat/a" }),
    );
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(picker?.error).toBe("A thread is running here.");
  });

  it("creates then switches to a valid new branch and rejects an option-looking name", async () => {
    const git = gateway();
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    await act(async () => picker?.create("--upload-pack=x"));
    expect(git.createBranch).not.toHaveBeenCalled();
    expect(picker?.error).not.toBeNull();
    await act(async () => picker?.create("feat/new"));
    expect(git.createBranch).toHaveBeenCalledWith("/a", "feat/new");
    expect(git.switchBranch).toHaveBeenCalledWith("/a", "feat/new");
  });

  it("switches a remote branch through checkoutRemoteBranch with remote/name", async () => {
    const git = gateway();
    act(() => root.render(<Harness gateway={git} repositoryRoot="/a" />));
    await act(async () => picker?.load());
    await act(async () =>
      picker?.switchTo({ current: false, kind: "remote", name: "origin/main", ref: "refs/remotes/origin/main" }),
    );
    expect(git.checkoutRemoteBranch).toHaveBeenCalledWith("/a", "origin/main");
  });
});
```

Run: `npx vitest run src/application/useComposerBranchPicker.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the hook**

Widen the gateway type in `useAgentBranchCheckout.ts`:

```ts
import type { GitBranches, GitGateway, GitHistoryGateway } from "../domain/git";

export type AgentBranchCheckoutGateway = Pick<
  GitGateway,
  "switchBranch" | "checkoutRemoteBranch" | "createBranch"
> &
  Pick<GitHistoryGateway, "getBranches">;
```

(The production value is the full `TauriGitGateway` from `workbenchComposition.ts:149`, which implements all four; add `createBranch: vi.fn(async () => undefined)` and `getBranches: vi.fn(async () => ({ current: null, local: [], remotes: {} }))` to test fakes that `npm run check` flags.)

```ts
// src/application/useComposerBranchPicker.ts
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GitBranches } from "../domain/git";
import type { AgentBranchRef } from "../domain/agentWorktreeBase";
import { validateNewBranchName } from "../domain/gitBranchPicker";
import type { AgentBranchCheckoutGateway } from "./useAgentBranchCheckout";

export interface ComposerBranchItem {
  readonly current: boolean;
  readonly kind: "local" | "remote";
  readonly name: string;
  readonly ref: AgentBranchRef;
}

export interface ComposerBranchTarget {
  readonly ownerKey: string;
  readonly repositoryRoot: string;
}

export type ComposerBranchList =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly branches: GitBranches }
  | { readonly kind: "error"; readonly message: string };

export interface ComposerBranchPicker {
  readonly error: string | null;
  readonly list: ComposerBranchList;
  readonly pending: boolean;
  create(name: string): Promise<void>;
  load(): void;
  switchTo(item: ComposerBranchItem): Promise<void>;
}

const MAX_ERROR_LENGTH = 500;

export function useComposerBranchPicker({
  gateway,
  guard,
  target,
}: {
  readonly gateway: AgentBranchCheckoutGateway | null;
  readonly guard: (target: { readonly rootPath: string; readonly ownerKey: string }) => string | null;
  readonly target: ComposerBranchTarget | null;
}): ComposerBranchPicker {
  const repositoryRoot = target?.repositoryRoot ?? null;
  const ownerKey = target?.ownerKey ?? null;
  const identity = useMemo(() => ({ gateway, ownerKey, repositoryRoot }), [gateway, ownerKey, repositoryRoot]);
  const ownerRef = useRef(identity);
  const generationRef = useRef(0);
  const guardRef = useRef(guard);
  const [list, setList] = useState<ComposerBranchList>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    guardRef.current = guard;
  }, [guard]);

  useLayoutEffect(() => {
    ownerRef.current = identity;
    generationRef.current += 1;
    setList({ kind: "idle" });
    setPending(false);
    setError(null);
  }, [identity]);

  const capture = useCallback(() => {
    const owner = ownerRef.current;
    const generation = generationRef.current;
    return () => ownerRef.current === owner && generationRef.current === generation;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const { gateway: git, repositoryRoot: root } = ownerRef.current;
    if (git === null || root === null) return;
    const owns = capture();
    setList({ kind: "loading" });
    try {
      const branches = await git.getBranches(root);
      if (!owns()) return;
      setList({ kind: "ready", branches });
    } catch (failure: unknown) {
      if (!owns()) return;
      setList({ kind: "error", message: failureMessage(failure, "Branches could not be loaded.") });
    }
  }, [capture]);

  const load = useCallback((): void => {
    void refresh();
  }, [refresh]);

  const runGuarded = useCallback(
    async (operation: (git: AgentBranchCheckoutGateway, root: string) => Promise<void>): Promise<void> => {
      const { gateway: git, ownerKey: key, repositoryRoot: root } = ownerRef.current;
      if (git === null || root === null || key === null || pending) return;
      const blocked = guardRef.current({ rootPath: root, ownerKey: key });
      if (blocked !== null) {
        setError(blocked);
        return;
      }
      const owns = capture();
      setPending(true);
      setError(null);
      try {
        await operation(git, root);
        if (!owns()) return;
        setPending(false);
        await refresh();
      } catch (failure: unknown) {
        if (!owns()) return;
        setPending(false);
        setError(failureMessage(failure, "Could not switch branches. Refresh and try again."));
      }
    },
    [capture, pending, refresh],
  );

  const switchTo = useCallback(
    (item: ComposerBranchItem): Promise<void> => {
      if (item.current) return Promise.resolve();
      return runGuarded(async (git, root) => {
        if (item.kind === "local") return git.switchBranch(root, item.name);
        if (git.checkoutRemoteBranch === undefined) throw new Error("Switching to a remote branch is unavailable.");
        await git.checkoutRemoteBranch(root, item.name);
      });
    },
    [runGuarded],
  );

  const create = useCallback(
    (name: string): Promise<void> => {
      const validated = validateNewBranchName(name);
      if (validated.kind === "invalid") {
        setError(validated.reason);
        return Promise.resolve();
      }
      return runGuarded(async (git, root) => {
        await git.createBranch(root, validated.name);
        await git.switchBranch(root, validated.name);
      });
    },
    [runGuarded],
  );

  return { create, error, list, load, pending, switchTo };
}

function failureMessage(failure: unknown, fallback: string): string {
  const raw = failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, MAX_ERROR_LENGTH);
  return cleaned === "" ? fallback : cleaned;
}
```

The `throw new Error(...)` above is production code inside the operation callback (caught by `runGuarded` and shown to the user), not test code. `ComposerBranchItem` lives in the application hook so the presentation module imports from the application layer, never the reverse.

Run: `npx vitest run src/application/useComposerBranchPicker.test.tsx` (PASS).

- [ ] **Step 5: Branch items and the picker component (with a failing test first)**

```tsx
// src/components/agentMode/AgentComposerBranchPicker.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEAD_WORKTREE_BASE, type AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import { AgentComposerBranchPicker } from "./AgentComposerBranchPicker";

describe("AgentComposerBranchPicker", () => {
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

  const gateway = () => ({
    checkoutRemoteBranch: vi.fn(async () => []),
    createBranch: vi.fn(async () => undefined),
    getBranches: vi.fn(async () => ({ current: "feat/idempotency-keys", local: ["feat/idempotency-keys", "main"], remotes: { origin: ["release/2.4"] } })),
    switchBranch: vi.fn(async () => undefined),
  });

  async function render(isolation: "in-place" | "worktree", onWorktreeBaseChange = vi.fn(), git = gateway()) {
    const context = {
      disabled: false,
      isolation,
      locked: false,
      onWorktreeBaseChange,
      repositoryRoot: "/repo",
      worktreeBase: HEAD_WORKTREE_BASE as AgentWorktreeBase,
    };
    act(() => root.render(<AgentComposerBranchPicker branchCheckout={{ gateway: git, guard: () => null }} context={context} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.click());
    return { git, onWorktreeBaseChange };
  }

  it("lists local and remote refs with the current branch selected and switches in local checkout mode", async () => {
    const { git } = await render("in-place");
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((node) => node.textContent)).toEqual([
      expect.stringContaining("feat/idempotency-keys"),
      expect.stringContaining("main"),
      expect.stringContaining("origin/release/2.4"),
    ]);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    await act(async () => (options[1] as HTMLElement).click());
    expect(git.switchBranch).toHaveBeenCalledWith("/repo", "main");
  });

  it("offers Create branch for an unknown query in local mode", async () => {
    const { git } = await render("in-place");
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search refs"]');
    act(() => {
      if (search === null) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "feat/new-thing");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
      node.textContent?.startsWith("Create branch"),
    );
    await act(async () => create?.click());
    expect(git.createBranch).toHaveBeenCalledWith("/repo", "feat/new-thing");
  });

  it("selects a worktree base without touching the checkout in New worktree mode", async () => {
    const { git, onWorktreeBaseChange } = await render("worktree");
    expect(host.textContent).toContain("From feat/idempotency-keys");
    const remote = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
      node.textContent?.includes("origin/release/2.4"),
    );
    await act(async () => remote?.click());
    expect(onWorktreeBaseChange).toHaveBeenCalledWith({ kind: "ref", ref: "refs/remotes/origin/release/2.4" });
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="option"]')?.textContent?.startsWith("Create branch")).not.toBe(true);
  });

  it("supports arrow keys and Enter from the search field", async () => {
    const { git } = await render("in-place");
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search refs"]');
    act(() => {
      search?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    await act(async () => {
      search?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(git.switchBranch).toHaveBeenCalledWith("/repo", "main");
  });
});
```

Run it: FAIL.

```ts
// src/components/agentMode/composerBranchItems.ts
import { localBranchRef, remoteBranchRef } from "../../domain/agentWorktreeBase";
import type { GitBranches } from "../../domain/git";
import type { ComposerBranchItem } from "../../application/useComposerBranchPicker";

export const MAX_COMPOSER_BRANCH_ITEMS = 200;

export function composerBranchItems(branches: GitBranches, query: string): ReadonlyArray<ComposerBranchItem> {
  const needle = query.trim().toLowerCase();
  const items: ComposerBranchItem[] = [];
  const push = (item: ComposerBranchItem | null): void => {
    if (item === null || items.length >= MAX_COMPOSER_BRANCH_ITEMS) return;
    if (needle !== "" && !item.name.toLowerCase().includes(needle)) return;
    items.push(item);
  };
  const ordered = [...branches.local].sort((left, right) => {
    if (left === branches.current) return -1;
    if (right === branches.current) return 1;
    return left.localeCompare(right);
  });
  for (const name of ordered) {
    const ref = localBranchRef(name);
    push(ref === null ? null : { current: name === branches.current, kind: "local", name, ref });
  }
  for (const [remote, names] of Object.entries(branches.remotes).sort(([left], [right]) => left.localeCompare(right))) {
    for (const name of [...names].sort()) {
      const ref = remoteBranchRef(remote, name);
      push(ref === null ? null : { current: false, kind: "remote", name: `${remote}/${name}`, ref });
    }
  }
  return items;
}
```

(P6's `gitBranchPickerItems` adds default/worktree badges from data the composer does not have; `composerBranchItems` is the composer's ref-typed projection and reuses P6's `validateNewBranchName` for creation. If P6's committed `gitBranchPickerItems` accepts `GitBranches` directly, replace the body with a map over its result into `ComposerBranchItem` and keep this function's signature.)

```tsx
// src/components/agentMode/AgentComposerBranchPicker.tsx
import { GitBranch, Plus, Search } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import {
  useComposerBranchPicker,
  type ComposerBranchItem,
} from "../../application/useComposerBranchPicker";
import { agentBranchRefLabel } from "../../domain/agentWorktreeBase";
import { Popover } from "../../ui/foundation/Popover";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import { composerBranchItems } from "./composerBranchItems";

export interface AgentComposerBranchPickerProps {
  readonly branchCheckout: AgentWorkbenchChrome["branchCheckout"];
  readonly context: AgentComposerDrawerContext;
}

const unavailable = () => "Branch switching is unavailable in this view.";

export function AgentComposerBranchPicker({ branchCheckout, context }: AgentComposerBranchPickerProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const target =
    context.repositoryRoot === null
      ? null
      : { ownerKey: context.repositoryRoot, repositoryRoot: context.repositoryRoot };
  const picker = useComposerBranchPicker({
    gateway: branchCheckout?.gateway ?? null,
    guard: branchCheckout?.guard ?? unavailable,
    target,
  });

  if (context.locked || target === null || branchCheckout == null) return null;

  const worktreeMode = context.isolation === "worktree";
  const branches = picker.list.kind === "ready" ? picker.list.branches : null;
  const current = branches?.current ?? null;
  const items = branches === null ? [] : composerBranchItems(branches, query);
  const trimmed = query.trim();
  const offerCreate = !worktreeMode && trimmed !== "" && !items.some((item) => item.name === trimmed);
  const baseRef = context.worktreeBase.kind === "ref" ? context.worktreeBase.ref : null;
  const label = worktreeMode
    ? `From ${baseRef === null ? (current ?? "HEAD") : agentBranchRefLabel(baseRef)}`
    : (current ?? "Detached HEAD");
  const selected = (item: ComposerBranchItem): boolean =>
    worktreeMode ? (baseRef === null ? item.current : item.ref === baseRef) : item.current;
  const choose = async (item: ComposerBranchItem): Promise<void> => {
    if (worktreeMode) {
      context.onWorktreeBaseChange(item.current ? { kind: "head" } : { kind: "ref", ref: item.ref });
      setOpen(false);
      return;
    }
    await picker.switchTo(item);
    setOpen(false);
  };
  const rowCount = items.length + (offerCreate ? 1 : 0);
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rowCount === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + rowCount) % rowCount);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const item = items[active];
    if (item !== undefined) {
      void choose(item);
      return;
    }
    if (offerCreate) void picker.create(trimmed);
  };

  return (
    <div className="agent-picker">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Branch: ${label}`}
        className="agent-picker__trigger agent-picker__trigger--ghost"
        disabled={context.disabled || picker.pending}
        onClick={() => {
          if (!open) picker.load();
          setOpen((current) => !current);
        }}
        ref={triggerRef}
        type="button"
      >
        <GitBranch aria-hidden="true" className="agent-picker__icon" size={14} />
        <span className="agent-picker__value agent-branch-picker__value">{label}</span>
      </button>
      <Popover
        anchorRef={triggerRef}
        className="agent-branch-picker"
        label="Branch"
        onClose={() => setOpen(false)}
        open={open}
        placement="top-end"
      >
        <label className="agent-branch-picker__search">
          <Search aria-hidden="true" size={14} />
          <input
            aria-activedescendant={rowCount === 0 ? undefined : `${listId}-${active}`}
            aria-controls={listId}
            aria-label="Search refs"
            autoFocus
            onChange={(event) => {
              setQuery(event.currentTarget.value.slice(0, 256));
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search refs…"
            spellCheck={false}
            type="search"
            value={query}
          />
        </label>
        <div aria-label="Branches" className="agent-branch-picker__list" id={listId} role="listbox">
          {picker.list.kind === "loading" ? <p className="agent-branch-picker__note">Loading branches…</p> : null}
          {picker.list.kind === "error" ? <p className="agent-branch-picker__note" role="alert">{picker.list.message}</p> : null}
          {items.map((item, index) => (
            <div
              aria-selected={selected(item)}
              className="agent-picker__option"
              data-active={index === active ? "true" : undefined}
              id={`${listId}-${index}`}
              key={item.ref}
              onClick={() => void choose(item)}
              onMouseEnter={() => setActive(index)}
              role="option"
              tabIndex={-1}
            >
              <GitBranch aria-hidden="true" className="agent-picker__mark" size={14} />
              <span className="agent-branch-picker__name">{item.name}</span>
              {item.kind === "remote" ? <span className="agent-picker__detail">remote</span> : null}
            </div>
          ))}
          {offerCreate ? (
            <div
              aria-selected={false}
              className="agent-picker__option"
              data-active={active === items.length ? "true" : undefined}
              id={`${listId}-${items.length}`}
              onClick={() => void picker.create(trimmed)}
              role="option"
              tabIndex={-1}
            >
              <Plus aria-hidden="true" className="agent-picker__mark" size={14} />
              <span>
                Create branch <code className="agent-branch-picker__name">{trimmed}</code>
              </span>
            </div>
          ) : null}
        </div>
        {picker.error === null ? null : (
          <p className="agent-branch-picker__note" role="alert">
            {picker.error}
          </p>
        )}
      </Popover>
    </div>
  );
}
```

Append to `agentPickers.css`:

```css
.agent-branch-picker {
  width: 300px;
  padding: 0;
}

.agent-branch-picker__search {
  display: flex;
  height: 36px;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid var(--cv-hair);
  color: var(--cv-fg-subtle);
  gap: var(--cv-space-4);
}

.agent-branch-picker__search input {
  min-width: 0;
  flex: 1;
  border: 0;
  background: none;
  color: var(--cv-fg-strong);
  font: var(--cv-t-md) var(--cv-font-ui);
  outline: none;
}

.agent-branch-picker__list {
  max-height: 220px;
  overflow: auto;
  padding: var(--cv-space-2);
}

.agent-branch-picker__list .agent-picker__option[data-active="true"] {
  background: var(--cv-tint-2);
}

.agent-branch-picker__name,
.agent-branch-picker__value {
  overflow: hidden;
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-branch-picker__note {
  margin: 0;
  padding: var(--cv-space-4) 10px;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}
```

(The foundation `Popover` renders `role="dialog"`, so the trigger declares `aria-haspopup="dialog"` as the mockup's refs combobox does.)

- [ ] **Step 6: Worktree base state in the composer and the drawer mount**

`src/components/agentMode/composer/AgentComposerFrame.tsx`: add to `AgentComposerDrawerContext`:

```ts
readonly worktreeBase: AgentWorktreeBase;
onWorktreeBaseChange(base: AgentWorktreeBase): void;
```

`src/components/agentMode/useAgentComposerState.ts`: add state keyed by the composer root and expose it:

```ts
const [worktreeBaseChoice, setWorktreeBaseChoice] = useState<{
  readonly repositoryRoot: string;
  readonly base: AgentWorktreeBase;
} | null>(null);
const worktreeBase =
  worktreeBaseChoice !== null && worktreeBaseChoice.repositoryRoot === composerRoot
    ? worktreeBaseChoice.base
    : HEAD_WORKTREE_BASE;
const changeWorktreeBase = useCallback(
  (base: AgentWorktreeBase) => {
    if (composerRoot === null) return;
    setWorktreeBaseChoice({ repositoryRoot: composerRoot, base });
  },
  [composerRoot],
);
```

(`composerRoot` is the name the hook already uses for the selected repository root at the `setIsolationChoice({ repositoryRoot: composerRoot, ... })` line; use that exact variable.) Return `worktreeBase` and `onWorktreeBaseChange: changeWorktreeBase` from the hook, and pass them from `AgentComposer` props into P3's `drawerContext` `useMemo` (add both to its dependency list). The start request is extended in Task 18.

`src/components/agentMode/AgentModeView.tsx`: build and pass the render prop (memoized, P3 compares by identity):

```tsx
const branchCheckout = chrome.branchCheckout ?? null;
const renderDrawerEnd = useCallback(
  (context: AgentComposerDrawerContext) => (
    <AgentComposerBranchPicker branchCheckout={branchCheckout} context={context} />
  ),
  [branchCheckout],
);
```

and add `renderDrawerEnd={renderDrawerEnd}` to `<AgentComposerController ...>`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/domain/agentWorktreeBase.test.ts src/application/useComposerBranchPicker.test.tsx src/components/agentMode/AgentComposerBranchPicker.test.tsx src/components/agentMode/AgentComposer.test.tsx src/application/useAgentBranchCheckout.test.ts`
Expected: PASS. `npm run check` exits 0.

- [ ] **Step 8: Report changed files to the lead.**

---

### Task 18: Typed worktree start point from the start request to Rust (F8 contract)

**Files:**
- Modify TS: `src/domain/gitWorktree.ts` (port `addAgentWorktree`), `src/infrastructure/tauriGitWorktreeIpcContract.ts` (`invokeAddGitWorktreeIpc`), `src/infrastructure/tauriGitWorktreeIpcContract.test.ts`, `src/infrastructure/tauriGitWorktreeGateway.ts`, `src/infrastructure/tauriGitWorktreeGateway.test.ts`, `src/application/agentThreadWorktreeProvisioning.ts` (`createThreadWorktree`), its test, `src/application/agentThreadPorts.ts:309` (`AgentThreadStartRequest`), `src/application/useAgentTurnDispatch.ts:511-518`, `src/components/agentMode/useAgentComposerState.ts` (the `startThread({...})` call ~line 489), and every `GitWorktreeGateway` test fake (`grep -rln "addAgentWorktree" src`)
- Modify Rust: `src-tauri/src/git_worktree.rs` (trait `GitWorktreeGateway::add_agent_worktree`, `CommandGitWorktreeGateway::add_agent_worktree`, tests calling it), `src-tauri/src/lib_composition/git_worktree_commands.rs` (`add_agent_worktree_receipt`, `add_git_worktree`, the `ScriptedPruneGateway` test impl), `src-tauri/src/git_integration_tests.rs`, `src-tauri/src/lib_composition/git_integration_commands.rs` (callers)

**Interfaces:**
- Consumes: `AgentWorktreeBase`, `HEAD_WORKTREE_BASE`, `parseAgentBranchRef` (Task 17); P6 `resolve_worktree_start_point(root: &Path, reference: &str) -> Result<String, String>` in `git_worktree.rs` (returns a full hex sha; validates, rejects tags).
- Produces:
  - TS port: `addAgentWorktree(repositoryRoot: string, taskId: string, base: AgentWorktreeBase): Promise<AgentWorktreeReceipt>`.
  - IPC `add_git_worktree` args: `{ repositoryRoot, taskId, base: { kind: "head" } | { kind: "ref", ref: string } }`.
  - `AgentThreadStartRequest.worktreeBase?: AgentWorktreeBase`.
  - Rust: `pub enum WorktreeStartPoint { Head, Ref(String) }`, `#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)] pub(crate) enum WorktreeStartPointWire { Head, Ref { r#ref: String } }`, `GitWorktreeGateway::add_agent_worktree(&self, repository_root: &Path, task_id: &str, start: &WorktreeStartPoint) -> Result<CreatedAgentWorktree, String>`.

- [ ] **Step 1: Write the failing Rust tests**

In `git_worktree.rs` `#[cfg(test)]` module (next to the existing `add_agent_worktree` tests that use a real temporary git repository fixture):

```rust
#[test]
fn agent_worktree_starts_from_a_selected_local_branch() {
    let repository = TestRepository::new();
    repository.run(["checkout", "-b", "feature"]);
    repository.commit_file("feature.txt", "feature");
    let feature_head = repository.head();
    repository.run(["checkout", "main"]);
    let created = CommandGitWorktreeGateway::new()
        .add_agent_worktree(
            &repository.root,
            "agt-base-0001",
            &WorktreeStartPoint::Ref("refs/heads/feature".to_string()),
        )
        .expect("worktree from feature");
    assert_eq!(head_of(&created.worktree_path), feature_head);
    assert_ne!(repository.head(), feature_head);
}

#[test]
fn agent_worktree_rejects_hostile_start_points_before_git_runs() {
    let repository = TestRepository::new();
    for hostile in ["--upload-pack=x", "refs/heads/-b", "HEAD~1", "refs/tags/v1", "refs/heads/a..b"] {
        let error = CommandGitWorktreeGateway::new()
            .add_agent_worktree(
                &repository.root,
                "agt-hostile-base-0001",
                &WorktreeStartPoint::Ref(hostile.to_string()),
            )
            .expect_err("hostile start point must be rejected");
        assert!(!error.is_empty());
        assert_branch_absent(&repository.root, "agent/agt-hostile-base-0001");
    }
}

#[test]
fn start_point_wire_is_closed() {
    let head: WorktreeStartPointWire = serde_json::from_value(serde_json::json!({ "kind": "head" })).expect("head");
    assert_eq!(WorktreeStartPoint::from(head), WorktreeStartPoint::Head);
    let reference: WorktreeStartPointWire =
        serde_json::from_value(serde_json::json!({ "kind": "ref", "ref": "refs/heads/main" })).expect("ref");
    assert_eq!(WorktreeStartPoint::from(reference), WorktreeStartPoint::Ref("refs/heads/main".to_string()));
    assert!(serde_json::from_value::<WorktreeStartPointWire>(serde_json::json!({ "kind": "sha", "ref": "abc" })).is_err());
    assert!(serde_json::from_value::<WorktreeStartPointWire>(serde_json::json!({ "kind": "head", "ref": "x" })).is_err());
}
```

(`TestRepository`, `commit_file`, `head`, `run`, `assert_branch_absent` are the fixture helpers this test module already uses; `head_of(path)` is `repository_head(path).expect("head")`. Use the fixture's real helper names where they differ.)

Run: `cd src-tauri && cargo test --lib git_worktree`
Expected: FAIL to compile.

- [ ] **Step 2: Implement the Rust start point**

In `git_worktree.rs`:

```rust
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorktreeStartPoint {
    Head,
    Ref(String),
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum WorktreeStartPointWire {
    Head,
    Ref {
        #[serde(rename = "ref")]
        reference: String,
    },
}

impl From<WorktreeStartPointWire> for WorktreeStartPoint {
    fn from(wire: WorktreeStartPointWire) -> Self {
        match wire {
            WorktreeStartPointWire::Head => WorktreeStartPoint::Head,
            WorktreeStartPointWire::Ref { reference } => WorktreeStartPoint::Ref(reference),
        }
    }
}

fn starting_commit(root: &Path, start: &WorktreeStartPoint) -> Result<String, String> {
    match start {
        WorktreeStartPoint::Head => repository_head(root),
        WorktreeStartPoint::Ref(reference) => {
            if !(reference.starts_with("refs/heads/") || reference.starts_with("refs/remotes/")) {
                return Err("Agent worktrees can start only from a local or remote branch.".to_string());
            }
            resolve_worktree_start_point(root, reference)
        }
    }
}
```

Change the trait method and implementation signature to take `start: &WorktreeStartPoint`, and in `CommandGitWorktreeGateway::add_agent_worktree` replace the two `repository_head(&root)?` calls: keep the first (it validates the repository has a HEAD for the unborn-repo error message) and change `let starting_head = repository_head(&root)?;` to `let starting_head = starting_commit(&root, start)?;` (it is resolved under the creation lock, so `worktree add -b <branch> <target> <sha>` uses the exact commit that was validated). Update every existing test call to pass `&WorktreeStartPoint::Head`, and the `ScriptedPruneGateway` impl signature in `git_worktree_commands.rs`.

`git_worktree_commands.rs`:

```rust
fn add_agent_worktree_receipt(
    gateway: &dyn GitWorktreeGateway,
    repository_root: &Path,
    task_id: &str,
    start: &WorktreeStartPoint,
    set_trust: impl FnOnce(&str) -> Result<(), String>,
) -> Result<AgentWorktreeReceipt, String> {
    let created = gateway.add_agent_worktree(repository_root, task_id, start)?;
    let worktree_path = created.worktree_path.to_string_lossy().into_owned();
    let trusted = set_trust(&worktree_path).is_ok();
    Ok(AgentWorktreeReceipt { worktree_path, branch: created.branch, trusted })
}

#[tauri::command]
pub(crate) async fn add_git_worktree(
    repository_root: String,
    task_id: String,
    base: WorktreeStartPointWire,
    trust: GitTrustState<'_>,
    app: AppHandle,
) -> Result<AgentWorktreeReceipt, String> {
    ensure_worktree_repository_trusted(trusted_for(&trust, &repository_root)?)?;
    let start = WorktreeStartPoint::from(base);
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&repository_root)?;
        add_agent_worktree_receipt(
            &CommandGitWorktreeGateway::new(),
            &root,
            &task_id,
            &start,
            |worktree_path| set_worktree_trust(&app, worktree_path, true),
        )
    })
    .await
}
```

Update the other callers (`git_integration_commands.rs`, `git_integration_tests.rs`) to pass `&WorktreeStartPoint::Head`.

Run: `cd src-tauri && cargo test --lib git_worktree && cargo test --lib git_integration && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 3: Write the failing TS contract tests**

`tauriGitWorktreeIpcContract.test.ts`:

```ts
it("sends the worktree base as a closed wire value", async () => {
  const invokeCommand = vi.fn(async () => ({ worktreePath: "/repo/.worktrees/agt-1", branch: "agent/agt-1", trusted: true }));
  await invokeAddGitWorktreeIpc(invokeCommand, "/repo", "agt-base-0001", { kind: "ref", ref: "refs/heads/feature" });
  expect(invokeCommand).toHaveBeenCalledWith(ADD_GIT_WORKTREE_IPC_COMMAND, {
    repositoryRoot: "/repo",
    taskId: "agt-base-0001",
    base: { kind: "ref", ref: "refs/heads/feature" },
  });
  await invokeAddGitWorktreeIpc(invokeCommand, "/repo", "agt-base-0002", { kind: "head" });
  expect(invokeCommand).toHaveBeenLastCalledWith(ADD_GIT_WORKTREE_IPC_COMMAND, {
    repositoryRoot: "/repo",
    taskId: "agt-base-0002",
    base: { kind: "head" },
  });
});

it("rejects a hostile ref before IPC", async () => {
  const invokeCommand = vi.fn();
  await expect(
    invokeAddGitWorktreeIpc(invokeCommand, "/repo", "agt-base-0003", {
      kind: "ref",
      ref: "refs/heads/--upload-pack=x" as "refs/heads/x",
    }),
  ).rejects.toThrow(TypeError);
  expect(invokeCommand).not.toHaveBeenCalled();
});
```

`agentThreadWorktreeProvisioning.test.ts`: extend the existing success test so `createThreadWorktree(..., threadId, { kind: "ref", ref: "refs/heads/feature" })` results in `gateway.addAgentWorktree` being called with that base, and the existing call sites pass `HEAD_WORKTREE_BASE`.

Run: `npx vitest run src/infrastructure/tauriGitWorktreeIpcContract.test.ts src/application/agentThreadWorktreeProvisioning.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the TS plumbing**

`tauriGitWorktreeIpcContract.ts`:

```ts
export async function invokeAddGitWorktreeIpc(
  invokeCommand: InvokeGitWorktreeCommand,
  repositoryRoot: string,
  taskId: string,
  base: AgentWorktreeBase,
): Promise<AgentWorktreeReceipt> {
  const validatedRepositoryRoot = validateGitWorktreeRepositoryRoot(repositoryRoot);
  const validatedTaskId = validateAgentWorktreeTaskId(taskId);
  return parseAgentWorktreeReceipt(
    await invokeCommand(ADD_GIT_WORKTREE_IPC_COMMAND, {
      repositoryRoot: validatedRepositoryRoot,
      taskId: validatedTaskId,
      base: agentWorktreeBaseWire(base),
    }),
  );
}

function agentWorktreeBaseWire(base: AgentWorktreeBase): { readonly kind: "head" } | { readonly kind: "ref"; readonly ref: string } {
  switch (base.kind) {
    case "head":
      return { kind: "head" };
    case "ref": {
      const ref = parseAgentBranchRef(base.ref);
      if (ref === null) throw new TypeError("Invalid Git worktree base ref.");
      return { kind: "ref", ref };
    }
    default:
      return base satisfies never;
  }
}
```

`gitWorktree.ts`: `addAgentWorktree(repositoryRoot: string, taskId: string, base: AgentWorktreeBase): Promise<AgentWorktreeReceipt>;`. `tauriGitWorktreeGateway.ts`: forward `base`. `agentThreadWorktreeProvisioning.ts`: `createThreadWorktree(dependenciesRef, mountedRef, authority, repositoryRoot, threadId, base: AgentWorktreeBase)` and call `gateway.addAgentWorktree(repositoryRoot, threadId, base)`. `agentThreadPorts.ts`: `readonly worktreeBase?: AgentWorktreeBase;` on `AgentThreadStartRequest`. `useAgentTurnDispatch.ts`: pass `request.worktreeBase ?? HEAD_WORKTREE_BASE` as the new last argument of `createThreadWorktree`. `useAgentComposerState.ts`: add `worktreeBase,` to the `startThread({...})` object (and to that callback's dependency list). Update every `addAgentWorktree` test fake signature (`npm run check` lists them).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/infrastructure/tauriGitWorktreeIpcContract.test.ts src/infrastructure/tauriGitWorktreeGateway.test.ts src/application/agentThreadWorktreeProvisioning.test.ts src/application/useAgentTurnDispatch.test.tsx src/components/agentMode/AgentComposer.test.tsx`
Expected: PASS. Add one dispatch test to `useAgentTurnDispatch.test.tsx` (next to its existing worktree start test) asserting that a start request with `worktreeBase: { kind: "ref", ref: "refs/heads/feature" }` reaches `gitWorktreeGateway.addAgentWorktree` with that base, and one without `worktreeBase` reaches it with `{ kind: "head" }`.

- [ ] **Step 6: Report changed files to the lead.**

---

### Task 19: Composer usage-limits notice and `/usage`

**Files:**
- Create: `src/components/agentMode/usage/useComposerUsageLimitsNotice.ts`, `src/components/agentMode/usage/useComposerUsageLimitsNotice.test.tsx`, `src/components/agentMode/usage/AgentComposerUsageLimitsNotice.tsx`
- Modify: `src/domain/agentComposerCommand.ts` (+ test), `src/components/agentMode/AgentComposer.tsx` (command handler + `onShowUsageLimits?(): void` prop), `src/components/agentMode/AgentComposerController.tsx` (pass-through prop), `src/components/agentMode/AgentModeView.tsx` (hook + `banners` + `onShowUsageLimits`)

**Interfaces:**
- Consumes: `WorkbenchAgentsSurface.accountUsage`, `UsageLimitBars` (Task 9), foundation `ComposerBanner({ tone, icon, actions, children })`, P3 `banners?: ReactNode` on `AgentComposerControllerProps`.
- Produces: `AgentComposerCommandId` gains `"usage"` (label "Usage limits", description "Show plan limits for Claude Code and Codex."), available for every provider; `useComposerUsageLimitsNotice(accountUsage, nowEpochMs?): { visible: boolean; show(): void; dismiss(): void; providers: ReadonlyArray<{ provider; windows }> }`; auto-shows when any ready window is at or above 90% used; dismissal is remembered per snapshot key (provider + `fetchedAtEpochMs`), so a newer snapshot over the threshold shows it again.

- [ ] **Step 1: Write the failing tests**

`src/domain/agentComposerCommand.test.ts`:

```ts
it("offers /usage for both providers", () => {
  expect(agentComposerCommands("codex", false).map((command) => command.id)).toContain("usage");
  expect(agentComposerCommands("claudeCode", true).map((command) => command.id)).toContain("usage");
});
```

```tsx
// src/components/agentMode/usage/useComposerUsageLimitsNotice.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentAccountUsageLoadState } from "../../../domain/agentAccountUsage";
import { useComposerUsageLimitsNotice } from "./useComposerUsageLimitsNotice";

type Usage = Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;

function usage(usedPercent: number, fetchedAtEpochMs: number): Usage {
  return {
    claudeCode: {
      kind: "ready",
      snapshot: {
        provider: "claudeCode",
        fetchedAtEpochMs,
        windows: [{ id: "seven_day", label: "Weekly limit", usedPercent, windowDurationMinutes: 10_080, resetsAtEpochMs: null, resetsLabel: "Sep 28" }],
      },
    },
    codex: { kind: "idle" },
  };
}

describe("useComposerUsageLimitsNotice", () => {
  let host: HTMLDivElement;
  let root: Root;
  let notice: ReturnType<typeof useComposerUsageLimitsNotice> | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    notice = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({ accountUsage }: { accountUsage: Usage }) {
    notice = useComposerUsageLimitsNotice(accountUsage);
    return null;
  }

  it("stays hidden under the threshold until /usage shows it", () => {
    act(() => root.render(<Harness accountUsage={usage(40, 1)} />));
    expect(notice?.visible).toBe(false);
    act(() => notice?.show());
    expect(notice?.visible).toBe(true);
    expect(notice?.providers.map((entry) => entry.provider)).toEqual(["claudeCode"]);
  });

  it("appears at 90% and stays dismissed for the same snapshot but returns for a newer one", () => {
    act(() => root.render(<Harness accountUsage={usage(92, 1)} />));
    expect(notice?.visible).toBe(true);
    act(() => notice?.dismiss());
    expect(notice?.visible).toBe(false);
    act(() => root.render(<Harness accountUsage={usage(93, 1)} />));
    expect(notice?.visible).toBe(false);
    act(() => root.render(<Harness accountUsage={usage(94, 2)} />));
    expect(notice?.visible).toBe(true);
  });

  it("has nothing to show when no provider reported limits", () => {
    act(() => root.render(<Harness accountUsage={{ claudeCode: { kind: "idle" }, codex: { kind: "unavailable" } }} />));
    act(() => notice?.show());
    expect(notice?.providers).toEqual([]);
    expect(notice?.visible).toBe(false);
  });
});
```

Run: `npx vitest run src/domain/agentComposerCommand.test.ts src/components/agentMode/usage/useComposerUsageLimitsNotice.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement the command and the hook**

`agentComposerCommand.ts`: add `| "usage"` to `AgentComposerCommandId`, add `{ id: "usage", label: "Usage limits", description: "Show plan limits for Claude Code and Codex." }` after `settings` in `COMMANDS`, and `case "usage":` to the `return true` group of the switch.

```ts
// src/components/agentMode/usage/useComposerUsageLimitsNotice.ts
import { useCallback, useMemo, useState } from "react";
import type {
  AgentAccountUsageLoadState,
  AgentAccountUsageWindow,
} from "../../../domain/agentAccountUsage";

const PROVIDERS = ["claudeCode", "codex"] as const;
const NOTICE_USED_PERCENT = 90;

export interface ComposerUsageLimitsEntry {
  readonly provider: (typeof PROVIDERS)[number];
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
}

export interface ComposerUsageLimitsNotice {
  readonly providers: ReadonlyArray<ComposerUsageLimitsEntry>;
  readonly visible: boolean;
  dismiss(): void;
  show(): void;
}

export function useComposerUsageLimitsNotice(
  accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>,
): ComposerUsageLimitsNotice {
  const providers = useMemo(() => readyProviders(accountUsage), [accountUsage]);
  const snapshotKey = useMemo(() => snapshotKeyOf(accountUsage), [accountUsage]);
  const hot = providers.some((entry) => entry.windows.some((window) => window.usedPercent >= NOTICE_USED_PERCENT));
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const requested = requestedKey === snapshotKey;
  const visible = providers.length > 0 && dismissedKey !== snapshotKey && (hot || requested);
  const show = useCallback(() => {
    setRequestedKey(snapshotKey);
    setDismissedKey(null);
  }, [snapshotKey]);
  const dismiss = useCallback(() => {
    setDismissedKey(snapshotKey);
    setRequestedKey(null);
  }, [snapshotKey]);
  return { dismiss, providers, show, visible };
}

function readyProviders(
  accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>,
): ReadonlyArray<ComposerUsageLimitsEntry> {
  return PROVIDERS.flatMap((provider) => {
    const state = accountUsage[provider];
    if (state.kind !== "ready" || state.snapshot.windows.length === 0) return [];
    return [{ provider, windows: state.snapshot.windows }];
  });
}

function snapshotKeyOf(
  accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>,
): string {
  return PROVIDERS.map((provider) => {
    const state = accountUsage[provider];
    return state.kind === "ready" ? `${provider}:${state.snapshot.fetchedAtEpochMs}` : `${provider}:-`;
  }).join("|");
}
```

Run the two tests: PASS.

- [ ] **Step 3: The notice component**

```tsx
// src/components/agentMode/usage/AgentComposerUsageLimitsNotice.tsx
import { Gauge, X } from "lucide-react";
import { ComposerBanner } from "../../../ui/foundation/ComposerBanner";
import { IconButton } from "../../../ui/foundation/IconButton";
import { UsageLimitBars } from "../../usage/UsageLimitBars";
import { usageProviderLabel } from "../../usage/usagePresentation";
import type { ComposerUsageLimitsNotice } from "./useComposerUsageLimitsNotice";

export function AgentComposerUsageLimitsNotice({ notice }: { readonly notice: ComposerUsageLimitsNotice }) {
  if (!notice.visible) return null;
  const single = notice.providers.length === 1 ? notice.providers[0] : undefined;
  return (
    <ComposerBanner
      actions={<IconButton icon={<X aria-hidden="true" size={14} />} label="Dismiss usage limits" onClick={notice.dismiss} size="xs" />}
      icon={<Gauge aria-hidden="true" size={14} />}
    >
      <span className="agent-usage-notice__title">
        Usage limits
        <span className="agent-usage-notice__summary">
          {single === undefined ? `${notice.providers.length} providers` : usageProviderLabel(single.provider)}
        </span>
      </span>
      {notice.providers.map((entry) => (
        <div className="agent-usage-notice__provider" key={entry.provider}>
          {single === undefined ? <span className="agent-usage-notice__summary">{usageProviderLabel(entry.provider)}</span> : null}
          <UsageLimitBars compact nowEpochMs={Date.now()} windows={entry.windows} />
        </div>
      ))}
    </ComposerBanner>
  );
}
```

Append to `src/components/usage/usage.css`:

```css
.agent-usage-notice__title {
  display: flex;
  align-items: center;
  color: var(--cv-fg-strong);
  font-weight: 500;
  gap: var(--cv-space-4);
}

.agent-usage-notice__summary {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
  font-weight: 400;
}

.agent-usage-notice__provider {
  display: flex;
  flex-direction: column;
  margin-top: var(--cv-space-2);
}
```

- [ ] **Step 4: Wire `/usage` and the banner**

`AgentComposer.tsx`: add `onShowUsageLimits?(): void;` to the props and, in the command handler next to the `settings` branch:

```ts
if (command === "usage") {
  changePrompt("");
  onShowUsageLimits?.();
  return;
}
```

`AgentComposerController.tsx`: add `readonly onShowUsageLimits?: () => void;` and pass it to `AgentComposer` (add it to the controller's memo equality list if P3 compares props explicitly).

`AgentModeView.tsx`:

```tsx
const usageNotice = useComposerUsageLimitsNotice(agents.accountUsage ?? IDLE_ACCOUNT_USAGE);
```

and on `<AgentComposerController ...>` add `banners={<AgentComposerUsageLimitsNotice notice={usageNotice} />}` and `onShowUsageLimits={usageNotice.show}`. (`IDLE_ACCOUNT_USAGE` is the constant `AgentModeView.tsx` already passes to the sidebar at line ~827.)

- [ ] **Step 5: Add a composer integration test and run**

In `AgentComposer.test.tsx` add a case: typing `/usage` and pressing Enter calls `onShowUsageLimits` once and clears the prompt (use the file's existing command test as the template, e.g. the `/settings` case). Run:

`npx vitest run src/domain/agentComposerCommand.test.ts src/components/agentMode/usage src/components/agentMode/AgentComposer.test.tsx src/components/agentMode/AgentModeView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Report changed files to the lead.**

---
### Task 20: Full repository gates (lead)

**Files:** none (verification only).

- [ ] **Step 1: Free the Node inspector port**

Run: `lsof -ti tcp:9229 | xargs -r kill`
Expected: exit 0 (an orphaned `node --inspect` makes the Node watch tests fail; repo memory).

- [ ] **Step 2: TypeScript gates, one per line, checking `echo $?` after each (never judge through `| tail`)**

```bash
npm run check
npm run lint -- --max-warnings 0
npm run lint:exhaustive-deps
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
```

Expected: every command exits 0. `npm run size:hotspots` must not report growth for `src/App.tsx`, `src/application/useAgentProviderManagement.ts` (untouched) or `src-tauri/src/lib.rs` (untouched). If `npm test -- --run` fails only in Node watch/debug tests, free port 9229 and rerun those files sequentially before treating it as a regression.

- [ ] **Step 3: Rust gates**

```bash
cd src-tauri
cargo check --all-targets
cargo test --lib
cargo test --tests
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cd ..
```

Expected: every command exits 0.

- [ ] **Step 4: Coverage, whitespace and scope**

Run: `npm run test:coverage` (expected exit 0), then `git diff --check && git status --porcelain`. `git diff --check` prints nothing; `git status` lists only files from the Ownership section plus the owner's pre-existing untracked docs and other phases' committed work (check for foreign hunks from a concurrent Codex session before staging; repo memory).

- [ ] **Step 5: Residue checks**

```bash
grep -rn "var(--codevo-" src/components/settings src/components/usage src/components/agentMode/pickers
grep -rn "AgentUsagePanel\|AgentExecutionEnvironmentPicker\|AppearanceSettingsPage\|KeybindingsTable" src
grep -n "updater:allow-check" src-tauri/capabilities/default.json
```

Expected: all three print nothing.

---

### Task 21: Independent read-only review (Opus 5.5)

**Files:** none.

- [ ] **Step 1: Dispatch the reviewer**

Dispatch a fresh general-purpose agent with `model: "opus"` and this prompt:

```text
You are an independent, read-only reviewer for phase P9 of the Codevo redesign in /Users/matusmockor/Developer/editor. Do not edit files, do not run git commands that change state, do not run coderabbit. Read CLAUDE.md, the spec docs/superpowers/specs/2026-09-23-codevo-redesign-design.md (sections 3.1.11, 3.3 F7/F8, 4, 6, 7), the plan docs/superpowers/plans/2026-09-24-redesign-p9-settings-pickers.md and the mockup docs/redesign/v3-settings-pickers.html, then review the working-tree diff (`git diff` plus untracked files under src/ and src-tauri/).

Report findings as P0 (wrong behaviour, data loss, security), P1 (spec or CLAUDE.md violation, missing test for a risky path), P2 (quality). For each: file:line, what is wrong, a concrete failing scenario, the fix. Verify every claim in code before reporting it.

Focus on:
1. F7: the frontend sends only the channel enum; Rust owns endpoints; `app_update_check` request is closed (deny_unknown_fields); the returned resource id works with the plugin's download/install; switching channel mid-check or with a downloaded candidate drops stale results and disposes the old candidate; the stable 404 path reads as up to date and nothing else does; capability narrowing did not break download/install.
2. F8: `AgentWorktreeBase` is validated in TS before IPC and in Rust before any git process; `--end-of-options` is used; tags, revision expressions, option-looking names and oversized refs are rejected; the worktree starts from the exact validated commit under the creation lock; compensation on failure still removes the branch/worktree; local-checkout switching is guarded (running threads, dirty editors, trust) and owner-revalidated after every await (A -> B -> A); no switch can target a repository other than the composer's current target.
3. Settings: every previous setting is still reachable (compare the old registry rows to the new ones; PHP stays); deep links (`resolveSettingsRoute`, including legacy "appearance" and "git") land on the right row and focus it; search still finds every row; Restore defaults touches only the documented fields; the Keybindings recorder ignores the search field; Usage/Archive handle missing agent data, empty data and large archives (paging).
4. Pickers: keyboard (Arrow/Home/End, Enter/Space, Escape closes only the innermost popover and restores focus to its trigger); roles (menu/menuitemradio/menuitemcheckbox/listbox/option) are correct; the compact composer presentation still works; the /plan command, favorites and legacy models behave as before; nested-repository selection with search/paging still works through AgentRepositoryPicker.
5. Tokens: no --codevo-*/--color-* references or raw colours in the touched stylesheets; light and dark schemes both covered; prefers-reduced-motion respected (motion only through tokens).
6. Layering and size: no application module imports components; no new file near hotspot limits; App.tsx, useAgentProviderManagement.ts and lib.rs did not grow.
7. Anything in the diff that contradicts the plan, the spec or the sibling-phase agreements recorded in the plan's Ownership section.

End with a verdict: SHIP, SHIP AFTER FIXES (list), or DO NOT SHIP.
```

- [ ] **Step 2: Triage**

Verify every P0/P1 finding in the code before acting (repo memory: audits over-report). Fix real ones through a scoped implementer task, rerun focused tests and Task 20, and re-dispatch the reviewer on the fix diff. Record rejected findings with a one-line reason in the final report.

---

### Task 22: QA build and Codex computer-use QA

**Files:** `~/tmp/codevo-qa/qa_prompt_p9.txt` (scratch, deleted at the end).

- [ ] **Step 1: Build and open the QA bundle**

```bash
npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'
open "src-tauri/target/debug/bundle/macos/Codevo QA.app"
osascript -e 'tell application "Codevo QA" to activate'
```

Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists and a "Codevo QA" window is frontmost. Exit code 1 caused only by the missing updater signing key is acceptable; a compile error is not. Before running the tester, open a project that is a git repository with at least two local branches and one remote branch, and make sure one agent thread is archived (so Archive has data).

- [ ] **Step 2: Write the QA prompt**

```bash
mkdir -p ~/tmp/codevo-qa && cat > ~/tmp/codevo-qa/qa_prompt_p9.txt <<'QA'
You are a UI QA tester with Computer Use. First action: bring the window to the front with `osascript -e 'tell application "Codevo QA" to activate'`, then take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop.

Rules:
- ATTACH ONLY to the already running app "Codevo QA" (bundle id dev.mockor.editor.qa). Never launch, open, quit, restart or build any app. Never interact with "Codevo Editor" or any other app.
- Before EVERY screenshot run `osascript -e 'tell application "Codevo QA" to activate'` so the QA window is frontmost.
- Do not edit files. Do not change macOS system settings. Do not sign in or out of any provider. Do not press "Update", "Install and restart" or "Restart".
- Reference design: docs/redesign/v3-settings-pickers.html in the repository (states General, Providers, Keys, Usage, Archive, Model, Effort, Access, Env, Branch, Limits). Compare structure, spacing, copy and alignment.

Steps (record worked/failed and a screenshot path for each):
1. Open Settings (Cmd+,). Confirm the left column shows a Search field with a "/" key hint, sections General, Providers, Environments, Keybindings, Index & languages, Snippets, Usage, Archive, PHP, and a Back item at the bottom; the main column shows "Settings / General" in a top bar with "Restore defaults" on the right.
2. General: confirm sections Theme (System/Dark/Light segmented control in the header, six palette cards with wireframe previews), Text & editor, Updates (a "Codevo" row with the version and a Check for updates button, an "Update track" select with Stable/Beta), Workspace, Editing, Editor header items (including "Threads needing attention in the sidebar"). Click three different palette cards and switch Dark/Light; confirm the whole app recolours each time and the selected card shows a check. Leave Graphite · Teal Dark selected.
3. Change Update track to Stable, then back to Beta. Click "Check for updates" once on each track and report the status text shown (no error loop, no crash).
4. Keyboard: focus the section list, press ArrowDown three times and ArrowUp once; confirm the selected section and the breadcrumb follow. Press "/" and confirm the Search field is focused; type "beta" and confirm a result "Update track" appears; press Enter and confirm the Update track row is highlighted.
5. Providers: confirm one card per provider (glyph, name, version, status line with a coloured dot, optional Sign in button, enable switch, expand chevron). Expand Claude Code: confirm Executable path, a Models list with star buttons, model ids, a Default badge, a NEW badge on the newest model, and an "N legacy models" row that expands. Star and unstar one model. Confirm sections New threads and CLI updates below.
6. Keybindings: confirm category groups of rows with a "When" line and key chips, a search field and a count in the header. Click a key chip, confirm an inline recorder appears, press Escape (or Cancel) and confirm nothing changed. Search for a non-existing name and confirm "No matching shortcuts".
7. Usage: confirm one section per provider with limit bars (label, "N% used", bar, "Resets ..." text) or a clear reason when a provider has no data, and a Local activity section with a Today/7 days/30 days switch and three totals. Hover one bar and report the tooltip text. Click the refresh button in the top bar.
8. Archive: confirm archived threads grouped by project with an Unarchive button; do NOT click Unarchive.
9. Environments, Index & languages, Snippets, PHP: open each and confirm nothing overlaps, no text is clipped, and controls use the same rounded group style.
10. Back to the thread view (Back). In the composer footer open, one at a time: the model picker (360x346 popover with a provider rail: favorites star, Claude Code, Codex; search field; star buttons; NEW badge; a Legacy models row), the effort menu (Effort radio rows, Context window, Fast mode/Thinking switches), and the access menu (Supervised, Auto-accept edits, Auto, Full access, a separator, Plan mode, Use Claude CLI settings). For each: use only the keyboard (ArrowDown/ArrowUp, Enter, Escape) and confirm Escape closes it and focus returns to its button.
11. In the drawer below the composer: open the workspace menu (Run on: This computer [+ servers]; Checkout: Local checkout / New worktree; Manage environments). Choose New worktree, then open the branch picker on the right: confirm it reads "From <branch>", lists local and remote branches with a search field, and choosing a branch changes the label to "From <branch>" without switching the project's branch (check the Git surface or the sidebar branch label). Switch back to Local checkout, open the branch picker, type a new name and confirm a "Create branch <name>" row appears; press Escape without creating it.
12. Type "/usage" in the composer and press Enter: confirm a "Usage limits" notice appears above the composer with compact bars and a dismiss button; dismiss it.
13. Repeat steps 2 (only the palette cards and one Settings page) and 10 (only the model picker) in Zinc · Orange Light and in Ink · Mint Dark. Report any low-contrast text, invisible borders, or controls that merge with the background.

Final report:
- One line per step: "Step N: worked" or "Step N: failed - <what you saw>" with screenshot paths.
- A list of every visual difference from the mockup (element, expected, actual).
- A list of every keyboard or focus problem.
QA
```

- [ ] **Step 3: Run the tester and wait for the report**

Run (background, 45 minute cap in the orchestrator): `python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p9.txt > /tmp/qa-p9.log 2>&1`
Expected: the log ends with the tester's report. Watch only final or error lines (`COMPUTER_USE_UNAVAILABLE`, `TIMEOUT`, `ERROR`, the final agent message). If the run is blocked by the permission classifier, ask the owner to run the same command with the `!` prefix, or to paste `~/tmp/codevo-qa/qa_prompt_p9.txt` into their own interactive Codex session and paste the report back.

- [ ] **Step 4: Fix loop**

For each QA failure: confirm the root cause in code, fix it through a scoped implementer task, rerun focused tests, Task 20 and a reviewer pass on the fix, rebuild the QA app and re-run only the failed steps.

- [ ] **Step 5: Clean up**

Run: `osascript -e 'quit app "Codevo QA"'; rm -f /tmp/qa-p9.log ~/tmp/codevo-qa/qa_prompt_p9.txt`
Expected: exit 0.

---

### Task 23: Commit to `main` (lead, after explicit owner authorization)

**Files:** all P9 files.

- [ ] **Step 1: Confirm the tree**

Run: `git branch --show-current && git status --porcelain && git log --oneline -5`
Expected: branch `main`; only P9 files changed (plus the owner's untracked docs). Check for foreign hunks from a concurrent Codex session before staging; stage nothing that is not P9.

- [ ] **Step 2: Commit the update channel slice**

```bash
git add -- src/domain/appUpdateChannel.ts src/domain/appUpdateChannel.test.ts src/domain/settings.ts src/domain/settings.test.ts src/domain/appUpdater.ts src/infrastructure/tauriAppUpdateChannelCheck.ts src/infrastructure/tauriAppUpdateChannelCheck.test.ts src/infrastructure/tauriAppUpdaterGateway.ts src/infrastructure/tauriAppUpdaterGateway.test.ts src/infrastructure/tauriAppUpdaterGateway.preparation.test.ts src/application/useAppUpdater.ts src/application/useAppUpdater.test.tsx src/application/workbenchController/useWorkbenchAppUpdaterComposition.ts src/components/WorkbenchAppUpdaterHost.tsx src/workbenchComposition.ts src/App.appUpdaterComposition.test.ts src/application/useAgentProviderManagement.test.tsx src/application/workbenchController/useWorkbenchSettingsPersistence.ts src/application/workbenchController/useWorkbenchSettingsPersistence.test.tsx src/infrastructure/settingsAppUpdaterPreferencesGateway.test.ts src/infrastructure/browserSettingsGateway.test.ts src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib_composition/app_update_channel_commands.rs src-tauri/src/lib_composition/command_facades.rs src-tauri/src/lib_composition/runtime.rs src-tauri/capabilities/default.json docs/release.md
git diff --cached --stat
git commit -F - <<'MSG'
feat(updater): stable and beta update channels

- Closed AppUpdateChannel setting (stable | beta, default beta)
- Rust app_update_check command selects the endpoint from a closed enum
  and returns the plugin metadata shape; the frontend sends only the channel
- Channel is part of the updater authority: switching drops in-flight
  checks and disposes the previous candidate
- A missing stable manifest reads as up to date
MSG
```

- [ ] **Step 3: Commit the settings slice**

```bash
git add -A -- src/components/settings src/components/usage src/App.css src/components/cssBorderAllowlist.ts src/application/useWorkbenchAgents.ts src/application/useWorkbenchAgents.test.ts src/components/agentMode/AgentUsagePanel.tsx src/components/agentMode/AgentUsagePanel.test.tsx src/components/agentMode/AgentRailUsagePopover.tsx src/components/agentMode/AgentThreadArchivedShelf.tsx src/components/agentMode/AgentThreadsSidebar.tsx src/components/agentMode/AgentThreadList.tsx
git diff --cached --stat
git commit -F - <<'MSG'
feat(settings): redesigned settings with usage and archive pages

- Settings nav column and main column with breadcrumb and page actions
- General merges appearance: palette cards, text and editor, updates with
  update track, workspace, editing, editor status items
- Providers with models, favorites, NEW/Default badges and legacy models
- Keybindings as grouped rows with inline recorder
- Usage page with limit bars and local activity; Archive page
- Settings styles moved to palette tokens
MSG
```

(Add to the `git add` list any P4 file path that differs, e.g. the actual `AgentThreadList` path, and `src/components/agentMode/agentRailSections*` if Task 10 changed it.)

- [ ] **Step 4: Commit the pickers and branch picker slice**

```bash
git add -A -- src/components/agentMode src/ui/foundation src/domain/agentWorktreeBase.ts src/domain/agentWorktreeBase.test.ts src/domain/agentLaunch.ts src/domain/claudeModelCatalog.ts src/domain/claudeModelCatalog.test.ts src/domain/claudeModelManifest.json src/domain/agentComposerCommand.ts src/domain/agentComposerCommand.test.ts src/domain/gitWorktree.ts src/infrastructure/tauriGitWorktreeGateway.ts src/infrastructure/tauriGitWorktreeGateway.test.ts src/infrastructure/tauriGitWorktreeIpcContract.ts src/infrastructure/tauriGitWorktreeIpcContract.test.ts src/application/useComposerBranchPicker.ts src/application/useComposerBranchPicker.test.tsx src/application/useAgentBranchCheckout.ts src/application/agentThreadWorktreeProvisioning.ts src/application/agentThreadWorktreeProvisioning.test.ts src/application/agentThreadPorts.ts src/application/useAgentTurnDispatch.ts src/application/useAgentTurnDispatch.test.tsx src-tauri/src/git_worktree.rs src-tauri/src/lib_composition/git_worktree_commands.rs src-tauri/src/lib_composition/git_integration_commands.rs src-tauri/src/git_integration_tests.rs docs/superpowers/plans/2026-09-24-redesign-p9-settings-pickers.md
git diff --cached --stat
git commit -F - <<'MSG'
feat(composer): redesigned pickers, branch picker and usage notice

- Model picker with provider rail, NEW badge and legacy summary
- Effort and access menus on foundation menu items (Plan mode and CLI
  settings rows)
- Workspace menu merges Run on and Checkout; repository picker kept for
  nested repositories
- Branch picker: switch or create in the local checkout, choose the start
  branch for new worktrees (typed ref validated in TS and Rust)
- /usage and automatic usage limits notice
MSG
git status --porcelain
```

Expected: three commits; the final `git status` shows only the owner's untracked files. No push, no tag, no release.

---

## Open Questions for the Owner

1. Default update track for fresh installs: the plan keeps `beta` (every published build is a beta today and the configured endpoint is the beta manifest). Should a future stable build default new installs to `stable` (for example derived from whether the running version has a prerelease tag)?
2. Stable track before any stable release exists reports "Codevo is up to date." Acceptable, or should it say "No stable release yet"? (Needs a distinct result kind from Rust; small follow-up.)
3. The mockup's Keybindings "When" clause is editable and has "Add keybinding" / "Open keybindings.json" buttons. Codevo has no when-clause model and no keybindings.json; the plan shows "Always"/"Reserved" read-only and omits the two buttons. OK?
4. The mockup's branch picker footer "Start new worktrees from origin" would require fetching before creating a worktree. The plan omits it (worktrees start from the selected local or already-fetched remote ref). Add later?
5. The mockup's Providers card shows the signed-in account e-mail and the Usage page shows it per provider; Codevo does not read account identity from the CLIs today, so the plan shows the existing auth status text only. Add account identity later?
6. "Restore defaults" on General resets appearance, text/editor, runtime policy and terminal shell integration, but not the update track, providers, keymap or workspace settings. Is that the intended scope?
7. PHP stays as the last Settings section (spec keeps PHP pages out of the redesign but no capability may be lost). Hide it for non-PHP workspaces instead?
8. The command palette's agent "Switch branch" source (P5 slot `branches?: PaletteBranchSource`) is left unbound in P9; bind it to `useComposerBranchPicker` in P10?

## Self-Review

**Spec coverage.**
- §3.1.11 General (palettes, appearance, sizes, fonts, syntax theme, updates, workspace, editing): Task 6 (+ Task 5 shell). Providers (detection, sign-in, versions, favorite models, legacy models): Task 7 (+ Task 13 badges). Environments, Index & languages, Snippets: Task 11 (restyle, no capability change). Keybindings (search, edit, modified): Task 8. Usage (limit bars): Task 9. Archive: Task 10. Composer pickers model/effort/access/environment/branch: Tasks 13, 14, 15, 16, 17. Usage limits notice: Task 19.
- §3.3 F7 typed enum on TS and Rust, wired into the updater: Tasks 1-3 (TS `AppUpdateChannel`, Rust `AppUpdateChannel`, `app_update_check`, channel as updater authority, release docs). F8 branch picker in the composer environment area: Tasks 17-18 (UI in the drawer end slot, local switch/create, typed worktree base end to end).
- §4 boundaries: Rust only for F7/F8; composition roots untouched (`App.tsx`, `lib.rs`); new focused modules; old picker/settings styles removed; wire contracts tested on both sides (Task 2 + Task 3, Task 18 Rust + TS).
- §6 testing: component tests with `act`, contract tests both sides, keyboard tests for menus/pickers/nav, CSS token contract (Task 11), QA build + Computer Use QA in palette 1 dark/light plus two other combinations (Task 22), full gates (Task 20).
- §7 Opus reviewer (Task 21), Codex QA (Task 22), no release (Task 23).

**Placeholder scan.** No TBD/TODO. Places that depend on sibling phases name the exact agreed symbol (`TopBar`, `AgentComposerDrawerContext`, `renderDrawerEnd`, `banners`, `validateNewBranchName`, `resolve_worktree_start_point`, `agentModelProviderState.ts`) and say what to adapt if the committed signature differs. Test helpers that already exist in a test file are referenced by their role with an instruction to reuse the file's helper; new helpers are written out (`settingsPagePropsFixture`, `bridgeUpdate` exists).

**Type consistency.** `AppUpdateChannel` (Task 1) is used by the port (Task 3), the hook option `channel`, `useWorkbenchAppUpdaterComposition(..., channel)`, `GeneralAppUpdateRows.channel` (Task 6). `SettingsAgentActivity` (Task 9) is used by Usage (Task 9) and Archive (Task 10). `AgentWorktreeBase`/`AgentBranchRef`/`HEAD_WORKTREE_BASE` (Task 17) are used by `AgentComposerDrawerContext.worktreeBase`, `useAgentComposerState`, `AgentThreadStartRequest.worktreeBase`, `createThreadWorktree(..., base)`, `addAgentWorktree(..., base)`, `invokeAddGitWorktreeIpc(..., base)` (Task 18). `ComposerBranchItem` is defined once in `useComposerBranchPicker.ts`. `MenuRadioItem`/`MenuSwitchItem` (Task 12) are used in Tasks 14, 15, 16. `AgentModelRow.isNew/isDefault` (Task 13) are used by `AgentProviderModelsList` (Task 7; the task notes the ordering).

**Review Focus.** Channel switch mid-check: Task 3 hook test + Task 2 Rust tests. Hostile branch refs: Task 17 domain table + Task 18 Rust hostile test and IPC pre-validation test. A -> B -> A branch list: Task 17 hook test. Partial usage snapshots: Task 9 presentation table + page states test. Keyboard: Task 5 nav, Task 8 recorder, Task 12/14/15/16/17 menu and picker keyboard tests.

## Lead decisions on open questions (2026-09-24)

1. Execute as three slices (Settings, F7 channel, pickers + F8), committed separately.
2. Keybindings: no editable "When" rules and no keybindings.json editor in this program; keep existing
   capabilities (search, rebind, modified, reset).
3. "Start new worktrees from origin" switch: out of scope for P9 (listed as a P10 follow-up only if trivial).
4. Account e-mail on provider/usage pages: do not show it (no new data surfaced).
5. Stable channel without a release must be truthful: show "No stable release yet" (not "up to date");
   add a test. Default channel stays beta.
6. Follow-up from P5: the Keybindings settings page (keybindingsPresentation.ts) must use the scoped
   `findKeymapSequenceConflicts` from src/domain/keymap.ts instead of the unscoped finder in
   shortcutSequence.ts, so ⌘K (palette, outside editor) is not reported as conflicting with the six
   ⌘K chords (editor text only). Add a test.
