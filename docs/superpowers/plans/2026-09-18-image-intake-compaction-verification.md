# Remote image intake and compaction verification

## Changes

- Remote clipboard intake accepts file items when the clipboard file list is empty and retains the exact composer owner across asynchronous reads.
- Remote paperclip uses a native image chooser. Native drag/drop reads explicit image sources with a bounded reader before remote staging, instead of rejecting all local paths.
- The native reader accepts regular PNG/JPEG/GIF/WebP images, checks descriptor identity and signatures, caps source bytes at 50 MiB and concurrent reads at two. Server upload normalization remains PNG/JPEG at at most 5 MiB.
- Compaction uses a live icon/status and a completed conversation separator, inspired by T3 Code. Only an explicit provider boundary marks completion. Manual compaction-only turns omit the ordinary assistant header; real output/errors remain. Completed boundaries remain visible outside collapsed work; token details support keyboard disclosure.

T3 source examined at commit `56a9bf2bd7d3dcdae722a5de84578909dc11aeda`: [MessagesTimeline.tsx](https://github.com/pingdotgg/t3code/blob/56a9bf2bd7d3dcdae722a5de84578909dc11aeda/apps/web/src/components/chat/MessagesTimeline.tsx#L1857-L1876).

## Native macOS findings

The reported clipboard failure was not reproduced with a PNG copied in Preview after the intake changes. Actual macOS clipboard insertion produced a ready image preview for both a new Linux/Claude conversation and an existing Linux/Claude conversation. Tests did not submit an AI message.

Native paperclip testing uncovered a packaging problem. Both the installed beta 51 and an initially assembled QA bundle failed `codesign --verify --deep --strict` with “code has no resources but signature indicates they must be present”. Their binaries had only linker signatures, without a sealed application bundle.

Native picker behavior initially appeared to correlate with signing settings, but that causal interpretation did not survive repeat testing. A later manual re-sign produced a byte-identical executable and identical code-signature metadata. Hardened-runtime overrides were therefore removed; the release change only ensures a valid bundle seal, preserving the existing runtime configuration. Native selection/focus automation requires separate verification.

Unsigned beta and debug smoke packaging now seals the bundle ad-hoc before packaging. Developer ID signing and notarization configuration remains unchanged. Release checks validate the original app and the app copies extracted from the updater archive and mounted DMG, in addition to the existing updater signature check.

Experimental custom picker implementations and their temporary dependency were removed after the controlled comparison. The normal filtered native chooser remains.

## Validation

Independent read-only reviews covered image intake, source-reader bounds and ownership, compaction presentation, and release packaging. Reported issues were fixed and re-reviewed.

All required frontend gates passed: type checking, strict lint, exhaustive dependency lint, build, hotspot size checks, full and changed-file formatting, and the full suite (1,650 files; 24,916 tests). Targeted coverage was also collected. All required Rust gates passed: all-target check, library tests (3,695 passed; three ignored), integration tests, formatting, and strict all-target Clippy. The final release-workflow revision passed eight focused tests, lint and formatting. Git diff whitespace checks passed.

Native clipboard insertion passed in both new and existing Linux/Claude composers. Paperclip selection staged an image successfully twice, but other native-dialog attempts could not be conclusively evaluated because automation reported `noWindowsAvailable` or left Open disabled. A physical native drag gesture remains unverified; drop routing and image-source reading have automated regression coverage. No AI message was sent during native testing.

Properly bundled QA builds passed strict signature verification. The release verification block also passed against a real QA app, a locally assembled QA archive, and a Tauri-built DMG; this is not a production updater-signature validation. One exploratory QA build used a temporary hardening override, which is absent from the final source. No release or production installation was performed as part of this change.

## Follow-up: conversation draft ownership

Inspection confirmed that attachment drafts were keyed only by project, while text drafts were keyed by conversation. This caused different conversations in the same project to display the same pending images. The provider-neutral paste handler was shared by Codex and Claude; no provider-specific intake duplication explains the original reported discrepancy.

Local clipboard and picker operations also lacked the pre-read ownership guard used by server intake. Regression tests reproduced both delayed local clipboard insertion and delayed picker insertion after switching conversations. Intake now shares one coordinator for local and server execution, retaining different transport adapters only where needed (local file paths versus image bytes uploaded to a server). Late results and errors cannot publish into a replacement composer, including switching away and back.

Attachment storage now exposes a conversation-scoped surface, keyed by the existing text-draft identity (thread ID or new-conversation project draft). Project identity remains separate workspace authority. The implementation preserves A → B → A drafts and binds send cleanup to the originating conversation. Clear, disconnect and owner replacement invalidate pending operations with a scope generation, including operations that have not produced their first thumbnail. Retention refuses additional attachments at the shared 32-item / 40 MiB limit without silently evicting existing images.

A separate reviewer approved the final intake and storage changes after corrections to disconnect cleanup and pending-operation invalidation. Final full frontend suite: 1,650 files, 24,933 tests passed. Focused intake tests cover both Codex and Claude on local and server execution. Targeted coverage of the changed intake/storage modules: 87.25% lines, 77.4% branches. A fresh QA app was bundled with the default hardened runtime and passed strict bundle-signature verification.

Native QA confirmed real PNG clipboard isolation in both local and Linux-server projects: an image staged in a new conversation draft disappeared when opening an existing conversation, then reappeared on returning to the new draft. Those isolation checks did not submit a message.

During an additional attempt to switch between two existing remote conversations, native keyboard automation retained composer focus and accidentally submitted the synthetic green PNG to the isolated Live E2E Claude conversation (task `c4463aa7-389a-4b4f-8b9f-d5d50dbe3dcd`). The run completed in approximately ten seconds with a description of the uniform green square; no tool activity was shown. This was not a planned upload test. Navigation stopped, owned unsent fixtures were cleared, and QA was closed. The extra test turn remains in history. The exact two-existing-conversation native gesture was not conclusively verified; automated integration tests cover that transition.
