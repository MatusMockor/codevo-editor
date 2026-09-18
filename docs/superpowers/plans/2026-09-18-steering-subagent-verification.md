# Active-run messages and subagent visibility

## Implemented behavior

- Queue is the default active-run submission preference; Send now is selectable,
  and the modified Enter shortcut reverses the preference.
- Queued messages dispatch at a fresh parent tool/result boundary. A foreground
  result with real background work permits delivery without waiting for process exit.
- Output-window eviction does not reject valid input. Accepted user messages have
  a separate bounded retention budget in remote replay.
- Local and remote input admission respects pending questions, exact task ownership,
  cancellation and serialized delivery. Server commands retain idempotency receipts;
  ambiguous delivery is never automatically retransmitted with a new identity.
- Claude input lifetime uses correlated command lifecycle events, including the race
  between a previous result and a newly accepted follow-up. Unsupported CLI versions
  fail closed rather than guessing whether input was consumed.
- Shared subagent disclosure sits outside the general work fold. Bounded lifecycle
  snapshots preserve identity, state and reported metrics when detailed output is
  evicted. Local persistence and server event pages carry the same strict schema.
- Previously discarded detailed output cannot be reconstructed. Old servers without
  the new capabilities retain explicit compatibility limits.

## Reference

Compared against T3 Code commit
`9ea9c3d5d2c444133e3ddff40eecf38737951589`: active-run queue dispatch in
`apps/web/src/components/ChatView.tsx`, subagent disclosures in
`apps/web/src/components/chat/MessagesTimeline.tsx`, and provider lifecycle in
`apps/server/src/provider/Layers/ClaudeAdapter.ts`.

The editor retains its bounded process-per-run architecture. T3's persistent SDK
query was not represented as equivalent to an unacknowledged stdin write.

## Verification

- Regression coverage includes saturated output, attachment preservation, tool-boundary
  delivery, pending questions, Stop/removal during preparation, owner replacement,
  uncertain HTTP results, replay and image metadata restoration.
- Three native real-process fixtures cover an old result before follow-up processing,
  both lifecycle/result orderings, and exit with an unfinished accepted command.
- Subagent tests cover output eviction, persistence, alias merging, child reuse,
  terminal states and provider-neutral disclosure.
- Focused coverage across the new queue/remote-send/lifecycle/disclosure modules:
  95.27% lines and 86.03% branches at the recorded coverage run.
- Exact beta.53 frontend snapshot: 25,082 tests passed across 1,660 files. Unrelated
  concurrent UI changes were excluded from this snapshot and release.
- Runner: macOS 360 passed / 21 platform skips; Linux 379 passed / 2 platform skips.
  Type checking and builds passed. Provider validation used deterministic process
  fixtures, not paid live AI requests.
- Frontend type checking, strict lint, exhaustive-deps budget, build, hotspot size and
  both formatting checks passed. The smaller App baseline was recorded.
- Native library: 3,734 passed, 3 ignored. The separate integration test command and
  formatting check passed. Strict all-target Clippy passed after an equivalent
  predicate simplification, independently reviewed and covered by focused tests.
- The earlier macOS executable-launch stall cleared before these native reruns;
  no system policy or binary-signing changes were needed.
- Runner revision `6eeff7b0579a23d5ae49a314a158f2ffae57e1bf` was deployed after an
  idle check, with database/build backup and authenticated capability verification.

## Boundaries

Subagent snapshots retain up to 32 identities and explicitly report overflow. Detailed
output remains bounded. Metrics are displayed only when reported by the provider.
No perpetual scheduler or automatic retry of an ambiguously delivered message was added.
