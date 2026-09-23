# Recorded agent changes

For new local turns, Codevo stores the on-disk workspace before and after the
agent runs as Git checkpoints. Checkpoints use private refs and a separate index;
they do not move the current branch or change the user's staged files. The changes
card compares those saved states, so later edits and commits do not change an old
turn's diff. Both local Claude and Codex tasks use this capture lifecycle.

This follows the checkpoint approach in T3 Code's
[CheckpointStore](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/checkpointing/CheckpointStore.ts)
and [CheckpointReactor](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration/Layers/CheckpointReactor.ts).
Codevo retains its own workspace ownership checks and bounded process execution.
Capture supports ordinary and linked Git worktree roots, including repositories
without an initial commit, on the existing Unix storage backend.

Like T3 Code, Codevo never initializes Git for a workspace. Before capturing,
the backend checks whether the workspace is a Git working tree root. A folder
that is not inside any Git repository reports `unsupported` with reason
`notGitRepository`; a folder that is only a subdirectory of a repository reports
`unsupported` with reason `notWorktreeRoot`. An unsupported workspace writes no
record, is not logged as a capture failure and shows no changes card. If Git
fails while a `.git` entry exists in the workspace or one of its parents, that is
a real capture failure and is saved as such. A saved failure that never captured
any checkpoint is read as `unsupported` when its workspace is no longer a Git
worktree root, so records from older builds do not show failures under every
turn. Files outside the repository and files ignored by Git are not recorded.

Existing JSON snapshot records remain readable. Missing historical snapshots cannot
be reconstructed faithfully from today's working tree, and retrying a read does
not create a replacement baseline. A diff describes changes between the two
workspace states: concurrent edits by a person or another agent in that same
workspace can also appear. Unsaved editor buffers are not captured.

Checkpoint retention is bounded to 512 records per workspace and a 256 MiB budget
for their reachable Git objects, with shared objects counted once. Application
metadata has a separate 256 MiB budget. Older records can be retired when a limit
is reached. Removing a checkpoint ref makes its unshared objects eligible for
normal Git garbage collection; it does not immediately shrink the repository.
Capture is limited to 10,000 paths, 32 MiB per file and 128 MiB of file reads.
The card displays up to 500 changed files and each text diff side is limited to
128 KiB. Unsupported or partial results are reported explicitly.

Capture admission serializes recording within each workspace and allows two
workspaces to record concurrently, with bounded waiting. It does not serialize
the agents' work between their initial and final checkpoints.

Summary and file-content reads share a bounded queue with at most four active
requests. Temporary backend admission failures receive a bounded automatic retry.
Requests recheck workspace ownership before starting and after completion; stale
results never replace the selected workspace's data.

The UI distinguishes three outcomes. Unsupported workspaces and turns that the
current view cannot read (not a trusted project, a foreign or replaced owner, a
cancelled read, a remote runner without the capability) render nothing. A saved
capture failure is final: its reason is shown muted and no Retry is offered.
Only recoverable read failures (busy backend, full queue, a transient storage or
workspace read error, or an unknown read error) offer Retry. A retry reads the
same saved checkpoint. It never substitutes the current Git diff. Checkpoints can
still be unavailable if capture failed, the repository/worktree is unavailable,
or saved objects were removed. Large and binary file content remains subject to
the diff viewer's limits.

Remote turns are recorded by their runner. This repository's desktop client queues
their reads too, but replacing local storage does not upgrade a remote runner or
add a capability that its server does not advertise.
