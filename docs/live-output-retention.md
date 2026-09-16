# Live output and execution ownership

Long output must not permanently freeze a conversation at its first display limit.
The editor retains a bounded recent window while continuing to process new output.
This is not a complete output archive: older content can be unavailable and the UI
must report that the displayed history is incomplete.

## Local delivery

- Native delivery allows 64 outstanding output chunks and a 256-event waiting ring.
  Chunks remain bounded to 8 KiB. The renderer acknowledges accepted, parsed chunks
  cumulatively under the exact task and workspace identity.
- If the waiting ring loses output, sequence gaps and per-stream line-boundary
  metadata let the parser discard torn records and continue with later responses.
- Terminal status follows consumed output. A disconnected renderer cannot retain a
  completed delivery indefinitely: terminal delivery expires after 30 seconds with
  an explicit incomplete-delivery failure.
- The transcript retains at most 512 events / 512 KiB. Accepted steering messages
  remain pinned; if they occupy the whole budget, additional output cannot fit.
- Incomplete turns do not automatically extract artifact links from retained
  Markdown: losing an opening code fence could otherwise authorize an example link.
  A durable, independently parsed artifact-reference history is not implemented.

## Remote delivery

The runner uses bounded rolling SQLite output retention rather than terminating a
provider at the former default 1 MiB lifetime-output limit. Lifecycle events are
preserved. Older output, including historical final answers, can age out under the
storage quotas. The task timeout and provider frame-size limits remain separate
protections; this does not promise unlimited execution.

Event pages can include the atomic optional pair
`outputTruncatedBeforeSequence` / `outputStartsAtLineBoundary`. The editor keeps
fetch cursors independent of its retained replay window and resets partial parsing
at the actual missing-output boundary. The latest turn has up to 3 MB of raw replay;
older selected turns share another 3 MB. Page-batch limits postpone fetching rather
than permanently abandoning later output.

Runner schema 7 requires a pre-migration backup for rollback. Deploy a compatible
editor before enabling the new runner: older strict page validators do not accept
the new gap metadata. Never restart the runner while user tasks are active.

## Target, model and cancellation

An existing conversation is bound to its execution owner. A missing or loading
remote owner must remain labeled as remote and block submission, never silently
become a new local conversation. This does not migrate an existing local thread.

Draft model choices are bounded and scoped. Switching execution environments can
carry an explicit draft choice; returning to a visited scope restores its choice.
Existing conversations retain their own provider. This memory does not persist
across application restarts.

Escape in the focused running composer invokes Stop unless another contextual
action, such as closing the command menu, consumes it first. For a remote thread,
Stop calls the runner cancellation API. It does not delete the conversation or undo
file changes. Pending follow-ups remain paused rather than being silently deleted.
