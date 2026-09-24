# Redesign P8 - Projects, clone, onboarding, trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the redesigned project onboarding: first-run empty state, "Add project" palette page (open folder, Git URL, GitHub, GitLab, recent folders - F3), one-step clone form with live validation (F6) and default destination `~/code/<name>` that remembers the last parent folder (F5), a clone progress banner with real Git progress and cancel, typed clone errors with Retry / Remove project, and a workspace trust dialog (F4) that replaces every one-click trust grant, while keeping the Rust trust gate authoritative.

**Architecture:** Rust `local_clone` gains a bounded Git progress/diagnostics reader, a closed failure classification and a one-level "ensure `~/code`" option; the TS wire contract mirrors them. Pure domain modules resolve clone input, destinations, form validation and banner copy. A `WorkspaceTrustPromptCoordinator` (Observer, like `QuickInputCoordinator`) plus a `ConfirmingWorkspaceTrustGateway` decorator add an explicit confirmation step before any trust grant; the grant itself still goes through the existing `set_workspace_trust` Rust command. Cloned projects defer the agent auto-admission grant so they open untrusted and ask via the dialog. New UI lives in `src/components/projects/**`, composes P1 foundation components and P5 command-list primitives, and is mounted through one `ProjectOnboardingLayer` in `AgentModeView`.

**Tech Stack:** React 19 + TypeScript (vitest, jsdom, `createRoot` + `act`), Tauri 2 / Rust (cargo test), lucide-react 1.18, P1 tokens `--cv-*`, P1 foundation (`src/ui/foundation/**`), P5 `src/ui/foundation/CommandList.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (§3.1.10, §3.3 F3-F6, §4, §5 row P8, §6, §7). Mockup: `docs/redesign/v3-projects-clone.html` (states First run, Add project, Clone form, Cloning, Auth error, Offline, Cloned, Trust, Projects). Briefs: `docs/redesign/BRIEF-v2.md`, `docs/redesign/BRIEF-v3-screens.md`. t3code reference: `/tmp/t3code-research-2/apps/web/src/components/NoProjectsHero.tsx`.

## Global Constraints

- Where the mockup and the spec disagree, the spec wins; where the spec is silent, the mockup wins (spec §2).
- Layering (CLAUDE.md): domain has no React/Tauri/timers; application depends on ports; adapters implement ports; `App.tsx`, `AgentModeView.tsx`, `AgentWorkbenchScreen.tsx`, `lib.rs` are composition roots only. P8 makes **zero** changes to `App.tsx` and `lib.rs`.
- Rust trust gate stays authoritative: no new trust command, no weakening of `set_workspace_trust`, `grant_opened_project_trust` or launch reservations. The dialog only decides whether the existing command is called.
- IPC contracts are closed: TS parsers reject unknown keys and unknown enum variants; Rust `deny_unknown_fields`. Every wire change has tests on both sides.
- Never send raw Git stderr to the UI. Only closed enums (`phase`, `failure`) and bounded numbers cross IPC.
- Bounds: progress line buffer 512 bytes, 12 retained diagnostic lines, stderr retention 64 KiB (unchanged), recent folders shown 5 (stored 25), `recentWorkspaceOpenedAt` entries 25, deferred trust roots 16, clone URL 2048 chars, path 4096 bytes, folder name 64 chars, branch 255 chars.
- Colors only from `--cv-*` tokens (spec §4 "no feature component defines its own colors"); `prefers-reduced-motion` disables the progress-track transition and spinner animation.
- Copy is sentence case, no trailing period on titles, US English, exact strings as listed in each task. Written prose must use a plain hyphen "-" not an em dash.
- No code comments except tooling annotations (user rule).
- Tests: React-aware `act`; never suppress warnings; no `throw` in test code; no real network.
- Verification: `npm run check`, `npm run lint -- --max-warnings 0`, `npm run lint:exhaustive-deps`, `npm run size:hotspots`, `npm run format:check`, `npm run format:check:changed`, `npm test -- --run`, Rust `cargo check --all-targets`, `cargo test --lib`, `cargo test --tests`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, `git diff --check`. CLAUDE.md also lists `npm run build`; run it once in Task 18 only because the QA app bundle is a deliverable.
- `prettier --write` only on files this phase owns, never on a directory.
- Commit to `main`, no push, no tag, no AI attribution, no Co-Authored-By line.

## Review Focus

1. **Pasting a URL with a token** (`https://ghp_x@github.com/a/b.git`, `https://user:pw@host/a/b`) - the form must say "A URL carrying credentials is rejected" and never enable Clone, never persist the URL. Test: Task 4 `rejects credential-bearing URLs`, Task 12 `never enables Clone for credential URLs`.
2. **Destination already exists / is already a project** - typing or defaulting to an existing folder must show the error inline before submit, and an open project must offer "Open existing" instead of a doomed clone. Test: Task 6 `flags existing folder and existing project`, Task 12 `offers Open existing for a project destination`.
3. **Workspace switch while the trust dialog is open (A -> B -> A)** - a confirmation for A must not trust B, and a stale confirmation must not trust A's new generation. Test: Task 8 `ignores a confirmation after the workspace changed`, Task 10 `does not grant when the project generation changed during the prompt`.
4. **Retry after a failed or cancelled clone keeps the message, the destination and the `~/code` creation flag** - retry must re-send `ensureParent` and the original branch. Test: Task 11 `retry resends ensureParent and branch`.
5. **Huge / chatty Git progress output** (progress `\r` updates over 64 KiB, a line longer than 512 bytes, an error printed after 64 KiB of progress) - progress keeps updating, memory stays bounded, and the final error is still classified. Test: Task 1 `classifies an error printed after the retention limit`, `drops overlong lines without growing`.

---

## Current code map (read before starting)

| Surface | Files today | Notes |
|---|---|---|
| Add-project entry | `src/components/agentMode/AgentProjectSourceDialog.tsx` (environment picker + "Open existing folder" / "Clone repository"), `AgentExistingServerProjectDialog` in the same file | legacy `palette-backdrop` / `quick-open` classes |
| Folder browser | `src/components/agentMode/AgentAddProjectDialog.tsx` (335 lines, `useDirectoryBrowser`, modes `addProject` / `selectDirectory`) | reused by clone "Choose folder" and server flows |
| Local clone UI | `src/components/agentMode/AgentLocalCloneDialog.tsx` (3 steps: source picker -> URL -> confirm), `agentLocalCloneDialog.css` | default destination `$HOME/<name>` |
| Clone banner | `src/components/agentMode/AgentCloneDraftPanel.tsx` + `.css`, rendered by `AgentCloneComposer.tsx` above `AgentComposer` | status strings only, raw `error` text |
| Server empty state | `src/components/agentMode/AgentRemoteDraftProjectChooser.tsx` + `.css` (native `<select>`) | |
| Clone orchestration | `useAgentProjectCreation.ts` (4 lanes), `useAgentProjectCreationLane.ts`, `agentProjectCreationSession.ts`, `useAgentAddProject.ts`, `useAgentWorkbenchProjectOpening.ts`, `agentWorkbenchChrome.ts` | lanes, sessions and receipts stay; P8 only adds options/fields |
| Local clone state | `src/application/useLocalProjectClone.ts` (polls every 1.5 s), port `application/ports/localProjectCloneGateway.ts`, adapter `infrastructure/tauriLocalProjectCloneGateway.ts`, contract `domain/localProjectClone.ts` | snapshot has no progress / failure kind |
| Rust clone | `src-tauri/src/local_clone/{mod,service,process,directory,directory_reservation,wire}.rs`, pipes `src-tauri/src/repository_lookup/pipes.rs` (shared via `repository_process_support.rs`) | `git clone --quiet`, generic error, parent must exist |
| Trust (workbench) | `useWorkbenchSettingsCommands.ts` `toggleWorkspaceTrust` (one click), `WorkspaceTrustIntentCoordinator`, BottomPanel "Trust" buttons, `trustWorkspace` passed to the agent host | Rust `set_workspace_trust` in `workspace_trust_commands.rs` |
| Trust (agents) | `useAgentProjects.ts` auto-admission via `AgentOpenedProjectAdmission` -> Rust `grant_opened_project_trust`; `trustProject = refreshProject` (only re-reads); project menu command `"trust"` has no menu entry | cloned projects are auto-trusted today |
| Recent folders | `AppSettings.recentWorkspacePaths` (25, no timestamps), written in `useWorkbenchWorkspaceTransitionCoordinator.ts:1490-1502` | |
| First run | `AgentThreadList.tsx:143` "No projects yet"; center shows the regular empty thread | |

## Key decisions

1. **Add project is a P8 page built from P5 primitives**, opened by the registry command `project.add` (P5 palette root action + Switch project page row) and by the sidebar / hero "Add project" buttons.
2. **Sources:** Open folder -> existing folder browser `AgentAddProjectDialog` unchanged (P5 keeps the legacy `.palette-backdrop` / `.quick-open*` classes styled; migrating its frame is left to P10). Git URL -> one-step clone form. GitHub / GitLab -> the existing `ProjectRepositoryPicker` (spec keeps repository search UI as-is) whose selection pre-fills the clone form; GitHub also works as `owner/repo` shorthand in the form. Environment control switches to server flows, which keep the existing remote dialogs (spec out-of-scope list).
3. **Pasting a Git URL or an absolute path into the Add project input** jumps to the clone form (URL) or offers "Open <path>" (path), as in the mockup.
4. **Default destination** `~/code/<folder>`; `lastCloneParentPath` (AppSettings) replaces `~/code` after the first clone. `~/code` is created by Rust only when the request says `ensureParent: true`, only one level, only directly under the canonical `$HOME`.
5. **Real progress:** Rust runs `git clone --progress`, parses phase / percent / bytes / rate from stderr through a bounded reader, publishes them in the snapshot; TS maps phases to one overall track (counting 0-4, compressing 4-8, receiving 8-82, resolving 82-96, checking out 96-100).
6. **Typed failures:** `authentication | notFound | branchNotFound | network | hostKey | timeout | destination | other`, classified in Rust from the reader's retained diagnostic lines (not the truncated stderr buffer). Banner copy comes from the kind.
7. **Trust dialog everywhere a grant happens:** workbench toggle / BottomPanel Trust buttons / agent host `onTrustWorkspace` (all call `toggleWorkspaceTrust`) and the agent project menu "Trust project…" (P4 adds the entry). Revocation stays one click. The Settings "Trusted workspace" switch stays a direct setting (agreed with P9).
8. **Cloned projects open untrusted:** the clone lane opens the finished clone with `trust: "prompt"`, which defers the auto-admission grant for that path once; the composer shows "Not trusted yet · Review" and sending opens the dialog. Folders the user opens with Open folder / Recent keep today's auto-admission.
9. **Agent-side grant path:** confirm via the dialog, revalidate the exact project entry (root key + generation + admission token), then call the same `setTrust(rootPath, true)` Rust command the workbench uses, then either notify the active workspace or reload the project entry.
10. **Project filter** is P4 (F1). P8 only QA-checks that added and cloned projects appear in it.

## Ownership

P8 runs after P2-P6 have landed. Every file below is written by P8 only, unless the row says "hunk", in which case P8 edits only the named lines of a file owned by the listed phase.

**Created by P8**

- Rust: `src-tauri/src/local_clone/progress.rs`, `src-tauri/src/local_clone/failure.rs`, `src-tauri/src/local_clone/progress_tests.rs`
- Domain: `src/domain/cloneRepositoryInput.ts`, `src/domain/cloneDestination.ts`, `src/domain/cloneForm.ts`, `src/domain/cloneStatusPresentation.ts`, `src/domain/recentFolders.ts`, `src/domain/projectOnboardingSettings.ts` (+ `.test.ts` for each)
- Application: `src/application/workspaceTrustPrompt.ts`, `src/application/confirmingWorkspaceTrustGateway.ts`, `src/application/workspaceTrustGrantConfirmation.ts`, `src/application/agentProjectTrustGrant.ts`, `src/application/useCloneDestinationProbe.ts`, `src/application/useRepositoryHostStatus.ts` (+ tests)
- UI: `src/components/projects/` - `projects.css`, `WorkspaceTrustDialog.tsx`, `WorkspaceTrustDialogHost.tsx`, `CloneRepositoryForm.tsx`, `useCloneRepositoryForm.ts`, `AddProjectPalette.tsx`, `addProjectPaletteModel.ts`, `EnvironmentControl.tsx`, `ProjectOnboardingLayer.tsx`, `CloneProgressBanner.tsx`, `cloneBannerModel.ts`, `ProjectTrustBanner.tsx`, `NoProjectsHero.tsx`, `AgentExistingServerProjectDialog.tsx` (moved) (+ tests)
- `src/components/agentMode/useAgentCloneDestinationPreference.ts` (+ test)

**Modified by P8 (P8-owned for this phase)**

- Rust: `src-tauri/src/local_clone/{mod,service,process,directory,wire,tests,directory_tests}.rs`, `src-tauri/src/repository_lookup/pipes.rs` (adds an observer variant, existing callers unchanged)
- `src/domain/localProjectClone.ts`, `src/domain/trust.ts`, `src/infrastructure/tauriLocalProjectCloneGateway.test.ts`
- `src/application/useLocalProjectClone.ts` (+ test), `src/application/agentOpenedProjectAdmission.ts` (+ test)
- `src/components/agentMode/`: `AgentCloneComposer.tsx`, `AgentRemoteDraftProjectChooser.tsx` + `.css`, `useAgentProjectCreation.ts`, `useAgentProjectCreationLane.ts`, `agentProjectCreationSession.ts`, `useAgentAddProject.ts`, `useAgentWorkbenchProjectOpening.ts`, `agentWorkbenchChrome.ts` (+ their tests)

**Deleted by P8**

- `AgentLocalCloneDialog.tsx`, `.test.tsx`, `agentLocalCloneDialog.css`; `AgentCloneDraftPanel.tsx`, `.test.tsx`, `agentCloneDraftPanel.css`; `AgentProjectSourceDialog.tsx`, `.test.tsx` (its `AgentExistingServerProjectDialog` moves to `src/components/projects/AgentExistingServerProjectDialog.tsx`)

**Hunks in files owned by other phases (agreed)**

