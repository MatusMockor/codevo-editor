# Claude background lifecycle

## Scope

Preserve real Claude background work after an initial foreground result, expose its state in the conversation and sidebar, and deliver subsequent native output to the same owned run. A sentence promising future work is not lifecycle evidence and never schedules an invocation.

This adapts T3 Code's separation of foreground completion and background liveness to Codevo's bounded process-per-run architecture. It does not introduce permanent idle sessions, a durable scheduler, automatic restart after provider exit, or new remote HTTP status values. Existing remote message queue semantics remain unchanged.

## Reference

Examined T3 Code commit `52e4b4429359904441039a286c61eaafe8474451`:

- [Claude adapter](https://github.com/pingdotgg/t3code/blob/52e4b4429359904441039a286c61eaafe8474451/apps/server/src/provider/Layers/ClaudeAdapter.ts): native task lifecycle, continuing SDK stream and late parent messages.
- [Background liveness](https://github.com/pingdotgg/t3code/blob/52e4b4429359904441039a286c61eaafe8474451/apps/server/src/orchestration/ThreadBackgroundLiveness.ts): working versus monitoring derived from real tasks.
- [Session reaper](https://github.com/pingdotgg/t3code/blob/52e4b4429359904441039a286c61eaafe8474451/apps/server/src/provider/Layers/ProviderSessionReaper.ts): active background work prevents idle reaping.

## Implementation contract

Both native desktop and runner retain Claude input when a successful foreground result arrives while actual native background tasks remain alive. A terminal task event does not itself close input: the following parent answer and result must still be received. Error, Stop and existing maximum runtime bounds retain their termination behavior. Duplicate and stale task events cannot resurrect completed work; tracking and input are bounded.

The native runtime is the sole owner of automatic stdin closure. The previous frontend result-triggered close IPC was removed; its regression proves steering and later background output remain available after the first result.

The application derives Monitoring only from explicit monitor/shell task types; live agent work is Working in background. Descriptions come from native events, not interpretation of assistant prose. Provider death or interruption clears live status. Foreground answer text remains visible while background work continues. No result creates a new user conversation or borrows another thread's execution owner.

## Validation

Independent reviews approved the native lifecycle, runner lifecycle, domain parsing/projection, UI and application integration after fixes. The final frontend suite passed 24,980 tests in 1,653 files. Targeted background parser/projector/UI coverage reached 100% lines and 93.12% branches. Runner macOS checks/build/full tests passed (319 passed, 21 platform skips); Linux isolated full tests passed (336 passed, two skips), followed by 23 focused tests after the final runner adjustment.

The exact pre-change runner implementation fails the EOF-sensitive delayed-answer test; restoring the corrected implementation passes it. The actual native macOS supervisor subprocess test also passes. These use deterministic simulated providers, not real AI calls. See [process verification](./2026-09-18-background-lifecycle-verification.md).

Final gates passed: frontend typecheck, strict lint, dependency lint, build/bundle budget, hotspot checks, full/changed formatting and whitespace checks. Rust all-target check, library suite (3,703 passed; three ignored), every integration test binary, formatting and strict all-target Clippy passed.

One unrelated Node watch test timed out during the first repeated library pass; its isolated rerun and the subsequent full library pass both passed. An old supervisor integration fixture expected an incomplete JSON prefix to close input; it was strengthened to assert that incomplete input stays open and a completed valid result closes it, then independently reviewed. All integration binaries passed after that test-only correction.

No release, production installation or deployment is included in this implementation turn.
