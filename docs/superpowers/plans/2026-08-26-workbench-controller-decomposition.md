# Workbench Controller Decomposition

Date: 2026-08-26
Baseline: `6203a40b`, 8,199 physical lines, 8,194 hotspot raw lines, 29,168 structural tokens

## Goal

Reduce `useWorkbenchController` to a composition root without changing public behavior, hook order, runtime ownership, or post-await authority checks. Every extraction is reviewed and committed independently. `npm run size:hotspots:update` may only record a measured decrease.

## Ordered extractions

1. Git coordinator
   - Current ranges: 1615-1685, 3736-3817, 5897-6206.
   - Boundary: replaced diff cleanup, repository discovery, status/diff/history/branch operations, commit and push commands.
   - Target: `src/application/workbenchController/useWorkbenchGitCoordinator.ts` with entry hooks invoked at the original positions so hook and effect order stays unchanged.
   - Expected reduction: about 330 raw lines and 1,200 structural tokens.

2. Task and debug runtime
   - Current range: 5545-5856.
   - Boundary: terminal test runner, VS Code tasks, package scripts, debug orchestration, cursor debugging, run without debugging, launch configuration surface, reveal/open-terminal actions, framework panel launchers.
   - Target: `src/application/workbenchController/useWorkbenchTaskDebugCoordinator.ts`.
   - Expected reduction: about 220 raw lines and 800 structural tokens.

3. Language runtime and diagnostics
   - Current ranges: 893-925, 1715-2436, 7572-7718.
   - Boundary: PHP and JavaScript/TypeScript runtime status, plans, diagnostics, session currency, install/start/stop/autostart, subscriptions, incremental sync, and changed-document scheduling.
   - Target: `src/application/workbenchController/useWorkbenchLanguageRuntimeCoordinator.ts`, with the late subscription entry point retained at its original hook-order position.
   - Shared refs at current lines 926-930 stay in the composition root until their framework or workspace owner is extracted.
   - Expected reduction: about 720 raw lines and 2,600 structural tokens.

4. Framework intelligence and navigation
   - Current range: 6208-7038.
   - Boundary: PHP framework caches, semantic providers, completions, signatures, code actions, definitions, hierarchy and history navigation.
   - Target: `src/application/workbenchController/useWorkbenchFrameworkIntelligenceCoordinator.ts`.
   - Expected reduction: about 680 raw lines and 2,500 structural tokens.

5. Editor and document session
   - Current ranges: 3618-3726, 4072-4309, 4569-5542.
   - Boundary: document tabs, save ownership and conflicts, close/group operations, recently closed tabs, editing and markdown commands, test navigation, and navigation activation.
   - Targets: `src/application/workbenchController/useWorkbenchDocumentLifecycle.ts` and `src/application/workbenchController/useWorkbenchEditorSessionCoordinator.ts`, shipped as one responsibility slice.
   - Expected reduction: about 1,050 raw lines and 3,700 structural tokens.

6. Workspace lifecycle
   - Current ranges: 807-823, 2518-3601, 4311-4567.
   - Boundary: workspace identity authority, reset/open/restore, directory/package loading, close authority, runtime teardown, and tab close.
   - Target: `src/application/workbenchController/useWorkbenchWorkspaceLifecycle.ts`, with authority/open/close entry hooks called at their original positions.
   - Expected reduction: about 1,150 raw lines and 4,000 structural tokens.

## Invariants and validation

- Preserve React hook order and the controller return contract after every extraction.
- Keep one owner for every mutable ref or state transition.
- Capture exact root, workspace identity, owner key, generation, and request token before every await and revalidate each after await before mutation.
- Keep closed unions exhaustive and strict IPC unchanged.
- Add focused tests around the new coordinator boundary when behavior is not already covered by controller preview tests.
- For every slice: focused tests, independent adversarial read-only review, the full required gate set, and one local commit to `main`. Do not push; the user pushes after the program is complete.
- Run the Phase 3 production build once after all extraction and performance slices are integrated.

## Round 2 execution record

Round 2 started from `041c44e8` with 5,798 raw lines and 19,332 structural tokens in `useWorkbenchController`. It ended at `363f87ab` with 5,673 raw lines and 18,490 structural tokens, a measured reduction of 125 raw lines and 842 structural tokens. The hotspot baseline was lowered after every controller extraction and was never increased.

