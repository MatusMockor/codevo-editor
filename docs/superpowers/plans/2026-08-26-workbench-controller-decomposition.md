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
- For every slice: focused tests, independent adversarial read-only review, the full required gate set, one commit, and one push to `main`.
- Run the Phase 3 production build once after all extraction and performance slices are integrated.

## Correctness debts resolved during decomposition

- `setSmartMode` must capture the exact workspace runtime owner and generation, then revalidate after every gateway, runtime-stop, and persistence await. Root equality alone does not reject an A-to-B-to-A replacement.
- Agent favorites, CLI paths, and appearance must persist through a narrow app-preferences command derived from app-settings persistence. They must not invoke workspace trust, runtime, indexing, PHP probe, or Git settings work.
- Ref bridges that break definition cycles remain ordered: initialize the stable delegate before consumers, then assign the final owner implementation at the existing point in hook order.
