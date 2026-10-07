# Generated files in agent conversations

Codevo shows local images inline in assistant answers and lists workspace PNG,
JPEG, WebP and self-contained HTML referenced in assistant Markdown as "Generated
files". The same format works with Claude Code and Codex:

```markdown
![Preview](design/preview.png)
![Login page](/absolute/path/login.png)
[Interactive design](design/preview.html)
```

## Inline images

A Markdown image in an assistant message is drawn in the message itself when its
source is a workspace-relative path, an absolute path or a `file://` URL. A space
in the path works either inside angle brackets, `![Shot](<dir with space/x.png>)`,
or written as `%20`. A `#` or a literal `%` in a file name must be percent-encoded
(`%23`, `%25`); the source is decoded exactly once. Clicking an image opens it
enlarged, with the other loaded images of the same message as a gallery.

- Formats: PNG, JPEG, GIF and WebP, checked against the file's real content.
- Limits per file: 10 MiB, each edge up to 16384 px and at most 32 megapixels.
  Only the first 16 images of one message are drawn; further images of that
  message stay text labels and the message says so.
- Local threads only, and the workspace must be trusted. Final answers and the
  intermediate assistant messages in the activity fold show images; reasoning
  text, user prompts, imported history and threads that run on a server do not.
- No copy of the file is kept. Each turn reads the file itself when its picture
  is first shown, and again whenever it is shown after its preview was released
  or after a restart. A later turn that shows the same path reads it separately.
  An old turn can therefore show newer bytes later than the ones it first showed,
  and a file that was moved or deleted shows "Image unavailable" with a retry.
- At most 32 previews and 64 MiB are held at a time. A preview that is far out of
  view only becomes eligible for release; it is released when room is needed for
  another one (a 33rd preview or more than 64 MiB) and read again when it comes
  back into view. The picture that is open enlarged is never released.
- When more images are in view than the 32 previews allow, the overflow shows
  "Image waiting for preview room" and loads by itself as others leave the view.
  When a picture does not fit into the 64 MiB that the images in view already
  use, it shows "Image unavailable" and needs a click to try again.
- An image inside a collapsed activity fold is not read while the fold is closed.
  It is read once the fold is open and the image is near the visible part of the
  thread. An image in a table column that is scrolled out of view sideways may be
  read once when the message appears, but its preview is not held while hidden.
- On macOS, images on network volumes and files that iCloud has offloaded are
  not shown ("Images on network or offloaded volumes are not shown."). A network
  mount that stops responding entirely can still stall a read until it recovers.
- The source must be a plain path. These are refused and the image stays a text
  label: a `:line` suffix, a `#fragment`, a `?query`, a home-relative `~/` path,
  a relative path that climbs above the thread's base directory, a relative path
  whose first segment contains a colon, and bidirectional or other invisible
  formatting characters anywhere in the path.
- Not supported: external `https` images (they stay links), SVG, AVIF and ICO,
  and a path written as plain text or inline code instead of a Markdown image.
- Find in thread searches the Markdown source. When a query matches the alt text
  or the path of a local image, that block is shown as its source while the
  search is active so the match can be highlighted. This also applies where the
  image is only a text label, as in imported history and server threads.

## Generated files

Workspace-relative image and HTML references also appear as "Generated files"
controls beneath the answer, backed by a captured snapshot. An image given by an
absolute path is shown inline only and gets no "Generated files" control.

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
