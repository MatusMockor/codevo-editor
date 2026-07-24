# Codevo Editor — Project Instructions

These project rules take precedence over global Claude instructions where they conflict.

## Product direction and current priority

Codevo is a native desktop IDE, not a browser editor demo.

The current priority is practical VS Code parity for everyday JavaScript, TypeScript,
Node.js, and Express development. Work on PHP, Nette, Laravel, or PhpStorm parity only
when the user explicitly changes the priority.

Focus on workflows developers actually use:

- editing, navigation, diagnostics, completion, rename, references, and code actions;
- project and monorepo awareness;
- package scripts, tasks, Jest/Vitest, coverage, and Problems integration;
- launch configurations and reliable Node debugging;
- breakpoints, exception policies, call stacks, scopes, variables, Watch, evaluation,
  mutation, Debug Console, hover/inline values, restart, attach, and native Node watch;
- Express routes and server-oriented project intelligence.

Do not claim parity with VS Code's extension ecosystem, arbitrary DAP adapters, remote
development, containers, or unsupported platforms. Report implemented capability and
remaining gaps separately.

## Autonomous execution and maximal safe delegation

The lead agent is a coordinator and integrator, not the only implementer.

- Delegate as much independent work as safely possible to subagents.
- Fill all available concurrency slots when there are genuinely independent tasks.
- Subagents may delegate further when that increases parallelism without overlapping
  ownership.
- Decompose work by explicit file/module ownership and give every agent a bounded
  outcome, validation commands, and forbidden files.
- Prefer parallel streams such as domain contract, application orchestration, Rust
  backend, UI/tests, and independent audit.
- Never assign two writing agents to the same files or tightly coupled code at the same
  time. Use one owner and make other agents read-only reviewers.
- Keep one lead agent responsible for integration, conflict resolution, full-suite
  validation, and the final truth about completion.
- After an implementation slice, use a different subagent for a read-only adversarial
  review. The author must not be the only reviewer.
- Address actionable findings and rerun the relevant gates.
- Do not leave agents silently running or assume they continue in the background.
  Check their state, collect their results, and interrupt obsolete work.
- If the user says stop, immediately stop all subagents and make no further changes.

Parallelism is not permission to produce disconnected designs. Agents must share the
same contracts and dependency direction, while retaining non-overlapping write scopes.

## Delivery workflow

For each slice:

1. Inspect the current dirty worktree and preserve all existing user changes.
2. Map the behavior, ownership boundaries, contracts, and failure modes.
3. Split independent work across subagents.
4. Add a failing or adversarial regression test when practical.
5. Implement the smallest complete vertical slice.
6. Run focused tests while iterating.
7. Request an independent read-only review.
8. Resolve findings.
9. Run all applicable repository gates, not only focused tests.
10. Report what is proven, what remains unsupported, and any residual risk.

Do not commit, push, create a branch, or open a pull request unless the user explicitly
asks. Never discard, reset, rewrite, or broadly format unrelated worktree changes.

## Dependency rule and layer boundaries

Dependencies point inward:

```text
Framework/UI/IPC
        ↓
Infrastructure adapters
        ↓
Application use cases and ports
        ↓
Pure domain model and policies
```

### Domain

The domain contains immutable data, invariants, parsers, policies, state transitions,
and pure transformations.

- No React, Tauri, Monaco, filesystem, process, network, timer, or global-state imports.
- Prefer discriminated unions/enums over combinations of booleans.
- Make invalid states unrepresentable where practical.
- Parse external input once into a closed internal type.
- Reject unknown or unsupported variants fail-closed.

### Application

The application layer coordinates use cases and owns workflow state.

- Depend on ports/interfaces, not concrete framework gateways.
- Capture workspace/session/owner authority before asynchronous work.
- Revalidate authority after every `await` and before every mutation or side effect.
- Keep orchestration in focused coordinators or hooks, not giant controllers.
- Model long-running operations as explicit state machines.

### Ports and infrastructure adapters

Ports define the minimum capability required by the application. Adapters implement
those ports for Tauri, Monaco, Node/CDP, LSP, filesystem, processes, or persistence.

- IPC contracts are strict, bounded, typed, and reject unknown fields.
- Do not pass raw shell commands, arbitrary runtime flags, regexes, environment maps,
  or executable payloads when a closed semantic command can be used instead.
- Keep TypeScript and Rust wire contracts synchronized with tests on both sides.

### Framework and composition roots

React, Tauri, Monaco, and runtime setup belong at the outside edge.

- `App.tsx`, `useWorkbenchController.ts`, and Rust `lib.rs` are composition roots, not
  places for business logic.
- Composition roots may wire dependencies but must delegate behavior to focused
  modules.
- New production modules should remain below repository hotspot limits.
- Do not solve hotspot failures by increasing the baseline when a coherent extraction
  exists.

## Design patterns

Use patterns because they clarify ownership or variability, not to decorate code.

### Architectural and framework-level patterns

