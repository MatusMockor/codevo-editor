# Generated files in agent conversations

Codevo displays workspace PNG, JPEG, WebP and self-contained HTML referenced in
assistant Markdown. The same format works with Claude Code and Codex:

```markdown
![Preview](design/preview.png)
[Interactive design](design/preview.html)
```

References must identify files within the task's authorized workspace. External
URLs remain links. Tool logs, user prompts, reasoning and fenced examples are not
artifact sources. This feature displays files; it does not install or purchase an
image-generation service.

## Capture and delivery

Local terminal-turn persistence captures referenced files through the native
artifact store. Continuation waits for artifact-bearing persistence to settle.
The runner captures provider assistant references before finishing the task, so
queued continuations cannot overwrite the preceding task's unsaved previews while
the editor is disconnected. Immutable snapshots reopen after source deletion or
worktree pruning. Older uncaptured references fail instead of showing newer bytes.

The runner advertises `outputArtifacts` and exposes authenticated task-scoped
registration, listing and content routes. Credentials stay in the native gateway.
Metadata includes owner-bound identity, media type, byte count and SHA256. The
editor verifies content before rendering it. Updating the editor alone does not
add these endpoints to an older runner.

## Presentation and isolation

Generated file controls appear beneath the assistant response in the existing
thread. Clicking a control loads the preview; images can be enlarged. One preview
is retained per transcript to bound memory. Closing or changing it disposes its
object URL or native HTML lease.

HTML uses an opaque `sandbox="allow-scripts"` frame and a dedicated native scheme
with its own restrictive CSP. Inline scripts and styles work; network, external
assets, nested frames, workers, forms and parent access do not. The editor's main
script policy is unchanged. HTML must be self-contained. The native registry has
random identities, bounded storage, expiration and explicit revocation. Tauri's
main-frame-only invocation key remains part of the native isolation boundary.

## Limits and compatibility

- At most 32 references per turn; assistant reference extraction is bounded.
- Image files: 8 MiB, at most 8192 pixels per side and 16 million pixels total.
- HTML: 2 MiB, valid UTF-8.
- Local snapshot storage: 256 MiB and 4096 entries. Runner storage: 1 GiB.
- Runner automatic discovery: 1 MiB structured stdout, 256 KiB per line. On
  exhaustion it retains already discovered references and reports incomplete
  discovery. Later references may therefore lack offline snapshots.
- Claude receives an appended presentation hint; previously resumed sessions may
  retain their original system-prompt snapshot until compaction. No automatic
  compaction or hosted publication is triggered.
- Codex receives a separate capability text item; user input is preserved and
  configured developer instructions are not overridden.

The design follows T3 Code's provider-independent, environment-owned file
references. Claude Code's separately hosted artifacts and Codex-specific image
events are not required by this portable saved-file contract.
