# Feature implementation notes

This file documents how selected app features are implemented and how to use them in code.

## Toast notifications

The editor uses a shared notice/toast pipeline.

### Files

- `src/application/workbenchNotice.ts`  
  - `WorkbenchNotice` model and factory helpers.
- `src/application/useWorkbenchController.ts`  
  - Maintains toast/notices state.
- `src/application/useNoticeToastRenderers.tsx`  
  - Maps notice payloads to toast UI renderers.
- `src/components/NoticeToastHost.tsx`  
  - Displays toasts and tracks dismissals.
- `src/components/ToastNotification.tsx`
  - Reusable toast UI component with template types and action handlers.
- `src/components/ManagedPhpactorSetupNotice.tsx`
  - Concrete notice implementation for missing PHPactor setup.
- `src/App.tsx`
  - Shell wiring; mounts `NoticeToastHost` and connects workbench state.
- `src/App.css`
  - Toast styling, variants, and animations.

### How to add/update a toast in code

1. Create a notice payload in your feature logic.
2. Choose a notice identity strategy:
   - Include `groupKey` for replaceable/grouped notices.
   - Omit `groupKey` for one-off one-time notices.
3. Push/replace notices in `useWorkbenchController`.
4. Add or update a renderer in `useNoticeToastRenderers.tsx` for the notice payload.

### How to use grouped notices

- Use a stable key such as `feature-name:<scope>` for lifecycle-aware replacement.
- Dismissing a grouped notice is tracked by `group:` + group key.
- If source state still requires that grouped notice, it can be reintroduced.

## Adding feature notes

For new feature work, append a section in this file with:

- A short behavior description
- Affected files
- Integration points in state and commands/events
- Any side effects and error handling

Use the same pattern for other features that need contributor-facing implementation guidance.

## JavaScript coverage viewport projection

JavaScript coverage reports are indexed once by immutable report identity. The active-editor application policy selects an exact workspace-owned, clean file; the Monaco adapter then binary-searches its already sorted line records for the visible viewport.

### Files

- `src/domain/jsTestCoverageDecorations.ts`
  - Immutable report/path lookup facade and editor-neutral line projection.
- `src/application/jsTestCoverageDecorationSelection.ts`
  - Workspace, report, file and dirty-document authority checks.
- `src/components/jsTestCoverageDecorationWindow.ts`
  - Bounded visible-range normalization, binary-search selection and decoration/inline-label caps.
- `src/components/useJsTestCoverageEditorDecorations.ts`
  - Exact model subscription, refresh and cleanup ownership.

The adapter returns at most 256 decorations and 128 inline hit-count labels. It reads at most 64 Monaco visible ranges per pass and marks retained decorations when additional ranges were omitted. Do not restore a full-file clone, sort or decoration map before viewport selection.

## JavaScript/TypeScript LSP change mailbox

Document changes use a latest-value mailbox keyed by the exact workspace root and LSP session. Only the current entry may drain or publish an error; drop, clear, re-entry and replacement revoke older work. Every document notification also carries `expectedSessionId` through the gateway so the Rust session rejects stale writes.

## Bounded stopped stacks and variable pages

Stopped events retain at most 256 strictly validated frames with unique IDs. `framesTruncated` is preserved to the windowed Call Stack so a bounded prefix or an empty inspectable result is never presented as complete.

Variable-page requests settle malformed current responses into a retryable error and release all request admission. Reducer ownership prevents stale, reordered and A→B→A settlement from clearing a newer flight.

## Current private debugger foundations

The child-target multiplexer routes private stack, variables and resume operations with exact target authority so endpoint reuse cannot address or disconnect a replacement target. It is deliberately unwired and disabled; contributors must not expose it as child or multi-process debugging until production composition and lifecycle acceptance are separately complete.

The dynamic source-map registry foundation prepares maps asynchronously without filesystem work under the shared debugger lock. Exact `scriptId`, transport and registration generation fence pending work, commits and lookup receipts. One worker has a 32-job queue; the registry fails closed above 64 pending maps, 256 committed maps, 250,000 tokens per map, 1,000,000 tokens per session, 256 retained source-file authorities per map or 512 per session. Independent review and the focused/full Rust gates are clean. This foundation does not include `smartStep`, late breakpoint reconciliation or full source-map parity.