These patterns define boundaries between larger parts of the system:

- **Ports and Adapters / Hexagonal Architecture** — domain and application logic depend
  on stable ports; Tauri, Monaco, CDP, LSP, filesystem, and process code are adapters.
- **Clean Architecture dependency rule** — framework details depend on application
  policies, never the reverse.
- **Application Service / Use Case** — one focused coordinator implements one workflow.
- **Gateway** — a typed boundary to IPC or another external subsystem.
- **Repository** — access to persisted workspace-scoped state behind a narrow contract.
- **Presenter / View Model** — converts domain state into safe bounded UI data.
- **Reducer / State Machine** — lifecycle-heavy React and debugger state transitions.
- **Facade** — exposes a deliberately small surface over a complex subsystem.
- **Dependency Injection** — pass ports explicitly through composition roots; avoid
  service locators.

React-specific guidance:

- Use focused hooks for application coordination and reducers for lifecycle state.
- Keep components declarative and side effects in owned effects/coordinators.
- Preserve hook ordering.
- Effects must clean up subscriptions, timers, process/session ownership, and stale
  async work.
- Tests must use React-aware `act`, `waitFor`, or equivalent settlement. Never suppress
  warnings to make a suite appear clean.

### OOP and GoF-level patterns

These patterns structure collaboration inside a layer:

- **Strategy** — replaceable parsing, launch, filtering, replay, or matching policy.
- **State** — explicit debugger/task/watch lifecycle behavior by state.
- **Command** — typed user or IPC intentions with bounded validated payloads.
- **Adapter** — translate an external API into an internal port.
- **Factory / Abstract Factory** — construct validated runtime/session families without
  leaking concrete types.
- **Observer** — bounded event delivery with explicit subscription ownership.
- **Facade** — narrow entry point to a complex implementation.
- **Builder** — only for construction with many validated optional fields.
- **Guard / RAII** — Rust ownership for permits, process groups, file descriptors,
  rollback, cancellation, and cleanup.

Prefer composition over inheritance. Avoid deep class hierarchies, mutable singletons,
service locators, boolean-flag APIs, and speculative generic abstractions.

### Functional patterns

TypeScript and Rust should also use functional techniques:

- pure parsing and validation functions;
- immutable snapshots;
- algebraic data types/discriminated unions;
- exhaustive matching;
- explicit `Result`/error values;
- transformation pipelines with bounded inputs and outputs.

## Workspace and async isolation

Per-project isolation is a critical invariant.

- No runtime process, LSP response, debugger event, index, diagnostic, completion,
  watcher, terminal, task, or cached result may leak between workspace tabs.
- Capture the exact workspace root, registered identity, session, generation, epoch,
  and owner before starting asynchronous work.
- Revalidate the captured authority after every `await` and immediately before
  publishing state or performing a side effect.
- Treat workspace A → B → A as different ownership generations.
- A path string alone is not identity. Use canonical/descriptor-backed identity where
  security or correctness depends on the exact file.
- Dirty editor state and on-disk state are distinct authorities.
- Late, duplicate, foreign, reordered, or stale results must fail closed.
- Use monotonic generations and exact owner leases rather than “currently active”
  guesses.

For operations that cross an irreversible boundary, use a two-phase protocol:

1. prepare and retain exact authority;
2. revalidate/confirm immediately before the irreversible action;
3. commit once;
4. compensate or clean up on uncertain settlement.

Confirmation must be exact-owner, single-use, bounded by timeout, and safe under Stop,
Drop, panic, disconnect, trust revocation, and workspace replacement.

## Rust backend rules

- Never execute user-derived shell command strings.
- Use typed no-shell process plans with bounded arguments, environment, output, time,
  and concurrency.
- Retain workspace/file descriptor identity across sensitive operations.
- Own and reap the complete process group on timeout, cancellation, failure, panic, or
  Drop.
- Never hold a global registry mutex across filesystem, process, network, CDP, or
  callback work.
- Use RAII guards for permits, cleanup, rollback, and partial ownership transfer.
- Panic paths must not strand registry entries, processes, waiters, or locks.
- Tauri commands should be thin facades that dispatch blocking work off the UI runtime.
- `lib.rs` is a composition root. Put substantive behavior in focused modules.

## TypeScript and frontend rules

- Keep IPC/domain contracts `readonly` and closed.
- Validate inbound and outbound values at boundaries.
- Never expose process IDs, inspector URLs, raw arguments, environment values, source
  payloads, or opaque backend capabilities in React state or the DOM unless required.
- Keep exact capabilities and owner leases private to the application layer.
- Separate display models from executable/private recipes.
- Use exhaustive switches and `never` checks for closed unions.
- Do not use `any` to bypass a contract.
- Avoid giant hooks and forwarding-only abstractions. Extract coherent ownership and
  lifecycle responsibilities.

## Performance, large files, and responsiveness

