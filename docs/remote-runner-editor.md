# Remote runner in the desktop editor

The desktop editor can connect to an existing Linux Codevo Runner over SSH,
submit tasks against registered server projects, and display their saved output
and diffs. **This computer remains the default execution environment.** Adding a
server does not move a local project or install the runner.

Remote work uses the existing Agents sidebar, conversation view and composer.
Each server conversation appears as one thread, identified by a server icon; its
follow-up turns do not create separate sidebar threads. The execution-location
picker chooses the target for a new thread. An existing thread retains its target.

## Server prerequisites

The supported direct Linux setup runs the runner as a systemd user service;
Docker is not required. Follow the runner repository's
[Linux deployment instructions](https://github.com/MatusMockor/codevo-runner#direct-linux-deployment-with-systemd)
for Node, Git, persistent SQLite storage, service configuration and lingering.
Lingering keeps the user service running after SSH logout and starts it on boot.

The editor connection requires:

- An SSH server reachable from the desktop and an account that can authenticate
  non-interactively using an existing key or the desktop's SSH agent.
- A previously verified SSH host key in the desktop's known-hosts configuration.
  The editor uses strict host-key checking and does not offer a password or
  first-time host-key acceptance dialog.
- `python3` available to that account's non-interactive SSH session.
- The runner listening on `127.0.0.1:4318` on the server.
- The runner's bearer token readable by that account at
  `~/.config/codevo-runner/runner-token`, with private file permissions.
- Task execution enabled, the required Claude/Codex CLI installed and logged in
  under the service account, and project tools available in the systemd service's
  explicit `PATH`.

The editor owns a persistent SSH tunnel for each connected server, forwarding a
private local Unix socket to the loopback runner API. A fixed Python bootstrap
reads the runner token once through SSH; the token is held only in the Rust
backend's memory, never in the renderer, local settings, logs or command arguments.
HTTP requests reuse the tunnel. Agent forwarding stays disabled and the runner
does not need a publicly exposed port. Provider credentials remain on the server.

Updated runners publish compact WebSocket change notifications through the same
tunnel. Notifications coalesce into an inventory refresh; transcript data still
comes from the bounded HTTP event API. Every reconnect receives a fresh snapshot
and triggers reconciliation. When all connected servers have healthy subscriptions, inventory reconciles every
60 seconds; unavailable streams retain two-second polling for older runners. Failed setup
retries with bounded backoff. Disconnecting revokes the exact connection and its
subscriptions without cancelling server tasks.

## Clone or register server projects

Server projects must be registered before an agent can use them. The runner's
clone API accepts a repository URL, a folder name and an optional branch. The
folder name uses letters, digits, underscores and hyphens, starts with a letter or
digit, and is at most 64 characters. Omitting the branch uses the repository's
default branch. The clone API remains available, but its integration into the
existing **Add project** flow is not yet complete. Do not rely on a desktop clone
button in this build; a separate remote task panel is not part of this integration.

Cloning runs on the Linux server. The current deployment uses
`CODEVO_PROJECTS_ROOT=/home/codex/Developer`, producing
`/home/codex/Developer/<folder-name>`. The runner checkout is
`/home/codex/Developer/codevo-runner`. Its `CODEVO_DATA_DIR` is
`/home/codex/Developer/.agent/codevo-runner`, so task worktrees are created in
`/home/codex/Developer/.agent/codevo-runner/workspaces/<task-id>`.
The default clone root is the service account's `~/Developer`; operators can set
an absolute `CODEVO_PROJECTS_ROOT` when deploying another server.

Use an HTTPS URL, an SSH URL such as `ssh://git@host/owner/repository.git`, or
`git@host:owner/repository.git`. For private repositories, use SSH with a key and verified host keys
already available to the service account on the server. HTTPS cloning is anonymous;
credential helpers and interactive login are disabled. Credentials embedded
in HTTPS URLs, local filesystem URLs and arbitrary destination paths are rejected.
The desktop's SSH agent is not forwarded to the server for Git authentication.
Existing destination folders and registered project names are refused, not replaced.

A successful clone is registered in the runner's SQLite database and becomes a
server project without editing a JSON file or restarting the service. Closing the
editor does not cancel an accepted clone. Clone jobs support cancellation and
retry through the runner API. A runner restart marks unfinished clone jobs
`interrupted`; it does not resume Git midway through a clone. An abrupt
server/process failure can leave an incomplete destination folder. Inspect it on
the server before removing it, or retry with a different folder name; retries never
overwrite that folder. Cloning requires the runner's `projectCloning` capability.

Existing
server checkouts can still be registered through `CODEVO_PROJECTS_FILE`, for example
`/home/codex/.config/codevo-runner/projects.json`:

```json
[{ "id": "my-app", "name": "My app", "path": "/home/codex/Developer/my-app" }]
```

Each manually registered path must identify a real writable Git checkout on the
server. Apply file registry changes using the runner's deployment workflow,
including a service restart when required. The editor selects server project IDs
and names rather than accepting arbitrary server paths.

The runner prepares a separate Git worktree for a new conversation. Follow-up
turns reuse that conversation's worktree. A server
checkout is independent of the currently opened local checkout, including any
uncommitted local edits. Cloning does not synchronize local uncommitted files.

## Connect and run

1. Open **Settings → Environments → Add server**.
2. Enter a display name, SSH host, username and SSH port. DNS names and IPv4
   addresses are supported; IPv6 addresses are not supported by this form.
3. Connect. The editor verifies access and the runner protocol before saving the
   connection. It does not install providers or sign them in.
4. Create a new thread using the normal Agents interface. Choose the connected
   server with the execution-location picker. The normal project selector lists
   registered projects for that execution environment.
5. Use the existing model and permission controls, enter a prompt, optionally attach
   images through the normal composer, and send it. These launch choices are sent
   to the runner; selecting a server must not silently substitute other settings.

Sending the selected model and permission settings requires the runner to advertise
`taskLaunchOptions`. A runner without that capability must be updated before using
this launch flow; the editor does not silently replace the selected options with
runner defaults.

Remote image staging accepts up to **eight PNG/JPEG images of at most 5 MiB each**
through the existing attachment components. The runner also validates image contents
and dimensions; a matching extension alone is insufficient. Local file paths are
not server attachment paths. Uploads complete before task admission.

If submission is not confirmed, recover or retry the original request before sending
another one. An uncertain response does not prove that execution failed to start.
The execution target remains fixed for an existing thread; selecting another target
is a new-thread action, not a transfer of the current provider conversation.

## Local instruction sources

Remote instruction synchronization currently applies only to Claude turns; Codex
turns do not collect or send local instruction files or require instruction-sync support.
The desktop is the source of truth for Claude rules. Select
a trusted, open local project as the instruction source for a server project to
include its project rules. Keep that local project open while sending remote turns. The
association belongs to the exact server, runner identity and remote project; equal
project names do not establish an association. Without a local source, only global
instructions are synchronized. A mapped source that is unavailable or untrusted
must fail rather than silently fall back to global instructions.

Before sending a new turn, continuing a conversation or queueing a message, the
editor collects a bounded snapshot of saved instruction files. This includes the
local Claude configuration directory's `CLAUDE.md` and Markdown rules, and the
mapped project's `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and nested
instruction/rule files. Ignored and uncommitted instruction files are eligible;
unsaved editor buffers must be saved first. Authentication, provider settings and
other local project files are not synchronized by this feature.

The snapshot is pinned to the submitted message. Retrying an uncertain submission
reuses that snapshot; later edits belong to the next message. Each snapshot is
limited to 128 files, 64 KiB per file and 512 KiB total UTF-8 content. Collection
rejects unsupported imports, unsafe paths and incomplete scans instead of silently
sending partial instructions. Older runners without `instructionSync` must be
updated before using this flow.

Imports currently support relative Markdown files within the same global or
project source tree. Absolute paths, home-relative paths, non-Markdown imports and
imports escaping that tree are rejected. Save portable relative references before
sending. Literal machine-specific paths in instruction prose are not rewritten.

The runner uses isolated instruction storage and managed files in the conversation
worktree, without replacing the server account's global Claude configuration.
Updates and removals affect only synchronized files; a conflicting server edit is
an error rather than permission to overwrite it. Nested project instructions retain
their paths and scope. Global instructions are refreshed in each turn's context;
previous turns remain in provider history, so synchronization is not erasure of
old conversation context or a guarantee that different providers interpret rules
identically.

The supported runner host for instruction materialization is Linux. Other hosts
fail explicitly instead of falling back to unsafe path-based writes. Files that
exist only on the server and have never been managed by synchronization are not
deleted merely because the first local snapshot omits them; review such existing
server rules separately.

## History, reconnect and results

Connection settings are saved locally. After restarting the editor, saved servers
are connected automatically once. If a connection fails, retry it after restoring
network access. Task data and execution
belong to the runner: closing or disconnecting the editor does not cancel an
already queued or running task. Use the task's cancellation action to stop it.

The existing conversation view receives persisted task state and events, output
and terminal status. Reconnecting can replay saved output. Remote file changes use
the editor's existing per-file changes viewer when the runner advertises
`taskFileDiffs`. It includes untracked files and their text contents, as well as
tracked changes, without applying those changes to the local checkout.

Per-file review limits each original or modified text to **64 KiB**. Binary or
larger files are marked unavailable rather than presented as complete text; a
bounded file list also reports truncation. The separate legacy cumulative patch
endpoint still lists untracked file names without including their contents in its
patch. That patch limitation does not apply to supported untracked text files in
the per-file viewer. Output and both diff representations remain bounded.

A runner service restart interrupts an already running provider process. Such a
task becomes `interrupted`; reconnecting the editor does not resume that process.
Queued tasks remain eligible for execution.

## Continue a server conversation

Open the server thread in the normal sidebar, enter another message in the same
composer and send it. No separate continuation screen or activation button is
required. The runner resumes the provider conversation in its existing server
worktree, preserving previous code changes. A new thread starts a separate
conversation and worktree.

The original provider, server project and execution target belong to the thread.
Each follow-up still has its own runner task ID, status and output internally,
linked to its parent task and root conversation, but the sidebar and chat present
one conversation. Only its latest turn can continue; viewing older messages does
not fork the provider conversation. Diffs are cumulative against the original
baseline and reflect the shared worktree's current state. They are not immutable
per-turn snapshots.

A runner must advertise `taskContinuation`. A runner without that capability cannot accept a follow-up.
The eligibility check requires a finished task, saved provider session metadata
and a usable original worktree. It does not prove that the provider's own history
still exists or that its login remains valid. Missing or rejected provider history
fails the follow-up; the runner does not silently replace it with a fresh session.
For an uncertain submission response, retry the same follow-up or refresh to recover
it before changing the message or starting another conversation.

Older server tasks can become eligible if their retained structured output contains
a valid provider session ID and the required worktree still exists. This is
conditional recovery, not a migration of provider history. Moving a worktree or its
source repository can invalidate Git or provider path associations; do not assume
that relocated historical tasks can resume. Local **Import session** does not copy
local provider history to the server.

A finished `interrupted`, `failed` or `cancelled` task can be eligible when its
session and worktree are available. Continuing creates a new turn; it does not
restart the old process automatically. Reopening the editor alone only restores
access to saved task history.

## Runner identity

Connections retain the runner identity. The Rust transport checks it before requests
and sends the optional `X-Codevo-Runner-Id` header. The updated runner deployment
validates that header on the actual request and rejects a mismatch, protecting
against replacement between the preliminary check and a mutation. Older clients
may omit the header; the editor supplies it after connection. If a server is
replaced with a different runner identity, remove the saved server and add it
again deliberately.

## Current scope

Verification outcomes belong to the specific build being delivered. Source support
and isolated-runner tests do not by themselves prove native app quit/reopen behavior.

New conversations and follow-up turns use separate runner task records while each
conversation remains one editor thread. This
integration does not yet provide interactive provider permission approvals, automatic copying
of local projects or their uncommitted edits, a remote filesystem editor, or
applying remote changes to the local checkout. Reviewing a remote diff does not synchronize files to the PC.

This document describes behavior and setup, not release availability or a test
report. Validation and release outcomes must be recorded separately for the
specific build being delivered.


## Interactive questions and long runs

A runner advertising `interactiveQuestions` can publish structured provider questions.
The current turn displays them above the existing composer, with single or multiple
choices and an optional custom answer. Sending an answer responds to the same live
provider invocation; it does not queue another prompt. The ordinary composer draft
is independent of the question form. Selecting an option alone never submits it.

Pending question snapshots are persisted on the runner. Closing the editor leaves
accepted work and pending questions on the server. After reconnect, the editor reads
the pending snapshot again. Duplicate delivery of the same answer is idempotent;
different or stale answers are rejected. Stop cancels waiting questions along with
the task. A runner restart expires pending interactions because their provider RPC
is no longer alive; it does not fabricate automatic process resumption.

This feature handles structured user questions, not permission approvals or arbitrary
questions written as ordinary assistant prose. The question panel shows the current
turn; it is not a complete renderer of all older question cards. Native local pending
questions are tied to the local child process and do not survive quitting that process.

The runner reports `executionTimeoutMs` and the server settings show it. The default
is twelve hours, configurable with `CODEVO_EXECUTION_TIMEOUT_MS` from one minute to
seven days. The deadline includes waiting for an answer. Queue waiting before execution
is separate. Disconnecting the editor does not reset the execution deadline; restarting
the server interrupts active execution. Provider-side limits and network failures
remain possible regardless of this runner policy.

Deploy a compatible editor before the runner that adds these descriptor and question
contracts. Back up runner data before schema migration. Do not restart the production
service while user tasks are active.
