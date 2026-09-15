# Runner stream — deferred server verification

Update: Linux became available later on September 15. Deployment and native
verification are recorded in [server live verification](2026-09-15-server-live-verification.md).
The earlier deferral below is historical; do not repeat completed server tests
without a new change or unresolved concern.

## User decision, 2026-09-15

The Linux server cannot be switched on now. Defer server verification and do not
keep retrying SSH. When Matus says the Linux server is running, resume the checklist
below. This note is the continuation record, not a scheduled background task.

## Current implementation

- Editor: `/Users/matusmockor/Developer/editor`, base commit `cf92c607` (beta.40).
- Runner: `/Users/matusmockor/Developer/codevo-runner`.
- Changes are uncommitted in both repositories. No release or production deployment
  was performed for this slice. Preserve the earlier uncommitted perf-bootstrap fix.
- Persistent SSH forwarding through a private Unix socket; runner token in Rust
  memory only; bounded HTTP, connection ownership and shutdown cleanup.
- Authenticated `/v1/changes` WebSocket invalidations, coalesced refreshes,
  reconnect reconciliation, 60-second reconciliation when all connected servers
  have healthy subscriptions, older-runner polling fallback.
- Existing thread design and provider execution are unchanged.

## Evidence already collected

- Frontend: 24,000 tests, coverage, check, lint, formatting, size and build passed.
- Rust: 3,590 library tests passed; combined library/integration run 4,783 passed,
  3 ignored; check, formatting and strict Clippy passed. Independent reviews closed.
- Runner: 164 passed, 5 platform skips; check/build and independent review passed.
- Isolated Linux runner through a separate Node WebSocket client and SSH forward:
  20 draft creations coalesced into one change; reconnect, auth and identity checked.
  Test resources removed; existing production service was not restarted.
- Earlier production Rust transport test: 20 reads used one SSH PID; median
  10.414 ms, p95 77.126 ms; closing reaped the process. This preceded final startup
  ownership refinements. Final rerun failed because ordinary SSH also timed out.
- Full native editor subscription → inventory → visible UI E2E is still unverified.
- Detailed evidence:
  `/Users/matusmockor/.codex/task-logs/runner-stream-20260915/verification.md`.

## Resume when the server is available

1. Verify SSH to `codex@192.168.1.110` and inspect existing service/tasks read-only.
2. Read current Git status in both repositories and this note before any changes.
3. Repeat the latest Rust live transport test, pinned to runner identity
   `0080d352-dbb1-477d-9eda-c5f3f47d1b70`. Revalidate that identity rather than
   silently accepting a replacement. Test is explicitly ignored by default and
   uses `CODEVO_RUNNER_LIVE_HOST`, `CODEVO_RUNNER_LIVE_USER`, `CODEVO_RUNNER_LIVE_ID`.
4. Verify the new editor with the new runner through the real native UI: prompt,
   streaming, disconnect/reconnect, preserved history and Stop. Use an isolated
   fixture; avoid disrupting existing tasks. Distinguish transport/API proof from UI.
5. Repeat idle process/request measurements and verify owned-resource cleanup.
6. Commit/push/release and production update only with applicable user authorization;
   deferring verification does not itself authorize shipping.

## Useful work without Linux

User requirement added: preserve the ability to search conversation history while
optimizing loading/rendering. Search must not be restricted to the currently
loaded page or rendered rows. Keep persisted history separate from UI cache;
search the authoritative retained history and load the matching page on selection.
Offline search of remote history requires a local synchronized index/copy; do not
claim complete remote search while the server is unavailable without that data.

1. Reduce repeated metadata/resume checks across completed turns. Existing benchmark
   produced 67 requests for an unchanged 64-turn inventory. Use bounded caching and
   invalidation; check resume authority freshly before continuing a task.
2. Preserve unchanged turn object identities in `remoteAgentProjection`; measure
   actual render counts before claiming a UI improvement.
3. Diagnose the medium-file native performance readiness failure without weakening
   the 1,000-completion threshold. Add observed counts/runtime diagnostics; then
   extend measurements to scrolling, output bursts, cancellation and memory soak.

Use before/after evidence and independent review. Do not introduce a new remote
thread design or claim a memory leak from the current measurements.

## History performance and search work (September 15, follow-up)

User authorized parallel implementation. Linux remains deferred; no SSH, deployment,
commit, push, or release is part of this follow-up.

- Inventory now reads continuation availability only for the highest-sequence turn.
  Actual production-loader tests: unchanged 1/16/64-turn inventories use 4/4/4
  requests (previously 4/19/67); cold loads use 6/36/132 (previously 6/51/195).
  Canonical prompts and event replay remain intact. No metadata TTL was added;
  authoritative continuation availability is still checked freshly.
- Remote projection preserves unchanged object identities. React regression with
  64 turns containing assistant responses: ten equivalent refreshes produce zero
  additional turn-body renders; changing the last prompt renders only that turn.
  Candidate construction and replay scanning still occur.
- Runner adds authenticated `GET /v1/history/search`, using bounded SQLite worker
  reads with advancing task-sequence pages. Scope is retained runner prompts and
  recognized assistant text, not provider-only or unsynchronized imported history.
- Editor search integration and bounded rendering around an older matched event
  passed local validation and independent review. Search completeness remains explicit when
  disconnected, unsupported, truncated, or outside retained records. No offline
  synchronization index has been added.
- New validation evidence belongs in
  `/Users/matusmockor/.codex/task-logs/history-performance-20260915`.
  Final frontend: 24,059 tests / 1,587 files, coverage and all configured gates passed.
  Rust: 3,595 library tests / 4,788 combined tests passed, 3 ignored; all gates passed.
  Runner: 168 passed / 5 Linux-only skips, check/build passed. Independent reviews closed.
  Earlier full-gate counts above precede this follow-up. Repeat real native search/reveal and streaming E2E when
  Linux is available, alongside the deferred steps above.