The editor must feel as immediate and predictable as VS Code during everyday work,
including large files, large repositories, and monorepos. Correct behavior that freezes
typing, scrolling, navigation, or the window is not complete.

- Keep the UI/main thread free of filesystem crawling, parsing, indexing, hashing,
  process waits, large serialization, and other blocking work.
- Never perform an unbounded full-file or full-workspace scan on every keystroke.
- Prefer incremental parsing, incremental indexes, dirty-region updates, cached
  immutable snapshots, and invalidation of only the affected owner.
- Debounce and coalesce edit-driven work, cancel superseded requests, and publish only
  the latest exact-owner result.
- Move CPU-heavy or blocking work to workers or Rust blocking pools. Returning a
  Promise does not make synchronous work non-blocking.
- Avoid repeatedly cloning large strings, ASTs, arrays, maps, IPC payloads, or Monaco
  models. Pass compact identities and bounded projections where possible.
- Paginate, stream, window, or virtualize large result sets. React must not render
  thousands of rows when a viewport-sized projection is sufficient.
- Cap decorations, diagnostics, inline values, tree nodes, retained console output,
  events, and cached documents. Eviction must be deterministic.
- Keep frequently updated state local. Avoid rerendering the whole workbench for cursor,
  scroll, terminal-output, debugger-event, or single-document changes.
- Batch related state changes and IPC/event delivery without hiding intermediate
  ownership or failure states.
- Use fast-path checks before expensive canonicalization, parsing, indexing, or runtime
  discovery, while preserving the authoritative validation at the security boundary.

Large-file behavior must degrade gracefully:

- Detect expensive files by measured bytes, line count, and feature cost rather than
  filename alone.
- Preserve essential editing, save, search, go-to-line, and basic navigation.
- Disable or reduce expensive semantic features explicitly and truthfully instead of
  freezing, crashing, silently truncating, or publishing incomplete results as complete.
- Show a bounded large-file/degraded-mode reason when a user-visible capability is
  reduced.
- Re-enable capabilities when the exact document becomes eligible again; do not leak a
  degraded state to another tab or workspace generation.

Performance work requires evidence:

- Measure before and after changes using representative small, large, and adversarial
  files and repositories.
- Add regression tests or benchmarks for hot paths when they can be deterministic.
- Test rapid typing, scrolling, cancellation storms, repeated workspace switches,
  large output bursts, and large result sets.
- Track latency, allocations/retained memory, IPC payload size, queue depth, and work
  performed per edit where relevant.
- Do not trade correctness, owner isolation, or cleanup for a benchmark result.
- Do not call a performance task complete based only on successful functional tests.

## Boundedness and security

Every external or workspace-derived operation needs explicit limits:

- input bytes and UTF-8-safe output bytes;
- item, file, directory, edge, page, and event counts;
- recursion/depth;
- queue capacity and concurrency;
- timeout and cancellation;
- retained state and cache eviction.

Validate before expensive work. Never silently truncate in a way that presents partial
data as complete; expose a bounded/truncated state.

Trusted workspace code still requires exact workspace isolation, process ownership,
bounded resources, and truthful failure handling.

## Testing and completion criteria

Focused tests are iteration tools, not completion proof.

Before declaring a slice complete, run all applicable gates:

```bash
npm run check
npm run lint -- --max-warnings 0
npm run build
npm run size:hotspots
npm run format:check
npm run format:check:changed
npm test -- --run

cd src-tauri
cargo check --all-targets
cargo test --lib
cargo test --tests
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

Run coverage when the changed surface is covered by the repository coverage workflow.
Also run `git diff --check`.

Test race and failure paths, not only success:

- workspace A → B → A;
- dirty document during pending work;
- symlink/case/path aliases;
- stale, duplicate, foreign, reordered, and late events;
- timeout, cancellation, Stop, Drop, panic, and disconnect;
- partial start and rollback;
- queue/output/size limit exhaustion;
- reentrant callbacks and concurrent replacement.

Do not call work “done” while the tree does not compile, a required gate fails, an
independent P0/P1 finding remains, or the documented claim is stronger than the proof.

## Review and repository hygiene

- Do not use CodeRabbit in this project. Never run `coderabbit` or `cr`.
- Delegate review to a separate read-only AI subagent.
- Preserve unrelated dirty worktree changes.
- Avoid destructive Git commands.
- Do not update baselines merely to silence a regression.
- Do not commit generated build output, temporary fixtures, logs, coverage artifacts,
  or agent scratch files.
- Commit messages must not contain AI, Claude, Anthropic, or co-author attribution.
- Commit or push only after explicit user authorization.

## Communication

- Lead with the current outcome and concrete evidence.
- During long work, report which parallel streams are active and what each owns.
- Distinguish passing focused tests from passing full gates.
- Never say agents are still working without checking their actual state.
- Never say a feature is complete while validation is unfinished.
- State supported and unsupported scope plainly; avoid invented percentages unless they
  are clearly labeled as estimates and backed by a capability inventory.