| Responsibility                 | Original controller region                                                                 | Extracted boundary                                                             | Commit     | Raw lines | Structural tokens |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------- | --------: | ----------------: |
| Language runtime projection    | Runtime state and derived projection around the former 893-925 and 1715-2436 regions       | `useWorkbenchLanguageRuntimeProjection`                                        | `46c69e25` |     5,771 |            19,121 |
| Language runtime subscriptions | Late runtime-event subscription entry point formerly in the 7572-7718 region               | `useWorkbenchLanguageRuntimeSubscriptionsCoordinator`                          | `40435a74` |     5,761 |            19,073 |
| Incremental document sync      | Changed-document scheduling shared by the controller and language runtime coordinator      | `useWorkbenchChangedDocumentSyncCoordinator`                                   | `86924142` |     5,756 |            19,041 |
| Workspace identity authority   | Workspace lifecycle identity ownership formerly centered in the 2518-3601 region           | `useWorkspaceIdentityAuthority`                                                | `e753bfec` |     5,747 |            18,918 |
| Exact backend teardown         | Rust workspace registry and runtime teardown boundary                                      | `dispose_registered_workspace` and unregister modules                          | `cbd62d1d` |     5,747 |            18,918 |
| Workspace open and restore     | Open admission, startup restore, and hydration ownership                                   | `useWorkspaceOpenRequestLifecycle` and settings hydration                      | `2bff5ffd` |     5,733 |            18,832 |
| Exact close teardown           | Task, lease, backend, cache, trust, and identity settlement                                | `registeredWorkspaceCloseCoordinator` and `useWorkbenchCloseLifecycle`         | `a5e92e24` |     5,723 |            18,751 |
| Workspace tab close            | Dirty-scope preparation, teardown handoff, retained-state cleanup, and next-tab activation | `useWorkbenchWorkspaceTabCloseCoordinator` and `workspaceRetainedStateCleanup` | `363f87ab` |     5,673 |            18,490 |

All eight slices received focused regression tests and an independent read-only adversarial review before their local `main` commit. The required frontend gates passed for every commit. Cargo gates were run sequentially whenever the slice touched Rust or completed a phase boundary. The production build ran once for the integrated phase. No round 2 commit was pushed.

## Correctness debts resolved during decomposition

- `setSmartMode` must capture the exact workspace runtime owner and generation, then revalidate after every gateway, runtime-stop, and persistence await. Root equality alone does not reject an A-to-B-to-A replacement.
- Agent favorites, CLI paths, and appearance must persist through a narrow app-preferences command derived from app-settings persistence. They must not invoke workspace trust, runtime, indexing, PHP probe, or Git settings work.
- Ref bridges that break definition cycles remain ordered: initialize the stable delegate before consumers, then assign the final owner implementation at the existing point in hook order.

## Round 3 extraction plan

Round 3 starts at `d47d7f92` with 5,660 raw lines and 18,447 structural tokens. The hard target is at most 3,000 raw lines and 10,000 structural tokens. Line ranges below are inclusive positions in that starting snapshot and must be remapped after every extraction.

1. Editor and file surface
   - Range: 3123-3560.
   - Destination: `useWorkbenchEditorFileCoordinator.ts`.
   - Boundary: document tabs, Git changes, PHP outline and change signature, workspace edits, reveal, preview, and file-open ownership.
   - Net reduction budget: at least 298 raw lines and 1,014 structural tokens.
   - Completed in `82eb75fd`: 5,660 to 5,336 raw lines and 18,447 to 17,380 structural tokens. Independent adversarial review: clean.

2. Document save and close
   - Range: 3562-3967.
   - Destination: `useWorkbenchDocumentSaveCloseCoordinator.ts`.
   - Boundary: save authority, conflicts, lifecycle exclusion, group and tab close, retained-state cleanup, workspace close, and quit ownership.
   - Net reduction budget: at least 271 raw lines and 844 structural tokens.
   - Completed after `82eb75fd`: 5,336 to 5,065 raw lines and 17,380 to 16,531 structural tokens. Independent adversarial review: clean.

3. Editor and navigation tools
   - Range: 3968-4682.
   - Destination: `useWorkbenchEditorNavigationCoordinator.ts`.
   - Boundary: editor commands, task/debug navigation, auxiliary panels, local history, framework navigation, language navigation, navigation history, and file operations.
   - Net reduction budget: at least 535 raw lines and 1,338 structural tokens.

4. Settings, commands, and late effects
   - Range: 4683-5180.
   - Destination: `useWorkbenchCommandEffectsCoordinator.ts`.
   - Boundary: settings and managed-install commands, Pint, floating surfaces, command registry, native menu, keyboard shortcuts, persistence, hydration, file changes, and ordered runtime subscriptions.
   - Net reduction budget: at least 373 raw lines and 880 structural tokens.

5. Workspace transition and lifecycle
   - Range: 2042-3121.
   - Destination: `useWorkbenchWorkspaceTransitionCoordinator.ts`.
   - Boundary: exact workspace identity and runtime ownership, reset, open, restore, activation, package and settings loading, close preparation, and post-await authority revalidation.
   - Net reduction budget: at least 820 raw lines and 3,403 structural tokens.

6. Public controller facade
   - Range: 5181-5659.
   - Destination: `createWorkbenchControllerResult.ts`.
   - Boundary: the exact public return contract and final presentation projection after the preceding coordinators expose typed output facets.
   - Net reduction budget: at least 390 raw lines and 1,100 structural tokens.

The six starting regions contain 3,616 raw lines and 10,946 structural tokens. Replacement wiring is capped at 880 raw lines and 2,310 tokens, projecting a controller of about 2,924 raw lines and 9,811 structural tokens before import cleanup. Every slice preserves render-time ref bridge assignment order, lowers both hotspot dimensions, receives an independent adversarial review, passes the complete gate set, and is committed and pushed independently.