| File | Owner | P8 hunk | Agreement |
|---|---|---|---|
| `src/components/agentMode/AgentModeView.tsx` | P2 | (a) replace the dialog block (`AgentProjectSourceDialog`, `AgentExistingServerProjectDialog`, `AgentLocalCloneDialog`, `AgentAddProjectDialog`) with `<ProjectOnboardingLayer …/>`; (b) first branch of the center ternary renders `<NoProjectsHero/>`; (c) `project.add` handler in `commandHandlers`; (d) `onTrustProject` type gains optional `origin` | P2 confirmed it does not move the dialog block or the center ternary |
| `src/components/agentMode/AgentWorkbenchScreen.tsx` | P2 | `onTrustProject`, `useAgentWorkbenchProjectOpening` extra deps, `useAgentCloneDestinationPreference` (~20 lines) | P2 confirmed |
| `src/components/WorkbenchOverlayHosts.tsx` | shell | mount `<WorkspaceTrustDialogHost/>`, widen the composition `Pick` | P2 asked for this instead of App.tsx |
| `src/workbenchComposition.ts` | shell | create `WorkspaceTrustPromptCoordinator`, decorate the trust gateway | P2 asked for composition routing |
| `src/application/workbenchController/useWorkbenchSettingsCommands.ts` | workbench | 8-line confirmation step at the top of `toggleWorkspaceTrust` | nobody else edits trust there |
| `src/application/workbenchController/useWorkbenchWorkspaceTransitionCoordinator.ts` | workbench | one property in the `persistAppSettings` call at lines ~1497-1502 | - |
| `src/application/useAgentProjects.ts` | agents | 2 new methods (`deferOpenedProjectTrust`, `grantProjectTrust`) delegating to new modules, surface type additions | P4 does not change project trust |
| `src/domain/settings.ts` | P9 | 2 optional fields + normalize calls | P9 notified; second lander rebases |
| `src/domain/keymap.ts` | P5 | one `project.add` entry | P5 requested P8 registers it |
| `src/application/agentViewCommandBridge.ts`, `src/application/workbenchAgentCommands.ts`, `src/components/agentMode/useAgentViewCommands.ts` (+ tests) | shared (the bridge already has uncommitted edits from a running phase when this plan was written) | `project.add` id, optional `addProject` handler, `addProjectAvailable()`, one command entry | rebase on whatever P2/P5 committed; P8 adds members only, never renames |
| `src/components/agentMode/AgentComposer*` | P3 | none - P3 adds `banners?: ReactNode` and `placeholder?: string` to `AgentComposerProps` | P3 confirmed prop names |
| `src/ui/foundation/CommandList.tsx` | P5 | none - P8 uses `CommandSurface`, `CommandInput` (`leadIcon`, `lead`, `onBack`, `trailing`), `CommandPanel`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`, `CommandFooter`, `CommandFooterHint`, `useCommandListNavigation` | P5 confirmed the API; `trailing` requested (if P5 names it differently, rename at the 2 call sites) |
| `agentProjectMenuPresentation.ts` (P4 new module) | P4 | none - P4 adds "Trust project…" (command `"trust"`) for untrusted local projects and the "Not trusted" scope label | P4 confirmed |
| `AgentThreadsSidebar` / `AgentRailCloneRow.tsx` | P4 | none - P8 keeps `pendingClones` fields and `AgentRailCloneRow` props unchanged, only adds optional fields | P4 confirmed |
| AgentComposerController `banners` in AgentModeView | P9 | none - P8 does not use that slot | P9 informed |

Files P8 must not touch: `App.tsx`, `lib.rs`, `AgentThreadSession*.tsx`, `AgentComposer*.tsx`, `AgentThreadsSidebar.tsx`, `AgentThreadList.tsx`, `agentSidebarPresentation.ts`, `CommandPalette*`, `src/ui/foundation/**` (read only), `src/ui/tokens/**`.

## File structure

```text
src-tauri/src/local_clone/
  progress.rs          bounded stderr reader: progress lines -> CloneProgress, other lines -> diagnostics ring
  failure.rs           closed CloneFailure + ordered classification table
  progress_tests.rs    parser/reader/classifier unit tests
  wire.rs              + ensure_parent (request), progress/failure (snapshot)
  directory.rs         + prepare_parent (one-level ~/code creation under canonical HOME)
  service.rs           --progress, observer wiring, failure recording, settle rules
  process.rs           run_bounded(..., observe_stderr)
src-tauri/src/repository_lookup/pipes.rs  read_streams -> read_streams_observed

src/domain/
  localProjectClone.ts         wire contract (progress, failure, ensureParent)
  cloneRepositoryInput.ts      raw input -> empty | credentials | invalid | ok{url, identity, transport}
  cloneDestination.ts          ~ expansion/abbreviation, default parent, folder-name suggestion, destination parse
  cloneForm.ts                 pure form evaluation -> card, suggestion, errors, request
  cloneStatusPresentation.ts   overall percent, progress summary, failure copy
  recentFolders.ts             recent folder entries with ages, opened-at bookkeeping
  projectOnboardingSettings.ts normalizers for the two new AppSettings fields
  trust.ts                     + WorkspaceTrustConfirmation, confirmGrant capability

src/application/
  workspaceTrustPrompt.ts             prompt coordinator (Observer, single active request, host lease)
  confirmingWorkspaceTrustGateway.ts  Decorator adding confirmGrant to a WorkspaceTrustGateway
  workspaceTrustGrantConfirmation.ts  confirm-then-revalidate helper for the workbench toggle
  agentProjectTrustGrant.ts           confirm -> revalidate -> setTrust for agent projects
  useCloneDestinationProbe.ts         debounced, generation-guarded existence probe
  useRepositoryHostStatus.ts          GitHub / GitLab availability for the Sources list

src/components/projects/
  projects.css, NoProjectsHero.tsx, AddProjectPalette.tsx, addProjectPaletteModel.ts,
  EnvironmentControl.tsx, CloneRepositoryForm.tsx, useCloneRepositoryForm.ts,
  CloneProgressBanner.tsx, cloneBannerModel.ts, ProjectTrustBanner.tsx,
  WorkspaceTrustDialog.tsx, WorkspaceTrustDialogHost.tsx, ProjectOnboardingLayer.tsx,
  AgentExistingServerProjectDialog.tsx
```

Slices: Tasks 1-11 are behavior (Rust + contracts + domain + application) and can be committed as slice A after Task 11 passes focused tests; Tasks 12-16 are UI (slice B). Tasks 17-20 wrap up both.

---
### Task 1: Rust clone output reader and failure classifier

**Files:**
- Create: `src-tauri/src/local_clone/progress.rs`
- Create: `src-tauri/src/local_clone/failure.rs`
- Create: `src-tauri/src/local_clone/progress_tests.rs`
- Modify: `src-tauri/src/local_clone/mod.rs` (declare modules)
- Modify: `src-tauri/src/repository_lookup/pipes.rs` (observer variant)

**Interfaces:**
- Produces (Rust, crate-private):
  - `enum ClonePhase { Counting, Compressing, Receiving, Resolving, CheckingOut }` serialized camelCase (`"counting"`, …, `"checkingOut"`)
  - `struct CloneProgress { phase: ClonePhase, percent: u8, received_bytes: Option<u64>, bytes_per_second: Option<u64> }` serialized `{phase, percent, receivedBytes, bytesPerSecond}`
  - `struct CloneOutputReader` with `push(&mut self, &[u8]) -> Option<CloneProgress>`, `finish(&mut self) -> Option<CloneProgress>`, `diagnostics(&self) -> impl Iterator<Item = &str> + Clone`
  - `fn parse_progress_line(&str) -> Option<CloneProgress>`
  - `enum CloneFailure { Authentication, NotFound, BranchNotFound, Network, HostKey, Timeout, Destination, Other }` serialized camelCase
  - `fn classify_failure<'a>(lines: impl Iterator<Item = &'a str> + Clone) -> CloneFailure`
  - `pipes::read_streams_observed(stdout, stderr, limits, deadline, observe_stderr: &mut dyn FnMut(&[u8])) -> StreamsResult`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/local_clone/progress_tests.rs`:

```rust
use super::failure::{classify_failure, CloneFailure};
use super::progress::{parse_progress_line, CloneOutputReader, ClonePhase, CloneProgress};

fn progress(phase: ClonePhase, percent: u8) -> CloneProgress {
    CloneProgress {
        phase,
        percent,
        received_bytes: None,
        bytes_per_second: None,
    }
}

#[test]
fn parses_every_git_progress_phase() {
    assert_eq!(
        parse_progress_line("remote: Counting objects:  12% (12/100)"),
        Some(progress(ClonePhase::Counting, 12))
    );
    assert_eq!(
        parse_progress_line("remote: Enumerating objects: 2742, done."),
        None
    );
    assert_eq!(
        parse_progress_line("remote: Compressing objects:  45% (54/120)"),
        Some(progress(ClonePhase::Compressing, 45))
    );
    assert_eq!(
        parse_progress_line("Resolving deltas: 100% (300/300), done."),
        Some(progress(ClonePhase::Resolving, 100))
    );
    assert_eq!(
        parse_progress_line("Updating files:  50% (10/20)"),
        Some(progress(ClonePhase::CheckingOut, 50))
    );
    assert_eq!(parse_progress_line("Cloning into '.'..."), None);
    assert_eq!(parse_progress_line("Receiving objects: 101% (1/1)"), None);
}

#[test]
fn parses_received_bytes_and_rate() {
    assert_eq!(
        parse_progress_line("Receiving objects:  45% (1234/2742), 12.50 MiB | 5.00 MiB/s"),
        Some(CloneProgress {
            phase: ClonePhase::Receiving,
            percent: 45,
            received_bytes: Some(13_107_200),
            bytes_per_second: Some(5_242_880),
        })
    );
    assert_eq!(
        parse_progress_line(
            "Receiving objects: 100% (2742/2742), 27.40 MiB | 5.00 MiB/s, done."
        )
        .and_then(|value| value.bytes_per_second),
        Some(5_242_880)
    );
    assert_eq!(
        parse_progress_line("Receiving objects:  10% (1/10), 512 bytes | 1.00 KiB/s")
            .and_then(|value| value.received_bytes),
        Some(512)
    );
    assert_eq!(
        parse_progress_line("Receiving objects:  10% (1/10), 1e300 GiB | NaN MiB/s")
            .and_then(|value| value.received_bytes),
        None
    );
}

#[test]
fn reader_splits_carriage_returns_across_chunks() {
    let mut reader = CloneOutputReader::default();
    assert_eq!(reader.push(b"Receiving objects:  1"), None);
    assert_eq!(
        reader.push(b"0% (1/10)\rReceiving objects:  20% (2/10)\r"),
        Some(progress(ClonePhase::Receiving, 20))
    );
    assert_eq!(reader.push(b"Resolving deltas:  30% (3/10)"), None);
    assert_eq!(reader.finish(), Some(progress(ClonePhase::Resolving, 30)));
}

#[test]
fn drops_overlong_lines_without_growing() {
    let mut reader = CloneOutputReader::default();
    let long = vec![b'x'; 10_000];
    assert_eq!(reader.push(&long), None);
    assert_eq!(reader.push(b"\n"), None);
    assert_eq!(reader.diagnostics().count(), 0);
    assert_eq!(
        reader.push(b"Receiving objects:  5% (1/20)\r"),
        Some(progress(ClonePhase::Receiving, 5))
    );
}

#[test]
fn keeps_only_the_latest_diagnostic_lines_lowercased() {
    let mut reader = CloneOutputReader::default();
    for index in 0..40 {
        reader.push(format!("warning: line {index}\n").as_bytes());
    }
    reader.push(b"FATAL: Authentication failed for 'https://example.com/a/b.git/'\n");
    let lines: Vec<&str> = reader.diagnostics().collect();
    assert_eq!(lines.len(), 12);
    assert_eq!(
        lines.last().copied(),
        Some("fatal: authentication failed for 'https://example.com/a/b.git/'")
    );
}

#[test]
fn classifies_an_error_printed_after_the_retention_limit() {
    let mut reader = CloneOutputReader::default();
    for percent in 0..=100 {
        for _ in 0..20 {
            reader.push(format!("Receiving objects: {percent:3}% (1/1), 1.00 MiB | 1.00 MiB/s\r").as_bytes());
        }
    }
    reader.push(b"\nfatal: unable to access 'https://example.com/a.git/': Could not resolve host: example.com\n");
    assert_eq!(classify_failure(reader.diagnostics()), CloneFailure::Network);
}

#[test]
fn classification_order_prefers_specific_causes() {
    let cases: [(&[&str], CloneFailure); 8] = [
        (&["host key verification failed.", "fatal: could not read from remote repository."], CloneFailure::HostKey),
        (&["fatal: could not read username for 'https://github.com': terminal prompts disabled"], CloneFailure::Authentication),
        (&["git@github.com: permission denied (publickey).", "fatal: the remote end hung up unexpectedly"], CloneFailure::Authentication),
        (&["warning: could not find remote branch nope to clone.", "fatal: remote branch nope not found in upstream origin"], CloneFailure::BranchNotFound),
        (&["remote: repository not found.", "fatal: repository 'https://example.com/a/b.git/' not found"], CloneFailure::NotFound),
        (&["fatal: unable to access 'https://example.com/': failed to connect to example.com port 443"], CloneFailure::Network),
        (&["ssh: could not resolve hostname example.com: nodename nor servname provided"], CloneFailure::Network),
        (&["error: something unexpected"], CloneFailure::Other),
    ];
    for (lines, expected) in cases {
        assert_eq!(classify_failure(lines.iter().copied()), expected, "{lines:?}");
    }
}

#[test]
fn wire_values_are_camel_case() {
    assert_eq!(
        serde_json::to_value(CloneProgress {
            phase: ClonePhase::CheckingOut,
            percent: 7,
            received_bytes: Some(1),
            bytes_per_second: None,
        })
        .unwrap(),
        serde_json::json!({"phase":"checkingOut","percent":7,"receivedBytes":1,"bytesPerSecond":null})
    );
    assert_eq!(
        serde_json::to_value(CloneFailure::BranchNotFound).unwrap(),
        serde_json::json!("branchNotFound")
    );
}
```

Add to `src-tauri/src/local_clone/mod.rs` below `mod directory;`:

```rust
mod failure;
mod progress;
#[cfg(test)]
#[path = "progress_tests.rs"]
mod progress_tests;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib local_clone::progress_tests`
Expected: FAIL to compile with "file not found for module `failure`" / "unresolved import".

- [ ] **Step 3: Implement the reader**

Create `src-tauri/src/local_clone/progress.rs`:

```rust
use serde::Serialize;
use std::collections::VecDeque;

const MAX_LINE_BYTES: usize = 512;
const MAX_DIAGNOSTIC_LINES: usize = 12;
const MAX_SAFE_BYTES: f64 = 9_007_199_254_740_991.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClonePhase {
    Counting,
    Compressing,
    Receiving,
    Resolving,
    CheckingOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloneProgress {
    pub phase: ClonePhase,
    pub percent: u8,
    pub received_bytes: Option<u64>,
    pub bytes_per_second: Option<u64>,
}

#[derive(Default)]
pub(crate) struct CloneOutputReader {
    partial: Vec<u8>,
    discarding: bool,
    diagnostics: VecDeque<String>,
}

impl CloneOutputReader {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Option<CloneProgress> {
        let mut latest = None;
        for &byte in bytes {
            if byte == b'\r' || byte == b'\n' {
                if let Some(progress) = self.finish_line() {
                    latest = Some(progress);
                }
                continue;
            }
            if self.discarding {
                continue;
            }
            if self.partial.len() >= MAX_LINE_BYTES {
                self.partial.clear();
                self.discarding = true;
                continue;
            }
            self.partial.push(byte);
        }
        latest
    }

    pub(crate) fn finish(&mut self) -> Option<CloneProgress> {
        self.finish_line()
    }

    pub(crate) fn diagnostics(&self) -> impl Iterator<Item = &str> + Clone {
        self.diagnostics.iter().map(String::as_str)
    }

    fn finish_line(&mut self) -> Option<CloneProgress> {
        let discarded = std::mem::replace(&mut self.discarding, false);
        let line = String::from_utf8_lossy(&self.partial).trim().to_owned();
        self.partial.clear();
        if discarded || line.is_empty() {
            return None;
        }
        if let Some(progress) = parse_progress_line(&line) {
            return Some(progress);
        }
        if self.diagnostics.len() == MAX_DIAGNOSTIC_LINES {
            self.diagnostics.pop_front();
        }
        self.diagnostics.push_back(line.to_ascii_lowercase());
        None
    }
}

pub(crate) fn parse_progress_line(line: &str) -> Option<CloneProgress> {
    let body = line.strip_prefix("remote: ").unwrap_or(line);
    let (label, rest) = body.split_once(':')?;
    let phase = match label.trim() {
        "Counting objects" => ClonePhase::Counting,
        "Compressing objects" => ClonePhase::Compressing,
        "Receiving objects" => ClonePhase::Receiving,
        "Resolving deltas" => ClonePhase::Resolving,
        "Updating files" | "Checking out files" => ClonePhase::CheckingOut,
        _ => return None,
    };
    let (percent_text, after_percent) = rest.trim_start().split_once('%')?;
    let percent = percent_text.trim().parse::<u8>().ok().filter(|value| *value <= 100)?;
    let (received_bytes, bytes_per_second) = after_percent
        .split_once(", ")
        .map(|(_, transfer)| parse_transfer(transfer))
        .unwrap_or((None, None));
    Some(CloneProgress {
        phase,
        percent,
        received_bytes,
        bytes_per_second,
    })
}

fn parse_transfer(text: &str) -> (Option<u64>, Option<u64>) {
    let mut parts = text.split('|');
    let received = parts.next().and_then(parse_size);
    let rate = parts
        .next()
        .and_then(|value| value.split(',').next())
        .and_then(|value| value.trim().strip_suffix("/s"))
        .and_then(parse_size);
    (received, rate)
}

fn parse_size(text: &str) -> Option<u64> {
    let (number, unit) = text.trim().split_once(' ')?;
    let value = number.parse::<f64>().ok().filter(|value| value.is_finite() && *value >= 0.0)?;
    let scale = match unit.trim() {
        "bytes" => 1.0,
        "KiB" => 1024.0,
        "MiB" => 1_048_576.0,
        "GiB" => 1_073_741_824.0,
        _ => return None,
    };
    let bytes = (value * scale).round();
    if bytes > MAX_SAFE_BYTES {
        return None;
    }
    Some(bytes as u64)
}
```

Create `src-tauri/src/local_clone/failure.rs`:

```rust
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloneFailure {
    Authentication,
    NotFound,
    BranchNotFound,
    Network,
    HostKey,
    Timeout,
    Destination,
    Other,
}

const CLASSIFICATION_TABLE: [(CloneFailure, &[&str]); 5] = [
    (
        CloneFailure::HostKey,
        &["host key verification failed", "no matching host key"],
    ),
    (
        CloneFailure::Authentication,
        &[
            "authentication failed",
            "could not read username",
            "could not read password",
            "permission denied (publickey",
            "invalid username or password",
            "terminal prompts disabled",
            "the requested url returned error: 401",
            "the requested url returned error: 403",
        ],
    ),
    (
        CloneFailure::BranchNotFound,
        &["not found in upstream", "could not find remote branch"],
    ),
    (
        CloneFailure::NotFound,
        &[
            "repository not found",
            "does not appear to be a git repository",
            "the requested url returned error: 404",
            "' not found",
        ],
    ),
    (
        CloneFailure::Network,
        &[
            "could not resolve host",
            "could not resolve hostname",
            "failed to connect",
            "connection timed out",
            "connection refused",
            "connection reset",
            "network is unreachable",
            "operation timed out",
            "ssl",
            "early eof",
            "the remote end hung up unexpectedly",
        ],
    ),
];

pub(crate) fn classify_failure<'a>(lines: impl Iterator<Item = &'a str> + Clone) -> CloneFailure {
    for (failure, needles) in CLASSIFICATION_TABLE {
        if lines
            .clone()
            .any(|line| needles.iter().any(|needle| line.contains(needle)))
        {
            return failure;
        }
    }
    CloneFailure::Other
}
```

- [ ] **Step 4: Add the observer variant to the shared pipe reader**

In `src-tauri/src/repository_lookup/pipes.rs`, replace the body of `read_streams` with a delegation and move the loop into `read_streams_observed`; change `BoundedStream::drain` to take the observer:

```rust
pub(crate) fn read_streams<O: Read + AsRawFd, E: Read + AsRawFd>(
    stdout: O,
    stderr: E,
    limits: StreamLimits,
    deadline: Instant,
) -> StreamsResult {
    read_streams_observed(stdout, stderr, limits, deadline, &mut |_| {})
}

pub(crate) fn read_streams_observed<O: Read + AsRawFd, E: Read + AsRawFd>(
    stdout: O,
    stderr: E,
    limits: StreamLimits,
    deadline: Instant,
    observe_stderr: &mut dyn FnMut(&[u8]),
) -> StreamsResult {
    if !set_non_blocking(stdout.as_raw_fd()) || !set_non_blocking(stderr.as_raw_fd()) {
        return StreamsResult::Failed;
    }
    let mut out = BoundedStream::new(stdout, limits.stdout_bytes, false);
    let mut err = BoundedStream::new(stderr, limits.stderr_bytes, true);
    loop {
        if out.finished && err.finished {
            return StreamsResult::Complete {
                stdout: out.into_buffer(),
                stderr: err.into_buffer(),
            };
        }
        let now = Instant::now();
        if now >= deadline {
            return StreamsResult::TimedOut;
        }
        let timeout = poll_millis(deadline.saturating_duration_since(now));
        let mut descriptors = [out.poll_descriptor(), err.poll_descriptor()];
        let ready = poll_descriptors(&mut descriptors, timeout);
        let Some(ready) = ready else {
            return StreamsResult::Failed;
        };
        if ready == 0 {
            continue;
        }
        if descriptors[0].revents != 0 && out.drain(&mut |_| {}) {
            return StreamsResult::TooLarge;
        }
        if descriptors[1].revents != 0 {
            err.drain(observe_stderr);
        }
    }
}
```

and

```rust
    fn drain(&mut self, observe: &mut dyn FnMut(&[u8])) -> bool {
        match self.reader.read(&mut self.chunk) {
            Ok(0) => {
                self.finished = true;
                false
            }
            Ok(count) => {
                observe(&self.chunk[..count]);
                self.push(count)
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => false,
            Err(error) if error.kind() == ErrorKind::Interrupted => false,
            Err(_) => {
                self.finished = true;
                false
            }
        }
    }
```

`read_streams` keeps its signature, so `repository_lookup/process.rs` and `agent_turn_changes/git_process.rs` compile unchanged, and `read_streams_observed` is used in every compilation unit that includes `pipes.rs` (no dead-code warning).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib local_clone::progress_tests && cargo test --lib repository_lookup`
Expected: PASS (8 new tests, repository_lookup tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/local_clone/progress.rs src-tauri/src/local_clone/failure.rs src-tauri/src/local_clone/progress_tests.rs src-tauri/src/local_clone/mod.rs src-tauri/src/repository_lookup/pipes.rs
git commit -m "feat(clone): parse git progress and classify clone failures in bounded reader"
```

### Task 2: Rust clone service - progress, failure kind, `~/code` creation

**Files:**
- Modify: `src-tauri/src/local_clone/wire.rs`
- Modify: `src-tauri/src/local_clone/service.rs`
- Modify: `src-tauri/src/local_clone/process.rs`
- Modify: `src-tauri/src/local_clone/directory.rs`
- Modify: `src-tauri/src/local_clone/tests.rs`, `src-tauri/src/local_clone/directory_tests.rs`

**Interfaces:**
- Consumes: Task 1 types.
- Produces (wire):
  - request `{ idempotencyKey, url, name, parentPath, branch?, ensureParent? }` - `ensureParent` boolean, default `false`
  - snapshot `{ cloneId, status, path, error, progress, failure }` - `progress` non-null only while `running`; `failure` non-null exactly when `failed`
  - `Destination::reserve(parent: &str, name: &str, ensure_parent: bool)`
  - `process::run_bounded(command, limits, kill, observe_stderr: &mut dyn FnMut(&[u8]))`
  - `Job::publish_progress(&self, CloneProgress)`, `Job::record_failure(&self, CloneFailure)`

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/local_clone/tests.rs`:

```rust
#[test]
fn running_snapshot_publishes_progress_and_terminal_states_clear_it() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let (published, proceed) = std::sync::mpsc::channel::<()>();
    let (release, released) = std::sync::mpsc::channel::<()>();
    let started = state
        .start_with(fixture.request(1), move |job, destination| {
            job.publish_progress(super::progress::CloneProgress {
                phase: super::progress::ClonePhase::Receiving,
                percent: 42,
                received_bytes: Some(1024),
                bytes_per_second: None,
            });
            published.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(2)).unwrap();
            destination.verify()
        })
        .unwrap();
    proceed.recv_timeout(Duration::from_secs(2)).unwrap();
    let running = state.get(&started.clone_id).unwrap();
    assert_eq!(running.status, Status::Running);
    assert_eq!(running.progress.map(|value| value.percent), Some(42));
    assert_eq!(running.failure, None);
    release.send(()).unwrap();
    let done = wait(&state, &started.clone_id);
    assert_eq!(done.status, Status::Completed);
    assert_eq!(done.progress, None);
    assert_eq!(done.failure, None);
}

#[test]
fn failed_snapshot_carries_recorded_or_default_failure_kind() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let recorded = state
        .start_with(fixture.request(1), |job, _| {
            job.record_failure(super::failure::CloneFailure::Authentication);
            Err("Cloning failed.".into())
        })
        .unwrap();
    let failed = wait(&state, &recorded.clone_id);
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(failed.failure, Some(super::failure::CloneFailure::Authentication));
    let unrecorded = state
        .start_with(fixture.request(2), |_, _| Err("Cloning failed.".into()))
        .unwrap();
    assert_eq!(
        wait(&state, &unrecorded.clone_id).failure,
        Some(super::failure::CloneFailure::Other)
    );
}

#[test]
fn snapshot_wire_shape_is_closed_and_camel_case() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let started = state
        .start_with(fixture.request(1), |job, _| {
            job.record_failure(super::failure::CloneFailure::Network);
            Err("Cloning failed.".into())
        })
        .unwrap();
    let failed = wait(&state, &started.clone_id);
    let value = serde_json::to_value(&failed).unwrap();
    let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["cloneId", "error", "failure", "path", "progress", "status"]);
    assert_eq!(value["failure"], serde_json::json!("network"));
    assert_eq!(value["progress"], serde_json::Value::Null);
}

#[test]
fn request_accepts_optional_ensure_parent_and_rejects_non_boolean() {
    let base = serde_json::json!({"idempotencyKey":"00000000-0000-0000-0000-000000000001","url":"https://example.com/org/repo.git","name":"repo","parentPath":"/tmp"});
    let parsed: CloneRequest = serde_json::from_value(base.clone()).unwrap();
    assert!(!parsed.ensure_parent);
    let mut with_flag = base.clone();
    with_flag["ensureParent"] = serde_json::json!(true);
    assert!(serde_json::from_value::<CloneRequest>(with_flag).unwrap().ensure_parent);
    let mut bad = base;
    bad["ensureParent"] = serde_json::json!("yes");
    assert!(serde_json::from_value::<CloneRequest>(bad).is_err());
}

#[test]
fn actual_git_clone_reports_classified_failure_for_missing_branch() {
    let fixture = Fixture::new();
    let source = fixture.0.join("branch-source");
    assert!(Command::new("git").args(["init", "--quiet"]).arg(&source).status().unwrap().success());
    std::fs::write(source.join("a.txt"), "a").unwrap();
    assert!(Command::new("git").arg("-C").arg(&source).args(["add", "a.txt"]).status().unwrap().success());
    assert!(Command::new("git")
        .arg("-C")
        .arg(&source)
        .args(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "init"])
        .status()
        .unwrap()
        .success());
    let state = LocalCloneState::default();
    let mut request = fixture.request(9);
    request.branch = Some("does-not-exist".into());
    let started = state
        .start_with(request, move |job, destination| {
            let mut command = Command::new("git");
            command
                .args(["clone", "--progress", "--branch", "does-not-exist", "--"])
                .arg(&source)
                .arg(".");
            destination.anchor(&mut command);
            run_clone(job, destination, command)
        })
        .unwrap();
    let failed = wait(&state, &started.clone_id);
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(failed.failure, Some(super::failure::CloneFailure::BranchNotFound));
    assert!(!fixture.0.join("clone-9").exists());
}
```

Update every existing `run_bounded(command, limits, &kill)` call in `tests.rs` to `run_bounded(command, limits, &kill, &mut |_| {})`, and add `ensure_parent: false,` to `Fixture::request`.

Append to `src-tauri/src/local_clone/directory_tests.rs`:

```rust
#[test]
fn ensure_parent_creates_one_missing_level_under_home_only() {
    let fixture = Fixture::new();
    let home = fixture.0.join("home");
    std::fs::create_dir(&home).unwrap();
    let code = home.join("code");
    let created = prepare_parent(code.to_str().unwrap(), true, Some(&home)).unwrap();
    assert!(code.is_dir());
    assert_eq!(created, std::fs::canonicalize(&code).unwrap());
    assert!(prepare_parent(code.to_str().unwrap(), true, Some(&home)).is_ok());
    let nested = home.join("a").join("b");
    assert!(prepare_parent(nested.to_str().unwrap(), true, Some(&home)).is_err());
    assert!(!home.join("a").exists());
    let outside = fixture.0.join("elsewhere");
    assert!(prepare_parent(outside.to_str().unwrap(), true, Some(&home)).is_err());
    assert!(!outside.exists());
    let missing = home.join("other");
    assert!(prepare_parent(missing.to_str().unwrap(), false, Some(&home)).is_err());
    assert!(!missing.exists());
    assert!(prepare_parent(home.join("..").join("x").to_str().unwrap(), true, Some(&home)).is_err());
}

#[test]
fn ensure_parent_uses_an_existing_symlinked_parent_without_creating() {
    let fixture = Fixture::new();
    let home = fixture.0.join("home");
    let target = fixture.0.join("target");
    std::fs::create_dir(&home).unwrap();
    std::fs::create_dir(&target).unwrap();
    std::os::unix::fs::symlink(&target, home.join("code")).unwrap();
    let resolved = prepare_parent(home.join("code").to_str().unwrap(), true, Some(&home)).unwrap();
    assert_eq!(resolved, std::fs::canonicalize(&target).unwrap());
}
```

Update the existing `Destination::reserve(x, name)` calls in `directory_tests.rs` to `Destination::reserve(x, name, false)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib local_clone`
Expected: FAIL to compile (`no field ensure_parent`, `no method publish_progress`, `cannot find function prepare_parent`, `cannot find function run_clone`).

- [ ] **Step 3: Implement wire changes**

In `src-tauri/src/local_clone/wire.rs`:

```rust
use super::failure::CloneFailure;
use super::progress::CloneProgress;
```

Add to `CloneRequest` after `branch`:

```rust
    #[serde(default)]
    pub ensure_parent: bool,
```

Replace `Snapshot` with:

```rust
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub clone_id: String,
    pub status: Status,
    pub path: Option<String>,
    pub error: Option<String>,
    pub progress: Option<CloneProgress>,
    pub failure: Option<CloneFailure>,
}
```

- [ ] **Step 4: Implement the parent preparation**

In `src-tauri/src/local_clone/directory.rs` change `reserve` to take `ensure_parent: bool` and start with:

```rust
    #[cfg(unix)]
    pub fn reserve(parent: &str, name: &str, ensure_parent: bool) -> Result<Self, String> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let parent_path = prepare_parent(parent, ensure_parent, home.as_deref())?;
```

(the rest of the body is unchanged from `let parent = std::fs::OpenOptions::new()` on). Change the non-unix stub signature to `pub fn reserve(_parent: &str, _name: &str, _ensure_parent: bool)`. Add at the end of the file:

```rust
#[cfg(unix)]
pub(super) fn prepare_parent(
    parent: &str,
    ensure_parent: bool,
    home: Option<&std::path::Path>,
) -> Result<PathBuf, String> {
    const UNAVAILABLE: &str = "The destination folder is unavailable.";
    match std::fs::canonicalize(parent) {
        Ok(path) => return Ok(path),
        Err(error) if !ensure_parent || error.kind() != std::io::ErrorKind::NotFound => {
            return Err(UNAVAILABLE.into())
        }
        Err(_) => {}
    }
    let requested = std::path::Path::new(parent);
    let Some(std::path::Component::Normal(name)) = requested.components().next_back() else {
        return Err(UNAVAILABLE.into());
    };
    let grandparent = requested.parent().ok_or(UNAVAILABLE)?;
    let home = std::fs::canonicalize(home.ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE)?;
    if std::fs::canonicalize(grandparent).map_err(|_| UNAVAILABLE)? != home {
        return Err(UNAVAILABLE.into());
    }
    let home_directory = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(&home)
        .map_err(|_| UNAVAILABLE)?;
    use std::os::unix::ffi::OsStrExt;
    let name = CString::new(name.as_bytes()).map_err(|_| UNAVAILABLE)?;
    // SAFETY: the directory descriptor is live for the call and `name` is a
    // NUL-terminated single path component.
    let created = unsafe { libc::mkdirat(home_directory.as_raw_fd(), name.as_ptr(), 0o755) };
    if created != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
        return Err(UNAVAILABLE.into());
    }
    std::fs::canonicalize(parent).map_err(|_| UNAVAILABLE.into())
}
```

- [ ] **Step 5: Implement service changes**

In `src-tauri/src/local_clone/process.rs` change `run_bounded` to

```rust
pub(crate) fn run_bounded(
    command: Command,
    limits: ProcessLimits,
    kill: &ProcessKillSwitch,
    observe_stderr: &mut dyn FnMut(&[u8]),
) -> Result<ProcessOutput, ProcessError> {
```

and replace `read_streams(` with `read_streams_observed(` passing `observe_stderr` as the last argument (import `read_streams_observed` instead of `read_streams`).

In `src-tauri/src/local_clone/service.rs`:

1. Imports: add `use super::failure::{classify_failure, CloneFailure};` and `use super::progress::{CloneOutputReader, CloneProgress};`, and under `#[cfg(unix)]` import `process::ProcessError`.
2. Add a field to `Job`: `failure: Mutex<Option<CloneFailure>>,` and initialize it with `failure: Mutex::new(None),`. Initialize the snapshot with `progress: None, failure: None,`.
3. Add to `impl Job`:

```rust
    pub(super) fn publish_progress(&self, progress: CloneProgress) {
        let mut state = lock(&self.snapshot);
        if state.status == Status::Running && state.progress != Some(progress) {
            state.progress = Some(progress);
        }
    }
    pub(super) fn record_failure(&self, failure: CloneFailure) {
        *lock(&self.failure) = Some(failure);
    }
```

4. `start_with`: `Destination::reserve(&request.parent_path, &request.name, request.ensure_parent)?`.
5. Replace `settle` with:

```rust
fn settle(job: &Job, destination: &Destination, result: Result<(), String>) {
    let mut state = lock(&job.snapshot);
    let cancelled = job.cancelled.load(Ordering::SeqCst);
    state.progress = None;
    if (result.is_err() || cancelled) && destination.cleanup().is_err() {
        state.status = Status::Failed;
        state.path = None;
        state.failure = Some(CloneFailure::Destination);
        state.error = Some("Cloning stopped. The partial folder could not be removed; choose a different folder name before retrying.".into());
        return;
    }
    if cancelled {
        state.status = Status::Cancelled;
        state.path = None;
        return;
    }
    match result {
        Ok(()) => state.status = Status::Completed,
        Err(error) => {
            state.status = Status::Failed;
            state.path = None;
            state.failure = Some(lock(&job.failure).take().unwrap_or(CloneFailure::Other));
            state.error = Some(error);
        }
    }
}
```

6. Split `execute` (unix) into command planning and a reusable `run_clone` (tests drive `run_clone` with their own local `git clone` command, the same way the existing `actual_git_clone_uses_reserved_destination_and_preserves_existing_folder` test does, so production code keeps `protocol.file.allow=never` without test switches):

```rust
#[cfg(unix)]
fn execute(job: &Job, destination: &Destination) -> Result<(), String> {
    if job.cancelled.load(Ordering::SeqCst) {
        return Ok(());
    }
    destination.verify()?;
    let home = std::env::var_os("HOME").ok_or("The home folder is unavailable.")?;
    let search_path = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into());
    let mut argv: Vec<String> = vec![
        "-c".into(),
        "core.hooksPath=/dev/null".into(),
        "-c".into(),
        "protocol.file.allow=never".into(),
        "-c".into(),
        "protocol.ext.allow=never".into(),
        "clone".into(),
        "--progress".into(),
        "--no-recurse-submodules".into(),
    ];
    if let Some(branch) = &job.request.branch {
        argv.extend(["--branch".into(), branch.clone()]);
    }
    argv.extend(["--".into(), job.request.url.clone(), ".".into()]);
    let mut command = plan_command(
        std::path::Path::new("git"),
        &argv,
        std::path::Path::new(&home),
        &search_path,
    );
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env(
            "GIT_SSH_COMMAND",
            "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
        );
    for key in [
        "SSH_AUTH_SOCK",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_EXEC_PATH",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    destination.anchor(&mut command);
    run_clone(job, destination, command)
}

#[cfg(unix)]
fn run_clone(job: &Job, destination: &Destination, command: std::process::Command) -> Result<(), String> {
    let mut reader = CloneOutputReader::default();
    let output = run_bounded(
        command,
        ProcessLimits {
            timeout: std::time::Duration::from_secs(1800),
            stdout_bytes: 64 * 1024,
            stderr_bytes: 64 * 1024,
        },
        &job.kill,
        &mut |chunk| {
            if let Some(progress) = reader.push(chunk) {
                job.publish_progress(progress);
            }
        },
    );
    if let Some(progress) = reader.finish() {
        job.publish_progress(progress);
    }
    match output {
        Ok(output) if output.success => destination.verify().inspect_err(|_| {
            job.record_failure(CloneFailure::Destination);
        }),
        Err(ProcessError::TimedOut) => {
            job.record_failure(CloneFailure::Timeout);
            Err("Cloning timed out.".into())
        }
        _ => {
            job.record_failure(classify_failure(reader.diagnostics()));
            Err("Cloning failed. Check the repository address and local Git access.".into())
        }
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib local_clone && cargo clippy --all-targets -- -D warnings`
Expected: PASS; clippy clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/local_clone
git commit -m "feat(clone): publish clone progress and typed failures, create ~/code on request"
```

### Task 3: TS clone wire contract

**Files:**
- Modify: `src/domain/localProjectClone.ts`
- Modify: `src/domain/localProjectClone.test.ts`
- Modify: `src/infrastructure/tauriLocalProjectCloneGateway.test.ts`
- Modify (fixtures only): every test that builds a local clone snapshot literal - `src/application/useLocalProjectClone.test.tsx`, `src/components/agentMode/useAgentProjectCreation.test.tsx`, `src/components/agentMode/useAgentProjectCreationQueue.test.tsx`, `src/components/agentMode/AgentWorkbenchScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 wire shape.
- Produces:

```ts
export const LOCAL_CLONE_PHASES: readonly ["counting", "compressing", "receiving", "resolving", "checkingOut"];
export type LocalCloneProgressPhase = (typeof LOCAL_CLONE_PHASES)[number];
export type LocalCloneProgress = Readonly<{ phase: LocalCloneProgressPhase; percent: number; receivedBytes: number | null; bytesPerSecond: number | null }>;
export const LOCAL_CLONE_FAILURES: readonly ["authentication", "notFound", "branchNotFound", "network", "hostKey", "timeout", "destination", "other"];
export type LocalCloneFailure = (typeof LOCAL_CLONE_FAILURES)[number];
export type LocalProjectCloneRequest = Readonly<{ idempotencyKey: string; url: string; name: string; parentPath: string; branch?: string; ensureParent?: true }>;
export type LocalProjectCloneSnapshot =
  | Readonly<{ cloneId: string; status: "running"; path: string; error: null; progress: LocalCloneProgress | null; failure: null }>
  | Readonly<{ cloneId: string; status: "completed"; path: string; error: null; progress: null; failure: null }>
  | Readonly<{ cloneId: string; status: "failed"; path: null; error: string; progress: null; failure: LocalCloneFailure }>
  | Readonly<{ cloneId: string; status: "cancelled"; path: null; error: null; progress: null; failure: null }>;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/localProjectClone.test.ts` (keep existing imports; add `parseLocalProjectCloneSnapshot`, `parseLocalProjectCloneRequest` if missing):

```ts
describe("local clone progress and failure contract", () => {
  const cloneId = "01234567-89ab-4cde-8fab-0123456789ab";
  const running = {
    cloneId,
    status: "running",
    path: "/Users/dev/code/repo",
    error: null,
    progress: { phase: "receiving", percent: 45, receivedBytes: 1024, bytesPerSecond: null },
    failure: null,
  };

  it("accepts running progress and typed failures", () => {
    expect(parseLocalProjectCloneSnapshot(running)).toEqual(running);
    expect(
      parseLocalProjectCloneSnapshot({
        cloneId,
        status: "failed",
        path: null,
        error: "Cloning failed.",
        progress: null,
        failure: "authentication",
      }),
    ).toMatchObject({ status: "failed", failure: "authentication" });
  });

  it.each([
    ["progress on a completed clone", { ...running, status: "completed" }],
    ["a failure on a running clone", { ...running, failure: "network" }],
    ["an unknown phase", { ...running, progress: { ...running.progress, phase: "packing" } }],
    ["a fractional percent", { ...running, progress: { ...running.progress, percent: 4.5 } }],
    ["a percent above 100", { ...running, progress: { ...running.progress, percent: 101 } }],
    ["negative bytes", { ...running, progress: { ...running.progress, receivedBytes: -1 } }],
    ["unknown progress keys", { ...running, progress: { ...running.progress, raw: "x" } }],
    ["a missing failure key", { cloneId, status: "running", path: "/a", error: null, progress: null }],
    [
      "an unknown failure",
      { cloneId, status: "failed", path: null, error: "x", progress: null, failure: "disk" },
    ],
    [
      "a failed clone without a failure kind",
      { cloneId, status: "failed", path: null, error: "x", progress: null, failure: null },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseLocalProjectCloneSnapshot(value)).toThrow("contract");
  });

  it("accepts ensureParent only as literal true", () => {
    const base = {
      idempotencyKey: cloneId,
      url: "https://github.com/acme/repo.git",
      name: "repo",
      parentPath: "/Users/dev/code",
    };
    expect(parseLocalProjectCloneRequest({ ...base, ensureParent: true })).toEqual({
      ...base,
      ensureParent: true,
    });
    expect(() => parseLocalProjectCloneRequest({ ...base, ensureParent: false })).toThrow();
    expect(() => parseLocalProjectCloneRequest({ ...base, ensureParent: "yes" })).toThrow();
  });
});
```

In `src/infrastructure/tauriLocalProjectCloneGateway.test.ts` change the fixture to
`const snapshot = { cloneId, status: "running", path: "/Users/dev/repo", error: null, progress: null, failure: null };`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/localProjectClone.test.ts src/infrastructure/tauriLocalProjectCloneGateway.test.ts`
Expected: FAIL ("Invalid local project clone contract." for the new fixtures).

- [ ] **Step 3: Implement the contract**

In `src/domain/localProjectClone.ts` replace the type block and the two parse functions:

```ts
export const LOCAL_CLONE_PHASES = [
  "counting",
  "compressing",
  "receiving",
  "resolving",
  "checkingOut",
] as const;
export type LocalCloneProgressPhase = (typeof LOCAL_CLONE_PHASES)[number];
export type LocalCloneProgress = Readonly<{
  phase: LocalCloneProgressPhase;
  percent: number;
  receivedBytes: number | null;
  bytesPerSecond: number | null;
}>;
export const LOCAL_CLONE_FAILURES = [
  "authentication",
  "notFound",
  "branchNotFound",
  "network",
  "hostKey",
  "timeout",
  "destination",
  "other",
] as const;
export type LocalCloneFailure = (typeof LOCAL_CLONE_FAILURES)[number];

export type LocalProjectCloneRequest = Readonly<{
  idempotencyKey: string;
  url: string;
  name: string;
  parentPath: string;
  branch?: string;
  ensureParent?: true;
}>;
export type LocalProjectCloneJobRequest = Readonly<{ cloneId: string }>;
export type LocalProjectCloneSnapshot =
  | Readonly<{
      cloneId: string;
      status: "running";
      path: string;
      error: null;
      progress: LocalCloneProgress | null;
      failure: null;
    }>
  | Readonly<{
      cloneId: string;
      status: "completed";
      path: string;
      error: null;
      progress: null;
      failure: null;
    }>
  | Readonly<{
      cloneId: string;
      status: "failed";
      path: null;
      error: string;
      progress: null;
      failure: LocalCloneFailure;
    }>
  | Readonly<{
      cloneId: string;
      status: "cancelled";
      path: null;
      error: null;
      progress: null;
      failure: null;
    }>;

export function parseLocalProjectCloneRequest(value: unknown): LocalProjectCloneRequest {
  const record = exactRecord(
    value,
    ["idempotencyKey", "url", "name", "parentPath"],
    ["branch", "ensureParent"],
  );
  const idempotencyKey = cloneId(record.idempotencyKey);
  const url = text(record.url, 2048);
  const name = text(record.name, 64);
  const parentPath = absolutePath(record.parentPath);
  if (parseRepositoryCloneUrl(url) === null || !isCloneFolderName(name)) invalid();
  const hasBranch = Object.prototype.hasOwnProperty.call(record, "branch");
  if (hasBranch && (typeof record.branch !== "string" || !isCloneBranchName(record.branch)))
    invalid();
  const hasEnsureParent = Object.prototype.hasOwnProperty.call(record, "ensureParent");
  if (hasEnsureParent && record.ensureParent !== true) invalid();
  return {
    idempotencyKey,
    url,
    name,
    parentPath,
    ...(hasBranch ? { branch: record.branch as string } : {}),
    ...(hasEnsureParent ? { ensureParent: true as const } : {}),
  };
}

export function parseLocalProjectCloneSnapshot(value: unknown): LocalProjectCloneSnapshot {
  const record = exactRecord(value, ["cloneId", "status", "path", "error", "progress", "failure"]);
  const id = cloneId(record.cloneId);
  switch (record.status) {
    case "running":
      if (record.error !== null || record.failure !== null) invalid();
      return {
        cloneId: id,
        status: "running",
        path: absolutePath(record.path),
        error: null,
        progress: record.progress === null ? null : progress(record.progress),
        failure: null,
      };
    case "completed":
      if (record.error !== null || record.progress !== null || record.failure !== null) invalid();
      return {
        cloneId: id,
        status: "completed",
        path: absolutePath(record.path),
        error: null,
        progress: null,
        failure: null,
      };
    case "failed":
      if (record.path !== null || record.progress !== null) invalid();
      return {
        cloneId: id,
        status: "failed",
        path: null,
        error: text(record.error, 4096),
        progress: null,
        failure: failure(record.failure),
      };
    case "cancelled":
      if (
        record.path !== null ||
        record.error !== null ||
        record.progress !== null ||
        record.failure !== null
      )
        invalid();
      return { cloneId: id, status: "cancelled", path: null, error: null, progress: null, failure: null };
    default:
      return invalid();
  }
}

function progress(value: unknown): LocalCloneProgress {
  const record = exactRecord(value, ["phase", "percent", "receivedBytes", "bytesPerSecond"]);
  const phase = LOCAL_CLONE_PHASES.find((candidate) => candidate === record.phase);
  if (phase === undefined) invalid();
  if (
    typeof record.percent !== "number" ||
    !Number.isInteger(record.percent) ||
    record.percent < 0 ||
    record.percent > 100
  )
    invalid();
  return {
    phase,
    percent: record.percent,
    receivedBytes: byteCount(record.receivedBytes),
    bytesPerSecond: byteCount(record.bytesPerSecond),
  };
}

function byteCount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function failure(value: unknown): LocalCloneFailure {
  const known = LOCAL_CLONE_FAILURES.find((candidate) => candidate === value);
  if (known === undefined) invalid();
  return known;
}
```

- [ ] **Step 4: Update snapshot fixtures in dependent tests**

Run: `grep -rn "status: \"running\"\|status: \"completed\"\|status: \"failed\"\|status: \"cancelled\"" src/application/useLocalProjectClone.test.tsx src/components/agentMode/useAgentProjectCreation.test.tsx src/components/agentMode/useAgentProjectCreationQueue.test.tsx src/components/agentMode/AgentWorkbenchScreen.test.tsx`
For every hit that is a **local** clone snapshot (it has `cloneId` and `path`, not a remote `projectKey`), add `progress: null, failure: null`, and for `status: "failed"` use `failure: "other"`. Remote runner fixtures stay unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/domain/localProjectClone.test.ts src/infrastructure/tauriLocalProjectCloneGateway.test.ts src/application/useLocalProjectClone.test.tsx src/components/agentMode/useAgentProjectCreation.test.tsx src/components/agentMode/useAgentProjectCreationQueue.test.tsx src/components/agentMode/AgentWorkbenchScreen.test.tsx && npm run check`
Expected: PASS; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/domain/localProjectClone.ts src/domain/localProjectClone.test.ts src/infrastructure/tauriLocalProjectCloneGateway.test.ts src/application/useLocalProjectClone.test.tsx src/components/agentMode/useAgentProjectCreation.test.tsx src/components/agentMode/useAgentProjectCreationQueue.test.tsx src/components/agentMode/AgentWorkbenchScreen.test.tsx
git commit -m "feat(clone): mirror clone progress, failure kind and ensureParent in the TS contract"
```

### Task 4: Domain - resolve clone input (URL, SSH, bare host, owner/repo)

**Files:**
- Create: `src/domain/cloneRepositoryInput.ts`
- Test: `src/domain/cloneRepositoryInput.test.ts`

**Interfaces:**
- Consumes: `parseRepositoryCloneUrl`, `RepositoryIdentity` from `src/domain/repositoryCloneUrl.ts`.
- Produces:

```ts
export type CloneInputTransport = "https" | "ssh";
export type CloneRepositoryInput =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "credentials" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "ok"; url: string; identity: RepositoryIdentity; transport: CloneInputTransport; shorthand: boolean }>;
export function resolveCloneRepositoryInput(raw: string, shorthandHost: string | null): CloneRepositoryInput;
export function carriesCredentials(value: string): boolean;
export function looksLikeCloneSource(raw: string): boolean;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  carriesCredentials,
  looksLikeCloneSource,
  resolveCloneRepositoryInput,
} from "./cloneRepositoryInput";

describe("resolveCloneRepositoryInput", () => {
  it("accepts HTTPS and SSH clone URLs as typed", () => {
    expect(resolveCloneRepositoryInput(" https://github.com/acme/web-dashboard.git ", null)).toEqual({
      kind: "ok",
      url: "https://github.com/acme/web-dashboard.git",
      identity: { host: "github.com", path: "acme/web-dashboard" },
      transport: "https",
      shorthand: false,
    });
    expect(resolveCloneRepositoryInput("git@gitlab.com:group/sub/project.git", null)).toMatchObject({
      kind: "ok",
      identity: { host: "gitlab.com", path: "group/sub/project" },
      transport: "ssh",
    });
    expect(resolveCloneRepositoryInput("ssh://git@git.example.com:2222/a/b.git", null)).toMatchObject({
      kind: "ok",
      transport: "ssh",
    });
  });

  it("expands a bare host path to HTTPS", () => {
    expect(resolveCloneRepositoryInput("github.com/acme/web-dashboard", null)).toMatchObject({
      kind: "ok",
      url: "https://github.com/acme/web-dashboard",
      transport: "https",
      shorthand: false,
    });
  });

  it("expands owner/repo only when a shorthand host is available", () => {
    expect(resolveCloneRepositoryInput("acme/web-dashboard", "github.com")).toEqual({
      kind: "ok",
      url: "https://github.com/acme/web-dashboard.git",
      identity: { host: "github.com", path: "acme/web-dashboard" },
      transport: "https",
      shorthand: true,
    });
    expect(resolveCloneRepositoryInput("acme/web-dashboard", null)).toEqual({ kind: "invalid" });
  });

  it("rejects credential-bearing URLs", () => {
    for (const value of [
      "https://ghp_secret@github.com/acme/repo.git",
      "https://user:pass@example.com/a/b",
      "http://token@host.example/a/b",
    ]) {
      expect(resolveCloneRepositoryInput(value, "github.com")).toEqual({ kind: "credentials" });
    }
    expect(carriesCredentials("ssh://git@github.com/acme/repo.git")).toBe(false);
  });

  it("classifies empty, oversized and unsupported input", () => {
    expect(resolveCloneRepositoryInput("   ", "github.com")).toEqual({ kind: "empty" });
    expect(resolveCloneRepositoryInput("x".repeat(2049), "github.com")).toEqual({ kind: "invalid" });
    for (const value of ["file:///tmp/repo", "ext::sh -c x", "http://github.com/a/b", "not a url", "../a/b"]) {
      expect(resolveCloneRepositoryInput(value, "github.com")).toEqual({ kind: "invalid" });
    }
  });

  it("detects pasted clone sources in free text search", () => {
    expect(looksLikeCloneSource("https://github.com/a/b")).toBe(true);
    expect(looksLikeCloneSource("git@github.com:a/b.git")).toBe(true);
    expect(looksLikeCloneSource("github.com/a/b")).toBe(true);
    expect(looksLikeCloneSource("acme/web")).toBe(false);
    expect(looksLikeCloneSource("open folder")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/cloneRepositoryInput.test.ts`
Expected: FAIL ("Failed to resolve import ./cloneRepositoryInput").

- [ ] **Step 3: Implement**

```ts
import { parseRepositoryCloneUrl, type RepositoryIdentity } from "./repositoryCloneUrl";

export type CloneInputTransport = "https" | "ssh";
export type CloneRepositoryInput =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "credentials" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{
      kind: "ok";
      url: string;
      identity: RepositoryIdentity;
      transport: CloneInputTransport;
      shorthand: boolean;
    }>;

const MAX_INPUT_CHARS = 2048;
const EMPTY: CloneRepositoryInput = Object.freeze({ kind: "empty" });
const INVALID: CloneRepositoryInput = Object.freeze({ kind: "invalid" });
const CREDENTIALS: CloneRepositoryInput = Object.freeze({ kind: "credentials" });
const URL_WITH_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;
const SSH_USER_ONLY = /^ssh:\/\/[A-Za-z0-9_][A-Za-z0-9_-]{0,63}@[^/:@\s]+(?::\d+)?\//;
const BARE_HOST_PATH = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\/[^\s]+$/;
const OWNER_REPO = /^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?$/;

export function resolveCloneRepositoryInput(
  raw: string,
  shorthandHost: string | null,
): CloneRepositoryInput {
  const value = raw.trim();
  if (value === "") return EMPTY;
  if (value.length > MAX_INPUT_CHARS) return INVALID;
  if (carriesCredentials(value)) return CREDENTIALS;
  const direct = parseRepositoryCloneUrl(value);
  if (direct !== null)
    return {
      kind: "ok",
      url: value,
      identity: direct,
      transport: value.startsWith("https://") ? "https" : "ssh",
      shorthand: false,
    };
  if (BARE_HOST_PATH.test(value)) {
    const url = `https://${value}`;
    const identity = parseRepositoryCloneUrl(url);
    if (identity !== null) return { kind: "ok", url, identity, transport: "https", shorthand: false };
  }
  const shorthand = shorthandHost === null ? null : OWNER_REPO.exec(value);
  if (shorthand === null) return INVALID;
  const url = `https://${shorthandHost}/${shorthand[1]}/${shorthand[2]}.git`;
  const identity = parseRepositoryCloneUrl(url);
  if (identity === null) return INVALID;
  return { kind: "ok", url, identity, transport: "https", shorthand: true };
}

export function carriesCredentials(value: string): boolean {
  return URL_WITH_USERINFO.test(value) && !SSH_USER_ONLY.test(value);
}

export function looksLikeCloneSource(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_INPUT_CHARS) return false;
  return (
    carriesCredentials(value) ||
    parseRepositoryCloneUrl(value) !== null ||
    BARE_HOST_PATH.test(value)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/cloneRepositoryInput.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/cloneRepositoryInput.ts src/domain/cloneRepositoryInput.test.ts
git commit -m "feat(clone): resolve clone URLs, bare hosts and owner/repo shorthand"
```

### Task 5: Domain - clone destination (`~/code/<name>`, last parent)

**Files:**
- Create: `src/domain/cloneDestination.ts`
- Test: `src/domain/cloneDestination.test.ts`

**Interfaces:**
- Consumes: `isCloneFolderName`, `CLONE_FOLDER_NAME_PATTERN`, `RepositoryIdentity` from `repositoryCloneUrl.ts`.
- Produces:

```ts
export const DEFAULT_CLONE_PARENT_NAME = "code";
export function defaultCloneParentPath(home: string, lastParent: string | null): string;
export function isDefaultCloneParent(parentPath: string, home: string | null): boolean;
export function suggestCloneFolderName(identity: RepositoryIdentity): string;
export function joinClonePath(parent: string, name: string): string;
export function abbreviateHomePath(absolute: string, home: string | null): string;
export function expandHomePath(display: string, home: string | null): string | null;
export type CloneDestination =
  | Readonly<{ kind: "ok"; path: string; parentPath: string; name: string }>
  | Readonly<{ kind: "invalid" }>;
export function resolveCloneDestination(display: string, home: string | null): CloneDestination;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  abbreviateHomePath,
  defaultCloneParentPath,
  expandHomePath,
  isDefaultCloneParent,
  joinClonePath,
  resolveCloneDestination,
  suggestCloneFolderName,
} from "./cloneDestination";

const home = "/Users/dev";

describe("clone destination", () => {
  it("defaults to ~/code and prefers the last parent folder", () => {
    expect(defaultCloneParentPath(home, null)).toBe("/Users/dev/code");
    expect(defaultCloneParentPath(home, "/Volumes/work/src")).toBe("/Volumes/work/src");
    expect(isDefaultCloneParent("/Users/dev/code/", home)).toBe(true);
    expect(isDefaultCloneParent("/Users/dev/src", home)).toBe(false);
    expect(isDefaultCloneParent("/Users/dev/code", null)).toBe(false);
  });

  it("suggests a valid folder name from any repository path", () => {
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/web-dashboard" })).toBe("web-dashboard");
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/orders.api" })).toBe("orders-api");
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/.dotfiles" })).toBe("dotfiles");
    expect(suggestCloneFolderName({ host: "github.com", path: "acme/___" })).toBe("repository");
    expect(suggestCloneFolderName({ host: "x.io", path: `a/${"b".repeat(80)}` })).toHaveLength(64);
  });

  it("abbreviates and expands the home folder", () => {
    expect(abbreviateHomePath("/Users/dev/code/app", home)).toBe("~/code/app");
    expect(abbreviateHomePath("/Users/devtools/app", home)).toBe("/Users/devtools/app");
    expect(abbreviateHomePath("/Users/dev", home)).toBe("~");
    expect(expandHomePath("~/code/app", home)).toBe("/Users/dev/code/app");
    expect(expandHomePath("~", home)).toBe("/Users/dev");
    expect(expandHomePath("/opt/app", home)).toBe("/opt/app");
    expect(expandHomePath("~/code/app", null)).toBeNull();
    expect(expandHomePath("code/app", home)).toBeNull();
    expect(expandHomePath("~other/app", home)).toBeNull();
  });

  it("resolves a destination into parent and folder name", () => {
    expect(resolveCloneDestination("~/code/web-dashboard/", home)).toEqual({
      kind: "ok",
      path: "/Users/dev/code/web-dashboard",
      parentPath: "/Users/dev/code",
      name: "web-dashboard",
    });
    expect(resolveCloneDestination("/web", home)).toEqual({
      kind: "ok",
      path: "/web",
      parentPath: "/",
      name: "web",
    });
    for (const bad of ["", "web", "~/code/bad name", "~/code/../x", "~/code/.hidden", "/", `/a/${"b".repeat(65)}`]) {
      expect(resolveCloneDestination(bad, home)).toEqual({ kind: "invalid" });
    }
    expect(resolveCloneDestination(`/${"a".repeat(4100)}/x`, home)).toEqual({ kind: "invalid" });
    expect(joinClonePath("/", "x")).toBe("/x");
    expect(joinClonePath("/a/", "x")).toBe("/a/x");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/cloneDestination.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { isCloneFolderName, type RepositoryIdentity } from "./repositoryCloneUrl";

export const DEFAULT_CLONE_PARENT_NAME = "code";
const FALLBACK_FOLDER_NAME = "repository";
const MAX_FOLDER_NAME_CHARS = 64;
const MAX_PATH_BYTES = 4096;
const encoder = new TextEncoder();

export type CloneDestination =
  | Readonly<{ kind: "ok"; path: string; parentPath: string; name: string }>
  | Readonly<{ kind: "invalid" }>;

const INVALID: CloneDestination = Object.freeze({ kind: "invalid" });

export function defaultCloneParentPath(home: string, lastParent: string | null): string {
  return lastParent ?? joinClonePath(home, DEFAULT_CLONE_PARENT_NAME);
}

export function isDefaultCloneParent(parentPath: string, home: string | null): boolean {
  if (home === null) return false;
  return trimTrailingSlash(parentPath) === joinClonePath(home, DEFAULT_CLONE_PARENT_NAME);
}

export function suggestCloneFolderName(identity: RepositoryIdentity): string {
  const last = identity.path.split("/").pop() ?? "";
  const cleaned = last
    .replace(/\.git$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, MAX_FOLDER_NAME_CHARS);
  return isCloneFolderName(cleaned) ? cleaned : FALLBACK_FOLDER_NAME;
}

export function joinClonePath(parent: string, name: string): string {
  const base = trimTrailingSlash(parent);
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

export function abbreviateHomePath(absolute: string, home: string | null): string {
  if (home === null) return absolute;
  const root = trimTrailingSlash(home);
  if (absolute === root) return "~";
  if (absolute.startsWith(`${root}/`)) return `~${absolute.slice(root.length)}`;
  return absolute;
}

export function expandHomePath(display: string, home: string | null): string | null {
  const value = display.trim();
  if (value.startsWith("/")) return value;
  if (home === null) return null;
  if (value === "~") return trimTrailingSlash(home);
  if (value.startsWith("~/")) return `${trimTrailingSlash(home)}${value.slice(1)}`;
  return null;
}

export function resolveCloneDestination(display: string, home: string | null): CloneDestination {
  const expanded = expandHomePath(display, home);
  if (expanded === null) return INVALID;
  const path = trimTrailingSlash(expanded);
  if (path === "/" || encoder.encode(path).byteLength > MAX_PATH_BYTES) return INVALID;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return INVALID;
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  if (!isCloneFolderName(name)) return INVALID;
  return { kind: "ok", path, parentPath: slash === 0 ? "/" : path.slice(0, slash), name };
}

function trimTrailingSlash(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/cloneDestination.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/cloneDestination.ts src/domain/cloneDestination.test.ts
git commit -m "feat(clone): default clone destination ~/code/<name> with home expansion"
```

### Task 6: Domain - clone form evaluation and clone status copy

**Files:**
- Create: `src/domain/cloneForm.ts`, `src/domain/cloneStatusPresentation.ts`
- Test: `src/domain/cloneForm.test.ts`, `src/domain/cloneStatusPresentation.test.ts`

**Interfaces:**
- Consumes: Task 3 `LocalCloneProgress`, `LocalCloneFailure`, `LocalProjectCloneRequest`; Task 4 `resolveCloneRepositoryInput`; Task 5 destination helpers; `isCloneBranchName`.
- Produces:

```ts
// cloneForm.ts
export type CloneFormInput = Readonly<{ url: string; destination: string; destinationEdited: boolean; branch: string; urlTouched: boolean }>;
export type CloneDestinationProbe =
  | Readonly<{ kind: "unknown" }> | Readonly<{ kind: "checking" }> | Readonly<{ kind: "free" }>
  | Readonly<{ kind: "exists" }> | Readonly<{ kind: "project"; rootPath: string }>;
export type CloneFormContext = Readonly<{ home: string | null; shorthandHost: string | null; lastParent: string | null; probe: CloneDestinationProbe }>;
export type CloneRepositoryCard =
  | Readonly<{ kind: "empty"; title: string; detail: string }>
  | Readonly<{ kind: "ok"; title: string; detail: string; glyph: "github" | "gitlab" | "gitUrl" }>
  | Readonly<{ kind: "bad"; title: string; detail: string }>;
export type CloneFormRequest = Omit<LocalProjectCloneRequest, "idempotencyKey">;
export type CloneFormState = Readonly<{
  repository: CloneRepositoryCard;
  destination: string;
  destinationTarget: Readonly<{ parentPath: string; name: string }> | null;
  destinationError: string | null;
  existingProjectRoot: string | null;
  branchError: string | null;
  request: CloneFormRequest | null;
  source: Readonly<{ host: string; path: string }> | null;
}>;
export function evaluateCloneForm(input: CloneFormInput, context: CloneFormContext): CloneFormState;

// cloneStatusPresentation.ts
export function overallClonePercent(progress: LocalCloneProgress | null): number;
export function cloneProgressSummary(progress: LocalCloneProgress | null): string;
export type CloneFailureDetail = Readonly<{ text: string; command: string | null; tail: string }>;
export function cloneFailureDetail(failure: LocalCloneFailure, host: string | null): CloneFailureDetail;
```

- [ ] **Step 1: Write the failing tests**

`src/domain/cloneForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateCloneForm, type CloneFormContext, type CloneFormInput } from "./cloneForm";

const context: CloneFormContext = {
  home: "/Users/dev",
  shorthandHost: "github.com",
  lastParent: null,
  probe: { kind: "free" },
};
const input: CloneFormInput = {
  url: "https://github.com/acme/web-dashboard",
  destination: "",
  destinationEdited: false,
  branch: "",
  urlTouched: false,
};

describe("evaluateCloneForm", () => {
  it("fills ~/code/<name>, marks ~/code for creation and builds the request", () => {
    const state = evaluateCloneForm(input, context);
    expect(state.repository).toEqual({
      kind: "ok",
      title: "acme/web-dashboard",
      detail: "github.com · HTTPS",
      glyph: "github",
    });
    expect(state.destination).toBe("~/code/web-dashboard");
    expect(state.request).toEqual({
      url: "https://github.com/acme/web-dashboard",
      name: "web-dashboard",
      parentPath: "/Users/dev/code",
      ensureParent: true,
    });
    expect(state.source).toEqual({ host: "github.com", path: "acme/web-dashboard" });
  });

  it("uses the remembered parent without ensureParent", () => {
    const state = evaluateCloneForm(input, { ...context, lastParent: "/Users/dev/src" });
    expect(state.destination).toBe("~/src/web-dashboard");
    expect(state.request).toEqual({
      url: "https://github.com/acme/web-dashboard",
      name: "web-dashboard",
      parentPath: "/Users/dev/src",
    });
  });

  it("keeps an edited destination and includes a valid branch", () => {
    const state = evaluateCloneForm(
      { ...input, destination: "/opt/work/dash", destinationEdited: true, branch: "release/2026.04" },
      context,
    );
    expect(state.request).toEqual({
      url: "https://github.com/acme/web-dashboard",
      name: "dash",
      parentPath: "/opt/work",
      branch: "release/2026.04",
    });
  });

  it("never enables Clone for credential URLs", () => {
    const state = evaluateCloneForm({ ...input, url: "https://tok@github.com/acme/x.git" }, context);
    expect(state.repository).toEqual({
      kind: "bad",
      title: "A URL carrying credentials is rejected",
      detail: "Remove the token and sign in with gh auth login instead.",
    });
    expect(state.request).toBeNull();
    expect(state.destination).toBe("");
  });

  it("shows invalid input as an error only after the field was touched", () => {
    expect(evaluateCloneForm({ ...input, url: "nope" }, context).repository.kind).toBe("empty");
    expect(evaluateCloneForm({ ...input, url: "nope", urlTouched: true }, context).repository).toEqual({
      kind: "bad",
      title: "That is not a clone URL Codevo accepts",
      detail: "Use https://host/owner/repo.git or git@host:owner/repo.git",
    });
  });

  it("flags existing folder and existing project", () => {
    const exists = evaluateCloneForm(input, { ...context, probe: { kind: "exists" } });
    expect(exists.destinationError).toBe(
      "~/code/web-dashboard already exists. Choose another folder name.",
    );
    expect(exists.request).toBeNull();
    const project = evaluateCloneForm(input, {
      ...context,
      probe: { kind: "project", rootPath: "/Users/dev/code/web-dashboard" },
    });
    expect(project.destinationError).toBe("~/code/web-dashboard is already a project.");
    expect(project.existingProjectRoot).toBe("/Users/dev/code/web-dashboard");
    expect(project.request).toBeNull();
  });

  it("rejects bad destinations and branches without blocking on unknown probes", () => {
    const badDestination = evaluateCloneForm(
      { ...input, destination: "code/app", destinationEdited: true },
      { ...context, probe: { kind: "unknown" } },
    );
    expect(badDestination.destinationError).toBe(
      "Enter an absolute destination path with a valid folder name.",
    );
    const badBranch = evaluateCloneForm({ ...input, branch: "-bad..x" }, context);
    expect(badBranch.branchError).toBe("Not a valid branch name.");
    expect(badBranch.request).toBeNull();
    expect(evaluateCloneForm(input, { ...context, probe: { kind: "checking" } }).request).not.toBeNull();
  });

  it("requires an absolute path when the home folder is unknown", () => {
    const state = evaluateCloneForm(input, { ...context, home: null });
    expect(state.destination).toBe("");
    expect(state.request).toBeNull();
  });

  it("labels SSH, GitLab and other hosts", () => {
    expect(
      evaluateCloneForm({ ...input, url: "git@gitlab.com:g/p.git" }, context).repository,
    ).toMatchObject({ detail: "gitlab.com · SSH", glyph: "gitlab" });
    expect(
      evaluateCloneForm({ ...input, url: "acme/web" }, context).repository,
    ).toMatchObject({ detail: "github.com · GitHub shorthand", glyph: "github" });
    expect(
      evaluateCloneForm({ ...input, url: "https://git.example.com/a/b" }, context).repository,
    ).toMatchObject({ glyph: "gitUrl" });
  });
});
```

`src/domain/cloneStatusPresentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  cloneFailureDetail,
  cloneProgressSummary,
  overallClonePercent,
} from "./cloneStatusPresentation";

describe("clone status presentation", () => {
  it("maps phases to one monotonic overall track", () => {
    expect(overallClonePercent(null)).toBe(0);
    expect(overallClonePercent({ phase: "counting", percent: 100, receivedBytes: null, bytesPerSecond: null })).toBe(4);
    expect(overallClonePercent({ phase: "receiving", percent: 50, receivedBytes: null, bytesPerSecond: null })).toBe(45);
    expect(overallClonePercent({ phase: "resolving", percent: 0, receivedBytes: null, bytesPerSecond: null })).toBe(82);
    expect(overallClonePercent({ phase: "checkingOut", percent: 100, receivedBytes: null, bytesPerSecond: null })).toBe(100);
  });

  it("summarizes progress with transfer details", () => {
    expect(cloneProgressSummary(null)).toBe("Starting");
    expect(
      cloneProgressSummary({ phase: "receiving", percent: 45, receivedBytes: 28_730_982, bytesPerSecond: 5_242_880 }),
    ).toBe("Receiving objects · 45% · 27.4 MiB | 5.0 MiB/s");
    expect(
      cloneProgressSummary({ phase: "resolving", percent: 30, receivedBytes: null, bytesPerSecond: null }),
    ).toBe("Resolving deltas · 30%");
    expect(
      cloneProgressSummary({ phase: "checkingOut", percent: 10, receivedBytes: null, bytesPerSecond: null }),
    ).toBe("Checking out files · 10%");
  });

  it("gives each failure kind actionable copy", () => {
    expect(cloneFailureDetail("authentication", "github.com")).toEqual({
      text: "Authentication failed for github.com. Run",
      command: "gh auth login",
      tail: "in a terminal, or use an SSH URL.",
    });
    expect(cloneFailureDetail("authentication", "gitlab.example.com").command).toBe("glab auth login");
    expect(cloneFailureDetail("authentication", "git.example.com")).toEqual({
      text: "Authentication failed for git.example.com. Check your Git credentials, or use an SSH URL.",
      command: null,
      tail: "",
    });
    expect(cloneFailureDetail("network", "github.com").text).toBe(
      "Could not reach github.com. Check your connection, then retry.",
    );
    expect(cloneFailureDetail("other", null).text).toBe(
      "Git could not clone the repository. Check the address and your local Git setup, then retry.",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/cloneForm.test.ts src/domain/cloneStatusPresentation.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `cloneStatusPresentation.ts`**

```ts
import type {
  LocalCloneFailure,
  LocalCloneProgress,
  LocalCloneProgressPhase,
} from "./localProjectClone";

export type CloneFailureDetail = Readonly<{ text: string; command: string | null; tail: string }>;

const PHASE_SPANS: Readonly<Record<LocalCloneProgressPhase, readonly [number, number]>> = {
  counting: [0, 4],
  compressing: [4, 8],
  receiving: [8, 82],
  resolving: [82, 96],
  checkingOut: [96, 100],
};

const PHASE_LABELS: Readonly<Record<LocalCloneProgressPhase, string>> = {
  counting: "Counting objects",
  compressing: "Compressing objects",
  receiving: "Receiving objects",
  resolving: "Resolving deltas",
  checkingOut: "Checking out files",
};

const MIB = 1_048_576;

export function overallClonePercent(progress: LocalCloneProgress | null): number {
  if (progress === null) return 0;
  const [start, end] = PHASE_SPANS[progress.phase];
  return Math.round(start + ((end - start) * progress.percent) / 100);
}

export function cloneProgressSummary(progress: LocalCloneProgress | null): string {
  if (progress === null) return "Starting";
  const parts = [PHASE_LABELS[progress.phase], `${progress.percent}%`];
  if (progress.receivedBytes !== null) {
    const received = `${(progress.receivedBytes / MIB).toFixed(1)} MiB`;
    parts.push(
      progress.bytesPerSecond === null
        ? received
        : `${received} | ${(progress.bytesPerSecond / MIB).toFixed(1)} MiB/s`,
    );
  }
  return parts.join(" · ");
}

export function cloneFailureDetail(
  failure: LocalCloneFailure,
  host: string | null,
): CloneFailureDetail {
  const where = host ?? "the Git host";
  switch (failure) {
    case "authentication":
      return authenticationDetail(where);
    case "notFound":
      return plain(`The repository was not found on ${where}. Check the URL and your access.`);
    case "branchNotFound":
      return plain("That branch does not exist. Leave Branch empty to use the default branch.");
    case "network":
      return plain(`Could not reach ${where}. Check your connection, then retry.`);
    case "hostKey":
      return plain(
        `The SSH host key for ${where} is not trusted yet. Connect once with ssh in a terminal, then retry.`,
      );
    case "timeout":
      return plain("Cloning took longer than 30 minutes and was stopped. Retry on a faster connection.");
    case "destination":
      return plain(
        "The destination folder changed or could not be cleaned up. Remove the project and clone into a new folder.",
      );
    case "other":
      return plain(
        "Git could not clone the repository. Check the address and your local Git setup, then retry.",
      );
    default:
      return unsupportedFailure(failure);
  }
}

function authenticationDetail(host: string): CloneFailureDetail {
  const command =
    host === "github.com" ? "gh auth login" : host.includes("gitlab") ? "glab auth login" : null;
  if (command === null)
    return plain(
      `Authentication failed for ${host}. Check your Git credentials, or use an SSH URL.`,
    );
  return {
    text: `Authentication failed for ${host}. Run`,
    command,
    tail: "in a terminal, or use an SSH URL.",
  };
}

function plain(text: string): CloneFailureDetail {
  return { text, command: null, tail: "" };
}

function unsupportedFailure(failure: never): never {
  throw new TypeError(`Unsupported clone failure: ${String(failure)}.`);
}
```

- [ ] **Step 4: Implement `cloneForm.ts`**

```ts
import {
  abbreviateHomePath,
  defaultCloneParentPath,
  isDefaultCloneParent,
  joinClonePath,
  resolveCloneDestination,
  suggestCloneFolderName,
} from "./cloneDestination";
import { resolveCloneRepositoryInput, type CloneRepositoryInput } from "./cloneRepositoryInput";
import type { LocalProjectCloneRequest } from "./localProjectClone";
import { isCloneBranchName } from "./repositoryCloneUrl";

export type CloneFormInput = Readonly<{
  url: string;
  destination: string;
  destinationEdited: boolean;
  branch: string;
  urlTouched: boolean;
}>;
export type CloneDestinationProbe =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "free" }>
  | Readonly<{ kind: "exists" }>
  | Readonly<{ kind: "project"; rootPath: string }>;
export type CloneFormContext = Readonly<{
  home: string | null;
  shorthandHost: string | null;
  lastParent: string | null;
  probe: CloneDestinationProbe;
}>;
export type CloneRepositoryCard =
  | Readonly<{ kind: "empty"; title: string; detail: string }>
  | Readonly<{ kind: "ok"; title: string; detail: string; glyph: "github" | "gitlab" | "gitUrl" }>
  | Readonly<{ kind: "bad"; title: string; detail: string }>;
export type CloneFormRequest = Omit<LocalProjectCloneRequest, "idempotencyKey">;
export type CloneFormState = Readonly<{
  repository: CloneRepositoryCard;
  destination: string;
  destinationTarget: Readonly<{ parentPath: string; name: string }> | null;
  destinationError: string | null;
  existingProjectRoot: string | null;
  branchError: string | null;
  request: CloneFormRequest | null;
  source: Readonly<{ host: string; path: string }> | null;
}>;

const EMPTY_CARD: CloneRepositoryCard = {
  kind: "empty",
  title: "Paste an HTTPS or SSH repository URL",
  detail: "or owner/repo for GitHub. A URL carrying credentials is rejected.",
};
const DESTINATION_INVALID = "Enter an absolute destination path with a valid folder name.";

export function evaluateCloneForm(input: CloneFormInput, context: CloneFormContext): CloneFormState {
  const repository = resolveCloneRepositoryInput(input.url, context.shorthandHost);
  const card = repositoryCard(repository, input.urlTouched);
  if (repository.kind !== "ok")
    return {
      repository: card,
      destination: input.destinationEdited ? input.destination : "",
      destinationTarget: null,
      destinationError: null,
      existingProjectRoot: null,
      branchError: branchError(input.branch),
      request: null,
      source: null,
    };
  const destination = input.destinationEdited
    ? input.destination
    : suggestedDestination(repository, context);
  const target = resolveCloneDestination(destination, context.home);
  const probeError = target.kind === "ok" ? probeMessage(context.probe, destination) : null;
  const destinationError = target.kind === "invalid" ? DESTINATION_INVALID : probeError;
  const branch = input.branch.trim();
  const branchProblem = branchError(branch);
  const existingProjectRoot = context.probe.kind === "project" ? context.probe.rootPath : null;
  const request =
    target.kind === "ok" && destinationError === null && branchProblem === null
      ? {
          url: repository.url,
          name: target.name,
          parentPath: target.parentPath,
          ...(branch === "" ? {} : { branch }),
          ...(isDefaultCloneParent(target.parentPath, context.home)
            ? { ensureParent: true as const }
            : {}),
        }
      : null;
  return {
    repository: card,
    destination,
    destinationTarget:
      target.kind === "ok" ? { parentPath: target.parentPath, name: target.name } : null,
    destinationError,
    existingProjectRoot: target.kind === "ok" ? existingProjectRoot : null,
    branchError: branchProblem,
    request,
    source: { host: repository.identity.host, path: repository.identity.path },
  };
}

function suggestedDestination(
  repository: Extract<CloneRepositoryInput, { kind: "ok" }>,
  context: CloneFormContext,
): string {
  if (context.home === null) return "";
  const parent = defaultCloneParentPath(context.home, context.lastParent);
  return abbreviateHomePath(
    joinClonePath(parent, suggestCloneFolderName(repository.identity)),
    context.home,
  );
}

function probeMessage(probe: CloneDestinationProbe, destination: string): string | null {
  switch (probe.kind) {
    case "exists":
      return `${destination} already exists. Choose another folder name.`;
    case "project":
      return `${destination} is already a project.`;
    case "unknown":
    case "checking":
    case "free":
      return null;
    default:
      return unsupportedProbe(probe);
  }
}

function branchError(branch: string): string | null {
  const value = branch.trim();
  if (value === "" || isCloneBranchName(value)) return null;
  return "Not a valid branch name.";
}

function repositoryCard(repository: CloneRepositoryInput, touched: boolean): CloneRepositoryCard {
  switch (repository.kind) {
    case "ok":
      return {
        kind: "ok",
        title: repository.identity.path,
        detail: `${repository.identity.host} · ${transportLabel(repository)}`,
        glyph: glyphFor(repository.identity.host),
      };
    case "credentials":
      return {
        kind: "bad",
        title: "A URL carrying credentials is rejected",
        detail: "Remove the token and sign in with gh auth login instead.",
      };
    case "invalid":
      return touched
        ? {
            kind: "bad",
            title: "That is not a clone URL Codevo accepts",
            detail: "Use https://host/owner/repo.git or git@host:owner/repo.git",
          }
        : EMPTY_CARD;
    case "empty":
      return EMPTY_CARD;
    default:
      return unsupportedInput(repository);
  }
}

function transportLabel(repository: Extract<CloneRepositoryInput, { kind: "ok" }>): string {
  if (repository.shorthand) return "GitHub shorthand";
  return repository.transport === "ssh" ? "SSH" : "HTTPS";
}

function glyphFor(host: string): "github" | "gitlab" | "gitUrl" {
  if (host === "github.com") return "github";
  if (host.includes("gitlab")) return "gitlab";
  return "gitUrl";
}

function unsupportedProbe(probe: never): never {
  throw new TypeError(`Unsupported destination probe: ${JSON.stringify(probe)}.`);
}

function unsupportedInput(input: never): never {
  throw new TypeError(`Unsupported clone input: ${JSON.stringify(input)}.`);
}
```

Note: GitHub shorthand label "GitHub shorthand" replaces the mockup's "GitHub account" because the form does not verify account access; everything else matches the mockup copy.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/domain/cloneForm.test.ts src/domain/cloneStatusPresentation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/cloneForm.ts src/domain/cloneForm.test.ts src/domain/cloneStatusPresentation.ts src/domain/cloneStatusPresentation.test.ts
git commit -m "feat(clone): evaluate the one-step clone form and clone status copy"
```

### Task 7: Settings - last clone parent (F5) and recent folders with ages (F3)

**Files:**
- Create: `src/domain/projectOnboardingSettings.ts`, `src/domain/recentFolders.ts`
- Test: `src/domain/projectOnboardingSettings.test.ts`, `src/domain/recentFolders.test.ts`
- Modify (hunk): `src/domain/settings.ts` (interface, defaults, normalize), `src/domain/settings.test.ts` (literal expectations)
- Modify (hunk): `src/application/workbenchController/useWorkbenchWorkspaceTransitionCoordinator.ts:~1497-1502`

**Interfaces:**
- Produces:

```ts
// projectOnboardingSettings.ts
export const MAX_RECENT_WORKSPACE_OPENED_AT = 25;
export function normalizeLastCloneParentPath(value: unknown): string | null;
export function normalizeRecentWorkspaceOpenedAt(value: unknown): Readonly<Record<string, number>>;
export function recordRecentWorkspaceOpenedAt(
  previous: Readonly<Record<string, number>> | undefined,
  recentPaths: readonly string[],
  openedPath: string,
  nowMs: number,
): Readonly<Record<string, number>>;

// recentFolders.ts
export type RecentFolderEntry = Readonly<{ path: string; label: string; openedAtMs: number | null }>;
export const MAX_RECENT_FOLDER_ENTRIES = 5;
export function recentFolderEntries(input: Readonly<{
  recentPaths: readonly string[];
  openedAt: Readonly<Record<string, number>>;
  excludeRoots: readonly string[];
}>): readonly RecentFolderEntry[];
export function recentFolderAge(openedAtMs: number | null, nowMs: number): string | null;

// AppSettings additions
lastCloneParentPath: string | null;
recentWorkspaceOpenedAt: Readonly<Record<string, number>>;
```

- [ ] **Step 1: Write the failing tests**

`src/domain/projectOnboardingSettings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeLastCloneParentPath,
  normalizeRecentWorkspaceOpenedAt,
  recordRecentWorkspaceOpenedAt,
} from "./projectOnboardingSettings";

describe("project onboarding settings", () => {
  it("keeps only an absolute bounded last clone parent", () => {
    expect(normalizeLastCloneParentPath("/Users/dev/src/")).toBe("/Users/dev/src");
    expect(normalizeLastCloneParentPath("relative")).toBeNull();
    expect(normalizeLastCloneParentPath(`/${"a".repeat(5000)}`)).toBeNull();
    expect(normalizeLastCloneParentPath("/a\u0000b")).toBeNull();
    expect(normalizeLastCloneParentPath(42)).toBeNull();
  });

  it("normalizes opened-at records to bounded positive integers", () => {
    expect(
      normalizeRecentWorkspaceOpenedAt({ "/a": 10, "/b": -1, "c": 5, "/d": 1.5, "/e": "x" }),
    ).toEqual({ "/a": 10 });
    expect(normalizeRecentWorkspaceOpenedAt([])).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`/p${i}`, i + 1]));
    expect(Object.keys(normalizeRecentWorkspaceOpenedAt(many))).toHaveLength(25);
  });

  it("records the opened path and prunes paths that left the recent list", () => {
    expect(
      recordRecentWorkspaceOpenedAt({ "/old": 1, "/keep": 2 }, ["/new", "/keep"], "/new/", 99),
    ).toEqual({ "/keep": 2, "/new": 99 });
  });
});
```

`src/domain/recentFolders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { recentFolderAge, recentFolderEntries } from "./recentFolders";

describe("recent folders", () => {
  it("lists recent folders that are not open, newest first, at most five", () => {
    const entries = recentFolderEntries({
      recentPaths: ["/code/a", "/code/open", "/code/b/", "/code/c", "/code/d", "/code/e", "/code/f"],
      openedAt: { "/code/a": 5, "/code/b": 4 },
      excludeRoots: ["/code/open/"],
    });
    expect(entries.map((entry) => entry.path)).toEqual([
      "/code/a",
      "/code/b/",
      "/code/c",
      "/code/d",
      "/code/e",
    ]);
    expect(entries[1]).toEqual({ path: "/code/b/", label: "b", openedAtMs: 4 });
    expect(entries[2].openedAtMs).toBeNull();
  });

  it("formats compact ages like the sidebar", () => {
    const now = 10 * 7 * 24 * 3_600_000;
    expect(recentFolderAge(null, now)).toBeNull();
    expect(recentFolderAge(now - 30_000, now)).toBe("now");
    expect(recentFolderAge(now - 4 * 60_000, now)).toBe("4m");
    expect(recentFolderAge(now - 2 * 3_600_000, now)).toBe("2h");
    expect(recentFolderAge(now - 3 * 24 * 3_600_000, now)).toBe("3d");
    expect(recentFolderAge(now - 5 * 7 * 24 * 3_600_000, now)).toBe("5w");
    expect(recentFolderAge(now + 60_000, now)).toBe("now");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/projectOnboardingSettings.test.ts src/domain/recentFolders.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/domain/projectOnboardingSettings.ts`:

```ts
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export const MAX_RECENT_WORKSPACE_OPENED_AT = 25;
const MAX_PATH_CHARS = 4096;

export function normalizeLastCloneParentPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.length > MAX_PATH_CHARS || value.includes("\u0000"))
    return null;
  return normalizedWorkspaceRootKey(value);
}

export function normalizeRecentWorkspaceOpenedAt(
  value: unknown,
): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, number] =>
        entry[0].startsWith("/") &&
        entry[0].length <= MAX_PATH_CHARS &&
        typeof entry[1] === "number" &&
        Number.isSafeInteger(entry[1]) &&
        entry[1] > 0,
    )
    .slice(0, MAX_RECENT_WORKSPACE_OPENED_AT);
  return Object.fromEntries(entries);
}

export function recordRecentWorkspaceOpenedAt(
  previous: Readonly<Record<string, number>> | undefined,
  recentPaths: readonly string[],
  openedPath: string,
  nowMs: number,
): Readonly<Record<string, number>> {
  const retained = new Set(recentPaths.map((path) => normalizedWorkspaceRootKey(path)));
  const next: Record<string, number> = {};
  for (const [path, openedAt] of Object.entries(previous ?? {})) {
    if (retained.has(normalizedWorkspaceRootKey(path))) next[normalizedWorkspaceRootKey(path)] = openedAt;
  }
  next[normalizedWorkspaceRootKey(openedPath)] = nowMs;
  return normalizeRecentWorkspaceOpenedAt(next);
}
```

`src/domain/recentFolders.ts`:

```ts
import { normalizedWorkspaceRootKey, workspaceDisplayName } from "./workspaceRootKey";

export type RecentFolderEntry = Readonly<{ path: string; label: string; openedAtMs: number | null }>;
export const MAX_RECENT_FOLDER_ENTRIES = 5;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function recentFolderEntries(
  input: Readonly<{
    recentPaths: readonly string[];
    openedAt: Readonly<Record<string, number>>;
    excludeRoots: readonly string[];
  }>,
): readonly RecentFolderEntry[] {
  const excluded = new Set(input.excludeRoots.map((root) => normalizedWorkspaceRootKey(root)));
  return input.recentPaths
    .filter((path) => !excluded.has(normalizedWorkspaceRootKey(path)))
    .slice(0, MAX_RECENT_FOLDER_ENTRIES)
    .map((path) => ({
      path,
      label: workspaceDisplayName(path),
      openedAtMs: input.openedAt[normalizedWorkspaceRootKey(path)] ?? null,
    }));
}

export function recentFolderAge(openedAtMs: number | null, nowMs: number): string | null {
  if (openedAtMs === null) return null;
  const elapsed = Math.max(0, nowMs - openedAtMs);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / WEEK)}w`;
}
```

- [ ] **Step 4: Wire the settings fields**

In `src/domain/settings.ts`:
1. `import { normalizeLastCloneParentPath, normalizeRecentWorkspaceOpenedAt } from "./projectOnboardingSettings";`
2. In `interface AppSettings`, after `recentWorkspacePaths?: string[];` add:

```ts
  recentWorkspaceOpenedAt?: Readonly<Record<string, number>>;
  lastCloneParentPath?: string | null;
```

3. In `defaultAppSettings()` after `recentWorkspacePaths: [],` add `recentWorkspaceOpenedAt: {},` and `lastCloneParentPath: null,`.
4. In the object returned by `normalizeAppSettings` after `recentWorkspacePaths,` add:

```ts
    recentWorkspaceOpenedAt: normalizeRecentWorkspaceOpenedAt(value.recentWorkspaceOpenedAt),
    lastCloneParentPath: normalizeLastCloneParentPath(value.lastCloneParentPath),
```

Both fields are optional in the interface so hand-built `AppSettings` literals elsewhere keep compiling. Run `npx vitest run src/domain/settings.test.ts`; wherever a `toEqual` literal of a normalized result now misses the two keys, add `recentWorkspaceOpenedAt: {}, lastCloneParentPath: null,` next to its `recentWorkspacePaths`.

In `useWorkbenchWorkspaceTransitionCoordinator.ts` (the `persistAppSettings` call right after `pushRecentWorkspacePath`), add one property and the import from `../../domain/projectOnboardingSettings`:

```ts
        await persistAppSettings({
          ...appSettingsRef.current,
          recentWorkspacePath: recentWorkspacePaths[0] ?? null,
          recentWorkspacePaths,
          recentWorkspaceOpenedAt: recordRecentWorkspaceOpenedAt(
            appSettingsRef.current.recentWorkspaceOpenedAt,
            recentWorkspacePaths,
            path,
            Date.now(),
          ),
          workspaceTabs: nextWorkspaceTabs,
        });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/domain/projectOnboardingSettings.test.ts src/domain/recentFolders.test.ts src/domain/settings.test.ts && npm run check && npm run size:hotspots`
Expected: PASS; hotspot check unchanged (transition coordinator grows by 6 lines and stays below 2000).

- [ ] **Step 6: Commit**

```bash
git add src/domain/projectOnboardingSettings.ts src/domain/projectOnboardingSettings.test.ts src/domain/recentFolders.ts src/domain/recentFolders.test.ts src/domain/settings.ts src/domain/settings.test.ts src/application/workbenchController/useWorkbenchWorkspaceTransitionCoordinator.ts
git commit -m "feat(projects): remember last clone parent and when recent folders were opened"
```

### Task 8: Trust confirmation plumbing (coordinator, decorator, workbench toggle)

**Files:**
- Modify: `src/domain/trust.ts`
- Create: `src/application/workspaceTrustPrompt.ts`, `src/application/confirmingWorkspaceTrustGateway.ts`, `src/application/workspaceTrustGrantConfirmation.ts`
- Test: `src/application/workspaceTrustPrompt.test.ts`, `src/application/confirmingWorkspaceTrustGateway.test.ts`, `src/application/workspaceTrustGrantConfirmation.test.ts`
- Modify (hunk): `src/workbenchComposition.ts:~238`
- Modify (hunk): `src/application/workbenchController/useWorkbenchSettingsCommands.ts:169-180`

**Interfaces:**
- Produces:

```ts
// domain/trust.ts additions
export type WorkspaceTrustOrigin =
  | Readonly<{ kind: "local" }>
  | Readonly<{ kind: "clone"; host: string; path: string }>;
export interface WorkspaceTrustConfirmation {
  readonly rootPath: string;
  readonly label: string;
  readonly origin: WorkspaceTrustOrigin;
}
// WorkspaceTrustGateway gains:
confirmGrant?(request: WorkspaceTrustConfirmation): Promise<boolean>;

// application/workspaceTrustPrompt.ts
export type WorkspaceTrustDecision = "trust" | "notNow";
export class WorkspaceTrustPromptCoordinator {
  readonly getSnapshot: () => WorkspaceTrustConfirmation | null;
  readonly subscribe: (listener: () => void) => () => void;
  acquireHostLease(): () => void;
  setWorkspaceScope(scope: string | null): void;
  request(request: WorkspaceTrustConfirmation): Promise<WorkspaceTrustDecision>;
  resolve(request: WorkspaceTrustConfirmation, decision: WorkspaceTrustDecision): void;
}

// application/confirmingWorkspaceTrustGateway.ts
export class ConfirmingWorkspaceTrustGateway implements WorkspaceTrustGateway {
  constructor(inner: WorkspaceTrustGateway, prompt: Pick<WorkspaceTrustPromptCoordinator, "request">);
}

// application/workspaceTrustGrantConfirmation.ts
export function confirmWorkspaceTrustGrant(
  gateway: Pick<WorkspaceTrustGateway, "confirmGrant">,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests**

`src/application/workspaceTrustPrompt.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTrustPromptCoordinator } from "./workspaceTrustPrompt";

const request = { rootPath: "/Users/dev/code/app", label: "app", origin: { kind: "local" as const } };

describe("WorkspaceTrustPromptCoordinator", () => {
  it("resolves notNow immediately when no host is mounted", async () => {
    await expect(new WorkspaceTrustPromptCoordinator().request(request)).resolves.toBe("notNow");
  });

  it("publishes one request and settles it exactly once", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    const release = prompt.acquireHostLease();
    const listener = vi.fn();
    prompt.subscribe(listener);
    const decision = prompt.request(request);
    const active = prompt.getSnapshot();
    expect(active).toEqual(request);
    prompt.resolve(active!, "trust");
    prompt.resolve(active!, "notNow");
    await expect(decision).resolves.toBe("trust");
    expect(prompt.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    release();
  });

  it("supersedes an older request instead of queueing it", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    prompt.acquireHostLease();
    const first = prompt.request(request);
    const second = prompt.request({ ...request, rootPath: "/Users/dev/code/other", label: "other" });
    await expect(first).resolves.toBe("notNow");
    expect(prompt.getSnapshot()?.label).toBe("other");
    prompt.resolve(prompt.getSnapshot()!, "trust");
    await expect(second).resolves.toBe("trust");
  });

  it("dismisses on workspace scope change and when the last host unmounts", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    const release = prompt.acquireHostLease();
    prompt.setWorkspaceScope("ws-a");
    const scoped = prompt.request(request);
    prompt.setWorkspaceScope("ws-b");
    await expect(scoped).resolves.toBe("notNow");
    const hosted = prompt.request(request);
    release();
    await expect(hosted).resolves.toBe("notNow");
  });

  it("rejects unbounded or relative requests", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    prompt.acquireHostLease();
    await expect(prompt.request({ ...request, rootPath: "relative" })).rejects.toThrow(RangeError);
    await expect(prompt.request({ ...request, label: "x".repeat(257) })).rejects.toThrow(RangeError);
    await expect(
      prompt.request({ ...request, origin: { kind: "clone", host: "h".repeat(300), path: "a/b" } }),
    ).rejects.toThrow(RangeError);
  });
});
```

`src/application/confirmingWorkspaceTrustGateway.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTrustGateway } from "../domain/trust";
import { ConfirmingWorkspaceTrustGateway } from "./confirmingWorkspaceTrustGateway";

describe("ConfirmingWorkspaceTrustGateway", () => {
  it("delegates trust IO unchanged and maps the dialog decision", async () => {
    const inner: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: false })),
      setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
      grantOpenedProject: vi.fn(async (identity) => ({ rootPath: identity.canonicalRoot, trusted: true })),
    };
    const prompt = { request: vi.fn().mockResolvedValueOnce("trust").mockResolvedValueOnce("notNow") };
    const gateway = new ConfirmingWorkspaceTrustGateway(inner, prompt);
    const confirmation = { rootPath: "/a", label: "a", origin: { kind: "local" as const } };
    await expect(gateway.confirmGrant(confirmation)).resolves.toBe(true);
    await expect(gateway.confirmGrant(confirmation)).resolves.toBe(false);
    await expect(gateway.setTrust("/a", true)).resolves.toEqual({ rootPath: "/a", trusted: true });
    await expect(gateway.getTrust("/a")).resolves.toEqual({ rootPath: "/a", trusted: false });
    await gateway.grantOpenedProject?.({ workspaceId: "w", admissionToken: 1, selectedPath: "/a", canonicalRoot: "/a" });
    expect(inner.grantOpenedProject).toHaveBeenCalledTimes(1);
    expect(prompt.request).toHaveBeenCalledTimes(2);
  });

  it("does not invent grantOpenedProject when the inner gateway lacks it", () => {
    const gateway = new ConfirmingWorkspaceTrustGateway(
      { getTrust: vi.fn(), setTrust: vi.fn() },
      { request: vi.fn() },
    );
    expect(gateway.grantOpenedProject).toBeUndefined();
  });
});
```

`src/application/workspaceTrustGrantConfirmation.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { confirmWorkspaceTrustGrant } from "./workspaceTrustGrantConfirmation";

describe("confirmWorkspaceTrustGrant", () => {
  it("passes through gateways without a confirmation capability", async () => {
    await expect(confirmWorkspaceTrustGrant({}, "/a", () => true)).resolves.toBe(true);
  });

  it("asks with the project label and a local origin", async () => {
    const confirmGrant = vi.fn(async () => true);
    await expect(confirmWorkspaceTrustGrant({ confirmGrant }, "/Users/dev/app/", () => true)).resolves.toBe(true);
    expect(confirmGrant).toHaveBeenCalledWith({
      rootPath: "/Users/dev/app/",
      label: "app",
      origin: { kind: "local" },
    });
  });

  it("ignores a confirmation after the workspace changed", async () => {
    let current = true;
    const confirmGrant = vi.fn(async () => {
      current = false;
      return true;
    });
    await expect(confirmWorkspaceTrustGrant({ confirmGrant }, "/a", () => current)).resolves.toBe(false);
  });

  it("returns false when declined", async () => {
    await expect(
      confirmWorkspaceTrustGrant({ confirmGrant: async () => false }, "/a", () => true),
    ).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/application/workspaceTrustPrompt.test.ts src/application/confirmingWorkspaceTrustGateway.test.ts src/application/workspaceTrustGrantConfirmation.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

Append to `src/domain/trust.ts`:

```ts
export type WorkspaceTrustOrigin =
  | Readonly<{ kind: "local" }>
  | Readonly<{ kind: "clone"; host: string; path: string }>;

export interface WorkspaceTrustConfirmation {
  readonly rootPath: string;
  readonly label: string;
  readonly origin: WorkspaceTrustOrigin;
}
```

and add `confirmGrant?(request: WorkspaceTrustConfirmation): Promise<boolean>;` as the last member of `interface WorkspaceTrustGateway`.

`src/application/workspaceTrustPrompt.ts`:

```ts
import type { WorkspaceTrustConfirmation } from "../domain/trust";

export type WorkspaceTrustDecision = "trust" | "notNow";

interface PendingTrustPrompt {
  readonly request: WorkspaceTrustConfirmation;
  readonly resolve: (decision: WorkspaceTrustDecision) => void;
}

const MAX_PATH_CHARS = 4096;
const MAX_LABEL_CHARS = 256;
const MAX_ORIGIN_CHARS = 512;

export class WorkspaceTrustPromptCoordinator {
  private active: PendingTrustPrompt | null = null;
  private hosts = 0;
  private workspaceScope: string | null = null;
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = (): WorkspaceTrustConfirmation | null => this.active?.request ?? null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  acquireHostLease(): () => void {
    this.hosts += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.hosts -= 1;
      if (this.hosts === 0) this.dismiss();
    };
  }

  setWorkspaceScope(scope: string | null): void {
    if (scope === this.workspaceScope) return;
    this.workspaceScope = scope;
    this.dismiss();
  }

  request(request: WorkspaceTrustConfirmation): Promise<WorkspaceTrustDecision> {
    const invalid = invalidReason(request);
    if (invalid !== null) return Promise.reject(new RangeError(invalid));
    if (this.hosts === 0) return Promise.resolve("notNow");
    const frozen: WorkspaceTrustConfirmation = Object.freeze({
      rootPath: request.rootPath,
      label: request.label,
      origin: Object.freeze({ ...request.origin }),
    });
    return new Promise((resolve) => {
      const previous = this.active;
      this.active = { request: frozen, resolve };
      previous?.resolve("notNow");
      this.emit();
    });
  }

  resolve(request: WorkspaceTrustConfirmation, decision: WorkspaceTrustDecision): void {
    const active = this.active;
    if (active === null || active.request !== request) return;
    this.active = null;
    active.resolve(decision);
    this.emit();
  }

  private dismiss(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    active.resolve("notNow");
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function invalidReason(request: WorkspaceTrustConfirmation): string | null {
  if (!request.rootPath.startsWith("/") || request.rootPath.length > MAX_PATH_CHARS)
    return "Trust prompts need an absolute project path.";
  if (request.label.length === 0 || request.label.length > MAX_LABEL_CHARS)
    return `Trust prompt labels must contain 1-${MAX_LABEL_CHARS} characters.`;
  if (
    request.origin.kind === "clone" &&
    `${request.origin.host}/${request.origin.path}`.length > MAX_ORIGIN_CHARS
  )
    return "Trust prompt origin is too long.";
  return null;
}
```

`src/application/confirmingWorkspaceTrustGateway.ts`:

```ts
import type {
  WorkspaceOpenedProjectIdentity,
  WorkspaceTrustConfirmation,
  WorkspaceTrustGateway,
  WorkspaceTrustState,
} from "../domain/trust";
import type { WorkspaceTrustPromptCoordinator } from "./workspaceTrustPrompt";

export class ConfirmingWorkspaceTrustGateway implements WorkspaceTrustGateway {
  readonly grantOpenedProject?: (
    identity: WorkspaceOpenedProjectIdentity,
  ) => Promise<WorkspaceTrustState>;

  constructor(
    private readonly inner: WorkspaceTrustGateway,
    private readonly prompt: Pick<WorkspaceTrustPromptCoordinator, "request">,
  ) {
    const grant = inner.grantOpenedProject;
    if (grant !== undefined) this.grantOpenedProject = (identity) => grant.call(inner, identity);
  }

  getTrust(rootPath: string): Promise<WorkspaceTrustState> {
    return this.inner.getTrust(rootPath);
  }

  setTrust(rootPath: string, trusted: boolean): Promise<WorkspaceTrustState> {
    return this.inner.setTrust(rootPath, trusted);
  }

  async confirmGrant(request: WorkspaceTrustConfirmation): Promise<boolean> {
    return (await this.prompt.request(request)) === "trust";
  }
}
```

`src/application/workspaceTrustGrantConfirmation.ts`:

```ts
import type { WorkspaceTrustGateway } from "../domain/trust";
import { workspaceDisplayName } from "../domain/workspaceRootKey";

export async function confirmWorkspaceTrustGrant(
  gateway: Pick<WorkspaceTrustGateway, "confirmGrant">,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (gateway.confirmGrant === undefined) return true;
  const confirmed = await gateway.confirmGrant({
    rootPath,
    label: workspaceDisplayName(rootPath),
    origin: { kind: "local" },
  });
  return confirmed && isCurrent();
}
```

- [ ] **Step 4: Compose and gate the workbench toggle**

In `src/workbenchComposition.ts`, next to `const quickInputCoordinator = new QuickInputCoordinator();` add
`const workspaceTrustPrompt = new WorkspaceTrustPromptCoordinator();`, include `workspaceTrustPrompt,` in the returned object next to `quickInputCoordinator,`, and replace `workspaceTrustGateway: new TauriWorkspaceTrustGateway(),` with

```ts
    workspaceTrustGateway: new ConfirmingWorkspaceTrustGateway(
      new TauriWorkspaceTrustGateway(),
      workspaceTrustPrompt,
    ),
```

(imports: `WorkspaceTrustPromptCoordinator` from `./application/workspaceTrustPrompt`, `ConfirmingWorkspaceTrustGateway` from `./application/confirmingWorkspaceTrustGateway`).

In `useWorkbenchSettingsCommands.ts` `toggleWorkspaceTrust`, directly after
`const trusted = !(desiredTrust ?? workspaceTrust?.trusted ?? false);` insert:

```ts
    if (trusted) {
      const promptRevision = openWorkspaceRequestTokenRef.current;
      const confirmed = await confirmWorkspaceTrustGrant(
        workspaceTrustGateway,
        requestedRoot,
        () =>
          openWorkspaceRequestTokenRef.current === promptRevision &&
          resolveCurrentWorkspaceRuntimeOwner()?.ownerKey === requestedOwner.ownerKey,
      );
      if (!confirmed) return;
    }
```

and import `confirmWorkspaceTrustGrant` from `../workspaceTrustGrantConfirmation`. Revocation (`trusted === false`) is not gated. Existing controller tests pass gateways without `confirmGrant`, so their behavior is unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/application/workspaceTrustPrompt.test.ts src/application/confirmingWorkspaceTrustGateway.test.ts src/application/workspaceTrustGrantConfirmation.test.ts src/application/useWorkbenchController.preview/editing-trust-events-and-settings.test.tsx src/application/useWorkbenchController.preview/workspace-identity-and-project-lifecycle.test.tsx && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/trust.ts src/application/workspaceTrustPrompt.ts src/application/workspaceTrustPrompt.test.ts src/application/confirmingWorkspaceTrustGateway.ts src/application/confirmingWorkspaceTrustGateway.test.ts src/application/workspaceTrustGrantConfirmation.ts src/application/workspaceTrustGrantConfirmation.test.ts src/workbenchComposition.ts src/application/workbenchController/useWorkbenchSettingsCommands.ts
git commit -m "feat(trust): confirm workspace trust grants through a prompt coordinator"
```

### Task 9: Trust dialog UI and host

**Files:**
- Create: `src/components/projects/projects.css`, `src/components/projects/WorkspaceTrustDialog.tsx`, `src/components/projects/WorkspaceTrustDialogHost.tsx`
- Test: `src/components/projects/WorkspaceTrustDialog.test.tsx`
- Modify (hunk): `src/components/WorkbenchOverlayHosts.tsx`

**Interfaces:**
- Consumes: Task 8 coordinator; P1 `Dialog`, `Button`.
- Produces: `WorkspaceTrustDialog({ request, onDecide })`, `WorkspaceTrustDialogHost({ prompt, workspaceScope })`; CSS classes `cv-trust-*` and the shared `cv-project-favicon`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceTrustPromptCoordinator } from "../../application/workspaceTrustPrompt";
import { WorkspaceTrustDialogHost } from "./WorkspaceTrustDialogHost";

describe("WorkspaceTrustDialogHost", () => {
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
  function button(label: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(found).toBeInstanceOf(HTMLButtonElement);
    return found as HTMLButtonElement;
  }

  it("renders the mockup copy for a cloned project and trusts on confirm", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws" />));
    let decision: Promise<string> = Promise.resolve("");
    act(() => {
      decision = prompt.request({
        rootPath: "/Users/dev/code/web-dashboard",
        label: "web-dashboard",
        origin: { kind: "clone", host: "github.com", path: "acme/web-dashboard" },
      });
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Trust web-dashboard?");
    expect(dialog?.textContent).toContain(
      "Agents can only start in trusted projects. Trust it if you know where this code comes from.",
    );
    expect(dialog?.textContent).toContain("/Users/dev/code/web-dashboard");
    expect(dialog?.textContent).toContain("Cloned from github.com/acme/web-dashboard");
    expect(dialog?.textContent).toContain("Agents run commands and edit files in this folder");
    expect(dialog?.textContent).toContain("Package scripts, tasks, tests and the debugger can run");
    expect(dialog?.textContent).toContain("Language servers start from the project's own binaries");
    expect(dialog?.textContent).toContain("You can revoke trust any time in Settings.");
    expect(document.activeElement).toBe(button("Not now"));
    act(() => button("Trust project").click());
    await expect(decision).resolves.toBe("trust");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("treats Escape and Not now as notNow and labels local folders", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws" />));
    let decision: Promise<string> = Promise.resolve("");
    act(() => {
      decision = prompt.request({ rootPath: "/opt/app", label: "app", origin: { kind: "local" } });
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Local folder");
    act(() => {
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await expect(decision).resolves.toBe("notNow");
  });

  it("dismisses a pending prompt when the host unmounts", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws" />));
    let decision: Promise<string> = Promise.resolve("");
    act(() => {
      decision = prompt.request({ rootPath: "/opt/app", label: "app", origin: { kind: "local" } });
    });
    act(() => root.render(<></>));
    await expect(decision).resolves.toBe("notNow");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/projects/WorkspaceTrustDialog.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/components/projects/projects.css` (this task adds the trust rules; later tasks append their own sections to the same file):

```css
.cv-project-favicon {
  display: inline-grid;
  flex: none;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: var(--cv-r-xs);
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-2xs);
  font-weight: 600;
}

.cv-trust__where {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--cv-r-card);
  background: var(--cv-tint-1);
  box-shadow: inset 0 0 0 1px var(--cv-hair);
}

.cv-trust__where-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.cv-trust__path {
  overflow: hidden;
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-mono);
  font-size: var(--cv-t-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-trust__origin,
.cv-trust__note {
  margin: 0;
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-trust__allows {
  display: grid;
  gap: 8px;
  margin: 16px 0;
  padding: 0;
  list-style: none;
  color: var(--cv-fg);
  font-size: var(--cv-t-sm);
}

.cv-trust__allows li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cv-trust__allows svg {
  flex: none;
  color: var(--cv-fg-subtle);
}
```

`src/components/projects/WorkspaceTrustDialog.tsx`:

```tsx
import { Bot, Code, SquareTerminal } from "lucide-react";
import type { WorkspaceTrustDecision } from "../../application/workspaceTrustPrompt";
import type { WorkspaceTrustConfirmation } from "../../domain/trust";
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";
import "./projects.css";

export interface WorkspaceTrustDialogProps {
  readonly request: WorkspaceTrustConfirmation | null;
  onDecide(decision: WorkspaceTrustDecision): void;
}

export function WorkspaceTrustDialog({ request, onDecide }: WorkspaceTrustDialogProps) {
  if (request === null) return null;
  return (
    <Dialog
      description="Agents can only start in trusted projects. Trust it if you know where this code comes from."
      dismissOnBackdrop={false}
      footer={
        <>
          <Button onClick={() => onDecide("notNow")}>Not now</Button>
          <Button onClick={() => onDecide("trust")} variant="primary">
            Trust project
          </Button>
        </>
      }
      onClose={() => onDecide("notNow")}
      open
      title={`Trust ${request.label}?`}
      width="sm"
    >
      <div className="cv-trust__where">
        <span aria-hidden="true" className="cv-project-favicon">
          {projectInitial(request.label)}
        </span>
        <span className="cv-trust__where-text">
          <span className="cv-trust__path" title={request.rootPath}>
            {request.rootPath}
          </span>
          <span className="cv-trust__origin">{originLabel(request)}</span>
        </span>
      </div>
      <ul aria-label="Trusting allows" className="cv-trust__allows">
        <li>
          <Bot aria-hidden="true" size={14} />
          Agents run commands and edit files in this folder
        </li>
        <li>
          <SquareTerminal aria-hidden="true" size={14} />
          Package scripts, tasks, tests and the debugger can run
        </li>
        <li>
          <Code aria-hidden="true" size={14} />
          Language servers start from the project's own binaries
        </li>
      </ul>
      <p className="cv-trust__note">You can revoke trust any time in Settings.</p>
    </Dialog>
  );
}

export function projectInitial(label: string): string {
  return (label.replace(/[^a-z0-9]/gi, "").charAt(0) || "P").toUpperCase();
}

function originLabel(request: WorkspaceTrustConfirmation): string {
  if (request.origin.kind === "clone")
    return `Cloned from ${request.origin.host}/${request.origin.path}`;
  return "Local folder";
}
```

P1 `Dialog` focuses the first focusable element when no `initialFocusRef` is given; the body has no focusable controls and the footer renders Not now first, so the safe choice gets initial focus without a ref.

`src/components/projects/WorkspaceTrustDialogHost.tsx`:

```tsx
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import type {
  WorkspaceTrustDecision,
  WorkspaceTrustPromptCoordinator,
} from "../../application/workspaceTrustPrompt";
import { WorkspaceTrustDialog } from "./WorkspaceTrustDialog";

export interface WorkspaceTrustDialogHostProps {
  readonly prompt: WorkspaceTrustPromptCoordinator;
  readonly workspaceScope: string | null;
}

export function WorkspaceTrustDialogHost({ prompt, workspaceScope }: WorkspaceTrustDialogHostProps) {
  const request = useSyncExternalStore(prompt.subscribe, prompt.getSnapshot, prompt.getSnapshot);
  useEffect(() => prompt.acquireHostLease(), [prompt]);
  useLayoutEffect(() => {
    prompt.setWorkspaceScope(workspaceScope);
  }, [prompt, workspaceScope]);
  const decide = useCallback(
    (decision: WorkspaceTrustDecision) => {
      if (request !== null) prompt.resolve(request, decision);
    },
    [prompt, request],
  );
  return <WorkspaceTrustDialog onDecide={decide} request={request} />;
}
```

In `src/components/WorkbenchOverlayHosts.tsx` widen the composition pick to `"dirtyCloseDecisionCoordinator" | "quickInputCoordinator" | "workspaceTrustPrompt"`, import `WorkspaceTrustDialogHost` from `./projects/WorkspaceTrustDialogHost`, and render after `QuickInputDialogHost`:

```tsx
      <WorkspaceTrustDialogHost
        prompt={composition.workspaceTrustPrompt}
        workspaceScope={
          workbench.workspaceIdentityDescriptor?.workspaceId ?? workbench.workspaceRoot
        }
      />
```

`App.tsx` already passes the whole `workbenchComposition`, so it does not change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/projects/WorkspaceTrustDialog.test.tsx && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects/projects.css src/components/projects/WorkspaceTrustDialog.tsx src/components/projects/WorkspaceTrustDialogHost.tsx src/components/projects/WorkspaceTrustDialog.test.tsx src/components/WorkbenchOverlayHosts.tsx
git commit -m "feat(trust): add the workspace trust dialog host"
```

### Task 10: Agent projects - defer trust for clones, confirmed grant for "Trust project…"

**Files:**
- Modify: `src/application/agentOpenedProjectAdmission.ts` (+ `.test.ts`)
- Create: `src/application/agentProjectTrustGrant.ts` (+ `.test.ts`)
- Modify (hunk): `src/application/useAgentProjects.ts` (surface type, two callbacks, returned memo)
- Modify (test): `src/application/useAgentProjects.test.ts` (two tests in `describe("useAgentProjects trust actions")`)

**Interfaces:**
- Consumes: Task 8 `WorkspaceTrustGateway.confirmGrant`, `WorkspaceTrustOrigin`.
- Produces:

```ts
// AgentOpenedProjectAdmission
deferTrust(rootPath: string): void;           // next admission of this path is observed without a grant

// agentProjectTrustGrant.ts
export type AgentProjectTrustGrantResult = "granted" | "declined" | "stale";
export function confirmAndGrantAgentProjectTrust(input: Readonly<{
  rootPath: string;
  label: string;
  origin: WorkspaceTrustOrigin;
  gateway: Pick<WorkspaceTrustGateway, "confirmGrant" | "setTrust">;
  isCurrent: () => boolean;
}>): Promise<AgentProjectTrustGrantResult>;

// AgentProjectsSurface additions (optional so fakes keep compiling)
deferOpenedProjectTrust?(rootPath: string): void;
grantProjectTrust?(rootKey: string, origin: WorkspaceTrustOrigin | null): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/application/agentOpenedProjectAdmission.test.ts`:

```ts
describe("deferred opened project trust", () => {
  it("observes a deferred admission without granting, then grants a later admission", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    admission.deferTrust("/project/");
    await expect(admission.authorize(identity(1), untrusted, port, () => true)).resolves.toBeNull();
    await expect(admission.authorize(identity(1), untrusted, port, () => true)).resolves.toBeNull();
    expect(port.grantOpenedProject).not.toHaveBeenCalled();
    await admission.authorize(identity(2), untrusted, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
  });

  it("bounds deferred roots and drops the oldest first", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    for (let index = 0; index < 17; index += 1) admission.deferTrust(`/p${index}`);
    await admission.authorize(identity(1, "/p0"), { rootPath: "/p0", trusted: false }, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
    await admission.authorize(identity(2, "/p16"), { rootPath: "/p16", trusted: false }, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
  });
});
```

`src/application/agentProjectTrustGrant.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { confirmAndGrantAgentProjectTrust } from "./agentProjectTrustGrant";

function gateway(confirmed: boolean) {
  return {
    confirmGrant: vi.fn(async () => confirmed),
    setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
  };
}
const origin = { kind: "clone" as const, host: "github.com", path: "acme/web" };

describe("confirmAndGrantAgentProjectTrust", () => {
  it("grants through setTrust only after confirmation", async () => {
    const port = gateway(true);
    await expect(
      confirmAndGrantAgentProjectTrust({ rootPath: "/code/web", label: "web", origin, gateway: port, isCurrent: () => true }),
    ).resolves.toBe("granted");
    expect(port.confirmGrant).toHaveBeenCalledWith({ rootPath: "/code/web", label: "web", origin });
    expect(port.setTrust).toHaveBeenCalledExactlyOnceWith("/code/web", true);
  });

  it("does nothing when declined or when no confirmation capability exists", async () => {
    const declined = gateway(false);
    await expect(
      confirmAndGrantAgentProjectTrust({ rootPath: "/a", label: "a", origin, gateway: declined, isCurrent: () => true }),
    ).resolves.toBe("declined");
    expect(declined.setTrust).not.toHaveBeenCalled();
    const setTrust = vi.fn();
    await expect(
      confirmAndGrantAgentProjectTrust({ rootPath: "/a", label: "a", origin, gateway: { setTrust }, isCurrent: () => true }),
    ).resolves.toBe("declined");
    expect(setTrust).not.toHaveBeenCalled();
  });

  it("does not grant when the project generation changed during the prompt", async () => {
    let current = true;
    const port = {
      confirmGrant: vi.fn(async () => {
        current = false;
        return true;
      }),
      setTrust: vi.fn(),
    };
    await expect(
      confirmAndGrantAgentProjectTrust({ rootPath: "/a", label: "a", origin, gateway: port, isCurrent: () => current }),
    ).resolves.toBe("stale");
    expect(port.setTrust).not.toHaveBeenCalled();
  });

  it("reports stale when the owner changes while the grant is in flight", async () => {
    let current = true;
    const port = {
      confirmGrant: vi.fn(async () => true),
      setTrust: vi.fn(async (rootPath: string) => {
        current = false;
        return { rootPath, trusted: true };
      }),
    };
    await expect(
      confirmAndGrantAgentProjectTrust({ rootPath: "/a", label: "a", origin, gateway: port, isCurrent: () => current }),
    ).resolves.toBe("stale");
  });
});
```

Append inside `describe("useAgentProjects trust actions", …)` in `src/application/useAgentProjects.test.ts`:

```ts
  it("keeps a deferred cloned project untrusted until the dialog confirms", async () => {
    const descriptor = { ...descriptorFor(BACKGROUND_ROOT, "background"), admissionToken: 21 };
    const confirmGrant = vi.fn(async () => true);
    const harness = renderAgentProjects({
      tabs: [],
      descriptors: [[BACKGROUND_ROOT, descriptor]],
      untrustedRoots: [BACKGROUND_ROOT],
    });
    Object.assign(harness.trust, { confirmGrant });
    act(() => harness.hook().deferOpenedProjectTrust?.(BACKGROUND_ROOT));
    harness.setTabs([BACKGROUND_ROOT]);
    await waitForReact(() =>
      expect(harness.hook().projects.find((p) => p.rootKey === BACKGROUND_ROOT)?.trust).toBe(
        "untrusted",
      ),
    );
    expect(harness.trust.grantOpenedProject).not.toHaveBeenCalled();
    await act(async () =>
      harness.hook().grantProjectTrust?.(BACKGROUND_ROOT, {
        kind: "clone",
        host: "github.com",
        path: "acme/background",
      }),
    );
    expect(confirmGrant).toHaveBeenCalledWith({
      rootPath: BACKGROUND_ROOT,
      label: expect.any(String),
      origin: { kind: "clone", host: "github.com", path: "acme/background" },
    });
    expect(harness.trust.setTrust).toHaveBeenCalledExactlyOnceWith(BACKGROUND_ROOT, true);
    await waitForReact(() =>
      expect(harness.hook().projects.find((p) => p.rootKey === BACKGROUND_ROOT)?.trust).toBe(
        "trusted",
      ),
    );
    harness.unmount();
  });

  it("does not grant remote or declined projects", async () => {
    const harness = renderAgentProjects({ tabs: [BACKGROUND_ROOT], untrustedRoots: [BACKGROUND_ROOT] });
    Object.assign(harness.trust, { confirmGrant: vi.fn(async () => false) });
    await waitForReact(() =>
      expect(harness.hook().projects.find((p) => p.rootKey === BACKGROUND_ROOT)?.trust).toBe(
        "untrusted",
      ),
    );
    await act(async () => harness.hook().grantProjectTrust?.(BACKGROUND_ROOT, null));
    await act(async () => harness.hook().grantProjectTrust?.("remote:srv:/x", null));
    expect(harness.trust.setTrust).not.toHaveBeenCalled();
    harness.unmount();
  });
```

If the harness has no `setTabs`, add it next to the existing environment mutators in `renderAgentProjects`: `setTabs(tabs: string[]) { environment.tabs = tabs; rerender(); }` (the harness already exposes `rerender`; `appSettingsRef` reads `environment.tabs`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/application/agentOpenedProjectAdmission.test.ts src/application/agentProjectTrustGrant.test.ts src/application/useAgentProjects.test.ts`
Expected: FAIL (`deferTrust is not a function`, module missing, `grantProjectTrust` undefined).

- [ ] **Step 3: Implement**

In `src/application/agentOpenedProjectAdmission.ts` add a bounded deferral set and consult it in `authorize` right after the `observed` bookkeeping:

```ts
const MAX_DEFERRED_TRUST_ROOTS = 16;
```

```ts
  private readonly deferred: string[] = [];

  deferTrust(rootPath: string): void {
    const key = normalizedWorkspaceRootKey(rootPath);
    const existing = this.deferred.indexOf(key);
    if (existing >= 0) this.deferred.splice(existing, 1);
    this.deferred.push(key);
    if (this.deferred.length > MAX_DEFERRED_TRUST_ROOTS) this.deferred.shift();
  }

  private consumeDeferral(identity: WorkspaceIdentityDescriptor): boolean {
    const keys = [identity.selectedPath, identity.canonicalRoot].map((path) =>
      normalizedWorkspaceRootKey(path),
    );
    const index = this.deferred.findIndex((key) => keys.includes(key));
    if (index < 0) return false;
    this.deferred.splice(index, 1);
    return true;
  }
```

In `authorize`, replace
`if (trust.trusted || gateway.grantOpenedProject === undefined) return null;`
with
`if (trust.trusted || gateway.grantOpenedProject === undefined || this.consumeDeferral(identity)) return null;`
(the admission is already recorded in `observed` two lines above, so the same admission is never granted later). Import `normalizedWorkspaceRootKey` from `../domain/workspaceRootKey`.

`src/application/agentProjectTrustGrant.ts`:

```ts
import type { WorkspaceTrustGateway, WorkspaceTrustOrigin } from "../domain/trust";

export type AgentProjectTrustGrantResult = "granted" | "declined" | "stale";

export async function confirmAndGrantAgentProjectTrust(
  input: Readonly<{
    rootPath: string;
    label: string;
    origin: WorkspaceTrustOrigin;
    gateway: Pick<WorkspaceTrustGateway, "confirmGrant" | "setTrust">;
    isCurrent: () => boolean;
  }>,
): Promise<AgentProjectTrustGrantResult> {
  const { gateway, isCurrent } = input;
  if (gateway.confirmGrant === undefined) return "declined";
  const confirmed = await gateway.confirmGrant({
    rootPath: input.rootPath,
    label: input.label,
    origin: input.origin,
  });
  if (!confirmed) return "declined";
  if (!isCurrent()) return "stale";
  await gateway.setTrust(input.rootPath, true);
  return isCurrent() ? "granted" : "stale";
}
```

In `src/application/useAgentProjects.ts`:
1. Extend `AgentProjectsSurface`:

```ts
  deferOpenedProjectTrust?(rootPath: string): void;
  grantProjectTrust?(rootKey: string, origin: WorkspaceTrustOrigin | null): Promise<void>;
```

2. After `const trustProject = refreshProject;` add:

```ts
  const deferOpenedProjectTrust = useCallback((rootPath: string): void => {
    openedAdmissionRef.current.deferTrust(rootPath);
  }, []);

  const grantProjectTrust = useCallback(
    async (rootKey: string, origin: WorkspaceTrustOrigin | null): Promise<void> => {
      if (rootKey.startsWith("remote:")) return;
      const entry = entriesRef.current.get(rootKey);
      if (entry === undefined || entry.releasing || entry.trust === "trusted") return;
      const generation = entry.generation;
      const admission = dependenciesRef.current.descriptorForRoot(entry.rootPath)?.admissionToken;
      const isCurrent = () =>
        entryFor(rootKey, generation) !== null &&
        dependenciesRef.current.descriptorForRoot(entry.rootPath)?.admissionToken === admission;
      const result = await attempt(() =>
        confirmAndGrantAgentProjectTrust({
          rootPath: entry.rootPath,
          label: workspaceDisplayName(entry.rootPath),
          origin: origin ?? { kind: "local" },
          gateway: dependenciesRef.current.trustGateway,
          isCurrent,
        }),
      );
      if (!result.ok) {
        dependenciesRef.current.reportError(AGENT_PROJECTS_SOURCE, result.error);
        return;
      }
      if (result.value !== "granted") return;
      const deps = dependenciesRef.current;
      if (entry.workspaceId !== null && deps.activeWorkspaceId === entry.workspaceId) {
        deps.onActiveWorkspaceTrustChanged(entry.rootPath, entry.workspaceId, true);
        return;
      }
      await runProjectLoad(rootKey, generation);
    },
    [entryFor, runProjectLoad],
  );
```

(`attempt`, `entryFor`, `runProjectLoad`, `openedAdmissionRef`, `dependenciesRef`, `AGENT_PROJECTS_SOURCE` and `workspaceDisplayName` already exist in the file; import `confirmAndGrantAgentProjectTrust` from `./agentProjectTrustGrant` and `WorkspaceTrustOrigin` from `../domain/trust`.) The active-workspace branch returns without reloading for the same reason the auto-admission path does: the controller trust change re-runs the load with fresh active trust instead of reading the stale value.

3. Add `deferOpenedProjectTrust, grantProjectTrust,` to the returned memo object and its dependency list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/application/agentOpenedProjectAdmission.test.ts src/application/agentProjectTrustGrant.test.ts src/application/useAgentProjects.test.ts && npm run check && npm run lint:exhaustive-deps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/agentOpenedProjectAdmission.ts src/application/agentOpenedProjectAdmission.test.ts src/application/agentProjectTrustGrant.ts src/application/agentProjectTrustGrant.test.ts src/application/useAgentProjects.ts src/application/useAgentProjects.test.ts
git commit -m "feat(trust): open cloned projects untrusted and grant agent trust after confirmation"
```

### Task 11: Clone plumbing - retry fidelity, deferred trust on open, destination probe, host status, parent preference

**Files:**
- Modify: `src/application/useLocalProjectClone.ts` (+ `.test.tsx`)
- Modify: `src/components/agentMode/agentWorkbenchChrome.ts`, `useAgentWorkbenchProjectOpening.ts` (+ `.test.tsx`), `useAgentAddProject.ts`, `useAgentProjectCreation.ts`, `useAgentProjectCreationLane.ts`
- Create: `src/application/useCloneDestinationProbe.ts` (+ `.test.tsx`), `src/application/useRepositoryHostStatus.ts` (+ `.test.ts`), `src/components/agentMode/useAgentCloneDestinationPreference.ts` (+ `.test.tsx`)
- Modify (hunk): `src/components/agentMode/AgentWorkbenchScreen.tsx` (~20 lines)

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7, 10.
- Produces:

```ts
// useLocalProjectClone return gains
source: RepositoryIdentity | null;

// agentWorkbenchChrome.ts
export type AgentAddProjectTrustMode = "auto" | "prompt";
export interface AgentCloneDestinationPreference { readonly lastParentPath: string | null; remember(parentPath: string): void }
// AgentWorkbenchAddProjectChrome gains
readonly cloneDestination?: AgentCloneDestinationPreference;
readonly recentFolders?: readonly RecentFolderEntry[];
addProject(path: string, options?: Readonly<{ trust: AgentAddProjectTrustMode }>): Promise<AgentAddedProjectReceipt>;

// useAgentAddProject
addProject(path: string, trust?: AgentAddProjectTrustMode): void;

// lane / creation return gains
localCloneDetail: Readonly<{
  progress: LocalCloneProgress | null;
  failure: LocalCloneFailure | null;
  source: RepositoryIdentity | null;
}> | null;

// useCloneDestinationProbe.ts
export function useCloneDestinationProbe(
  gateway: Pick<DirectoryListingGateway, "listDirectoryEntries"> | null,
  target: Readonly<{ parentPath: string; name: string }> | null,
  projectRootPaths: readonly string[],
  delayMs?: number,
): CloneDestinationProbe;

// useRepositoryHostStatus.ts
export type RepositoryHostStatus =
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "ready"; host: string }>
  | Readonly<{ kind: "signedOut"; host: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unavailable" }>;
export type RepositoryHostStatuses = Readonly<Record<RepositoryProvider, RepositoryHostStatus>>;
export function repositoryHostStatuses(snapshot: RepositoryHostsSnapshot): RepositoryHostStatuses;
export function useRepositoryHostStatus(gateway: RepositoryLookupGateway | null, enabled: boolean): RepositoryHostStatuses;

// useAgentCloneDestinationPreference.ts
export function useAgentCloneDestinationPreference(input: Readonly<{
  lastParentPath: string | null;
  save(parentPath: string): Promise<void>;
}>): AgentCloneDestinationPreference;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/application/useLocalProjectClone.test.tsx` inside `describe("local clone ownership", …)`:

```ts
  it("retry resends ensureParent and branch and exposes the repository source", async () => {
    const s = setup(async (request) => ({
      cloneId: request.idempotencyKey,
      status: "failed",
      path: null,
      error: "Cloning failed.",
      progress: null,
      failure: "network",
    }));
    await act(async () => {
      await s.result.current.start({ ...input, branch: "dev", ensureParent: true });
    });
    expect(s.result.current.source).toEqual({ host: "github.com", path: "team/repo" });
    await act(async () => {
      s.result.current.retry();
    });
    const calls = vi.mocked(s.gateway.start).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toMatchObject({ branch: "dev", ensureParent: true, url: input.url });
    await act(async () => {
      s.result.current.dismiss();
    });
    expect(s.result.current.source).toBeNull();
  });
```

`src/application/useCloneDestinationProbe.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloneDestinationProbe } from "../domain/cloneForm";
import type { DirectoryListingGateway } from "../domain/directoryListing";
import { useCloneDestinationProbe } from "./useCloneDestinationProbe";

type Target = Readonly<{ parentPath: string; name: string }> | null;

describe("useCloneDestinationProbe", () => {
  const result: { current: CloneDestinationProbe } = { current: { kind: "unknown" } };
  let host: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });
  function mount(gateway: Pick<DirectoryListingGateway, "listDirectoryEntries">, roots: string[] = []) {
    const root = createRoot(host);
    function Harness({ target }: { readonly target: Target }) {
      result.current = useCloneDestinationProbe(gateway, target, roots, 200);
      return null;
    }
    return {
      render: (target: Target) => act(() => root.render(<Harness target={target} />)),
      unmount: () => act(() => root.unmount()),
    };
  }
  const listing = (names: string[], truncated = false) =>
    vi.fn(async () => ({
      path: "/Users/dev/code",
      parent: "/Users/dev",
      entries: names.map((name) => ({ name, kind: "directory" as const, hidden: false })),
      truncated,
    }));

  it("reports an existing folder case-insensitively after the debounce", async () => {
    const listDirectoryEntries = listing(["Web-Dashboard"]);
    const probe = mount({ listDirectoryEntries });
    probe.render({ parentPath: "/Users/dev/code", name: "web-dashboard" });
    expect(result.current).toEqual({ kind: "checking" });
    expect(listDirectoryEntries).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(listDirectoryEntries).toHaveBeenCalledWith({ path: "/Users/dev/code", includeFiles: true });
    expect(result.current).toEqual({ kind: "exists" });
    probe.unmount();
  });

  it("reports open projects without IO and stays unknown when the listing is truncated or fails", async () => {
    const listDirectoryEntries = listing([], true);
    const probe = mount({ listDirectoryEntries }, ["/Users/dev/code/app/"]);
    probe.render({ parentPath: "/Users/dev/code", name: "app" });
    expect(result.current).toEqual({ kind: "project", rootPath: "/Users/dev/code/app/" });
    probe.render({ parentPath: "/Users/dev/code", name: "other" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current).toEqual({ kind: "unknown" });
    probe.unmount();
    const failing = mount({ listDirectoryEntries: vi.fn(async () => Promise.reject(new Error("missing"))) });
    failing.render({ parentPath: "/Users/dev/code", name: "x" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current).toEqual({ kind: "unknown" });
    failing.unmount();
  });

  it("never publishes a stale answer for a superseded target", async () => {
    let release!: () => void;
    const listDirectoryEntries = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<DirectoryListingGateway["listDirectoryEntries"]>>>((resolve) => {
          release = () =>
            resolve({ path: "/a", parent: "/", entries: [{ name: "one", kind: "directory", hidden: false }], truncated: false });
        }),
    );
    const probe = mount({ listDirectoryEntries });
    probe.render({ parentPath: "/a", name: "one" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    probe.render({ parentPath: "/a", name: "two" });
    await act(async () => {
      release();
    });
    expect(result.current).toEqual({ kind: "checking" });
    probe.unmount();
  });
});
```

`src/application/useRepositoryHostStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { repositoryHostStatuses } from "./useRepositoryHostStatus";

describe("repositoryHostStatuses", () => {
  it("prefers an authenticated host and maps missing CLIs and failures", () => {
    expect(
      repositoryHostStatuses({
        github: {
          status: "ready",
          truncated: false,
          hosts: [
            { provider: "github", host: "ghe.example.com", auth: "notAuthenticated" },
            { provider: "github", host: "github.com", auth: "authenticated" },
          ],
        },
        gitlab: { status: "cliMissing" },
      }),
    ).toEqual({ github: { kind: "ready", host: "github.com" }, gitlab: { kind: "missing" } });
    expect(
      repositoryHostStatuses({
        github: { status: "ready", truncated: false, hosts: [{ provider: "github", host: "github.com", auth: "notAuthenticated" }] },
        gitlab: { status: "failed", reason: "timedOut" },
      }),
    ).toEqual({ github: { kind: "signedOut", host: "github.com" }, gitlab: { kind: "unavailable" } });
    expect(
      repositoryHostStatuses({
        github: { status: "ready", truncated: false, hosts: [] },
        gitlab: { status: "cliMissing" },
      }).github,
    ).toEqual({ kind: "missing" });
  });
});
```

`src/components/agentMode/useAgentCloneDestinationPreference.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentCloneDestinationPreference } from "./agentWorkbenchChrome";
import { useAgentCloneDestinationPreference } from "./useAgentCloneDestinationPreference";

describe("useAgentCloneDestinationPreference", () => {
  it("saves a new normalized parent once and skips the current one", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const save = vi.fn(async () => undefined);
    const result: { current: AgentCloneDestinationPreference | null } = { current: null };
    function Harness() {
      result.current = useAgentCloneDestinationPreference({ lastParentPath: "/Users/dev/code", save });
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Harness />));
    await act(async () => result.current?.remember("/Users/dev/code/"));
    await act(async () => result.current?.remember("/Users/dev/src/"));
    await act(async () => result.current?.remember("relative"));
    expect(save).toHaveBeenCalledExactlyOnceWith("/Users/dev/src");
    act(() => root.unmount());
  });
});
```

Append to `src/components/agentMode/useAgentWorkbenchProjectOpening.test.tsx` a test that calls `chrome.addProject("/code/app", { trust: "prompt" })` and asserts the injected `deferOpenedProjectTrust` mock was called with `"/code/app"` **before** `openWorkspaceRootWithReceipt` (record call order in one array), and that `addProject("/code/app")` without options does not call it. Use the file's existing render helper; pass `deferOpenedProjectTrust: vi.fn((path) => order.push(`defer:${path}`))` and make the existing `openWorkspaceRootWithReceipt` mock push `open:${path}`. Expected order: `["defer:/code/app", "open:/code/app"]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/application/useLocalProjectClone.test.tsx src/application/useCloneDestinationProbe.test.tsx src/application/useRepositoryHostStatus.test.ts src/components/agentMode/useAgentCloneDestinationPreference.test.tsx src/components/agentMode/useAgentWorkbenchProjectOpening.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `useLocalProjectClone` changes**

1. `import { parseRepositoryCloneUrl, type RepositoryIdentity } from "../domain/repositoryCloneUrl";`
2. State: `const [source, setSource] = useState<RepositoryIdentity | null>(null);`
3. In the restore effect after `setName(restored?.name ?? "");` add `setSource(restored ? parseRepositoryCloneUrl(restored.request.url) : null);`.
4. In `start` after `setName(input.name);` add `setSource(parseRepositoryCloneUrl(nextRequest.url));`.
5. Replace the body of `retry`'s `if (request.current) { … }` with:

```ts
    if (request.current) {
      const { url, name: folderName, parentPath, branch, ensureParent } = request.current;
      void start({
        url,
        name: folderName,
        parentPath,
        ...(branch ? { branch } : {}),
        ...(ensureParent ? { ensureParent } : {}),
      });
    }
```

6. In `dismiss` add `setSource(null);`; return `source` from the hook.

- [ ] **Step 4: Implement chrome, opening and lane changes**

`agentWorkbenchChrome.ts`:

```ts
import type { RecentFolderEntry } from "../../domain/recentFolders";

export type AgentAddProjectTrustMode = "auto" | "prompt";

export interface AgentCloneDestinationPreference {
  readonly lastParentPath: string | null;
  remember(parentPath: string): void;
}
```

and in `AgentWorkbenchAddProjectChrome`:

```ts
  readonly cloneDestination?: AgentCloneDestinationPreference;
  readonly recentFolders?: readonly RecentFolderEntry[];
  addProject(
    path: string,
    options?: Readonly<{ trust: AgentAddProjectTrustMode }>,
  ): Promise<AgentAddedProjectReceipt>;
```

`useAgentWorkbenchProjectOpening.ts`: add inputs `deferOpenedProjectTrust?: (rootPath: string) => void`, `cloneDestination?: AgentCloneDestinationPreference`, `recentFolders?: readonly RecentFolderEntry[]`; include `cloneDestination, recentFolders,` in the memoized chrome and the dependency list; change the `addProject` member to

```ts
      addProject: async (path: string, options?: Readonly<{ trust: AgentAddProjectTrustMode }>) => {
        if (options?.trust === "prompt") deferOpenedProjectTrust?.(path);
        const epoch = ++addSelectionEpoch.current;
```

(rest unchanged) and add `deferOpenedProjectTrust` to the dependency list.

`useAgentAddProject.ts`: change `addProject(path: string): void;` in `AgentAddProjectState` to `addProject(path: string, trust?: AgentAddProjectTrustMode): void;` and the callback to

```ts
  const addProject = useCallback(
    (path: string, trust: AgentAddProjectTrustMode = "auto") => {
      if (chrome === null) return;
      setOpen(false);
      const generation = ++authority.current.generation;
      setReceipt(null);
      void chrome
        .addProject(path, { trust })
```

(rest unchanged).

`useAgentProjectCreation.ts` `laneOptions`: forward the options.

```ts
            addProject(path: string, openOptions?: Readonly<{ trust: AgentAddProjectTrustMode }>) {
              receiptLane.current = index;
              if (session) session.receiptLane = index;
              return options.chrome!.addProject(path, openOptions);
            },
```

`useAgentProjectCreationLane.ts`:
1. Both clone-open call sites (`continueDraft` and `activateCompleted`) become `addProject.addProject(current.target.path, "prompt");`.
2. Add to the returned object, next to `pendingClone`:

```ts
    localCloneDetail:
      pending?.environment !== null || pending === null
        ? null
        : {
            progress:
              local.job?.cloneId === pending.id && local.job.status === "running"
                ? local.job.progress
                : null,
            failure:
              local.job?.cloneId === pending.id && local.job.status === "failed"
                ? local.job.failure
                : null,
            source: local.source,
          },
```

`useAgentProjectCreation` spreads `...active`, so `localCloneDetail` reaches `AgentModeView` without further changes.

- [ ] **Step 5: Implement the probe, host status and preference hooks**

`src/application/useCloneDestinationProbe.ts`:

```ts
import { useEffect, useMemo, useState } from "react";
import { joinClonePath } from "../domain/cloneDestination";
import type { CloneDestinationProbe } from "../domain/cloneForm";
import type { DirectoryListingGateway } from "../domain/directoryListing";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

const CHECKING: CloneDestinationProbe = { kind: "checking" };
const UNKNOWN: CloneDestinationProbe = { kind: "unknown" };

export function useCloneDestinationProbe(
  gateway: Pick<DirectoryListingGateway, "listDirectoryEntries"> | null,
  target: Readonly<{ parentPath: string; name: string }> | null,
  projectRootPaths: readonly string[],
  delayMs = 200,
): CloneDestinationProbe {
  const parentPath = target?.parentPath ?? null;
  const name = target?.name ?? null;
  const key = parentPath === null || name === null ? null : joinClonePath(parentPath, name);
  const project = useMemo(() => {
    if (key === null) return null;
    const wanted = normalizedWorkspaceRootKey(key);
    return projectRootPaths.find((root) => normalizedWorkspaceRootKey(root) === wanted) ?? null;
  }, [key, projectRootPaths]);
  const [answer, setAnswer] = useState<{ key: string; probe: CloneDestinationProbe } | null>(null);
  useEffect(() => {
    if (gateway === null || key === null || project !== null || parentPath === null || name === null)
      return;
    let disposed = false;
    const timer = setTimeout(() => {
      void gateway
        .listDirectoryEntries({ path: parentPath, includeFiles: true })
        .then((listing) => {
          const wanted = name.toLowerCase();
          const exists = listing.entries.some((entry) => entry.name.toLowerCase() === wanted);
          const probe: CloneDestinationProbe = exists
            ? { kind: "exists" }
            : listing.truncated
              ? UNKNOWN
              : { kind: "free" };
          if (!disposed) setAnswer({ key, probe });
        })
        .catch(() => {
          if (!disposed) setAnswer({ key, probe: UNKNOWN });
        });
    }, delayMs);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [delayMs, gateway, key, name, parentPath, project]);
  if (key === null) return UNKNOWN;
  if (project !== null) return { kind: "project", rootPath: project };
  if (gateway === null) return UNKNOWN;
  return answer?.key === key ? answer.probe : CHECKING;
}
```

`src/application/useRepositoryHostStatus.ts`:

```ts
import { useEffect, useState } from "react";
import type {
  RepositoryHostsSnapshot,
  RepositoryHostsState,
  RepositoryProvider,
} from "../domain/repositoryLookup";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";

export type RepositoryHostStatus =
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "ready"; host: string }>
  | Readonly<{ kind: "signedOut"; host: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unavailable" }>;
export type RepositoryHostStatuses = Readonly<Record<RepositoryProvider, RepositoryHostStatus>>;

const CHECKING: RepositoryHostStatuses = { github: { kind: "checking" }, gitlab: { kind: "checking" } };
const UNAVAILABLE: RepositoryHostStatuses = {
  github: { kind: "unavailable" },
  gitlab: { kind: "unavailable" },
};

export function repositoryHostStatuses(snapshot: RepositoryHostsSnapshot): RepositoryHostStatuses {
  return { github: hostStatus(snapshot.github), gitlab: hostStatus(snapshot.gitlab) };
}

export function useRepositoryHostStatus(
  gateway: RepositoryLookupGateway | null,
  enabled: boolean,
): RepositoryHostStatuses {
  const [loaded, setLoaded] = useState<{
    gateway: RepositoryLookupGateway;
    statuses: RepositoryHostStatuses;
  } | null>(null);
  useEffect(() => {
    if (gateway === null || !enabled) return;
    let disposed = false;
    void gateway
      .listHosts()
      .then((snapshot) => {
        if (!disposed) setLoaded({ gateway, statuses: repositoryHostStatuses(snapshot) });
      })
      .catch(() => {
        if (!disposed) setLoaded({ gateway, statuses: UNAVAILABLE });
      });
    return () => {
      disposed = true;
    };
  }, [enabled, gateway]);
  if (gateway === null) return UNAVAILABLE;
  return loaded?.gateway === gateway ? loaded.statuses : CHECKING;
}

function hostStatus(state: RepositoryHostsState): RepositoryHostStatus {
  switch (state.status) {
    case "ready": {
      const authenticated = state.hosts.find((host) => host.auth === "authenticated");
      if (authenticated !== undefined) return { kind: "ready", host: authenticated.host };
      const first = state.hosts[0];
      return first === undefined ? { kind: "missing" } : { kind: "signedOut", host: first.host };
    }
    case "cliMissing":
      return { kind: "missing" };
    case "failed":
      return { kind: "unavailable" };
    default:
      return unsupportedHostState(state);
  }
}

function unsupportedHostState(state: never): never {
  throw new TypeError(`Unsupported repository host state: ${JSON.stringify(state)}.`);
}
```

`src/components/agentMode/useAgentCloneDestinationPreference.ts`:

```ts
import { useMemo, useRef } from "react";
import { normalizeLastCloneParentPath } from "../../domain/projectOnboardingSettings";
import type { AgentCloneDestinationPreference } from "./agentWorkbenchChrome";

export function useAgentCloneDestinationPreference(
  input: Readonly<{ lastParentPath: string | null; save(parentPath: string): Promise<void> }>,
): AgentCloneDestinationPreference {
  const saved = useRef(input.lastParentPath);
  const { lastParentPath, save } = input;
  return useMemo(
    () => ({
      lastParentPath,
      remember(parentPath: string) {
        const normalized = normalizeLastCloneParentPath(parentPath);
        if (normalized === null || normalized === (saved.current ?? lastParentPath)) return;
        saved.current = normalized;
        void save(normalized).catch(() => {
          saved.current = lastParentPath;
        });
      },
    }),
    [lastParentPath, save],
  );
}
```

- [ ] **Step 6: Wire in `AgentWorkbenchScreen.tsx`**

After `const saveAgentModelFavorites = …` add:

```tsx
  const saveCloneParent = useCallback(
    async (lastCloneParentPath: string): Promise<void> => {
      await saveWorkbenchSettings(
        { ...appSettingsRef.current, lastCloneParentPath },
        workspaceSettingsRef.current,
        workspaceTrustRef.current?.trusted ?? null,
      );
    },
    [saveWorkbenchSettings],
  );
  const cloneDestination = useAgentCloneDestinationPreference({
    lastParentPath: appSettings.lastCloneParentPath ?? null,
    save: saveCloneParent,
  });
  const recentFolders = useMemo(
    () =>
      recentFolderEntries({
        recentPaths: appSettings.recentWorkspacePaths ?? [],
        openedAt: appSettings.recentWorkspaceOpenedAt ?? {},
        excludeRoots: projects.projects.map((project) => project.rootPath),
      }),
    [appSettings.recentWorkspaceOpenedAt, appSettings.recentWorkspacePaths, projects.projects],
  );
```

These lines sit above the existing `useAgentWorkbenchProjectOpening({ … })` call (around line 455); add `deferOpenedProjectTrust: projects.deferOpenedProjectTrust, cloneDestination, recentFolders,` to its argument object. Change the `onTrustProject` prop to

```tsx
        onTrustProject={(projectRootKey, origin) =>
          void (projects.grantProjectTrust ?? projects.trustProject)(projectRootKey, origin ?? null)
        }
```

(`trustProject(rootKey)` ignores the extra argument; the fallback only exists for surfaces that do not implement the new method.)

In `AgentModeView.tsx` (hunk d) widen the prop type so the arrow above type-checks: `onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;` (import `WorkspaceTrustOrigin` from `../../domain/trust`). Existing callers pass one argument and keep compiling.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/application/useLocalProjectClone.test.tsx src/application/useCloneDestinationProbe.test.tsx src/application/useRepositoryHostStatus.test.ts src/components/agentMode/useAgentCloneDestinationPreference.test.tsx src/components/agentMode/useAgentWorkbenchProjectOpening.test.tsx src/components/agentMode/useAgentProjectCreation.test.tsx src/components/agentMode/useAgentProjectCreationQueue.test.tsx src/components/agentMode/AgentWorkbenchScreen.test.tsx && npm run check && npm run lint:exhaustive-deps`
Expected: PASS.

- [ ] **Step 8: Commit (end of slice A)**

```bash
git add src/components/agentMode/AgentModeView.tsx src/application/useLocalProjectClone.ts src/application/useLocalProjectClone.test.tsx src/application/useCloneDestinationProbe.ts src/application/useCloneDestinationProbe.test.tsx src/application/useRepositoryHostStatus.ts src/application/useRepositoryHostStatus.test.ts src/components/agentMode/agentWorkbenchChrome.ts src/components/agentMode/useAgentWorkbenchProjectOpening.ts src/components/agentMode/useAgentWorkbenchProjectOpening.test.tsx src/components/agentMode/useAgentAddProject.ts src/components/agentMode/useAgentProjectCreation.ts src/components/agentMode/useAgentProjectCreationLane.ts src/components/agentMode/useAgentCloneDestinationPreference.ts src/components/agentMode/useAgentCloneDestinationPreference.test.tsx src/components/agentMode/AgentWorkbenchScreen.tsx
git commit -m "feat(clone): keep retry fidelity, defer clone trust on open and probe clone destinations"
```

### Task 12: One-step clone form (F6) with live validation

**Files:**
- Create: `src/application/useHomeDirectory.ts`, `src/components/projects/useCloneRepositoryForm.ts`, `src/components/projects/CloneRepositoryForm.tsx`
- Test: `src/components/projects/CloneRepositoryForm.test.tsx`
- Modify: `src/components/projects/projects.css` (append the form section)

**Interfaces:**
- Consumes: Task 6 `evaluateCloneForm`, `CloneFormRequest`; Task 5 helpers; Task 11 `useCloneDestinationProbe`; P5 `CommandSurface`, `CommandInput`, `CommandFooter`, `CommandFooterHint`; P1 `Button`, `IconButton`, `FieldFrame`; existing `AgentAddProjectDialog` (mode `selectDirectory`), `RemoteAddProjectSourceGlyph`.
- Produces:

```ts
export function useHomeDirectory(gateway: Pick<DirectoryListingGateway, "listDirectoryEntries"> | null): string | null;

export interface CloneRepositoryFormProps {
  readonly initialUrl: string;
  readonly environmentLabel: string;
  readonly directoryGateway: DirectoryListingGateway;
  readonly home: string | null;
  readonly shorthandHost: string | null;
  readonly lastParentPath: string | null;
  readonly projectRootPaths: readonly string[];
  readonly busy: boolean;
  readonly error: string | null;
  onBack(): void;
  onClone(request: CloneFormRequest, source: Readonly<{ host: string; path: string }>): void;
  onOpenExisting(rootPath: string): void;
}
export function CloneRepositoryForm(props: CloneRepositoryFormProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

`src/components/projects/CloneRepositoryForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { CloneRepositoryForm, type CloneRepositoryFormProps } from "./CloneRepositoryForm";

function gateway(existing: string[] = []): DirectoryListingGateway {
  return {
    listDirectoryEntries: vi.fn(async ({ path }) => ({
      path: path ?? "/Users/dev",
      parent: "/",
      entries: existing.map((name) => ({ name, kind: "directory" as const, hidden: false })),
      truncated: false,
    })),
    revealDirectory: vi.fn(async () => undefined),
  };
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CloneRepositoryForm", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: CloneRepositoryFormProps;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      initialUrl: "",
      environmentLabel: "This computer",
      directoryGateway: gateway(),
      home: "/Users/dev",
      shorthandHost: "github.com",
      lastParentPath: null,
      projectRootPaths: [],
      busy: false,
      error: null,
      onBack: vi.fn(),
      onClone: vi.fn(),
      onOpenExisting: vi.fn(),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function render(next: Partial<CloneRepositoryFormProps> = {}) {
    props = { ...props, ...next };
    await act(async () => root.render(<CloneRepositoryForm {...props} />));
  }
  async function settleProbe() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
  }
  function urlInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Git clone URL or owner/repo"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    return input as HTMLInputElement;
  }
  function field(label: string): HTMLInputElement {
    const labelElement = Array.from(document.querySelectorAll("label")).find((candidate) =>
      candidate.textContent?.startsWith(label),
    );
    const input = labelElement?.htmlFor ? document.getElementById(labelElement.htmlFor) : null;
    expect(input).toBeInstanceOf(HTMLInputElement);
    return input as HTMLInputElement;
  }
  function cloneButton(): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(button).toBeInstanceOf(HTMLButtonElement);
    return button as HTMLButtonElement;
  }

  it("fills ~/code/<name> and submits one request", async () => {
    await render();
    expect(cloneButton().disabled).toBe(true);
    act(() => typeInto(urlInput(), "https://github.com/acme/web-dashboard"));
    await settleProbe();
    expect(document.body.textContent).toContain("acme/web-dashboard");
    expect(document.body.textContent).toContain("github.com · HTTPS");
    expect(field("Destination").value).toBe("~/code/web-dashboard");
    expect(document.body.textContent).toContain("The repository is cloned into this folder.");
    expect(cloneButton().disabled).toBe(false);
    act(() => cloneButton().click());
    expect(props.onClone).toHaveBeenCalledExactlyOnceWith(
      {
        url: "https://github.com/acme/web-dashboard",
        name: "web-dashboard",
        parentPath: "/Users/dev/code",
        ensureParent: true,
      },
      { host: "github.com", path: "acme/web-dashboard" },
    );
  });

  it("never enables Clone for credential URLs", async () => {
    await render({ initialUrl: "https://ghp_x@github.com/acme/repo.git" });
    expect(document.body.textContent).toContain("A URL carrying credentials is rejected");
    expect(cloneButton().disabled).toBe(true);
    act(() => cloneButton().click());
    expect(props.onClone).not.toHaveBeenCalled();
  });

  it("offers Open existing for a project destination", async () => {
    await render({
      initialUrl: "acme/web-dashboard",
      projectRootPaths: ["/Users/dev/code/web-dashboard"],
    });
    expect(document.body.textContent).toContain("~/code/web-dashboard is already a project.");
    const open = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Open existing",
    );
    act(() => open?.click());
    expect(props.onOpenExisting).toHaveBeenCalledWith("/Users/dev/code/web-dashboard");
    expect(cloneButton().disabled).toBe(true);
  });

  it("flags an existing folder and a bad branch inline", async () => {
    await render({
      initialUrl: "https://github.com/acme/web-dashboard",
      directoryGateway: gateway(["web-dashboard"]),
    });
    await settleProbe();
    expect(document.body.textContent).toContain(
      "~/code/web-dashboard already exists. Choose another folder name.",
    );
    act(() => typeInto(field("Destination"), "~/code/web-2"));
    act(() => typeInto(field("Branch"), "bad..name"));
    await settleProbe();
    expect(document.body.textContent).toContain("Not a valid branch name.");
    expect(cloneButton().disabled).toBe(true);
  });

  it("keeps the destination the user edited when the URL changes", async () => {
    await render({ initialUrl: "https://github.com/acme/one" });
    act(() => typeInto(field("Destination"), "/opt/work/custom"));
    act(() => typeInto(urlInput(), "https://github.com/acme/two"));
    expect(field("Destination").value).toBe("/opt/work/custom");
  });

  it("goes back from the header and shows a start error", async () => {
    await render({ error: "Two clones are already running. Wait for one to finish." });
    expect(document.body.textContent).toContain(
      "Two clones are already running. Wait for one to finish.",
    );
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    act(() => back?.click());
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/projects/CloneRepositoryForm.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/application/useHomeDirectory.ts`:

```ts
import { useEffect, useState } from "react";
import type { DirectoryListingGateway } from "../domain/directoryListing";

export function useHomeDirectory(
  gateway: Pick<DirectoryListingGateway, "listDirectoryEntries"> | null,
): string | null {
  const [home, setHome] = useState<{ gateway: object; path: string } | null>(null);
  useEffect(() => {
    if (gateway === null) return;
    let disposed = false;
    void gateway
      .listDirectoryEntries({ path: null, includeFiles: false })
      .then((listing) => {
        if (!disposed) setHome({ gateway, path: listing.path });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [gateway]);
  return home !== null && home.gateway === gateway ? home.path : null;
}
```

`src/components/projects/useCloneRepositoryForm.ts`:

```ts
import { useMemo, useState } from "react";
import { useCloneDestinationProbe } from "../../application/useCloneDestinationProbe";
import { abbreviateHomePath, joinClonePath } from "../../domain/cloneDestination";
import { evaluateCloneForm, type CloneFormState } from "../../domain/cloneForm";
import type { DirectoryListingGateway } from "../../domain/directoryListing";

export interface CloneRepositoryFormModel {
  readonly url: string;
  readonly branch: string;
  readonly state: CloneFormState;
  setUrl(value: string): void;
  touchUrl(): void;
  setDestination(value: string): void;
  setBranch(value: string): void;
  chooseParent(parentPath: string): void;
}

export function useCloneRepositoryForm(input: Readonly<{
  initialUrl: string;
  home: string | null;
  shorthandHost: string | null;
  lastParent: string | null;
  directoryGateway: Pick<DirectoryListingGateway, "listDirectoryEntries"> | null;
  projectRootPaths: readonly string[];
}>): CloneRepositoryFormModel {
  const [url, setUrl] = useState(input.initialUrl);
  const [urlTouched, setUrlTouched] = useState(input.initialUrl.trim() !== "");
  const [destination, setDestinationValue] = useState("");
  const [destinationEdited, setDestinationEdited] = useState(false);
  const [branch, setBranch] = useState("");
  const formInput = { url, destination, destinationEdited, branch, urlTouched };
  const baseContext = {
    home: input.home,
    shorthandHost: input.shorthandHost,
    lastParent: input.lastParent,
  };
  const draft = evaluateCloneForm(formInput, { ...baseContext, probe: { kind: "unknown" } });
  const targetParent = draft.destinationTarget?.parentPath ?? null;
  const targetName = draft.destinationTarget?.name ?? null;
  const target = useMemo(
    () =>
      targetParent === null || targetName === null
        ? null
        : { parentPath: targetParent, name: targetName },
    [targetParent, targetName],
  );
  const probe = useCloneDestinationProbe(input.directoryGateway, target, input.projectRootPaths);
  const state = evaluateCloneForm(formInput, { ...baseContext, probe });
  return {
    url,
    branch,
    state,
    setUrl,
    touchUrl: () => setUrlTouched(true),
    setDestination(value: string) {
      setDestinationValue(value);
      setDestinationEdited(value.trim() !== "");
    },
    setBranch,
    chooseParent(parentPath: string) {
      const name = state.destinationTarget?.name ?? "repository";
      setDestinationValue(abbreviateHomePath(joinClonePath(parentPath, name), input.home));
      setDestinationEdited(true);
    },
  };
}
```

The `useMemo` keeps the probe target identity stable while its two strings are unchanged.

`src/components/projects/CloneRepositoryForm.tsx`:

```tsx
import { Folder, Monitor, TriangleAlert, Link2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { CloneFormRequest } from "../../domain/cloneForm";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { Button } from "../../ui/foundation/Button";
import { CommandFooter, CommandFooterHint, CommandInput, CommandSurface } from "../../ui/foundation/CommandList";
import { FieldFrame } from "../../ui/foundation/FieldFrame";
import { IconButton } from "../../ui/foundation/IconButton";
import { Kbd } from "../../ui/foundation/Kbd";
import { AgentAddProjectDialog } from "../agentMode/AgentAddProjectDialog";
import { RemoteAddProjectSourceGlyph } from "../agentMode/remoteAddProject/RemoteAddProjectSources";
import { useCloneRepositoryForm } from "./useCloneRepositoryForm";
import "./projects.css";

export interface CloneRepositoryFormProps {
  readonly initialUrl: string;
  readonly environmentLabel: string;
  readonly directoryGateway: DirectoryListingGateway;
  readonly home: string | null;
  readonly shorthandHost: string | null;
  readonly lastParentPath: string | null;
  readonly projectRootPaths: readonly string[];
  readonly busy: boolean;
  readonly error: string | null;
  onBack(): void;
  onClone(request: CloneFormRequest, source: Readonly<{ host: string; path: string }>): void;
  onOpenExisting(rootPath: string): void;
}

const DESTINATION_HINT = "The repository is cloned into this folder.";

export function CloneRepositoryForm(props: CloneRepositoryFormProps) {
  const form = useCloneRepositoryForm({
    initialUrl: props.initialUrl,
    home: props.home,
    shorthandHost: props.shorthandHost,
    lastParent: props.lastParentPath,
    directoryGateway: props.directoryGateway,
    projectRootPaths: props.projectRootPaths,
  });
  const [picking, setPicking] = useState(false);
  const destinationId = useId();
  const branchId = useId();
  const { state } = form;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    form.touchUrl();
    if (props.busy || state.request === null || state.source === null) return;
    props.onClone(state.request, state.source);
  };
  if (picking)
    return (
      <AgentAddProjectDialog
        gateway={props.directoryGateway}
        initialPath={state.destinationTarget?.parentPath ?? props.home}
        mode="selectDirectory"
        onAdd={(path) => {
          form.chooseParent(path);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
        onOpenExisting={() => undefined}
        projectRootPaths={[]}
      />
    );
  return (
    <CommandSurface label="Clone repository" onClose={props.onBack}>
      <form className="cv-clone-form" noValidate onSubmit={submit}>
        <CommandInput
          activeDescendantId={undefined}
          lead="back"
          listboxId={undefined}
          onBack={props.onBack}
          onChange={(value: string) => form.setUrl(value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") form.touchUrl();
          }}
          placeholder="Enter Git clone URL or owner/repo"
          trailing={
            <span className="cv-projects-environment cv-projects-environment--static">
              <Monitor aria-hidden="true" size={14} />
              {props.environmentLabel}
            </span>
          }
          value={form.url}
        />
        <div className="cv-clone-form__body">
          <div aria-live="polite" className="cv-clone-card" data-kind={state.repository.kind}>
            <span aria-hidden="true" className="cv-clone-card__icon">
              {state.repository.kind === "ok" ? (
                <RemoteAddProjectSourceGlyph kind={state.repository.glyph} />
              ) : state.repository.kind === "bad" ? (
                <TriangleAlert size={16} />
              ) : (
                <Link2 size={16} />
              )}
            </span>
            <span className="cv-clone-card__text">
              <span className="cv-clone-card__title">{state.repository.title}</span>
              <span className="cv-clone-card__detail">{state.repository.detail}</span>
            </span>
          </div>
          <div className="cv-clone-form__fields">
            <div>
              <FieldFrame
                error={state.destinationError ?? undefined}
                hint={state.destinationError === null ? DESTINATION_HINT : undefined}
                id={destinationId}
                label="Destination"
              >
                <div className="cv-clone-form__input" data-invalid={state.destinationError !== null}>
                  <input
                    aria-invalid={state.destinationError !== null}
                    autoComplete="off"
                    className="cv-clone-form__control"
                    disabled={props.busy}
                    id={destinationId}
                    maxLength={4162}
                    onChange={(event) => form.setDestination(event.currentTarget.value)}
                    placeholder="~/code/repository"
                    spellCheck={false}
                    value={state.destination}
                  />
                  <IconButton
                    disabled={props.busy}
                    icon={<Folder size={14} />}
                    label="Choose folder"
                    onClick={() => setPicking(true)}
                    size="xs"
                  />
                </div>
              </FieldFrame>
              {state.existingProjectRoot === null ? null : (
                <Button
                  onClick={() => props.onOpenExisting(state.existingProjectRoot as string)}
                  size="sm"
                  variant="ghost"
                >
                  Open existing
                </Button>
              )}
            </div>
            <FieldFrame error={state.branchError ?? undefined} id={branchId} label="Branch" optional>
              <div className="cv-clone-form__input" data-invalid={state.branchError !== null}>
                <input
                  aria-invalid={state.branchError !== null}
                  autoComplete="off"
                  className="cv-clone-form__control"
                  disabled={props.busy}
                  id={branchId}
                  maxLength={255}
                  onChange={(event) => form.setBranch(event.currentTarget.value)}
                  placeholder="Default branch"
                  spellCheck={false}
                  value={form.branch}
                />
              </div>
            </FieldFrame>
          </div>
          {props.error === null ? null : (
            <p className="cv-clone-form__error" role="alert">
              {props.error.slice(0, 500)}
            </p>
          )}
        </div>
        <CommandFooter>
          <CommandFooterHint keys={[<Kbd key="tab">Tab</Kbd>]} label="Next field" />
          <CommandFooterHint keys={[<Kbd key="esc">Esc</Kbd>]} label="Back" />
          <span className="cv-projects-footer-end">
            <Button disabled={props.busy || state.request === null} type="submit" variant="primary">
              {props.busy ? "Starting…" : "Clone"}
              <Kbd>↵</Kbd>
            </Button>
          </span>
        </CommandFooter>
      </form>
    </CommandSurface>
  );
}
```

If P5's `CommandInput` declares `activeDescendantId` / `listboxId` as required strings, pass `""` and omit the listbox attributes as P5 documents; do not add a listbox to this form. If its `onChange` receives the change event rather than the value, use `event.currentTarget.value` at the two call sites in this phase (here and in Task 13).

Append to `src/components/projects/projects.css`:

```css
.cv-projects-environment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--cv-r-control);
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  white-space: nowrap;
}

.cv-projects-environment:hover:not(.cv-projects-environment--static) {
  background: var(--cv-row-hover);
  color: var(--cv-fg-strong);
}

.cv-projects-footer-end {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.cv-clone-form__body {
  display: grid;
  gap: 14px;
  padding: 12px 16px 16px;
}

.cv-clone-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 10px;
  border-radius: var(--cv-r-card);
  background: var(--cv-tint-1);
  box-shadow: inset 0 0 0 1px var(--cv-hair);
}

.cv-clone-card__icon {
  display: grid;
  flex: none;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  background: var(--cv-tint-2);
  color: var(--cv-fg-strong);
}

.cv-clone-card__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.cv-clone-card__title {
  overflow: hidden;
  color: var(--cv-fg-strong);
  font-size: var(--cv-t-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-clone-card__detail {
  color: var(--cv-fg-subtle);
  font-size: var(--cv-t-xs);
}

.cv-clone-card[data-kind="empty"] .cv-clone-card__title {
  color: var(--cv-fg-muted);
  font-weight: 400;
}

.cv-clone-card[data-kind="bad"] .cv-clone-card__icon,
.cv-clone-card[data-kind="bad"] .cv-clone-card__title {
  color: var(--cv-danger);
}

.cv-clone-form__fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px;
  gap: 12px;
}

.cv-clone-form__input {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 3px 0 10px;
  border-radius: var(--cv-r-control);
  background: var(--cv-canvas);
  box-shadow: var(--cv-ring-hair-strong);
  transition: box-shadow var(--cv-motion-fast) var(--cv-ease);
}

.cv-clone-form__input:focus-within {
  box-shadow: var(--cv-ring-focus);
}

.cv-clone-form__input[data-invalid="true"] {
  box-shadow: var(--cv-ring-danger);
}

.cv-clone-form__control {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--cv-fg-strong);
  font: 12.5px var(--cv-font-mono);
  outline: none;
}

.cv-clone-form__control::placeholder {
  color: var(--cv-fg-subtle);
}

.cv-clone-form__error {
  margin: 0;
  color: var(--cv-danger);
  font-size: var(--cv-t-xs);
}

@media (prefers-reduced-motion: reduce) {
  .cv-clone-form__input {
    transition: none;
  }
}
```

(`--cv-ring-hair-strong`, `--cv-ring-focus`, `--cv-ring-danger` exist in `src/ui/tokens/semantic.css`; if one of them is a full `box-shadow` value list that already includes `inset`, use it as-is, which is what the P1 `TextField` does in `fields.css` - copy the exact declarations from `.cv-input`, `.cv-input:focus` and `.cv-input[aria-invalid="true"]` there if they differ.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/projects/CloneRepositoryForm.test.tsx && npm run check && npm run lint -- --max-warnings 0`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/useHomeDirectory.ts src/components/projects/useCloneRepositoryForm.ts src/components/projects/CloneRepositoryForm.tsx src/components/projects/CloneRepositoryForm.test.tsx src/components/projects/projects.css
git commit -m "feat(clone): one-step clone form with live validation"
```

### Task 13: Add project page (sources, recent folders F3, paste detection) and `project.add`

**Files:**
- Create: `src/components/projects/addProjectPaletteModel.ts` (+ `.test.ts`), `src/components/projects/EnvironmentControl.tsx`, `src/components/projects/AddProjectPalette.tsx` (+ `.test.tsx`)
- Modify: `src/components/projects/projects.css` (chip rules)
- Modify: `src/application/agentViewCommandBridge.ts`, `src/application/workbenchAgentCommands.ts`, `src/components/agentMode/useAgentViewCommands.ts` (+ their tests)
- Modify (hunk): `src/domain/keymap.ts` (one entry)

**Interfaces:**
- Consumes: Task 4 `looksLikeCloneSource`, Task 5 `abbreviateHomePath`/`expandHomePath`, Task 7 `RecentFolderEntry`/`recentFolderAge`, Task 11 `RepositoryHostStatuses`; P5 `CommandSurface`, `CommandInput`, `CommandPanel`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`, `CommandFooter`, `CommandFooterHint`, `useCommandListNavigation`; P1 `Menu`, `MenuItem`.
- Produces:

```ts
// addProjectPaletteModel.ts
export type AddProjectSourceId = "folder" | "gitUrl" | "github" | "gitlab" | "serverProject" | "serverClone";
export type AddProjectChip = Readonly<{ tone: "ok" | "warn"; label: string }>;
export type AddProjectPaletteItem =
  | Readonly<{ kind: "source"; key: string; id: AddProjectSourceId; title: string; description: string; shortcut: string | null; chip: AddProjectChip | null; disabledReason: string | null }>
  | Readonly<{ kind: "recent"; key: string; path: string; title: string; description: string; age: string | null }>
  | Readonly<{ kind: "openPath"; key: string; path: string; title: string; description: string }>
  | Readonly<{ kind: "cloneUrl"; key: string; url: string; title: string; description: string }>;
export type AddProjectPaletteGroup = Readonly<{ label: string; items: readonly AddProjectPaletteItem[] }>;
export function addProjectPaletteGroups(input: Readonly<{
  query: string;
  environment: "local" | "remote";
  hosts: RepositoryHostStatuses;
  recent: readonly RecentFolderEntry[];
  home: string | null;
  nowMs: number;
  cloneAvailable: boolean;
}>): readonly AddProjectPaletteGroup[];

// AddProjectPalette.tsx
export interface AddProjectPaletteProps {
  readonly servers: readonly RemoteRunnerServer[];
  readonly serverId: string | null;
  readonly hosts: RepositoryHostStatuses;
  readonly recent: readonly RecentFolderEntry[];
  readonly home: string | null;
  readonly cloneAvailable: boolean;
  readonly notice: string | null;
  onServerChange(serverId: string | null): void;
  onClose(): void;
  onOpenFolder(): void;
  onOpenPath(path: string): void;
  onCloneForm(url: string): void;
  onRepositoryPicker(provider: "github" | "gitlab"): void;
  onServerAction(serverId: string, action: "existing" | "clone"): void;
}

// agentViewCommandBridge.ts
AgentViewCommandId gains "project.add"; AgentViewCommandHandlers gains addProject?(): void; bridge gains addProjectAvailable(): boolean
```

- [ ] **Step 1: Write the failing tests**

`src/components/projects/addProjectPaletteModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addProjectPaletteGroups } from "./addProjectPaletteModel";

const base = {
  query: "",
  environment: "local" as const,
  hosts: { github: { kind: "ready" as const, host: "github.com" }, gitlab: { kind: "missing" as const } },
  recent: [
    { path: "/Users/dev/code/billing-worker", label: "billing-worker", openedAtMs: 1_000 },
    { path: "/Users/dev/archive/orders-api-v1", label: "orders-api-v1", openedAtMs: null },
  ],
  home: "/Users/dev",
  nowMs: 1_000 + 3 * 86_400_000,
  cloneAvailable: true,
};

describe("addProjectPaletteGroups", () => {
  it("lists sources and recent folders like the mockup", () => {
    const groups = addProjectPaletteGroups(base);
    expect(groups.map((group) => group.label)).toEqual(["Sources", "Recent"]);
    expect(groups[0].items).toEqual([
      { kind: "source", key: "source:folder", id: "folder", title: "Open folder", description: "Browse a folder on disk", shortcut: "⌘O", chip: null, disabledReason: null },
      { kind: "source", key: "source:gitUrl", id: "gitUrl", title: "Git URL", description: "Clone from an HTTPS or SSH URL", shortcut: null, chip: null, disabledReason: null },
      { kind: "source", key: "source:github", id: "github", title: "GitHub repository", description: "Clone owner/repo", shortcut: null, chip: { tone: "ok", label: "Connected" }, disabledReason: null },
      { kind: "source", key: "source:gitlab", id: "gitlab", title: "GitLab repository", description: "Clone group/project", shortcut: null, chip: { tone: "warn", label: "Setup required" }, disabledReason: "Install glab on This computer, then sign in." },
    ]);
    expect(groups[1].items).toEqual([
      { kind: "recent", key: "recent:/Users/dev/code/billing-worker", path: "/Users/dev/code/billing-worker", title: "billing-worker", description: "~/code/billing-worker", age: "3d" },
      { kind: "recent", key: "recent:/Users/dev/archive/orders-api-v1", path: "/Users/dev/archive/orders-api-v1", title: "orders-api-v1", description: "~/archive/orders-api-v1", age: null },
    ]);
  });

  it("filters by query and offers pasted URLs and paths first", () => {
    expect(addProjectPaletteGroups({ ...base, query: "git" })[0].items.map((item) => item.key)).toEqual([
      "source:gitUrl",
      "source:github",
      "source:gitlab",
    ]);
    const pasted = addProjectPaletteGroups({ ...base, query: "https://github.com/acme/web-dashboard" });
    expect(pasted[0]).toEqual({
      label: "Clone",
      items: [
        {
          kind: "cloneUrl",
          key: "clone:https://github.com/acme/web-dashboard",
          url: "https://github.com/acme/web-dashboard",
          title: "Clone repository",
          description: "https://github.com/acme/web-dashboard",
        },
      ],
    });
    const path = addProjectPaletteGroups({ ...base, query: "~/code/app" });
    expect(path[0].items[0]).toEqual({
      kind: "openPath",
      key: "path:/Users/dev/code/app",
      path: "/Users/dev/code/app",
      title: "Open ~/code/app",
      description: "Add this folder as a project",
    });
    expect(addProjectPaletteGroups({ ...base, query: "zzz" })).toEqual([]);
  });

  it("maps host states and missing clone support to disabled rows", () => {
    const signedOut = addProjectPaletteGroups({
      ...base,
      hosts: { github: { kind: "signedOut", host: "github.com" }, gitlab: { kind: "ready", host: "gitlab.com" } },
    })[0].items;
    expect(signedOut[2]).toMatchObject({ chip: { tone: "warn", label: "Sign in required" }, disabledReason: null });
    expect(signedOut[3]).toMatchObject({ chip: { tone: "ok", label: "Connected" }, disabledReason: null });
    const noClone = addProjectPaletteGroups({ ...base, cloneAvailable: false })[0].items;
    expect(noClone.slice(1).every((item) => item.kind === "source" && item.disabledReason === "Cloning is not available on this computer.")).toBe(true);
  });

  it("shows server sources and no recent folders for a server", () => {
    const groups = addProjectPaletteGroups({ ...base, environment: "remote" });
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.key)).toEqual(["source:serverProject", "source:serverClone"]);
  });
});
```

`src/components/projects/AddProjectPalette.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddProjectPalette, type AddProjectPaletteProps } from "./AddProjectPalette";

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddProjectPalette", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: AddProjectPaletteProps;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      servers: [],
      serverId: null,
      hosts: { github: { kind: "ready", host: "github.com" }, gitlab: { kind: "missing" } },
      recent: [{ path: "/Users/dev/code/billing-worker", label: "billing-worker", openedAtMs: null }],
      home: "/Users/dev",
      cloneAvailable: true,
      notice: null,
      onServerChange: vi.fn(),
      onClose: vi.fn(),
      onOpenFolder: vi.fn(),
      onOpenPath: vi.fn(),
      onCloneForm: vi.fn(),
      onRepositoryPicker: vi.fn(),
      onServerAction: vi.fn(),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function render(next: Partial<AddProjectPaletteProps> = {}) {
    props = { ...props, ...next };
    act(() => root.render(<AddProjectPalette {...props} />));
  }
  function input(): HTMLInputElement {
    const found = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search sources, or paste a path or Git URL"]',
    );
    expect(found).toBeInstanceOf(HTMLInputElement);
    return found as HTMLInputElement;
  }
  function option(text: string): HTMLElement {
    const found = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((item) =>
      item.textContent?.includes(text),
    );
    expect(found).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }

  it("opens each source and a recent folder", () => {
    render();
    act(() => option("Open folder").click());
    act(() => option("Git URL").click());
    act(() => option("GitHub repository").click());
    act(() => option("billing-worker").click());
    expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
    expect(props.onCloneForm).toHaveBeenCalledWith("");
    expect(props.onRepositoryPicker).toHaveBeenCalledWith("github");
    expect(props.onOpenPath).toHaveBeenCalledWith("/Users/dev/code/billing-worker");
  });

  it("does not run a disabled GitLab row and explains why", () => {
    render();
    const gitlab = option("GitLab repository");
    expect(gitlab.getAttribute("aria-disabled")).toBe("true");
    expect(gitlab.textContent).toContain("Setup required");
    act(() => gitlab.click());
    expect(props.onRepositoryPicker).not.toHaveBeenCalled();
  });

  it("jumps to the clone form when a Git URL is pasted", () => {
    render();
    act(() => typeInto(input(), "https://github.com/acme/web-dashboard"));
    expect(props.onCloneForm).toHaveBeenCalledWith("https://github.com/acme/web-dashboard");
  });

  it("opens the folder browser with Cmd+O and runs the highlighted row with Enter", () => {
    render();
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "o", metaKey: true, bubbles: true }));
    });
    expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(props.onCloneForm).toHaveBeenCalledWith("");
  });

  it("switches to server sources", () => {
    render({ servers: [{ id: "srv", name: "build-box", host: "10.0.0.2", username: "dev", port: 22, connected: true }], serverId: "srv" });
    act(() => option("Clone repository").click());
    expect(props.onServerAction).toHaveBeenCalledWith("srv", "clone");
    expect(document.body.textContent).not.toContain("billing-worker");
  });

  it("shows a capacity notice", () => {
    render({ notice: "You can keep up to 4 clones open. Finish or remove one before starting another." });
    expect(document.body.textContent).toContain("You can keep up to 4 clones open.");
  });
});
```

Append to the existing bridge / commands tests:

```ts
// src/application/agentViewCommandBridge.test.ts
it("dispatches project.add to the bound handler and reports availability", () => {
  const bridge = createAgentViewCommandBridge();
  expect(bridge.addProjectAvailable()).toBe(false);
  const addProject = vi.fn();
  const unbind = bridge.bind({ ...boundHandlers(), addProject });
  expect(bridge.addProjectAvailable()).toBe(true);
  bridge.run("project.add");
  expect(addProject).toHaveBeenCalledTimes(1);
  unbind();
  expect(bridge.addProjectAvailable()).toBe(false);
});

// src/application/workbenchAgentCommands.test.ts
it("registers project.add without requiring an open workspace", () => {
  const viewCommands = createAgentViewCommandBridge();
  const command = workbenchAgentCommands({ viewCommands }).find((entry) => entry.id === "project.add");
  expect(command).toMatchObject({ title: "Add Project…", category: "Workbench" });
  expect(command?.isEnabled({ hasWorkspace: false } as CommandContext)).toBe(false);
  viewCommands.bind({ ...boundHandlers(), addProject: vi.fn() });
  expect(command?.isEnabled({ hasWorkspace: false } as CommandContext)).toBe(true);
});
```

If these test files do not already have a `boundHandlers()` helper, add it in each file:

```ts
function boundHandlers(): AgentViewCommandHandlers {
  return {
    surfaceBlocked: () => false,
    newThread: vi.fn(),
    previousThread: vi.fn(),
    nextThread: vi.fn(),
    jumpToThread: vi.fn(),
    searchThreads: vi.fn(),
    findInThread: vi.fn(),
    threadSelected: () => false,
  };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/projects/addProjectPaletteModel.test.ts src/components/projects/AddProjectPalette.test.tsx src/application/agentViewCommandBridge.test.ts src/application/workbenchAgentCommands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the model**

`src/components/projects/addProjectPaletteModel.ts`:

```ts
import type { RepositoryHostStatus, RepositoryHostStatuses } from "../../application/useRepositoryHostStatus";
import { abbreviateHomePath, expandHomePath } from "../../domain/cloneDestination";
import { looksLikeCloneSource } from "../../domain/cloneRepositoryInput";
import { recentFolderAge, type RecentFolderEntry } from "../../domain/recentFolders";

export type AddProjectSourceId =
  | "folder"
  | "gitUrl"
  | "github"
  | "gitlab"
  | "serverProject"
  | "serverClone";
export type AddProjectChip = Readonly<{ tone: "ok" | "warn"; label: string }>;
export type AddProjectPaletteItem =
  | Readonly<{
      kind: "source";
      key: string;
      id: AddProjectSourceId;
      title: string;
      description: string;
      shortcut: string | null;
      chip: AddProjectChip | null;
      disabledReason: string | null;
    }>
  | Readonly<{ kind: "recent"; key: string; path: string; title: string; description: string; age: string | null }>
  | Readonly<{ kind: "openPath"; key: string; path: string; title: string; description: string }>
  | Readonly<{ kind: "cloneUrl"; key: string; url: string; title: string; description: string }>;
export type AddProjectPaletteGroup = Readonly<{ label: string; items: readonly AddProjectPaletteItem[] }>;

const NO_CLONE = "Cloning is not available on this computer.";
const CONNECTED: AddProjectChip = { tone: "ok", label: "Connected" };
const SIGN_IN: AddProjectChip = { tone: "warn", label: "Sign in required" };
const SETUP: AddProjectChip = { tone: "warn", label: "Setup required" };

export function addProjectPaletteGroups(
  input: Readonly<{
    query: string;
    environment: "local" | "remote";
    hosts: RepositoryHostStatuses;
    recent: readonly RecentFolderEntry[];
    home: string | null;
    nowMs: number;
    cloneAvailable: boolean;
  }>,
): readonly AddProjectPaletteGroup[] {
  const query = input.query.trim();
  const direct = directItem(query, input);
  if (direct !== null) return [direct];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item: AddProjectPaletteItem) =>
    tokens.every((token) => `${item.title} ${item.description}`.toLowerCase().includes(token));
  const sources = (input.environment === "remote" ? serverSources() : localSources(input)).filter(
    matches,
  );
  const recent =
    input.environment === "remote"
      ? []
      : input.recent
          .map(
            (entry): AddProjectPaletteItem => ({
              kind: "recent",
              key: `recent:${entry.path}`,
              path: entry.path,
              title: entry.label,
              description: abbreviateHomePath(entry.path, input.home),
              age: recentFolderAge(entry.openedAtMs, input.nowMs),
            }),
          )
          .filter(matches);
  return [
    ...(sources.length === 0 ? [] : [{ label: "Sources", items: sources }]),
    ...(recent.length === 0 ? [] : [{ label: "Recent", items: recent }]),
  ];
}

function directItem(
  query: string,
  input: Readonly<{ environment: "local" | "remote"; home: string | null; cloneAvailable: boolean }>,
): AddProjectPaletteGroup | null {
  if (input.environment !== "local") return null;
  if (input.cloneAvailable && looksLikeCloneSource(query))
    return {
      label: "Clone",
      items: [
        { kind: "cloneUrl", key: `clone:${query}`, url: query, title: "Clone repository", description: query },
      ],
    };
  if (!query.startsWith("/") && !query.startsWith("~")) return null;
  const path = expandHomePath(query, input.home);
  if (path === null) return null;
  return {
    label: "Folder",
    items: [
      {
        kind: "openPath",
        key: `path:${path}`,
        path,
        title: `Open ${abbreviateHomePath(path, input.home)}`,
        description: "Add this folder as a project",
      },
    ],
  };
}

function localSources(
  input: Readonly<{ hosts: RepositoryHostStatuses; cloneAvailable: boolean }>,
): AddProjectPaletteItem[] {
  const clone = (item: Omit<Extract<AddProjectPaletteItem, { kind: "source" }>, "kind" | "key">) =>
    source({ ...item, disabledReason: input.cloneAvailable ? item.disabledReason : NO_CLONE });
  return [
    source({ id: "folder", title: "Open folder", description: "Browse a folder on disk", shortcut: "⌘O", chip: null, disabledReason: null }),
    clone({ id: "gitUrl", title: "Git URL", description: "Clone from an HTTPS or SSH URL", shortcut: null, chip: null, disabledReason: null }),
    clone({ id: "github", title: "GitHub repository", description: "Clone owner/repo", shortcut: null, chip: githubChip(input.hosts.github), disabledReason: null }),
    clone({ id: "gitlab", title: "GitLab repository", description: "Clone group/project", shortcut: null, ...gitlabState(input.hosts.gitlab) }),
  ];
}

function serverSources(): AddProjectPaletteItem[] {
  return [
    source({ id: "serverProject", title: "Open server project", description: "Pick a folder on this server", shortcut: null, chip: null, disabledReason: null }),
    source({ id: "serverClone", title: "Clone repository", description: "Clone on this server", shortcut: null, chip: null, disabledReason: null }),
  ];
}

function source(item: Omit<Extract<AddProjectPaletteItem, { kind: "source" }>, "kind" | "key">): AddProjectPaletteItem {
  return { kind: "source", key: `source:${item.id}`, ...item };
}

function githubChip(status: RepositoryHostStatus): AddProjectChip | null {
  if (status.kind === "ready") return CONNECTED;
  if (status.kind === "signedOut") return SIGN_IN;
  return null;
}

function gitlabState(status: RepositoryHostStatus): Readonly<{ chip: AddProjectChip | null; disabledReason: string | null }> {
  switch (status.kind) {
    case "ready":
      return { chip: CONNECTED, disabledReason: null };
    case "signedOut":
      return { chip: SIGN_IN, disabledReason: "Run glab auth login on This computer." };
    case "missing":
      return { chip: SETUP, disabledReason: "Install glab on This computer, then sign in." };
    case "checking":
      return { chip: null, disabledReason: "Checking GitLab…" };
    case "unavailable":
      return { chip: null, disabledReason: "GitLab is not available right now." };
    default:
      return unsupportedStatus(status);
  }
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported repository host status: ${JSON.stringify(status)}.`);
}
```

The source list keeps the key order the test expects: `{ kind, key, id, title, description, shortcut, chip, disabledReason }` (the test uses `toEqual`, so key order does not matter; values do).

- [ ] **Step 4: Implement the environment control and the page**

`src/components/projects/EnvironmentControl.tsx`:

```tsx
import { ChevronDown, Monitor, Server } from "lucide-react";
import { useRef, useState } from "react";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";

export interface EnvironmentControlProps {
  readonly servers: readonly RemoteRunnerServer[];
  readonly serverId: string | null;
  onChange(serverId: string | null): void;
}

export function EnvironmentControl({ onChange, serverId, servers }: EnvironmentControlProps) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = servers.find((server) => server.id === serverId) ?? null;
  const label = selected?.name ?? "This computer";
  const icon = selected === null ? <Monitor aria-hidden="true" size={14} /> : <Server aria-hidden="true" size={14} />;
  if (servers.length === 0)
    return (
      <span className="cv-projects-environment cv-projects-environment--static">
        {icon}
        {label}
      </span>
    );
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="cv-projects-environment"
        onClick={() => setOpen((current) => !current)}
        ref={anchor}
        title="Where the project lives"
        type="button"
      >
        {icon}
        {label}
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      <Menu anchorRef={anchor} label="Project environment" onClose={() => setOpen(false)} open={open} placement="bottom-end">
        <MenuItem checked={serverId === null} icon={<Monitor size={14} />} onSelect={() => onChange(null)}>
          This computer
        </MenuItem>
        {servers.map((server) => (
          <MenuItem
            checked={server.id === serverId}
            icon={<Server size={14} />}
            key={server.id}
            onSelect={() => onChange(server.id)}
          >
            {server.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
```

(If `PopoverPlacement` has no `"bottom-end"`, use the closest end-aligned placement it exports.)

`src/components/projects/AddProjectPalette.tsx`:

```tsx
import { FolderOpen, FolderPlus, History, Link2 } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { RepositoryHostStatuses } from "../../application/useRepositoryHostStatus";
import type { RecentFolderEntry } from "../../domain/recentFolders";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSurface,
  useCommandListNavigation,
} from "../../ui/foundation/CommandList";
import { Kbd } from "../../ui/foundation/Kbd";
import { RemoteAddProjectSourceGlyph } from "../agentMode/remoteAddProject/RemoteAddProjectSources";
import {
  addProjectPaletteGroups,
  type AddProjectPaletteItem,
  type AddProjectSourceId,
} from "./addProjectPaletteModel";
import { EnvironmentControl } from "./EnvironmentControl";
import "./projects.css";

export interface AddProjectPaletteProps {
  readonly servers: readonly RemoteRunnerServer[];
  readonly serverId: string | null;
  readonly hosts: RepositoryHostStatuses;
  readonly recent: readonly RecentFolderEntry[];
  readonly home: string | null;
  readonly cloneAvailable: boolean;
  readonly notice: string | null;
  onServerChange(serverId: string | null): void;
  onClose(): void;
  onOpenFolder(): void;
  onOpenPath(path: string): void;
  onCloneForm(url: string): void;
  onRepositoryPicker(provider: "github" | "gitlab"): void;
  onServerAction(serverId: string, action: "existing" | "clone"): void;
}

export function AddProjectPalette(props: AddProjectPaletteProps) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [nowMs] = useState(() => Date.now());
  const previousLength = useRef(0);
  const groups = useMemo(
    () =>
      addProjectPaletteGroups({
        query,
        environment: props.serverId === null ? "local" : "remote",
        hosts: props.hosts,
        recent: props.recent,
        home: props.home,
        nowMs,
        cloneAvailable: props.cloneAvailable,
      }),
    [nowMs, props.cloneAvailable, props.home, props.hosts, props.recent, props.serverId, query],
  );
  const items = groups.flatMap((group) => group.items);
  const select = (item: AddProjectPaletteItem | undefined) => {
    if (item === undefined) return;
    switch (item.kind) {
      case "recent":
      case "openPath":
        props.onOpenPath(item.path);
        return;
      case "cloneUrl":
        props.onCloneForm(item.url);
        return;
      case "source":
        if (item.disabledReason !== null) return;
        runSource(item.id, props);
        return;
      default:
        unsupportedItem(item);
    }
  };
  const navigation = useCommandListNavigation({
    count: items.length,
    onExecute: (index: number) => select(items[index]),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.metaKey && event.key.toLowerCase() === "o" && props.serverId === null) {
      event.preventDefault();
      props.onOpenFolder();
      return;
    }
    navigation.handleKeyDown(event);
  };
  const onChange = (value: string) => {
    const jumped = value.length - previousLength.current > 1;
    previousLength.current = value.length;
    setQuery(value);
    const direct = addProjectPaletteGroups({
      query: value,
      environment: props.serverId === null ? "local" : "remote",
      hosts: props.hosts,
      recent: [],
      home: props.home,
      nowMs,
      cloneAvailable: props.cloneAvailable,
    })[0]?.items[0];
    if (jumped && direct?.kind === "cloneUrl") props.onCloneForm(direct.url);
  };
  let index = -1;
  return (
    <CommandSurface label="Add project" onClose={props.onClose}>
      <CommandInput
        activeDescendantId={items.length === 0 ? undefined : `${listboxId}-${navigation.activeIndex}`}
        lead="search"
        leadIcon={<FolderPlus aria-hidden="true" size={16} />}
        listboxId={listboxId}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Search sources, or paste a path or Git URL"
        trailing={
          <EnvironmentControl onChange={props.onServerChange} serverId={props.serverId} servers={props.servers} />
        }
        value={query}
      />
      <CommandPanel>
        {items.length === 0 ? (
          <CommandEmpty>No matching sources.</CommandEmpty>
        ) : (
          <CommandList id={listboxId} label="Sources">
            {groups.map((group) => (
              <CommandGroup key={group.label} label={group.label}>
                {group.items.map((item) => {
                  index += 1;
                  const position = index;
                  return (
                    <CommandItem
                      active={navigation.activeIndex === position}
                      description={item.description}
                      disabled={item.kind === "source" && item.disabledReason !== null}
                      icon={itemIcon(item)}
                      id={`${listboxId}-${position}`}
                      key={item.key}
                      onHover={() => navigation.setActiveIndex(position)}
                      onSelect={() => select(item)}
                      shortcut={item.kind === "source" ? (item.shortcut ?? undefined) : undefined}
                      timestamp={item.kind === "recent" ? (item.age ?? undefined) : undefined}
                      title={item.title}
                      trailing={itemTrailing(item)}
                    />
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        )}
        {props.notice === null ? null : (
          <p className="cv-projects-notice" role="status">
            {props.notice}
          </p>
        )}
      </CommandPanel>
      <CommandFooter>
        <CommandFooterHint keys={[<Kbd key="up">↑</Kbd>, <Kbd key="down">↓</Kbd>]} label="Navigate" />
        <CommandFooterHint keys={[<Kbd key="enter">Enter</Kbd>]} label="Select" />
        <CommandFooterHint keys={[<Kbd key="esc">Esc</Kbd>]} label="Close" />
      </CommandFooter>
    </CommandSurface>
  );
}

function runSource(id: AddProjectSourceId, props: AddProjectPaletteProps): void {
  switch (id) {
    case "folder":
      props.onOpenFolder();
      return;
    case "gitUrl":
      props.onCloneForm("");
      return;
    case "github":
      if (props.hosts.github.kind === "ready") props.onRepositoryPicker("github");
      else props.onCloneForm("");
      return;
    case "gitlab":
      props.onRepositoryPicker("gitlab");
      return;
    case "serverProject":
      if (props.serverId !== null) props.onServerAction(props.serverId, "existing");
      return;
    case "serverClone":
      if (props.serverId !== null) props.onServerAction(props.serverId, "clone");
      return;
    default:
      unsupportedSource(id);
  }
}

function unsupportedSource(id: never): never {
  throw new TypeError(`Unsupported add project source: ${String(id)}.`);
}

function itemIcon(item: AddProjectPaletteItem) {
  if (item.kind === "recent") return <History aria-hidden="true" size={16} />;
  if (item.kind === "openPath") return <FolderOpen aria-hidden="true" size={16} />;
  if (item.kind === "cloneUrl") return <Link2 aria-hidden="true" size={16} />;
  if (item.id === "github" || item.id === "gitlab") return <RemoteAddProjectSourceGlyph kind={item.id} />;
  if (item.id === "gitUrl" || item.id === "serverClone") return <RemoteAddProjectSourceGlyph kind="gitUrl" />;
  return <FolderOpen aria-hidden="true" size={16} />;
}

function itemTrailing(item: AddProjectPaletteItem) {
  if (item.kind !== "source" || item.chip === null) return undefined;
  return (
    <span className="cv-projects-chip" data-tone={item.chip.tone} title={item.disabledReason ?? undefined}>
      {item.chip.label}
    </span>
  );
}

function unsupportedItem(item: never): never {
  throw new TypeError(`Unsupported add project item: ${JSON.stringify(item)}.`);
}
```

P5's `CommandItem` renders the disabled state with `aria-disabled="true"` and does not call `onSelect` when `disabled` (per the agreed API); the extra guard in `select` keeps Enter on a disabled row inert too. If P5's `CommandItem` has no `title` attribute passthrough for the disabled reason, the chip's `title` carries it (mockup behavior).

Append to `projects.css`:

```css
.cv-projects-chip {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: var(--cv-t-2xs);
  font-weight: 500;
}

.cv-projects-chip[data-tone="ok"] {
  color: var(--cv-ok);
}

.cv-projects-chip[data-tone="warn"] {
  background: var(--cv-warn-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cv-warn) 35%, transparent);
  color: var(--cv-warn);
}

.cv-projects-notice {
  margin: 4px 8px 8px;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
}
```

- [ ] **Step 5: Register `project.add`**

`src/domain/keymap.ts` - append after the `agent.openCommitMenu` entry:

```ts
  {
    category: "Workbench",
    defaultShortcut: "",
    id: "project.add",
    label: "Add Project…",
  },
```

`src/application/agentViewCommandBridge.ts`:
- add `| "project.add"` to `AgentViewCommandId`;
- add `addProject?(): void;` to `AgentViewCommandHandlers`;
- add `addProjectAvailable(): boolean;` to `AgentViewCommandBridge` and `addProjectAvailable: () => current?.addProject !== undefined,` to the returned object;
- add to `dispatch` before `default`:

```ts
    case "project.add":
      handlers.addProject?.();
      return;
```

`src/components/agentMode/useAgentViewCommands.ts`: add `addProject: () => ref.current.addProject?.(),` to the bound handlers.

`src/application/workbenchAgentCommands.ts`: add to the returned list after `viewCommand("agent.openCommitMenu", …)`:

```ts
    {
      id: "project.add",
      title: "Add Project…",
      category: "Workbench",
      shortcut: shortcut?.("project.add"),
      isEnabled: () => viewCommands.addProjectAvailable(),
      run: () => viewCommands.run("project.add"),
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/projects src/application/agentViewCommandBridge.test.ts src/application/workbenchAgentCommands.test.ts src/domain/keymap.test.ts && npm run check && npm run lint -- --max-warnings 0`
Expected: PASS (if `keymap.test.ts` snapshots the command count, bump it by one).

- [ ] **Step 7: Commit**

```bash
git add src/components/projects/addProjectPaletteModel.ts src/components/projects/addProjectPaletteModel.test.ts src/components/projects/EnvironmentControl.tsx src/components/projects/AddProjectPalette.tsx src/components/projects/AddProjectPalette.test.tsx src/components/projects/projects.css src/application/agentViewCommandBridge.ts src/application/agentViewCommandBridge.test.ts src/application/workbenchAgentCommands.ts src/application/workbenchAgentCommands.test.ts src/components/agentMode/useAgentViewCommands.ts src/domain/keymap.ts
git commit -m "feat(projects): add project page with sources, recent folders and project.add command"
```

### Task 14: `ProjectOnboardingLayer` - one mount point for every add-project surface

**Files:**
- Create: `src/components/projects/ProjectOnboardingLayer.tsx` (+ `.test.tsx`)
- Create (move): `src/components/projects/AgentExistingServerProjectDialog.tsx` - the `AgentExistingServerProjectDialog` function moved verbatim from `AgentProjectSourceDialog.tsx`, with its imports (`FolderOpen`, `../agentMode/remoteAddProject/remoteAddProject.css`)
- Delete: `src/components/agentMode/AgentProjectSourceDialog.tsx`, `AgentProjectSourceDialog.test.tsx`, `AgentLocalCloneDialog.tsx`, `AgentLocalCloneDialog.test.tsx`, `agentLocalCloneDialog.css`
- Modify (hunks a, c): `src/components/agentMode/AgentModeView.tsx`
- Modify (selectors only): `src/components/agentMode/AgentWorkbenchScreen.test.tsx`, `src/components/agentMode/AgentModeView.test.tsx`, `src/components/agentMode/AgentModeView.remoteClone.test.tsx`, `src/components/agentMode/AgentComposerAttachments.test.tsx`

**Interfaces:**
- Consumes: Tasks 11-13; `useAgentProjectCreation` return value; `AgentAddProjectDialog`, `AgentRemoteAddProjectDialog`, `ProjectRepositoryPicker`.
- Produces:

```ts
export type ProjectOnboardingCreation = Pick<
  ReturnType<typeof useAgentProjectCreation>,
  | "entryOpen" | "open" | "closeEntry" | "choose" | "capacityError" | "pendingClones"
  | "localDialogOpen" | "closeLocal" | "local"
  | "existingServerProjects" | "closeExisting" | "selectExisting"
  | "remoteAdd" | "addProject"
>;
export interface ProjectOnboardingLayerProps {
  readonly creation: ProjectOnboardingCreation;
  readonly chrome: AgentWorkbenchAddProjectChrome | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly selectedServerId: string | null;
  readonly lookupGateway: RepositoryLookupGateway | null;
}
export function ProjectOnboardingLayer(props: ProjectOnboardingLayerProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

`src/components/projects/ProjectOnboardingLayer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import type { AgentWorkbenchAddProjectChrome } from "../agentMode/agentWorkbenchChrome";
import { ProjectOnboardingLayer, type ProjectOnboardingCreation } from "./ProjectOnboardingLayer";

function directoryGateway(): DirectoryListingGateway {
  return {
    listDirectoryEntries: vi.fn(async ({ path }) => ({
      path: path ?? "/Users/dev",
      parent: "/",
      entries: [],
      truncated: false,
    })),
    revealDirectory: vi.fn(async () => undefined),
  };
}

function creationFixture(overrides: Partial<ProjectOnboardingCreation> = {}): ProjectOnboardingCreation {
  return {
    entryOpen: true,
    open: vi.fn(),
    closeEntry: vi.fn(),
    choose: vi.fn(),
    capacityError: null,
    pendingClones: [],
    localDialogOpen: false,
    closeLocal: vi.fn(),
    local: { start: vi.fn(), busy: false, error: null } as unknown as ProjectOnboardingCreation["local"],
    existingServerProjects: null,
    closeExisting: vi.fn(),
    selectExisting: vi.fn(),
    remoteAdd: { open: false, close: vi.fn() } as unknown as ProjectOnboardingCreation["remoteAdd"],
    addProject: {
      open: false,
      projectRootPaths: [],
      openDialog: vi.fn(),
      closeDialog: vi.fn(),
      addProject: vi.fn(),
      reportNotice: vi.fn(),
    },
    ...overrides,
  };
}

function chromeFixture(): AgentWorkbenchAddProjectChrome {
  return {
    gateway: directoryGateway(),
    cloneGateway: { start: vi.fn(), get: vi.fn(), cancel: vi.fn() },
    cloneDestination: { lastParentPath: null, remember: vi.fn() },
    recentFolders: [{ path: "/Users/dev/code/billing-worker", label: "billing-worker", openedAtMs: null }],
    addProject: vi.fn(),
  };
}

describe("ProjectOnboardingLayer", () => {
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
  function option(text: string): HTMLElement {
    const found = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((item) =>
      item.textContent?.includes(text),
    );
    expect(found).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }

  it("routes sources to the existing creation flows", async () => {
    const creation = creationFixture();
    await act(async () =>
      root.render(
        <ProjectOnboardingLayer chrome={chromeFixture()} creation={creation} lookupGateway={null} selectedServerId={null} servers={[]} />,
      ),
    );
    act(() => option("Open folder").click());
    expect(creation.choose).toHaveBeenCalledWith(null, "existing");
    act(() => option("Git URL").click());
    expect(creation.choose).toHaveBeenCalledWith(null, "clone");
    act(() => option("billing-worker").click());
    expect(creation.closeEntry).toHaveBeenCalled();
    expect(creation.addProject.addProject).toHaveBeenCalledWith("/Users/dev/code/billing-worker");
  });

  it("renders the clone form for the reserved lane and remembers the parent on clone", async () => {
    const chrome = chromeFixture();
    const creation = creationFixture({ entryOpen: false, localDialogOpen: true });
    await act(async () =>
      root.render(
        <ProjectOnboardingLayer chrome={chrome} creation={creation} lookupGateway={null} selectedServerId={null} servers={[]} />,
      ),
    );
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Enter Git clone URL or owner/repo"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "https://github.com/acme/web-dashboard");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    act(() => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    expect(chrome.cloneDestination?.remember).toHaveBeenCalledWith("/Users/dev/code");
    expect(creation.local.start).toHaveBeenCalledWith({
      url: "https://github.com/acme/web-dashboard",
      name: "web-dashboard",
      parentPath: "/Users/dev/code",
      ensureParent: true,
    });
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    act(() => back?.click());
    expect(creation.closeLocal).toHaveBeenCalled();
    expect(creation.open).toHaveBeenCalled();
  });

  it("shows the capacity notice and blocks clone sources at four pending clones", async () => {
    const creation = creationFixture({
      pendingClones: Array.from({ length: 4 }, (_, index) => ({
        id: `${index}:c`,
        name: `c${index}`,
        environment: "local",
        status: "running",
        error: null,
      })) as unknown as ProjectOnboardingCreation["pendingClones"],
    });
    await act(async () =>
      root.render(
        <ProjectOnboardingLayer chrome={chromeFixture()} creation={creation} lookupGateway={null} selectedServerId={null} servers={[]} />,
      ),
    );
    expect(document.body.textContent).toContain(
      "You can keep up to 4 clones open. Finish or remove one before starting another.",
    );
    expect(option("Git URL").getAttribute("aria-disabled")).toBe("true");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/projects/ProjectOnboardingLayer.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the layer**

`src/components/projects/ProjectOnboardingLayer.tsx`:

```tsx
import { useState } from "react";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import { useHomeDirectory } from "../../application/useHomeDirectory";
import { useRepositoryHostStatus } from "../../application/useRepositoryHostStatus";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { AgentAddProjectDialog } from "../agentMode/AgentAddProjectDialog";
import { MAX_PENDING_PROJECT_CLONES } from "../agentMode/agentProjectCreationSession";
import type { AgentWorkbenchAddProjectChrome } from "../agentMode/agentWorkbenchChrome";
import { ProjectRepositoryPicker } from "../agentMode/ProjectRepositoryPicker";
import { AgentRemoteAddProjectDialog } from "../agentMode/remoteAddProject/AgentRemoteAddProjectDialog";
import type { useAgentProjectCreation } from "../agentMode/useAgentProjectCreation";
import "../agentMode/remoteAddProject/remoteAddProject.css";
import { AddProjectPalette } from "./AddProjectPalette";
import { AgentExistingServerProjectDialog } from "./AgentExistingServerProjectDialog";
import { CloneRepositoryForm } from "./CloneRepositoryForm";

export type ProjectOnboardingCreation = Pick<
  ReturnType<typeof useAgentProjectCreation>,
  | "entryOpen"
  | "open"
  | "closeEntry"
  | "choose"
  | "capacityError"
  | "pendingClones"
  | "localDialogOpen"
  | "closeLocal"
  | "local"
  | "existingServerProjects"
  | "closeExisting"
  | "selectExisting"
  | "remoteAdd"
  | "addProject"
>;

export interface ProjectOnboardingLayerProps {
  readonly creation: ProjectOnboardingCreation;
  readonly chrome: AgentWorkbenchAddProjectChrome | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly selectedServerId: string | null;
  readonly lookupGateway: RepositoryLookupGateway | null;
}

const CAPACITY_NOTICE = `You can keep up to ${MAX_PENDING_PROJECT_CLONES} clones open. Finish or remove one before starting another.`;
const NO_RECENT: readonly never[] = [];

export function ProjectOnboardingLayer({
  chrome,
  creation,
  lookupGateway,
  selectedServerId,
  servers,
}: ProjectOnboardingLayerProps) {
  const [serverId, setServerId] = useState(selectedServerId);
  const [cloneSeed, setCloneSeed] = useState("");
  const [picker, setPicker] = useState<"github" | "gitlab" | null>(null);
  const home = useHomeDirectory(chrome?.gateway ?? null);
  const hosts = useRepositoryHostStatus(
    lookupGateway,
    creation.entryOpen || creation.localDialogOpen || picker !== null,
  );
  const atCapacity = creation.pendingClones.length >= MAX_PENDING_PROJECT_CLONES;
  const cloneAvailable = chrome?.cloneGateway != null && !atCapacity;
  const shorthandHost =
    hosts.github.kind === "ready" || hosts.github.kind === "signedOut" ? hosts.github.host : "github.com";
  const openCloneForm = (url: string) => {
    setCloneSeed(url);
    creation.choose(null, "clone");
  };
  return (
    <>
      {creation.entryOpen && (
        <AddProjectPalette
          cloneAvailable={cloneAvailable}
          home={home}
          hosts={hosts}
          notice={creation.capacityError ?? (atCapacity ? CAPACITY_NOTICE : null)}
          onClose={creation.closeEntry}
          onCloneForm={openCloneForm}
          onOpenFolder={() => creation.choose(null, "existing")}
          onOpenPath={(path) => {
            creation.closeEntry();
            creation.addProject.addProject(path);
          }}
          onRepositoryPicker={(provider) => {
            creation.closeEntry();
            setPicker(provider);
          }}
          onServerAction={(id, action) => creation.choose(id, action)}
          onServerChange={setServerId}
          recent={chrome?.recentFolders ?? NO_RECENT}
          serverId={serverId}
          servers={servers}
        />
      )}
      {picker !== null && (
        <div className="palette-backdrop" onMouseDown={() => setPicker(null)} role="presentation">
          <section
            aria-label="Choose repository"
            className="quick-open agent-remote-add-project agent-local-clone"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <ProjectRepositoryPicker
              environmentLabel="This computer"
              gateway={lookupGateway}
              initialProvider={picker}
              onBack={() => {
                setPicker(null);
                creation.open();
              }}
              onChoose={(repository) => {
                const url = repository.sshUrl ?? repository.httpsUrl;
                if (url === null) return;
                setPicker(null);
                openCloneForm(url);
              }}
              onUseUrl={() => {
                setPicker(null);
                openCloneForm("");
              }}
            />
          </section>
        </div>
      )}
      {creation.localDialogOpen && chrome !== null && (
        <CloneRepositoryForm
          busy={creation.local.busy}
          directoryGateway={chrome.gateway}
          environmentLabel="This computer"
          error={creation.local.error}
          home={home}
          initialUrl={cloneSeed}
          key={cloneSeed}
          lastParentPath={chrome.cloneDestination?.lastParentPath ?? null}
          onBack={() => {
            creation.closeLocal();
            creation.open();
          }}
          onClone={(request) => {
            chrome.cloneDestination?.remember(request.parentPath);
            creation.local.start(request);
          }}
          onOpenExisting={(rootPath) => {
            creation.closeLocal();
            creation.addProject.addProject(rootPath);
          }}
          projectRootPaths={creation.addProject.projectRootPaths}
          shorthandHost={shorthandHost}
        />
      )}
      {creation.existingServerProjects !== null && (
        <AgentExistingServerProjectDialog
          onClose={creation.closeExisting}
          onSelect={creation.selectExisting}
          projects={creation.existingServerProjects}
        />
      )}
      <AgentRemoteAddProjectDialog controller={creation.remoteAdd} onClose={creation.remoteAdd.close} />
      {creation.addProject.open && chrome !== null && (
        <AgentAddProjectDialog
          gateway={chrome.gateway}
          onAdd={creation.addProject.addProject}
          onClose={creation.addProject.closeDialog}
          onNotice={creation.addProject.reportNotice}
          onOpenExisting={creation.addProject.addProject}
          projectRootPaths={creation.addProject.projectRootPaths}
        />
      )}
    </>
  );
}
```

`creation.local.start` is `async`; the form handler ignores its promise because `useLocalProjectClone.start` owns its own error state (`creation.local.error`), which the form shows. `addProject.addProject(path)` defaults to trust mode `"auto"`, so explicitly opened folders keep today's auto-admission (decision 8).

- [ ] **Step 4: Replace the dialog block in `AgentModeView.tsx`**

(a) Replace the four JSX blocks from `{creation.entryOpen && (` through the closing of `{addProject.open && chrome.addProject !== null && ( … )}` (currently `AgentModeView.tsx:1090-1127`: `AgentProjectSourceDialog`, `AgentExistingServerProjectDialog`, `AgentLocalCloneDialog`, `AgentRemoteAddProjectDialog`, `AgentAddProjectDialog`) with:

```tsx
        <ProjectOnboardingLayer
          chrome={chrome.addProject}
          creation={creation}
          lookupGateway={remoteContext?.repositoryLookup ?? null}
          selectedServerId={selectedServerId}
          servers={remoteContext?.servers ?? NO_REMOTE_SERVERS}
        />
```

Remove the now-unused imports (`AgentProjectSourceDialog`, `AgentExistingServerProjectDialog`, `AgentLocalCloneDialog`, `AgentAddProjectDialog`, `AgentRemoteAddProjectDialog`) and import `ProjectOnboardingLayer` from `../projects/ProjectOnboardingLayer`.

(c) `project.add` handler. Before `const commandHandlers = useMemo<AgentViewCommandHandlers>(`, add
`const openAddProjectRef = useRef<() => void>(() => undefined);`, add `addProject: () => openAddProjectRef.current(),` inside the `commandHandlers` object, and right after `const openAddProject = useAgentLatestCallback(creation.open);` add:

```tsx
  useLayoutEffect(() => {
    openAddProjectRef.current = openAddProject;
  }, [openAddProject]);
```

(`useRef` / `useLayoutEffect` are imported from `react` if not already.)

- [ ] **Step 5: Update integration test selectors**

Apply this mapping in `AgentWorkbenchScreen.test.tsx`, `AgentModeView.test.tsx`, `AgentModeView.remoteClone.test.tsx`, `AgentComposerAttachments.test.tsx` (behavior assertions stay the same):

| Old interaction | New interaction |
|---|---|
| button "Open existing folder" in the source dialog | `[role="option"]` whose text includes "Open folder" |
| button "Clone repository" in the local source dialog | `[role="option"]` whose text includes "Git URL" |
| URL step: type into `placeholder="https://github.com/owner/repository.git"`, click "Continue", then confirm "Clone repository" | type into `input[placeholder="Enter Git clone URL or owner/repo"]`; type the test's absolute destination into the field labelled "Destination"; click `button[type="submit"]` ("Clone") |
| server environment picked in the source dialog (`[role="menuitemradio"]` "Linux server") then button "Clone repository" | open the environment control (`button[title="Where the project lives"]`), pick the `MenuItem` "Linux server", then `[role="option"]` "Clone repository" (server sources) |
| `.agent-remote-project-choice__add` | unchanged (Task 16 keeps the class) |
| `button[aria-label="Close clone draft"]` | unchanged (Task 15 keeps a Hide control with that label) |

Run: `npx vitest run src/components/agentMode/AgentWorkbenchScreen.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/agentMode/AgentModeView.remoteClone.test.tsx src/components/agentMode/AgentComposerAttachments.test.tsx src/components/projects`
Expected: PASS.

- [ ] **Step 6: Delete the replaced files and verify nothing imports them**

```bash
git rm src/components/agentMode/AgentProjectSourceDialog.tsx src/components/agentMode/AgentProjectSourceDialog.test.tsx src/components/agentMode/AgentLocalCloneDialog.tsx src/components/agentMode/AgentLocalCloneDialog.test.tsx src/components/agentMode/agentLocalCloneDialog.css
grep -rn "AgentProjectSourceDialog\|AgentLocalCloneDialog\|agentLocalCloneDialog.css" src || echo "no references"
```

Expected: `no references`. The `.agent-local-clone` class is still used by the picker wrapper in the layer; its rules live in `remoteAddProject.css` / `projectRepositoryPicker.css` - check with `grep -rn "agent-local-clone" src --include='*.css'`; if the only rules were in the deleted `agentLocalCloneDialog.css`, copy the `.agent-local-clone` width rule into `projects.css` as `.agent-local-clone { width: 576px; }`.

- [ ] **Step 7: Run checks and commit**

Run: `npm run check && npm run lint -- --max-warnings 0 && npm run size:hotspots`
Expected: PASS; `AgentModeView.tsx` shrinks.

```bash
git add src/components/projects/ProjectOnboardingLayer.tsx src/components/projects/ProjectOnboardingLayer.test.tsx src/components/projects/AgentExistingServerProjectDialog.tsx src/components/agentMode/AgentModeView.tsx src/components/agentMode/AgentWorkbenchScreen.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/agentMode/AgentModeView.remoteClone.test.tsx src/components/agentMode/AgentComposerAttachments.test.tsx src/components/projects/projects.css
git commit -m "feat(projects): route add project, clone and server flows through one onboarding layer"
```

### Task 15: Clone progress banner, trust banner and the clone composer

**Files:**
- Create: `src/components/projects/cloneBannerModel.ts` (+ `.test.ts`), `src/components/projects/CloneProgressBanner.tsx`, `src/components/projects/ProjectTrustBanner.tsx` (+ `CloneBanners.test.tsx`)
- Modify: `src/components/agentMode/AgentCloneComposer.tsx` (+ `.test.tsx`)
- Modify (hunk): `src/components/agentMode/AgentModeView.tsx` - pass `onTrustProject={trustProject}` to `AgentCloneComposer`
- Delete: `src/components/agentMode/AgentCloneDraftPanel.tsx`, `AgentCloneDraftPanel.test.tsx`, `agentCloneDraftPanel.css`
- Modify: `src/components/projects/projects.css` (banner section)

**Interfaces:**
- Consumes: Task 6 presentation helpers; Task 11 `localCloneDetail`; P3 `AgentComposerProps.banners?: ReactNode`, `AgentComposerProps.placeholder?: string`; P1 `ComposerBanner`, `Button`, `IconButton`.
- Produces:

```ts
export type CloneBannerModel =
  | Readonly<{ kind: "running"; title: string; summary: string; percent: number | null }>
  | Readonly<{ kind: "preparing"; title: string }>
  | Readonly<{ kind: "failed"; title: string; detail: CloneFailureDetail; retryable: boolean }>
  | Readonly<{ kind: "cancelled"; title: string; detail: CloneFailureDetail; retryable: boolean }>
  | Readonly<{ kind: "none" }>;
export function cloneBannerModel(input: Readonly<{
  status: string;
  name: string;
  error: string | null;
  environment: "local" | "remote";
  projectReady: boolean;
  canRetry: boolean;
  detail: Readonly<{ progress: LocalCloneProgress | null; failure: LocalCloneFailure | null; source: RepositoryIdentity | null }> | null;
}>): CloneBannerModel;
export function clonePlaceholder(model: CloneBannerModel): string | undefined;

export function CloneProgressBanner(props: { model: CloneBannerModel; onCancel(): void; onRetry(): void; onRemove(): void; onHide(): void }): JSX.Element | null;
export function ProjectTrustBanner(props: { onReview(): void }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

`src/components/projects/cloneBannerModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cloneBannerModel, clonePlaceholder } from "./cloneBannerModel";

const source = { host: "github.com", path: "acme/web-dashboard" };
const base = {
  status: "running",
  name: "web-dashboard",
  error: null,
  environment: "local" as const,
  projectReady: false,
  canRetry: true,
  detail: { progress: { phase: "receiving" as const, percent: 50, receivedBytes: null, bytesPerSecond: null }, failure: null, source },
};

describe("cloneBannerModel", () => {
  it("shows running progress with the repository path", () => {
    const model = cloneBannerModel(base);
    expect(model).toEqual({
      kind: "running",
      title: "Cloning acme/web-dashboard",
      summary: "Receiving objects · 50%",
      percent: 45,
    });
    expect(clonePlaceholder(model)).toBe(
      "Write your first message. Sending unlocks when the clone finishes.",
    );
  });

  it("uses typed failure copy and keeps the message", () => {
    const model = cloneBannerModel({
      ...base,
      status: "failed",
      error: "Cloning failed.",
      detail: { progress: null, failure: "authentication", source },
    });
    expect(model).toEqual({
      kind: "failed",
      title: "Could not clone acme/web-dashboard",
      detail: {
        text: "Authentication failed for github.com. Run",
        command: "gh auth login",
        tail: "in a terminal, or use an SSH URL.",
      },
      retryable: true,
    });
    expect(clonePlaceholder(model)).toBe("Your message is kept. Retry to finish cloning.");
  });

  it("covers cancelled, preparing, ready and server clones", () => {
    expect(cloneBannerModel({ ...base, status: "cancelled", detail: { ...base.detail, progress: null } })).toMatchObject({
      kind: "cancelled",
      title: "Cancelled cloning acme/web-dashboard",
      detail: { text: "Retry to bring in the repository.", command: null, tail: "" },
    });
    expect(cloneBannerModel({ ...base, status: "succeeded" })).toEqual({
      kind: "preparing",
      title: "Preparing web-dashboard",
    });
    expect(cloneBannerModel({ ...base, status: "succeeded", projectReady: true })).toEqual({ kind: "none" });
    expect(
      cloneBannerModel({ ...base, environment: "remote", status: "queued", detail: null }),
    ).toEqual({ kind: "running", title: "Cloning web-dashboard", summary: "Working on the server", percent: null });
    expect(
      cloneBannerModel({ ...base, environment: "remote", status: "failed", error: "x".repeat(400), detail: null }),
    ).toMatchObject({ kind: "failed", detail: { text: "x".repeat(300) } });
  });
});
```

`src/components/projects/CloneBanners.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloneProgressBanner } from "./CloneProgressBanner";
import { ProjectTrustBanner } from "./ProjectTrustBanner";

describe("clone banners", () => {
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
  const handlers = () => ({ onCancel: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onHide: vi.fn() });
  function button(label: string) {
    return Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label,
    );
  }

  it("renders progress with an accessible track and cancels", () => {
    const actions = handlers();
    act(() =>
      root.render(
        <CloneProgressBanner
          model={{ kind: "running", title: "Cloning acme/web", summary: "Receiving objects · 45%", percent: 41 }}
          {...actions}
        />,
      ),
    );
    expect(host.textContent).toContain("Cloning acme/web");
    expect(host.textContent).toContain("Receiving objects · 45%");
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("41");
    act(() => button("Cancel")?.click());
    expect(actions.onCancel).toHaveBeenCalledTimes(1);
    expect(button("Retry")).toBeUndefined();
  });

  it("renders failure copy with the command and offers remove and retry", () => {
    const actions = handlers();
    act(() =>
      root.render(
        <CloneProgressBanner
          model={{
            kind: "failed",
            title: "Could not clone acme/web",
            detail: { text: "Authentication failed for github.com. Run", command: "gh auth login", tail: "in a terminal, or use an SSH URL." },
            retryable: true,
          }}
          {...actions}
        />,
      ),
    );
    expect(host.querySelector("code")?.textContent).toBe("gh auth login");
    act(() => button("Remove project")?.click());
    act(() => button("Retry")?.click());
    act(() => button("Close clone draft")?.click());
    expect(actions.onRemove).toHaveBeenCalledTimes(1);
    expect(actions.onRetry).toHaveBeenCalledTimes(1);
    expect(actions.onHide).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when there is no clone state to show", () => {
    act(() => root.render(<CloneProgressBanner model={{ kind: "none" }} {...handlers()} />));
    expect(host.innerHTML).toBe("");
  });

  it("asks to review trust", () => {
    const onReview = vi.fn();
    act(() => root.render(<ProjectTrustBanner onReview={onReview} />));
    expect(host.textContent).toContain("Not trusted yet");
    expect(host.textContent).toContain("Agents start here once you trust this project");
    act(() => button("Review")?.click());
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
```

Append to `src/components/agentMode/AgentCloneComposer.test.tsx` (add `localCloneDetail: null` to the `creation` fixture and `onTrustProject: vi.fn()` to `props`):

```tsx
  it("shows the trust banner for an untrusted clone and opens the dialog instead of sending", async () => {
    const untrusted = { ...project, trust: "untrusted" as const };
    props = {
      ...props,
      projects: [untrusted],
      creation: {
        ...props.creation,
        pending: { ...props.creation.pending!, target: { kind: "local", path: untrusted.rootPath } },
        pendingClone: { ...props.creation.pendingClone!, status: "succeeded" },
        completedProject: untrusted,
        localCloneDetail: { progress: null, failure: null, source: { host: "github.com", path: "acme/app" } },
      },
    };
    await render();
    expect(host.textContent).toContain("Not trusted yet");
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
    expect(props.onTrustProject).toHaveBeenCalledWith(untrusted.rootKey, {
      kind: "clone",
      host: "github.com",
      path: "acme/app",
    });
    expect(props.agents.startThread).not.toHaveBeenCalled();
  });

  it("shows clone progress above the composer while cloning", async () => {
    props = {
      ...props,
      creation: {
        ...props.creation,
        localCloneDetail: {
          progress: { phase: "receiving", percent: 10, receivedBytes: null, bytesPerSecond: null },
          failure: null,
          source: { host: "github.com", path: "acme/app" },
        },
      },
    };
    await render();
    expect(host.textContent).toContain("Cloning acme/app");
    expect(host.textContent).toContain("Receiving objects · 10%");
    expect(host.querySelector('[aria-label="Clone app"]')).toBeNull();
  });
```

(`send()` in this file selects `.agent-composer__send`; if P3 renamed the send button class, use P3's `SubmitButton` selector `button[aria-label="Send message"]` instead. Remove assertions in older tests of this file that referenced `AgentCloneDraftPanel` copy - "Cloning app", "Cancel clone", "Retry clone", "Dismiss clone" - and replace them with the new copy: "Cloning app" stays valid for a clone without a source, "Cancel", "Retry", "Remove project".)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/projects/cloneBannerModel.test.ts src/components/projects/CloneBanners.test.tsx src/components/agentMode/AgentCloneComposer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the model and banners**

`src/components/projects/cloneBannerModel.ts`:

```ts
import {
  cloneFailureDetail,
  cloneProgressSummary,
  overallClonePercent,
  type CloneFailureDetail,
} from "../../domain/cloneStatusPresentation";
import type { LocalCloneFailure, LocalCloneProgress } from "../../domain/localProjectClone";
import type { RepositoryIdentity } from "../../domain/repositoryCloneUrl";

export type CloneBannerModel =
  | Readonly<{ kind: "running"; title: string; summary: string; percent: number | null }>
  | Readonly<{ kind: "preparing"; title: string }>
  | Readonly<{ kind: "failed"; title: string; detail: CloneFailureDetail; retryable: boolean }>
  | Readonly<{ kind: "cancelled"; title: string; detail: CloneFailureDetail; retryable: boolean }>
  | Readonly<{ kind: "none" }>;

const RUNNING = new Set(["pending", "queued", "running", "cloning"]);
const COMPLETE = new Set(["completed", "succeeded"]);
const CANCELLED = new Set(["canceled", "cancelled"]);
const MAX_REMOTE_ERROR_CHARS = 300;

export function cloneBannerModel(
  input: Readonly<{
    status: string;
    name: string;
    error: string | null;
    environment: "local" | "remote";
    projectReady: boolean;
    canRetry: boolean;
    detail: Readonly<{
      progress: LocalCloneProgress | null;
      failure: LocalCloneFailure | null;
      source: RepositoryIdentity | null;
    }> | null;
  }>,
): CloneBannerModel {
  const repository = input.detail?.source?.path ?? input.name;
  if (COMPLETE.has(input.status))
    return input.projectReady ? { kind: "none" } : { kind: "preparing", title: `Preparing ${input.name}` };
  if (RUNNING.has(input.status))
    return input.environment === "local"
      ? {
          kind: "running",
          title: `Cloning ${repository}`,
          summary: cloneProgressSummary(input.detail?.progress ?? null),
          percent:
            input.detail?.progress == null ? null : overallClonePercent(input.detail.progress),
        }
      : { kind: "running", title: `Cloning ${repository}`, summary: "Working on the server", percent: null };
  if (CANCELLED.has(input.status))
    return {
      kind: "cancelled",
      title: `Cancelled cloning ${repository}`,
      detail: { text: "Retry to bring in the repository.", command: null, tail: "" },
      retryable: input.canRetry,
    };
  return {
    kind: "failed",
    title: `Could not clone ${repository}`,
    detail:
      input.environment === "local" && input.detail?.failure != null
        ? cloneFailureDetail(input.detail.failure, input.detail.source?.host ?? null)
        : {
            text: (input.error ?? "Cloning stopped. Retry to finish cloning.").slice(0, MAX_REMOTE_ERROR_CHARS),
            command: null,
            tail: "",
          },
    retryable: input.canRetry,
  };
}

export function clonePlaceholder(model: CloneBannerModel): string | undefined {
  switch (model.kind) {
    case "running":
    case "preparing":
      return "Write your first message. Sending unlocks when the clone finishes.";
    case "failed":
    case "cancelled":
      return "Your message is kept. Retry to finish cloning.";
    case "none":
      return undefined;
    default:
      return unsupportedModel(model);
  }
}

function unsupportedModel(model: never): never {
  throw new TypeError(`Unsupported clone banner: ${JSON.stringify(model)}.`);
}
```

`src/components/projects/CloneProgressBanner.tsx`:

```tsx
import { Download, TriangleAlert, X } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { IconButton } from "../../ui/foundation/IconButton";
import type { CloneBannerModel } from "./cloneBannerModel";
import "./projects.css";

export interface CloneProgressBannerProps {
  readonly model: CloneBannerModel;
  onCancel(): void;
  onRetry(): void;
  onRemove(): void;
  onHide(): void;
}

export function CloneProgressBanner({ model, onCancel, onHide, onRemove, onRetry }: CloneProgressBannerProps) {
  const hide = <IconButton icon={<X size={12} />} label="Close clone draft" onClick={onHide} size="xs" title="Hide" />;
  switch (model.kind) {
    case "none":
      return null;
    case "preparing":
      return (
        <ComposerBanner actions={hide} tone="working">
          <span className="cv-clone-banner__line">
            <strong>{model.title}</strong>
          </span>
        </ComposerBanner>
      );
    case "running":
      return (
        <ComposerBanner
          actions={
            <>
              {model.percent === null ? null : (
                <span
                  aria-label="Clone progress"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={model.percent}
                  className="cv-clone-banner__track"
                  role="progressbar"
                >
                  <span style={{ width: `${model.percent}%` }} />
                </span>
              )}
              <Button onClick={onCancel} size="sm" variant="ghost">
                Cancel
              </Button>
              {hide}
            </>
          }
          tone="working"
        >
          <span className="cv-clone-banner__line">
            <strong>{model.title}</strong>
            <span>{model.summary}</span>
          </span>
        </ComposerBanner>
      );
    case "failed":
    case "cancelled":
      return (
        <ComposerBanner
          actions={
            <>
              <Button onClick={onRemove} size="sm" variant="ghost">
                Remove project
              </Button>
              {model.retryable ? (
                <Button onClick={onRetry} size="sm" variant="ghost">
                  Retry
                </Button>
              ) : null}
              {hide}
            </>
          }
          icon={
            model.kind === "failed" ? (
              <span className="cv-clone-banner__icon--danger">
                <TriangleAlert size={14} />
              </span>
            ) : (
              <Download size={14} />
            )
          }
        >
          <span className="cv-clone-banner__stack">
            <strong>{model.title}</strong>
            <span>
              {model.detail.text}
              {model.detail.command === null ? null : (
                <>
                  {" "}
                  <code>{model.detail.command}</code> {model.detail.tail}
                </>
              )}
            </span>
          </span>
        </ComposerBanner>
      );
    default:
      return unsupportedBanner(model);
  }
}

function unsupportedBanner(model: never): never {
  throw new TypeError(`Unsupported clone banner: ${JSON.stringify(model)}.`);
}
```

`src/components/projects/ProjectTrustBanner.tsx`:

```tsx
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import "./projects.css";

export function ProjectTrustBanner({ onReview }: { onReview(): void }) {
  return (
    <ComposerBanner
      actions={
        <Button onClick={onReview} size="sm" variant="ghost">
          Review
          <ChevronRight aria-hidden="true" size={12} />
        </Button>
      }
      icon={<ShieldCheck size={14} />}
    >
      <span className="cv-clone-banner__line">
        <strong>Not trusted yet</strong>
        <span>Agents start here once you trust this project</span>
      </span>
    </ComposerBanner>
  );
}
```

Append to `projects.css`:

```css
.cv-clone-banner__line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}

.cv-clone-banner__line > span:last-child {
  overflow: hidden;
  color: var(--cv-fg-muted);
  text-overflow: ellipsis;
}

.cv-clone-banner__stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.cv-clone-banner__stack > span {
  color: var(--cv-fg-muted);
}

.cv-clone-banner__stack code {
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-mono);
  font-size: 11.5px;
}

.cv-clone-banner__line strong,
.cv-clone-banner__stack strong {
  color: var(--cv-fg-strong);
  font-weight: 500;
}

.cv-clone-banner__icon--danger {
  display: inline-grid;
  color: var(--cv-danger);
}

.cv-clone-banner__track {
  display: block;
  flex: none;
  width: 72px;
  height: 3px;
  margin: 0 6px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--cv-tint-3);
}

.cv-clone-banner__track > span {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--cv-accent);
  transition: width 0.25s linear;
}

@media (prefers-reduced-motion: reduce) {
  .cv-clone-banner__track > span {
    transition: none;
  }
}
```

- [ ] **Step 4: Rewire `AgentCloneComposer.tsx`**

1. Replace the `AgentCloneDraftPanel` import with `CloneProgressBanner`, `ProjectTrustBanner`, `cloneBannerModel`, `clonePlaceholder` imports, and add `"localCloneDetail"` to the `creation` `Pick` list.
2. Add the prop `onTrustProject(projectRootKey: string, origin?: WorkspaceTrustOrigin): void;` to `Props`.
3. After `const project = stableProject.current;` add:

```tsx
  const bannerModel = cloneBannerModel({
    status: clone.status,
    name: pending.name,
    error: creation.error ?? clone.error,
    environment: pending.environment === null ? "local" : "remote",
    projectReady: project !== null,
    canRetry: creation.canRetry,
    detail: creation.localCloneDetail,
  });
  const source = creation.localCloneDetail?.source ?? null;
  const awaitingTrust = project !== null && project.trust !== "trusted";
  const reviewTrust = () => {
    if (project === null) return;
    onTrustProject(
      project.rootKey,
      source === null ? { kind: "local" } : { kind: "clone", host: source.host, path: source.path },
    );
  };
```

4. In `submit`, add as the first line: `if (awaitingTrust) { reviewTrust(); return; }`.
5. Compute `const draftEmpty = creation.draft.trim() === "" && attachments.drafts.every((draft) => draft.state !== "ready");` and pass `submitBlocked={awaitingTrust ? draftEmpty : blocked}`.
6. Delete the `<div className="agent-clone-draft__spacer" />` and `<AgentCloneDraftPanel … />` elements and pass to `AgentComposer`:

```tsx
        banners={
          awaitingTrust ? (
            <ProjectTrustBanner onReview={reviewTrust} />
          ) : (
            <CloneProgressBanner
              model={bannerModel}
              onCancel={creation.cancel}
              onHide={creation.hidePending}
              onRemove={creation.dismiss}
              onRetry={creation.retry}
            />
          )
        }
        placeholder={clonePlaceholder(bannerModel)}
```

7. In `AgentModeView.tsx` pass `onTrustProject={trustProject}` to `<AgentCloneComposer … />`.

- [ ] **Step 5: Delete the old panel**

```bash
git rm src/components/agentMode/AgentCloneDraftPanel.tsx src/components/agentMode/AgentCloneDraftPanel.test.tsx src/components/agentMode/agentCloneDraftPanel.css
grep -rn "AgentCloneDraftPanel\|agent-clone-draft" src || echo "no references"
```

Expected: `no references` (if `agent-clone-draft__spacer` / `.agent-clone-composer` layout rules live in another CSS file, remove the spacer rule there; keep `.agent-clone-composer` if P3 still uses it for the column layout).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/projects src/components/agentMode/AgentCloneComposer.test.tsx src/components/agentMode/AgentModeView.remoteClone.test.tsx src/components/agentMode/AgentWorkbenchScreen.test.tsx && npm run check && npm run lint -- --max-warnings 0`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/projects src/components/agentMode/AgentCloneComposer.tsx src/components/agentMode/AgentCloneComposer.test.tsx src/components/agentMode/AgentModeView.tsx
git commit -m "feat(clone): clone progress and trust banners attached to the composer"
```

### Task 16: First-run hero and server project chooser

**Files:**
- Create: `src/components/projects/NoProjectsHero.tsx` (+ `.test.tsx`)
- Modify: `src/components/agentMode/AgentRemoteDraftProjectChooser.tsx`, `agentRemoteDraftProjectChooser.css` (+ `.test.tsx` only if copy assertions change)
- Modify: `src/components/projects/projects.css` (hero section)
- Modify (hunk b): `src/components/agentMode/AgentModeView.tsx` center ternary

**Interfaces:**
- Produces: `NoProjectsHero({ onAddProject }: { onAddProject(): void })`.

- [ ] **Step 1: Write the failing test**

`src/components/projects/NoProjectsHero.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { NoProjectsHero } from "./NoProjectsHero";

describe("NoProjectsHero", () => {
  it("renders the t3code first-run copy and opens add project", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onAddProject = vi.fn();
    act(() => root.render(<NoProjectsHero onAddProject={onAddProject} />));
    expect(host.querySelector("h1")?.textContent).toBe("What should we work on?");
    expect(host.textContent).toContain("Add a project to start your first thread.");
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "Add project");
    act(() => button?.click());
    expect(onAddProject).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    host.remove();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/projects/NoProjectsHero.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/components/projects/NoProjectsHero.tsx`:

```tsx
import { Plus } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import "./projects.css";

export function NoProjectsHero({ onAddProject }: { onAddProject(): void }) {
  return (
    <section aria-label="No projects" className="cv-no-projects">
      <h1 className="cv-no-projects__title">What should we work on?</h1>
      <p className="cv-no-projects__text">Add a project to start your first thread.</p>
      <Button icon={<Plus size={14} />} onClick={onAddProject} variant="primary">
        Add project
      </Button>
    </section>
  );
}
```

Append to `projects.css`:

```css
.cv-no-projects {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 32px 96px;
  text-align: center;
}

.cv-no-projects__title {
  margin: 0;
  color: var(--cv-fg-strong);
  font-family: var(--cv-font-display);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 36px;
}

.cv-no-projects__text {
  margin: 4px 0 24px;
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-sm);
}
```

`AgentRemoteDraftProjectChooser.tsx`: keep props, `section[aria-label="Choose server project"]`, the `<select>`, the `.agent-remote-project-choice__add` class and every copy string (tests depend on them); replace the heading/body classes with `cv-no-projects__title` / `cv-no-projects__text`, render the add action as `<Button className="agent-remote-project-choice__add" icon={<Plus size={14} />} onClick={onAddProject} variant="primary">Add project or clone repository</Button>` and the settings link as `<Button onClick={onOpenSettings} size="sm" variant="ghost">Manage server projects</Button>`, and add `cv-no-projects` to the section class list. Replace `agentRemoteDraftProjectChooser.css` with token-only rules:

```css
.agent-remote-project-choice {
  gap: 12px;
}

.agent-remote-project-choice label {
  color: var(--cv-fg-muted);
  font-size: var(--cv-t-xs);
  font-weight: 500;
}

.agent-remote-project-choice select {
  width: min(360px, 100%);
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--cv-r-control);
  background: var(--cv-canvas);
  box-shadow: var(--cv-ring-hair-strong);
  color: var(--cv-fg-strong);
  font: inherit;
  font-size: var(--cv-t-sm);
}

.agent-remote-project-choice select:focus-visible {
  box-shadow: var(--cv-ring-focus);
  outline: none;
}
```

(b) In `AgentModeView.tsx` make the NoProjectsHero the first branch of the center ternary that currently starts with `{creation.visible && creation.pending !== null && creation.pendingClone !== null ? (`:

```tsx
              {projects.length === 0 &&
              creation.pendingClones.length === 0 &&
              selectedServerId === null &&
              selectedThreadId === null ? (
                <NoProjectsHero onAddProject={openAddProject} />
              ) : creation.visible && creation.pending !== null && creation.pendingClone !== null ? (
```

(import `NoProjectsHero` from `../projects/NoProjectsHero`). `AgentThreadHeader` above it keeps rendering; the mockup's first-run top bar is empty because there is no project or thread to show, which the header already handles when `project` and `thread` are null.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/projects/NoProjectsHero.test.tsx src/components/agentMode/AgentRemoteDraftProjectChooser.test.tsx src/components/agentMode/AgentModeView.test.tsx src/components/agentMode/AgentModeView.remoteClone.test.tsx && npm run check && npm run lint -- --max-warnings 0 && npm run size:hotspots`
Expected: PASS. If an `AgentModeView.test.tsx` case renders with zero projects and expects the regular empty thread, give that fixture one project (the case is about the empty thread, not first run) or assert the hero instead when the test is about first run.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects/NoProjectsHero.tsx src/components/projects/NoProjectsHero.test.tsx src/components/projects/projects.css src/components/agentMode/AgentRemoteDraftProjectChooser.tsx src/components/agentMode/agentRemoteDraftProjectChooser.css src/components/agentMode/AgentModeView.tsx src/components/agentMode/AgentModeView.test.tsx
git commit -m "feat(projects): first-run hero and restyled server project chooser"
```

### Task 17: Full repository gates

**Files:** none (fixes go back to the owning task).

- [ ] **Step 1: Free the Node inspector port (repo memory: orphaned node on 9229 breaks watch tests)**

Run: `lsof -ti tcp:9229 | xargs -r kill`
Expected: exit 0.

- [ ] **Step 2: Run the TypeScript gates**

```bash
set -o pipefail
npm run check
npm run lint -- --max-warnings 0
npm run lint:exhaustive-deps
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run
```

Expected: every command exits 0 (check `$?`, never a piped tail - repo memory). `npm run build` is required by the project CLAUDE.md gate list and also produces nothing that gets committed. If `format:check:changed` fails, run `npx prettier --write <each file this phase owns>` - never on a directory. If `size:hotspots` fails for `AgentModeView.tsx` or `AgentWorkbenchScreen.tsx`, extract instead of raising the baseline.

- [ ] **Step 3: Run the Rust gates**

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

- [ ] **Step 4: Coverage and whitespace**

Run: `npm run test:coverage && git diff --check && git status --porcelain`
Expected: coverage thresholds pass; no whitespace errors; `git status` lists only files from the Ownership section plus files owned by other phases or by the user (leave those unstaged).

### Task 18: Independent read-only review (Opus 5.5)

**Files:** none.

- [ ] **Step 1: Dispatch the reviewer**

Dispatch a fresh general-purpose agent with `model: "opus"` (read-only; no edits, no state-changing git, no coderabbit) with this prompt:

```text
You are an independent, read-only reviewer for phase P8 (projects, clone, onboarding, trust) of the Codevo redesign in /Users/matusmockor/Developer/editor. Do not edit files, do not run git commands that change state, do not run coderabbit. Read CLAUDE.md, the spec docs/superpowers/specs/2026-09-23-codevo-redesign-design.md (3.1.10, 3.3 F3-F6, 4, 6), the mockup docs/redesign/v3-projects-clone.html and the plan docs/superpowers/plans/2026-09-24-redesign-p8-projects-clone.md, then review the P8 commits (`git log --oneline` since the commit before Task 1) and any uncommitted P8 changes.

Report P0 (security, data loss, wrong behaviour), P1 (spec / CLAUDE.md violation, missing test for a risky path), P2 (quality) with file:line, a concrete failing scenario and the fix. Verify every claim in code first.

Focus on:
1. Trust authority: no path grants trust without an explicit dialog decision (workbench toggle, BottomPanel Trust buttons, agent "Trust project…", cloned projects); revocation still works; the Rust set_workspace_trust / grant_opened_project_trust / launch reservation behaviour is unchanged; auto-admission is skipped exactly once for a cloned path and never for a folder the user opened; A -> B -> A during the dialog cannot trust the wrong owner or generation.
2. Clone contract: TS and Rust wire shapes match (progress only while running, failure exactly when failed, ensureParent only literal true); unknown keys and enum values fail closed on both sides; stderr is never forwarded to the UI.
3. Rust: progress reader bounds (line length, diagnostics ring, 64 KiB retention), classification order, prepare_parent creates at most one directory, only directly under canonical HOME, never follows a symlinked HOME child into a new directory creation, never holds a registry mutex across process or filesystem work; job snapshot lock scope in publish_progress.
4. Clone form: credential URLs never enable Clone; default ~/code/<name>, remembered parent, ensureParent only for ~/code; existing folder / existing project detection; destination probe cannot publish stale answers; retry re-sends branch and ensureParent.
5. Add project page: keyboard (arrows, Enter, Esc, Cmd+O), disabled rows inert, paste detection does not trigger on typed text, server environment keeps existing remote flows, capacity notice at 4 pending clones.
6. Banners: running / failed / cancelled / preparing / trust states match the mockup copy; untrusted clone sends open the dialog and keep the draft; no raw error text for local failures.
7. Layering and hotspots: no business logic added to AgentModeView/AgentWorkbenchScreen beyond wiring; App.tsx and lib.rs untouched; new modules small; tokens only (no colour literals); prefers-reduced-motion honoured.
8. Anything contradicting the plan's Ownership section (edits to files owned by P2-P6 or P9 beyond the listed hunks).

End with a verdict: SHIP, SHIP AFTER FIXES (list), or DO NOT SHIP.
```

- [ ] **Step 2: Triage**

Verify each P0/P1 finding in code before acting (repo memory: audits over-report). Fix real ones through a scoped implementer task on the owning files, rerun that task's focused tests and Task 17, and re-dispatch the reviewer on the fix diff. Record rejected findings with a one-line reason for the final report.

### Task 19: QA build and Codex computer-use QA

**Files:** `~/tmp/codevo-qa/qa_prompt_p8.txt` (scratch, deleted at the end).

- [ ] **Step 1: Build and open the QA app**

```bash
npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'
open "src-tauri/target/debug/bundle/macos/Codevo QA.app"
osascript -e 'tell application "Codevo QA" to activate'
```

Expected: `src-tauri/target/debug/bundle/macos/Codevo QA.app` exists and a "Codevo QA" window is frontmost. Exit code 1 caused only by the missing updater signing key is acceptable; a compile error is not.

- [ ] **Step 2: Prepare a first-run state for the QA bundle only**

The QA bundle has its own identifier, so its settings are separate from the owner's app. In Codevo QA close every open project tab (project menu > Close project) before starting the tester so the first-run state is visible. Do not touch "Codevo Editor".

- [ ] **Step 3: Write the QA prompt**

```bash
mkdir -p ~/tmp/codevo-qa && cat > ~/tmp/codevo-qa/qa_prompt_p8.txt <<'QA'
You are a UI QA tester with Computer Use. First action: take a screenshot. If Computer Use is unavailable, reply only COMPUTER_USE_UNAVAILABLE and stop.

Rules:
- ATTACH ONLY to the already running app window "Codevo QA" (bundle id dev.mockor.editor.qa). Never launch, open, quit or restart any app. Never interact with "Codevo Editor" or any other app.
- Before EVERY screenshot, bring "Codevo QA" to the front (activate it) and make sure its window is frontmost.
- Do not edit files, do not change macOS settings, do not run shell commands except to save screenshots.
- Only clone the public repository https://github.com/octocat/Hello-World (small). Never type credentials or tokens.

Steps (record worked/failed and a screenshot path for every step):
1. First run: the main area shows "What should we work on?", "Add a project to start your first thread." and an "Add project" button; the sidebar shows "No projects yet".
2. Click "Add project". A palette opens with the input "Search sources, or paste a path or Git URL", a "This computer" control, a "Sources" group (Open folder with ⌘O, Git URL, GitHub repository, GitLab repository with a chip) and, if any exist, a "Recent" group with relative ages. Use ArrowDown/ArrowUp to move the highlight; Esc closes the palette.
3. Open Cmd+K, type "add project", run "Add Project…": the same palette opens.
4. In the palette type "git": only the Git URL / GitHub / GitLab rows remain. Clear it.
5. Paste https://github.com/octocat/Hello-World into the palette input: the clone form opens with that URL, a repository card "octocat/Hello-World" / "github.com · HTTPS", Destination "~/code/Hello-World" (or ~/<last parent>/Hello-World) and an empty optional Branch field; the Clone button is enabled.
6. In the URL field type https://token@github.com/octocat/Hello-World: the card says "A URL carrying credentials is rejected" and Clone is disabled. Put the plain URL back.
7. Type "bad..name" in Branch: "Not a valid branch name." appears and Clone is disabled. Clear Branch.
8. Click Clone. The palette closes; above the composer a banner shows "Cloning octocat/Hello-World", a phase summary with a percentage and a thin progress track, and a Cancel button; the composer placeholder says sending unlocks when the clone finishes; the sidebar shows the project with a "Cloning" state.
9. Wait for the clone to finish. The banner changes to "Not trusted yet · Agents start here once you trust this project" with "Review". Type a short message and press Send: a dialog "Trust Hello-World?" opens with the path, "Cloned from github.com/octocat/Hello-World", three bullet lines and buttons "Not now" / "Trust project". Press "Not now": the dialog closes, the message is still in the composer.
10. Click "Review", then "Trust project": the dialog closes, the trust banner disappears and Send is available. Do not send.
11. Add project again, choose Git URL, enter https://github.com/octocat/Hello-World again: Destination shows an error that the folder is already a project (or already exists) and Clone is disabled; if "Open existing" is shown, click it and confirm the existing project is selected.
12. Add project, Git URL, enter https://github.com/octocat/this-repo-does-not-exist-codevo, Clone. When it fails, the banner shows "Could not clone octocat/this-repo-does-not-exist-codevo" with an actionable explanation (authentication or not found) and "Remove project" / "Retry". Click "Remove project": the banner disappears.
13. Open the sidebar project filter (folder icon next to search): Hello-World is listed next to "All projects"; selecting it filters the thread list; select "All projects" again.
14. Repeat step 2 and step 9's dialog screenshot in Light appearance (Settings > Appearance > Light, Graphite · Teal) and in Zinc · Orange Dark; report unreadable or low-contrast text.

Final report format:
- One line per step: "Step N: worked" or "Step N: failed - <what you saw>", with the screenshot path.
- A list of every visual difference from a calm, minimal t3code-like UI you noticed (misalignment, wrapping, clipped text, low contrast).
QA
```

- [ ] **Step 4: Run the tester and wait for the report**

Run (background, 45 minute cap inside the orchestrator): `python3 ~/tmp/codevo-qa/qa_orchestrator_v2.py ~/tmp/codevo-qa/qa_prompt_p8.txt > /tmp/qa-p8.log 2>&1`
Expected: the log ends with the tester's report. If the permission classifier blocks the run, ask the owner to run the same command with the `!` prefix, or to paste the prompt file into their own interactive Codex session (which runs inside the GUI session) and paste the report back. Watch only final or error lines (`COMPUTER_USE_UNAVAILABLE`, `TIMEOUT`, `ERROR`, final message).

- [ ] **Step 5: Fix loop**

For each failure: confirm the root cause in code, fix it in the owning task's files through a scoped implementer, rerun that task's focused tests, Task 17 and a reviewer pass on the fix, rebuild the QA app and re-run only the failed steps.

- [ ] **Step 6: Clean up**

Run: `osascript -e 'quit app "Codevo QA"'; rm -f /tmp/qa-p8.log ~/tmp/codevo-qa/qa_prompt_p8.txt; rm -rf ~/code/Hello-World`
Expected: exit 0. (`~/code/Hello-World` is the QA clone; delete it only if the QA run created it - check `git -C ~/code/Hello-World remote get-url origin` prints `https://github.com/octocat/Hello-World` first.)

### Task 20: Commit to `main` (lead, after explicit owner authorization)

**Files:** all P8 files.

- [ ] **Step 1: Confirm the tree**

Run: `git branch --show-current && git status --porcelain && git log --oneline -12`
Expected: branch `main`; the per-task commits are present; no foreign hunks staged (repo memory: a concurrent Codex session may share the tree - inspect every hunk you stage).

- [ ] **Step 2: Commit any review / QA fixes**

```bash
git add <only the P8 files changed by the fixes>
git diff --cached --stat
git commit -m "fix(projects): address P8 review and QA findings"
```

Expected: one commit (skip if there were no fixes). No AI attribution, no Co-Authored-By line, no push, no tag.

- [ ] **Step 3: Commit the plan**

```bash
git add docs/superpowers/plans/2026-09-24-redesign-p8-projects-clone.md
git commit -m "docs(redesign): add P8 projects, clone and trust plan"
```

---

## Supported scope after P8 and remaining gaps

- Supported: first-run hero; Add project page (local sources, recent folders with ages, pasted URL/path, server environment into the existing server flows); one-step local clone form with live validation, `~/code` default and remembered parent; real Git progress; typed failure copy with Retry / Remove project; trust dialog for every grant path; cloned projects open untrusted.
- Unchanged by design (spec out-of-scope list): GitHub/GitLab repository search UI (`ProjectRepositoryPicker`), server clone dialogs (`AgentRemoteAddProjectDialog`), SSH/HTTPS switching for server clones.
- Left for P10: migrating the folder browser (`AgentAddProjectDialog`) and `ProjectRepositoryPicker` frames from the legacy `.quick-open` classes to P5's command primitives.
- Not claimed: progress for server clones (the runner does not stream Git progress), Windows paths.

## Open risks

1. P5 API drift: the plan codes against the agreed `CommandList.tsx` exports (`trailing`, `leadIcon`, `onChange(value)`); a rename touches only `AddProjectPalette.tsx` and `CloneRepositoryForm.tsx`.
2. P3 `banners` / `placeholder` props: agreed names; if the untrusted-send interception is blocked by P3's own `submitBlocked` handling, the fix belongs in `AgentCloneComposer` (P8), not in `AgentComposer`.
3. `git --progress` output format is stable in `LC_ALL=C` but not a contract; unknown lines only lose progress detail (they fall back to "Starting" / the last known phase) and never break the clone.
4. GitHub returns "Authentication failed"/"could not read Username" for private and non-existent repositories alike; the banner then says authentication, which matches Git's own behaviour.
5. The first-run hero condition (`projects.length === 0` with no pending clone, server or selected thread) must be rechecked against P4's all-projects sidebar (F1) during QA step 1.

## Self-review

- Spec coverage (§3.1.10 + F3-F6): first-run empty state -> Task 16; add project via command palette (open folder, Git URL, GitHub, GitLab, recent folders) -> Tasks 7, 13, 14; one-step clone form with live validation -> Tasks 4-6, 12; default `~/code/<name>` remembering last parent -> Tasks 5, 7, 11, 12; clone progress banner with cancel -> Tasks 1-3, 15; clone errors with retry/remove -> Tasks 1, 2, 6, 15; trust dialog replacing one-click trust -> Tasks 8-10, 15; project filter -> P4 (agreement), QA step 13.
- §4 contracts: every wire change (clone progress/failure/ensureParent) has Rust tests (Tasks 1-2) and TS tests (Task 3). No new Tauri command.
- §6 testing: component tests for every new component; contract tests both sides; QA build + Codex computer-use QA in dark/light and a second palette (Task 19); keyboard paths tested for the palette and dialog.
- Placeholder scan: every code step has code; the conditional instructions (P5 prop names, test-harness helper) name the exact fallback code.
- Type consistency: `CloneFormRequest` (Task 6) is what `CloneRepositoryForm.onClone` (Task 12) emits and `useLocalProjectClone.start` (via `LocalProjectCloneInput`) accepts; `WorkspaceTrustOrigin` (Task 8) is used by Tasks 10, 11, 15; `RepositoryHostStatuses` (Task 11) feeds Tasks 13 and 14; `localCloneDetail` (Task 11) feeds Task 15; `AgentAddProjectTrustMode` (Task 11) is used by the lane (Task 11) and defaults to `"auto"` in Task 14.
- Review Focus tests: credential URLs (Tasks 4, 6, 12), existing destination / project (Tasks 6, 11, 12), A -> B -> A trust (Tasks 8, 10), retry fidelity (Task 11), chatty progress output (Task 1).

## Lead decisions (2026-09-24)

1. The owner asked for autonomous execution: Task 20 commits to main without waiting for a go-ahead once
   gates, review and QA pass (no push, no tag). Commit Slice A (Tasks 1-11) and Slice B separately.
2. Approved: cloned projects open untrusted with the trust dialog on first send; folders opened by the
   user keep automatic trust; revoking stays one click; the clone banner keeps a small hide control.
3. GitHub's ambiguous "authentication failed" for private vs missing repos: word the banner truthfully
   ("Repository not found or access denied") instead of asserting an authentication problem.
