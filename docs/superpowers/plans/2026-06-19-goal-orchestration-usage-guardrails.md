# Goal Orchestration and Usage Guardrails

## Goal

Move Codevo Editor toward two product targets without losing work or looping after context compaction:

- VS Code-like JavaScript/TypeScript intelligence in Basic mode.
- PhpStorm-like PHP IDE mode for OOP, Laravel, and later other framework providers.

## Current Distance

This is an execution estimate, not a completion claim:

- JavaScript/TypeScript Basic mode: about 75-85% toward a VS Code-like daily workflow. The managed TypeScript language-server runtime, workspace isolation, navigation, completions, diagnostics, code actions, symbols, hierarchy, settings, and inferred workspace planning are in place. Remaining risk is mostly exact VS Code parity, real-project UI QA, and edge cases around tsserver behavior.
- PHP IDE mode: about 45-60% toward PhpStorm-like Laravel/OOP assistance. The provider architecture, Laravel gating, receiver inference, local scopes, Eloquent/builder helpers, snippets, and workspace-aware routing are in place. Remaining work is a deeper semantic engine: richer symbol table, stronger type resolver, trait/context-aware diagnostics, framework plugins, and real Laravel project QA.
- Multi-project runtime isolation: materially improved, but still needs continuous regression coverage as PHP/JS/TS runtime features expand.

## Usage and Fanout Mode

Codex app usage quota is not exposed through the local goal API or repo tools. The app UI can show usage-limit warnings before tools can report a numeric percentage.

Default mode after a quota reset:

- Use parallel agents aggressively when tasks are independent.
- Prefer several bounded workers over one large monolithic implementation pass.
- Keep shared architecture and integration in the main agent.
- Keep checkpoint discipline even when usage is healthy.

Near-limit fallback:

- If the app UI shows usage-limit or near-limit warnings, stop fanout immediately.
- Finish only the smallest safe checkpoint.
- Run the narrowest relevant verification.
- Commit and push before continuing later.

Do not use `get_goal` as a Codex quota meter. It is goal/task metadata, not app usage quota.

## Orchestration Rules

- Main agent owns architecture, integration, final review, tests, commits, and pushes.
- Use subagents only for bounded, independent work.
- In normal/reset usage mode, spawn as many subagents as are useful when their ownership is truly independent.
- In near-limit mode, reduce to 0-2 subagents and prioritize checkpointing over breadth.
- Give every subagent a disjoint file/module ownership boundary.
- Never let subagents edit the same core controller/runtime files in parallel unless one is read-only.
- If the task touches shared contracts, the main agent implements or serializes that part.
- Close subagents after their result is integrated or rejected.
- Track outstanding subagent work explicitly before starting another implementation wave.

## Checkpoint Rules

Every implementation chunk should end with:

1. `git status --short --branch`
2. focused tests for touched code
3. broader check when practical:
   - frontend/domain: `npm run check`, targeted `npm test`
   - Rust/Tauri: `cargo test --manifest-path src-tauri/Cargo.toml` or targeted Rust tests
   - build when frontend wiring changes: `npm run build`
4. `git diff --check`
5. commit and push if green

Do not continue into another broad feature with uncommitted passing work.

## Context Compaction Rules

After compaction, resume from current state, not memory:

1. Read `git status --short --branch`.
2. Read recent commits with `git log --oneline -8`.
3. Read this guardrail file.
4. Read the relevant product plan:
   - JS/TS: `docs/superpowers/plans/2026-06-17-js-ts-vscode-parity.md`
   - multi-project/runtime: `docs/superpowers/plans/2026-06-17-multi-project-ide-tabs.md`
   - PHP/Laravel/OOP: use current domain/application tests and latest plan docs as source of truth.
5. Pick one bounded chunk that moves the real goal forward.

If the same subproblem reappears after compaction, check recent commits/tests before reimplementing it.

## Next Work Order

1. Finish VS Code-like JS/TS Basic-mode gaps with real runtime validation where feasible.
2. Strengthen JS/TS project-tab runtime isolation tests whenever a runtime feature is added.
3. Move to PHP IDE mode semantic depth:
   - framework provider boundaries
   - Laravel model/repository/service typing
   - trait/context-aware diagnostics
   - implementation chooser behavior
   - completion quality and method/property presentation
4. Add PhpStorm-like Laravel QA scenarios against the user's Laravel project when GUI/computer access is available.
