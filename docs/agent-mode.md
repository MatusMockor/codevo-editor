# Agent mode

Agent mode is Codevo's project-scoped workspace for running Claude Code or Codex, keeping
conversations as saved threads, reviewing their changes, and shipping Git work.

## Open and add projects

Open a workspace with the folder button in the primary navigation. The workspace becomes the
active agent project. Use **Add project** in the agent rail to register another directory, then use
the project scope menu to show all projects or one repository. Codevo keeps at most eight project
roots in the rail; any additional roots are reported as not shown.

A project must be trusted before an agent can start there. A background project can run agents
only in an isolated worktree. A project whose tab was closed while tasks are still live is being
released: its existing work is retained, but new threads and follow-ups are blocked.

## Start a thread and follow up

Choose a project or repository, write a prompt, select the provider/model and permission mode,
then choose a checkout:

- **Local checkout** runs directly in the project's checkout. Codevo warns and requires an
  explicit confirmation when the repository is dirty, has unsaved editors, has another active
  agent, or its status cannot be confirmed.
- **Isolated worktree** creates a dedicated Git worktree so the main checkout is not edited by
  that thread. The automatic isolation policy prefers a worktree when the repository is busy,
  dirty, or has unsaved editors.

Submit with **Cmd+Enter** on macOS or **Ctrl+Enter** elsewhere. Select an existing thread to send a
follow-up; follow-ups stay on that thread's original checkout and provider. Use **New thread** to
leave follow-up mode.

The rail groups pinned, active, and archived threads. A thread menu can start another thread, pin,
rename, mark unread, copy its path/branch/ID, stop it, archive it, or delete it. Pinning protects the
thread record from eviction, but does not protect its oldest turns from the 64-turn limit. Each
project root retains at most 64 threads and 16 MiB of thread data; older eligible records can be
evicted before the count limit is reached, and a save can fail when the store is full and no record
is eligible for eviction.

## Review and work with a thread

The thread header's **Open** menu can reveal the checkout in Finder, open its terminal or Files
surface, or copy its path. The right-panel surface controls and shortcuts expose three surfaces:

- **Files** browses the thread checkout and opens files in the editor.
- **Diff** lists the thread's changed files and opens file diffs or editor diff documents.
- **Terminal** opens a terminal rooted in the selected thread's checkout.

The standard editor remains available by expanding the editor. Its tabs, navigation, file and
local history, Git history, Source Control, and bottom terminal continue to work normally. The
agent rail footer opens Source Control, Usage, and **Settings > Agents** directly.

Search the rail to find saved thread titles and retained turn content. Search indexes the newest
eligible content first and is bounded to 128 thread documents or 4 MiB; the results say when some
documents or matches were omitted.

**Find in Thread** searches prompts plus the newest 200 rendered events from each retained turn,
returning at most 500 matches. It does not show a truncation label. Its **Cmd+F** shortcut is scoped
to focus in the thread session or its find bar; elsewhere **Cmd+F** remains the editor's Find.

## Ship changes

Open **Commit Thread Changes** from the thread header or command palette. Stop the running agent
before shipping, then:

1. Refresh branch status and review the changed files.
2. Commit with a bounded commit message.
3. Push the branch when a remote is configured.
4. For a worktree thread, integrate by fast-forward or merge commit into the main checkout.
5. Remove the integrated worktree and optionally delete its local branch.

Integration is blocked if the main checkout is dirty or detached. Fast-forward is also blocked
when the thread branch is behind the main checkout; choose a merge commit instead. In-place
threads can commit and push, but have no separate worktree to integrate or remove. **Discard
without integrating** is destructive and is kept separate from the normal ship path.

## Providers, sign-in, and updates

Open **Settings > Agents** (or use the rail footer):

1. Enable Claude Code or Codex and enter an absolute path to its CLI executable.
2. Register the provider policy if registration is pending or failed.
3. Use **Refresh** to read the installed version, authentication state, and update availability.
4. Use **Sign in** when authentication is needed. Codevo opens a dedicated bottom-terminal tab
   and starts `claude auth login` or `codex login`; complete the provider's interactive flow there.
   When the terminal exits, Codevo refreshes authentication status.

Provider health checks run on the configured interval; setting it to `0` makes checks manual.
**Check for updates** is opt-in and off by default. When an update is available, **Update** runs the
recognized npm or Homebrew installer and shows a bounded live tail of fixed, sanitized installer
activity summaries in the provider card. Raw installer stdout and stderr are not displayed; the
summaries disclose byte counts only, and withheld or truncated activity is labeled. Update and
sign-in actions are excluded while that provider has an active turn, and they are mutually
exclusive with each other.

Codevo updates the configured CLI only. It does not install an unknown provider, switch package
managers, or treat an unrecognized installer as updateable.

## Usage labels and limits

Open **Usage** from the agent rail and choose Today, 7 days, or 30 days. The panel aggregates saved
threads on this device by provider and project. It is explicitly not account, billing, or cost
usage.

The panel reports started/completed/failed/stopped/active turns, measured wall time, provider CLI
token evidence when the CLI supplied it, and **Output received by Codevo** in UTF-8 bytes. Coverage
labels show measured versus eligible turns and how many output measurements are complete. Legacy
turns without metrics are shown as unavailable, never as zero. The panel can label retained
threads whose older turns were trimmed and can label incomplete aggregation or metric coverage;
it cannot detect and label a thread record that was evicted entirely.

## Keyboard shortcuts

These are the current macOS defaults; replace **Cmd** with **Ctrl** on Windows and Linux where
applicable:

| Action                               | Shortcut                          |
| ------------------------------------ | --------------------------------- |
| New thread                           | Cmd+N                             |
| Previous / next thread               | Cmd+Shift+[ / Cmd+Shift+]         |
| Jump to visible thread 1-9           | Cmd+1 through Cmd+9               |
| Search threads                       | Cmd+Shift+K                       |
| Find in selected thread              | Cmd+F                             |
| Toggle right panel                   | Cmd+Alt+R                         |
| Open Files / Diff / Terminal surface | Cmd+Alt+F / Cmd+Alt+D / Cmd+Alt+J |
| Expand or collapse editor            | Cmd+Alt+E                         |
| Command palette                      | Cmd+Shift+P                       |
| Settings                             | Cmd+,                             |
| File history / local history         | Cmd+Alt+H / Cmd+Shift+H           |
| Toggle bottom panel                  | Cmd+J                             |

Open **Settings > Keymap** to search commands by label, category, command ID, or shortcut. Editable
bindings can be changed or reset individually to the platform default. Codevo displays exact and
prefix conflicts; the two recently-used-editor shortcuts are reserved and shown with the reason
they cannot be rebound.
