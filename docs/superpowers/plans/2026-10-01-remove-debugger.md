# Remove the interactive debugger (full removal)

Date: 2026-10-01. Owner decision: "Remove the debugger from the editor completely; it's
irrelevant now because the AI does all the debugging." This is a full removal, not a hide.

## Scope decision

Remove everything that exists only for the interactive debugger:

- Node CDP/inspector debugging (launch, attach, attach process picker, native Node
  `--watch` debugging, compound launches, child targets, source maps, smart step);
- PHP DBGp/Xdebug debugging (`php-script`, `php-test-file`, `php-listen` launch targets);
- breakpoints (line, inline, conditional, hit-count, logpoints, function breakpoints,
  breakpoint groups, activate/deactivate), exception pause policies and exception type
  filters, call stacks, scopes/variables/paging, Watch, evaluation, Set Value/Set
  Expression, Debug Console with completions, hover/inline values, stopped-line
  decorations, restart, restart frame, run to cursor, step commands;
- debug toolbar, debug side column/sections, Debug console drawer view, editor More-menu
  debug items, breakpoint gutter glyphs/menu, debug palette entries and keybindings;
- "Debug Test at Cursor" / test explorer debug buttons (the test runner itself stays);
- launch configurations: `.codevo/launch.json` editor dialog, `.vscode/launch.json` import,
  preLaunchTask/postDebugTask coordinators, `serverReadyAction` URL opener, the settings
  row "Node launch configurations" ("used by the Node debugger").

Judgment call - "Run Without Debugging" (Ctrl+F5) and the launch-configuration "Run"
launcher are removed too. They are implemented as the debug launch plan with the
inspector flags stripped (`debug_node_launch::build_run_plan`, `DebugLaunchTarget`),
are driven only by launch configurations, and live in the keymap "Debug" category. The
Rust `node_run_tasks` module and the TS `nodeRunTask` gateway exist only for that flow.
Running code stays available through package scripts, tasks.json tasks, the terminal and
the Jest/Vitest test runner. If the owner wants a plain "Run active file" later it should
be rebuilt on the package/task runner, not on the debugger launch plan.

Files in user workspaces (`.codevo/launch.json`, `.vscode/launch.json`) are never touched;
they are simply no longer read.

## Keep (shared pieces)

| Piece | Why kept | Action |
| --- | --- | --- |
| `debug_support::DebugProcessHandle` (supervise/terminate process group) | used by `js_test_run`, `js_test_task_runner`, `js_test_batch`, `package_commands`, `symfony_commands` | move to a neutral module (e.g. `supervised_process.rs`) with a neutral name; delete the rest of `debug_support.rs` |
| `debug_workspace_authority.rs` (`retain_workspace_root`, `retained_workspace_authority`, `DebugWorkspaceAuthority`, `RetainedDebugWorkspaceRoot`) | used by the terminal (`terminal_commands`, `terminal_commands/repository_target.rs`, `terminal_session.rs`) for descriptor-backed root identity | move to a neutral module (e.g. `retained_workspace_root.rs`), rename types without "Debug", keep its tests |
| `workspace_runtime` disposal, trust revocation, workspace unregister, git worktree removal, runtime shutdown | they also dispose terminals/tasks/LSP | remove only the debug-session disposer arms |
| `tungstenite` crate | used by `remote_runner` | keep; drop `sourcemap` / `unicode-*` crates only if no non-debug user remains |
| Jest/Vitest runner, coverage, Problems, continuous run, test explorer | kept feature | remove only the "debug" mode/buttons/commands |
| `vscode_tasks*`, `vscode_process_task*`, `node_package_*`, terminal | kept feature | remove only pre/post-launch-task coordinators that live in debug modules |
| `runtimeObservability` "debug bundle" (paste-ready diagnostics text) | not the debugger; a runtime diagnostics export | keep |
| `latencyTracker` | kept | drop only the `debug-variables-render` / `debug-console-append` metrics |
| `npm run debug*` package scripts, `scripts/qa-*`, perf CDP client | dev tooling (Tauri dev build, WebView CDP) unrelated to the in-app debugger | keep |
| `--cv-breakpoint` token | only used by breakpoint glyphs | remove together with glyph CSS (legacy-token ratchet must pass) |
| Neon/jsconfig schema strings mentioning "debugger", PHP/JS `debugger` keyword lists | language data, not the feature | keep |

## Contracts and commands removed

Tauri commands (and their TS IPC contracts/gateways): `debug_start`, `debug_start_compound`,
`debug_start_native_node_watch`, `debug_confirm_native_node_watch`,
`debug_list_node_attach_candidates`, `debug_start_node_attach_candidate`, `debug_stop`,
`debug_disconnect`, `debug_pause`, `debug_step`, `debug_restart_frame`,
`debug_run_to_location`, `debug_stack_trace`, `debug_scopes`, `debug_variables`,
`debug_evaluate`, `debug_completions`, `debug_set_breakpoints`,
`debug_set_breakpoints_active`, `debug_set_function_breakpoints`,
`debug_set_exception_pause`, `debug_set_variable`, `debug_set_expression`,
`workspace_start_node_run_task`, `workspace_acknowledge_node_run_task_start`,
`workspace_stop_node_run_task`, plus their events (debug events, node-run-task-status).
Managed state removed: `DebugSessionRegistry`, `NodeAttachCandidatePublicationRegistry`,
`NodeRunTaskRegistry`. No JSON under `contracts/` is debug-only (verified); the
`tauriIpcContractArchitecture` test is updated to drop the removed contracts.

## Keybindings / commands removed

Keymap ids: `debug.start` (F5), `debug.runWithoutDebugging` (Ctrl+F5), `debug.restart`,
`debug.runToCursor`, `debug.stop` (Shift+F5), `workbench.action.debug.disconnect`,
`debug.toggleBreakpoint` (F9), `workbench.debug.viewlet.action.toggleBreakpointsActivatedAction`,
`editor.debug.action.toggleInlineBreakpoint` (Shift+F9), `workbench.action.debug.callStack*`,
`workbench.action.debug.restartFrame`, `debug.setVariable`, `debug.addToWatchExpressions`,
`debug.stepOver` (F10), `debug.stepInto` (F11), `debug.stepOut` (Shift+F11),
`debug.focusConsole`, `debug.clearConsole`, `testing.debugAtCursor`.
Palette/registry-only ids: `debug.attachNode`, `debug.continue`, `debug.pause`,
`debug.openPanel`, `debug.listenPhp`, `debug.configureNodeLaunchConfigurations`,
`debug.selectAndStartConfiguration`, `debug.selectAndStartWithoutDebugging`,
`debug.stopWithoutDebugging`, `debug.enable/disable/removeAllBreakpoints`,
`debug.copy*`, `debug.evaluateInConsole`, `debug.setWatchExpression`,
`debug.addToWatchAtCursor`, `debug.hover.copyEvaluatePath`,
`editor.debug.action.goToNext/PreviousBreakpoint`, `workbench.debug.viewlet.action.copyValue`.

## Settings and persisted state - migration

- Keymap overrides: `normalizeKeymapSettings` iterates only known command ids, so stored
  overrides for removed `debug.*` ids are ignored on load and dropped on the next save.
  Add a regression test that a keymap blob containing removed ids loads cleanly.
- Settings: no debugger settings fields exist in `domain/settings.ts`; only the settings
  registry row `index.nodeLaunchConfigurations` and its page action are removed.
- Workspace session snapshot: `bottomPanelView: "debug"` was never persisted
  (`persistedBottomPanelView` maps it to `problems`); sidebar views have no debug view.
  The `BottomPanelView`/`EditorDrawerView` union loses `"debug"`; any restore path must
  keep falling back to `problems` for unknown views.
- localStorage keys (all prefixed `mockor.debug.`): `breakpoints.<root>`,
  `breakpointGroups.collapsed.<root>`, `consoleHistory.<root>`,
  `functionBreakpoints.<root>`, `functionBreakpointsMigrationOwner...`, `watch.<root>`.
  One-time cleanup: a small pure function removes every key starting with
  `mockor.debug.` from the storage at startup (bounded by the storage length, never
  throws; storage errors are swallowed). Covered by a test.

## Order of deletion (keeps the tree compiling per stream)

Rust stream (owner: Rust agent, `src-tauri/**`):
1. Extract shared pieces (`DebugProcessHandle`, workspace root retention) into neutral
   modules; repoint callers; build green.
2. Unregister debug and node-run Tauri commands and managed state in
   `lib_composition/runtime.rs`; remove debug arms from workspace facade, unregister,
   trust revocation, git worktree, runtime shutdown, workspace runtime disposal.
3. Delete `debug_*` modules, `node_run_tasks.rs`, `real_node_test_admission.rs` (only
   included by `debug_node_process`), `tests/debug_*`, and debug test modules in
   `lib_composition`; drop unused crates; update hotspot baseline entries.

TS stream A (owner: core agent, `src/application/**`, `src/domain/**`,
`src/infrastructure/**`, `src/test/**`):
1. Remove debug orchestration from the workbench controller (`useWorkbenchTaskDebugCoordinator`
   keeps only the task part), command registry, keymap, js-test commands.
2. Delete debug/launch/node-run domain, application and infrastructure files and tests.
3. Add the localStorage cleanup and keymap migration test.

TS stream B (owner: UI agent, `src/components/**`, `src/ui/**`, `src/App.tsx`,
`src/App.css`, `src/workbenchComposition.ts`, root `src/*.test.*`):
1. Remove debug panels, toolbar, drawer view, editor gutter/hover/inline decorations,
   More-menu items, settings row, launch dialogs, test-explorer debug buttons.
2. Delete debug components, CSS and the `--cv-breakpoint` token.

Streams A and B land together for TS (shared compile unit); they coordinate on the
controller return shape. Finally: hotspot baseline lowered with `npm run
size:hotspots:update` (never raised), docs updated, full gates, independent review.

## Docs

- `CLAUDE.md`: drop the debugger from product priority and race-test bullets.
- `README.md` and `docs/FEATURES.md`: remove debugger feature claims/sections.
- `CHANGELOG.md`: left to the lead.
- Historical plans under `docs/superpowers/` and `docs/PROGRESS.md`-style logs are
  history and are not rewritten; `docs/IDE_PARITY.md` gets a removal note.

## Appendix A - TypeScript files to delete (candidates, reviewed per file)

- `src/application/` (183): `debugAddToWatchCommandBridge.test.ts`, `debugAddToWatchCommandBridge.ts`, `debugBreakpointMutationQueue.test.ts`, `debugBreakpointMutationQueue.ts`, `debugBreakpointSynchronization.test.ts`, `debugBreakpointSynchronization.ts`, `debugCompoundSessionProjection.test.ts`, `debugCompoundSessionProjection.ts`, `debugCompoundStart.test.ts`, `debugCompoundStart.ts`, `debugConsoleKeyboardRouting.integration.test.tsx`, `debugCopyValue.test.ts`, `debugCopyValue.ts`, `debugCopyValueCommandBridge.test.ts`, `debugCopyValueCommandBridge.ts`, `debugFrameSelection.ts`, `debugInlineValueContext.test.ts`, `debugInlineValueContext.ts`, `debugOutputBatchCoordinator.test.ts`, `debugOutputBatchCoordinator.ts`, `debugPendingStartEvents.test.ts`, `debugPendingStartEvents.ts`, `debugRestartCoordinator.test.ts`, `debugRestartCoordinator.ts`, `debugSessionContracts.ts`, `debugSessionDefaults.ts`, `debugSessionOwnerProjection.ts`, `debugSessionOwnership.ts`, `debugSetVariableCommandBridge.test.ts`, `debugSetVariableCommandBridge.ts`, `debugStartConfirmation.ts`, `debugStartDescriptor.ts`, `debugStartGate.test.ts`, `debugStartGate.ts`, `debugVariablePageAuthority.test.ts`, `debugVariablePageAuthority.ts`, `debugWatchRefreshPolicy.ts`, `jsTestDebugLaunch.test.ts`, `jsTestDebugLaunch.ts`, `nativeNodeWatchDebugOrchestration.test.ts`, `nodeDebugCompoundRecipe.test.ts`, `nodeDebugCompoundRecipe.ts`, `nodeDebugCompoundSessionCoordinator.test.ts`, `nodeDebugCompoundSessionCoordinator.ts`, `nodeDebugCompoundStartCoordinator.test.ts`, `nodeDebugCompoundStartCoordinator.ts`, `nodeDebugPreLaunchTaskCoordinator.test.ts`, `nodeDebugPreLaunchTaskCoordinator.ts`, `nodeDebugPreparedLaunchRecipe.test.ts`, `nodeDebugPreparedLaunchRecipe.ts`, `nodeLaunchConfigurationLoader.test.ts`, `nodeLaunchConfigurationLoader.ts`, `nodeRunConfigurationStrategy.test.ts`, `nodeRunConfigurationStrategy.ts`, `nodeRunWithoutDebuggingPresentation.test.ts`, `nodeRunWithoutDebuggingPresentation.ts`, `nodeRunWithoutDebuggingResolver.ts`, `postDebugTaskCoordinator.test.ts`, `postDebugTaskCoordinator.ts`, `serverReadyActionCoordinator.test.ts`, `serverReadyActionCoordinator.ts`, `useBreakpointGroupCollapseState.test.tsx`, `useBreakpointGroupCollapseState.ts`, `useBreakpointRowFocus.ts`, `useConfiguredNodeLaunchStarter.test.tsx`, `useConfiguredNodeLaunchStarter.ts`, `useDebugAddToWatchComposition.test.tsx`, `useDebugAddToWatchComposition.ts`, `useDebugBreakpointActivation.ts`, `useDebugBreakpointAtCursor.ts`, `useDebugBreakpointManagement.ts`, `useDebugBreakpointNavigation.test.tsx`, `useDebugBreakpointNavigation.ts`, `useDebugCallStackNavigation.test.tsx`, `useDebugCallStackNavigation.ts`, `useDebugCandidateClipboardCommand.ts`, `useDebugCommandBridges.ts`, `useDebugConsole.test.tsx`, `useDebugConsole.ts`, `useDebugConsoleCompletion.ts`, `useDebugConsoleCompletions.test.tsx`, `useDebugConsoleCompletions.ts`, `useDebugConsoleSurfaceCommands.test.tsx`, `useDebugConsoleSurfaceCommands.ts`, `useDebugCopyDisplayedValue.ts`, `useDebugCopyEvaluatePath.test.tsx`, `useDebugCopyEvaluatePath.ts`, `useDebugCopyStackTrace.test.tsx`, `useDebugCopyStackTrace.ts`, `useDebugCopyValue.test.tsx`, `useDebugCopyValue.ts`, `useDebugCopyValueComposition.test.tsx`, `useDebugCopyValueComposition.ts`, `useDebugEvaluateInConsole.test.tsx`, `useDebugEvaluateInConsole.ts`, `useDebugEvaluation.ts`, `useDebugExceptionPause.test.tsx`, `useDebugExceptionPause.ts`, `useDebugFrameSelectionLifecycle.ts`, `useDebugFunctionBreakpointManagement.test.tsx`, `useDebugFunctionBreakpointManagement.ts`, `useDebugFunctionBreakpointSessionAuthority.ts`, `useDebugHoverEvaluation.test.tsx`, `useDebugHoverEvaluation.ts`, `useDebugInlineBreakpoint.test.tsx`, `useDebugInlineBreakpoint.ts`, `useDebugInlineBreakpointMutations.ts`, `useDebugInlineVariableLoading.test.tsx`, `useDebugInlineVariableLoading.ts`, `useDebugInspectionOwnerInvalidation.ts`, `useDebugLocationOpener.test.tsx`, `useDebugLocationOpener.ts`, `useDebugRestartFrame.test.tsx`, `useDebugRestartFrame.ts`, `useDebugRestartFrameLifecycle.ts`, `useDebugRunToCursor.test.tsx`, `useDebugRunToCursor.ts`, `useDebugSession.test.tsx`, `useDebugSession.ts`, `useDebugSessionEnd.ts`, `useDebugSessionEventProjection.ts`, `useDebugSetExpression.test.tsx`, `useDebugSetExpression.ts`, `useDebugSetVariable.test.tsx`, `useDebugSetVariable.ts`, `useDebugVariableMutationRows.test.tsx`, `useDebugVariableMutationRows.ts`, `useDebugWatchAtCursor.test.tsx`, `useDebugWatchAtCursor.ts`, `useDebugWatchExpressionMutations.test.tsx`, `useDebugWatchExpressionMutations.ts`, `useDebugWatchExpressions.test.tsx`, `useDebugWatchExpressions.ts`, `useEditorBreakpointGutterMenu.ts`, `useJsTestDebugAtCursor.test.tsx`, `useJsTestDebugAtCursor.ts`, `useJsTestExplorerDebug.test.tsx`, `useJsTestExplorerDebug.ts`, `useNodeDebugAttach.test.ts`, `useNodeDebugAttach.ts`, `useNodeDebugAttachProcessPicker.test.tsx`, `useNodeDebugAttachProcessPicker.ts`, `useNodeDebugCompoundComposition.test.tsx`, `useNodeDebugCompoundComposition.ts`, `useNodeDebugConfigurationLauncher.test.tsx`, `useNodeDebugConfigurationLauncher.ts`, `useNodeDebugPreLaunchComposition.test.tsx`, `useNodeDebugPreLaunchComposition.ts`, `useNodeLaunchConfigurationPicker.test.tsx`, `useNodeLaunchConfigurationPicker.ts`, `useNodeLaunchConfigurationsSurface.test.tsx`, `useNodeLaunchConfigurationsSurface.ts`, `useNodeLaunchWorkspaceCurrent.ts`, `useNodeRunConfigurationLauncher.test.tsx`, `useNodeRunConfigurationLauncher.ts`, `useNodeRunWithoutDebugging.test.tsx`, `useNodeRunWithoutDebugging.ts`, `useWorkbenchDebugBreakpointNavigationComposition.test.ts`, `useWorkbenchDebugCallStackNavigationComposition.test.ts`, `useWorkbenchDebugCopyStackTraceComposition.test.ts`, `useWorkbenchDebugCopyValueComposition.test.ts`, `useWorkbenchDebugInlineBreakpointComposition.test.ts`, `useWorkbenchDebugOrchestration.configurationLauncher.test.tsx`, `useWorkbenchDebugOrchestration.debugHover.test.tsx`, `useWorkbenchDebugOrchestration.nodeAttachPicker.test.tsx`, `useWorkbenchDebugOrchestration.test.ts`, `useWorkbenchDebugOrchestration.ts`, `useWorkbenchDebugRestartFrameComposition.test.ts`, `useWorkbenchDebugWatchAtCursorComposition.test.ts`, `useWorkbenchJsTestCursorDebugging.test.tsx`, `useWorkbenchJsTestCursorDebugging.ts`, `useWorkbenchJsTestDebugAtCursorComposition.test.ts`, `useWorkbenchNodeRunComposition.test.ts`, `useWorkbenchNodeRunWithoutDebugging.ts`, `useWorkbenchServerReadyActionComposition.test.ts`, `vscodeNodeLaunchConfigurationLoader.test.ts`, `vscodeNodeLaunchConfigurationLoader.ts`, `workbenchDebugCommands.test.ts`, `workbenchDebugCommands.ts`, `workbenchDebugControllerOptions.test.ts`, `workbenchDebugControllerOptions.ts`, `workbenchNodeRunCommands.test.ts`, `workbenchNodeRunCommands.ts`
- `src/application/workbenchController/` (2): `useWorkbenchTaskDebugCoordinator.ts`, `useWorkbenchTaskDebugNavigationCoordinator.test.tsx`
- `src/components/` (72): `DebugConsolePanel.test.tsx`, `DebugConsolePanel.tsx`, `DebugConsolePanel.virtualization.test.tsx`, `DebugPanel.breakpointGroups.test.tsx`, `DebugPanel.test.tsx`, `DebugPanel.tsx`, `DebugVariableTree.test.tsx`, `DebugVariableTree.tsx`, `DebugVariableTree.virtualization.test.tsx`, `DebugWatchesPanel.test.tsx`, `DebugWatchesPanel.tsx`, `DebugWatchesPanel.virtualization.test.tsx`, `EditorBreakpointGutterMenu.test.tsx`, `EditorBreakpointGutterMenu.tsx`, `EditorSurface.debugWatchAtCursorCapture.test.ts`, `ExceptionTypeFilter.test.tsx`, `ExceptionTypeFilter.tsx`, `FunctionBreakpoints.test.tsx`, `FunctionBreakpoints.tsx`, `NodeDebugAttachProcessPicker.test.tsx`, `NodeDebugAttachProcessPicker.tsx`, `NodeDebugAttachProcessPickerHost.tsx`, `NodeDebugConfigurationPicker.test.tsx`, `NodeDebugConfigurationPicker.tsx`, `NodeDebugLaunchSelector.test.tsx`, `NodeDebugLaunchSelector.tsx`, `NodeLaunchConfigurationPicker.test.tsx`, `NodeLaunchConfigurationPicker.tsx`, `NodeLaunchConfigurationsAction.test.tsx`, `NodeLaunchConfigurationsAction.tsx`, `NodeLaunchConfigurationsDialog.test.tsx`, `NodeLaunchConfigurationsDialog.tsx`, `NodeRunWithoutDebuggingPickerAction.test.tsx`, `NodeRunWithoutDebuggingPickerAction.tsx`, `debugAddToWatchSurface.ts`, `debugBreakpointNavigationMonacoReader.test.ts`, `debugBreakpointNavigationMonacoReader.ts`, `debugConsoleRenderItems.test.ts`, `debugConsoleRenderItems.ts`, `debugConsoleRenderedSegments.ts`, `debugCopyValueSurface.test.ts`, `debugCopyValueSurface.ts`, `debugEvaluateInConsoleMonacoReader.test.ts`, `debugEvaluateInConsoleMonacoReader.ts`, `debugHoverMonacoProvider.test.ts`, `debugHoverMonacoProvider.ts`, `debugInlineBreakpointMonacoReader.test.ts`, `debugInlineBreakpointMonacoReader.ts`, `debugInlineSourceAdmissionCoordinator.test.ts`, `debugInlineSourceAdmissionCoordinator.ts`, `debugRenderWork.perf.test.ts`, `debugSetVariableKey.test.ts`, `debugSetVariableKey.ts`, `debugSetVariableSurface.ts`, `debugValueContextMenuItems.test.ts`, `debugValueContextMenuItems.ts`, `debugVariableTreeRows.test.ts`, `debugVariableTreeRows.ts`, `debugWatchAtCursorMonacoReader.ts`, `debugWatchValueContextMenuItems.test.ts`, `debugWatchValueContextMenuItems.ts`, `useAppTestDebugPanels.problems.test.tsx`, `useAppTestDebugPanels.ts`, `useDebugInlineValueDecorations.test.tsx`, `useDebugInlineValueDecorations.ts`, `useDebugPanelProps.test.tsx`, `useDebugPanelProps.ts`, `useDebugStoppedLineDecoration.ts`, `useEditorBreakpointDecorations.test.tsx`, `useEditorBreakpointDecorations.ts`, `useNodeLaunchConfigurationsDialogController.test.tsx`, `useNodeLaunchConfigurationsDialogController.ts`
- `src/components/debug/` (22): `DebugActionButton.tsx`, `DebugBreakpoints.tsx`, `DebugCallStack.tsx`, `DebugConsoleRegion.test.tsx`, `DebugConsoleRegion.tsx`, `DebugExceptionRows.tsx`, `DebugSection.tsx`, `DebugSectionsRegion.test.tsx`, `DebugSectionsRegion.tsx`, `DebugToolbarRegion.test.tsx`, `DebugToolbarRegion.tsx`, `DebugVariables.tsx`, `DebugViewsRevealContext.ts`, `debug.css`, `debugListLayout.ts`, `debugLocationLabels.ts`, `debugPanelStatus.test.ts`, `debugPanelStatus.ts`, `debugPanelTestProps.ts`, `debugStackTraceCapability.ts`, `usePrivateDebugRegions.test.tsx`, `usePrivateDebugRegions.tsx`
- `src/components/editorPanel/` (4): `EditorDebugToolbarContext.ts`, `editorDebugToolbarRenderWork.perf.test.tsx`, `useEditorDebugFocus.test.tsx`, `useEditorDebugFocus.ts`
- `src/components/editorSurfaceCore/` (1): `useEditorDebugCaptureReaders.ts`
- `src/domain/` (91): `debug.test.ts`, `debug.ts`, `debugBreakpointGroups.test.ts`, `debugBreakpointGroups.ts`, `debugBreakpointGutterMenu.test.ts`, `debugBreakpointGutterMenu.ts`, `debugBreakpointHitCondition.test.ts`, `debugBreakpointHitCondition.ts`, `debugBreakpointLocation.test.ts`, `debugBreakpointLocation.ts`, `debugBreakpointLogMessage.test.ts`, `debugBreakpointLogMessage.ts`, `debugBreakpointNavigation.test.ts`, `debugBreakpointNavigation.ts`, `debugBreakpointNavigationCapture.test.ts`, `debugBreakpointNavigationCapture.ts`, `debugBreakpointPersistence.test.ts`, `debugBreakpointPersistence.ts`, `debugBreakpointPolicy.test.ts`, `debugBreakpointPolicy.ts`, `debugBreakpoints.test.ts`, `debugBreakpoints.ts`, `debugCallStackNavigation.test.ts`, `debugCallStackNavigation.ts`, `debugConsoleCompletions.test.ts`, `debugConsoleCompletions.ts`, `debugConsoleState.test.ts`, `debugConsoleState.ts`, `debugEvaluateInConsoleCapture.test.ts`, `debugEvaluateInConsoleCapture.ts`, `debugEvaluationPolicy.test.ts`, `debugEvaluationPolicy.ts`, `debugExceptionRows.test.ts`, `debugExceptionRows.ts`, `debugExceptionTypeFilter.test.ts`, `debugExceptionTypeFilter.ts`, `debugFunctionBreakpoints.test.ts`, `debugFunctionBreakpoints.ts`, `debugHoverExpression.test.ts`, `debugHoverExpression.ts`, `debugInlineBreakpointCapture.test.ts`, `debugInlineBreakpointCapture.ts`, `debugInlineValues.test.ts`, `debugInlineValues.ts`, `debugScriptPath.ts`, `debugServerReadyUrl.test.ts`, `debugServerReadyUrl.ts`, `debugSessionState.test.ts`, `debugSessionState.ts`, `debugStackTrace.test.ts`, `debugStackTrace.ts`, `debugVariableMutation.test.ts`, `debugVariableMutation.ts`, `debugVariablePages.test.ts`, `debugVariablePages.ts`, `debugVariableRanges.test.ts`, `debugVariableRanges.ts`, `debugWatchAtCursorCapture.test.ts`, `debugWatchAtCursorCapture.ts`, `debugWatchExpressions.test.ts`, `debugWatchExpressions.ts`, `debugWatchPayload.ts`, `debugWatchPersistence.test.ts`, `debugWatchPersistence.ts`, `editorDebugFocus.test.ts`, `editorDebugFocus.ts`, `jsTestDebugAtCursor.test.ts`, `jsTestDebugAtCursor.ts`, `jsTestDebugScope.test.ts`, `jsTestDebugScope.ts`, `nativeNodeWatchDebugGateway.ts`, `nativeNodeWatchLaunchIntent.test.ts`, `nativeNodeWatchLaunchIntent.ts`, `nodeDebugAttachCandidate.test.ts`, `nodeDebugAttachCandidate.ts`, `nodeDebugJustMyCode.ts`, `nodeDebugPostTask.test.ts`, `nodeDebugPostTask.ts`, `nodeDebugPreLaunchTask.test.ts`, `nodeDebugPreLaunchTask.ts`, `nodeDebugTaskLabel.ts`, `nodeLaunchConfiguration.test.ts`, `nodeLaunchConfiguration.ts`, `nodeNativeWatchLaunchPolicy.test.ts`, `nodeNativeWatchLaunchPolicy.ts`, `nodeRunTask.test.ts`, `nodeRunTask.ts`, `vscodeLaunchGlobList.test.ts`, `vscodeLaunchGlobList.ts`, `vscodeNodeLaunchConfiguration.test.ts`, `vscodeNodeLaunchConfiguration.ts`
- `src/infrastructure/` (23): `debugVariablePageWireValidation.ts`, `tauriDebugCompletionsContract.test.ts`, `tauriDebugGateway.test.ts`, `tauriDebugGateway.ts`, `tauriDebugIpcContract.test.ts`, `tauriDebugIpcContract.ts`, `tauriDebugIpcProtocol.ts`, `tauriNativeNodeWatchDebugGateway.test.ts`, `tauriNativeNodeWatchDebugIpcContract.test.ts`, `tauriNodeDebugAttachCandidateGateway.test.ts`, `tauriNodeDebugAttachCandidateGateway.ts`, `tauriNodeDebugAttachCandidateIpcContract.test.ts`, `tauriNodeDebugAttachCandidateIpcContract.ts`, `tauriNodeDebugAttachStartGateway.test.ts`, `tauriNodeDebugAttachStartGateway.ts`, `tauriNodeDebugAttachStartIpcContract.test.ts`, `tauriNodeDebugAttachStartIpcContract.ts`, `tauriNodeRunTaskGateway.test.ts`, `tauriNodeRunTaskGateway.ts`, `tauriNodeRunTaskIpcContract.test.ts`, `tauriNodeRunTaskIpcContract.ts`, `tauriServerReadyExternalUrlOpener.test.ts`, `tauriServerReadyExternalUrlOpener.ts`
- `src/test/` (1): `debugWatchMocks.ts`

## Appendix B - Rust files to delete

- `src-tauri/src/` (141): `debug_adapter.rs`, `debug_adapter_factory.rs`, `debug_adapter_registry_compound_tests.rs`, `debug_adapter_registry_lifecycle_tests.rs`, `debug_adapter_registry_session_tests.rs`, `debug_adapter_registry_startup_tests.rs`, `debug_adapter_registry_tests.rs`, `debug_adapter_registry_wire_tests.rs`, `debug_adapter_wire_tests.rs`, `debug_breakpoint_policy.rs`, `debug_cdp.rs`, `debug_cdp_breakpoint_rebind.rs`, `debug_cdp_breakpoints.rs`, `debug_cdp_clipboard.rs`, `debug_cdp_collection_variables.rs`, `debug_cdp_completion_tests.rs`, `debug_cdp_completions.rs`, `debug_cdp_connect.rs`, `debug_cdp_descriptor_snapshot_policy.rs`, `debug_cdp_disconnect.rs`, `debug_cdp_disconnect_integration_tests.rs`, `debug_cdp_evaluate_name.rs`, `debug_cdp_factory.rs`, `debug_cdp_function_breakpoints.rs`, `debug_cdp_request_handle.rs`, `debug_cdp_restart_frame.rs`, `debug_cdp_run_to_location.rs`, `debug_cdp_scope.rs`, `debug_cdp_session_routing.rs`, `debug_cdp_set_expression.rs`, `debug_cdp_set_expression_proof.rs`, `debug_cdp_set_expression_provenance.rs`, `debug_cdp_set_expression_target.rs`, `debug_cdp_set_variable.rs`, `debug_cdp_shared_state.rs`, `debug_cdp_smart_step.rs`, `debug_cdp_smart_step_runtime.rs`, `debug_cdp_smart_step_runtime_tests.rs`, `debug_cdp_startup_policy.rs`, `debug_cdp_this_receiver.rs`, `debug_cdp_transport.rs`, `debug_cdp_transport_event_loop.rs`, `debug_cdp_variables.rs`, `debug_cdp_watch_command_api.rs`, `debug_commands.rs`, `debug_commands_authority_tests.rs`, `debug_commands_wire.rs`, `debug_completions_command.rs`, `debug_completions_wire.rs`, `debug_compound_start.rs`, `debug_compound_start_large_group_tests.rs`, `debug_dbgp.rs`, `debug_dbgp_evaluate_policy.rs`, `debug_dbgp_variables.rs`, `debug_desired_policy.rs`, `debug_desired_policy_transaction_tests.rs`, `debug_disconnect_request.rs`, `debug_evaluate_wire.rs`, `debug_exception_type_filter.rs`, `debug_finish_gate.rs`, `debug_hit_condition.rs`, `debug_inspector_attach.rs`, `debug_inspector_discovery.rs`, `debug_inspector_startup.rs`, `debug_logpoint.rs`, `debug_node_attach_candidate_registry.rs`, `debug_node_attach_candidates.rs`, `debug_node_attach_endpoint.rs`, `debug_node_attach_http.rs`, `debug_node_attach_inventory.rs`, `debug_node_attach_inventory_tests.rs`, `debug_node_attach_list_command.rs`, `debug_node_attach_macos.rs`, `debug_node_attach_orchestrator.rs`, `debug_node_attach_socket_owner_macos.rs`, `debug_node_attach_start_command.rs`, `debug_node_child_inspector_discovery_strategy.rs`, `debug_node_child_target_multiplexer.rs`, `debug_node_child_target_registry.rs`, `debug_node_env_file.rs`, `debug_node_launch.rs`, `debug_node_launch_program.rs`, `debug_node_process.rs`, `debug_node_source_map_launch.rs`, `debug_node_stop_on_entry_real_integration_tests.rs`, `debug_node_stop_reap_real_integration_tests.rs`, `debug_node_watch_adapter.rs`, `debug_node_watch_adapter_tests.rs`, `debug_node_watch_breakpoint_sync.rs`, `debug_node_watch_breakpoint_sync_tests.rs`, `debug_node_watch_cdp.rs`, `debug_node_watch_cdp_activation.rs`, `debug_node_watch_cdp_command_runtime.rs`, `debug_node_watch_cdp_command_runtime_tests.rs`, `debug_node_watch_cdp_policy.rs`, `debug_node_watch_cdp_reconcile.rs`, `debug_node_watch_cdp_reconcile_tests.rs`, `debug_node_watch_cdp_target.rs`, `debug_node_watch_command_worker.rs`, `debug_node_watch_command_worker_tests.rs`, `debug_node_watch_control_proxy.rs`, `debug_node_watch_control_proxy_tests.rs`, `debug_node_watch_controller.rs`, `debug_node_watch_controller_tests.rs`, `debug_node_watch_entry_authority.rs`, `debug_node_watch_event_gate.rs`, `debug_node_watch_event_gate_tests.rs`, `debug_node_watch_generation.rs`, `debug_node_watch_generation_tests.rs`, `debug_node_watch_inspection_contract.rs`, `debug_node_watch_inspection_contract_tests.rs`, `debug_node_watch_launch_plan.rs`, `debug_node_watch_launch_policy.rs`, `debug_node_watch_real_integration_tests.rs`, `debug_node_watch_replay.rs`, `debug_node_watch_runtime.rs`, `debug_node_watch_session_factory.rs`, `debug_node_watch_start_command.rs`, `debug_node_watch_start_gate.rs`, `debug_node_watch_supervisor.rs`, `debug_node_watch_supervisor_tests.rs`, `debug_node_watch_workspace_start.rs`, `debug_session_factory.rs`, `debug_session_registry.rs`, `debug_session_registry_disconnect_tests.rs`, `debug_set_breakpoints_active_command.rs`, `debug_set_expression_command.rs`, `debug_set_expression_wire.rs`, `debug_set_variable_command.rs`, `debug_set_variable_wire.rs`, `debug_source_map.rs`, `debug_source_map_adversarial_tests.rs`, `debug_source_map_descriptor.rs`, `debug_source_map_registry.rs`, `debug_source_map_smart_step.rs`, `debug_source_map_smart_step_tests.rs`, `debug_support.rs`, `debug_variable_name.rs`, `debug_variable_page.rs`, `debug_workspace_authority.rs`, `debug_workspace_authority_tests.rs`
- `src-tauri/src/debug_cdp/` (2): `event_sink.rs`, `lifecycle.rs`
- `src-tauri/src/debug_cdp/tests/` (24): `debug_cdp_breakpoint_rebind_tests.rs`, `debug_cdp_clipboard_tests.rs`, `debug_cdp_collection_variables_real_integration_tests.rs`, `debug_cdp_collection_variables_tests.rs`, `debug_cdp_function_breakpoint_real_integration_tests.rs`, `debug_cdp_held_external_attach_tests.rs`, `debug_cdp_hit_condition_tests.rs`, `debug_cdp_inline_breakpoint_tests.rs`, `debug_cdp_internal_step_filter_tests.rs`, `debug_cdp_logpoint_tests.rs`, `debug_cdp_multiline_evaluate_name_tests.rs`, `debug_cdp_pause_generation_floor_tests.rs`, `debug_cdp_restart_frame_tests.rs`, `debug_cdp_run_to_location_tests.rs`, `debug_cdp_session_routing_tests.rs`, `debug_cdp_set_expression_proof_tests.rs`, `debug_cdp_source_map_authority_tests.rs`, `debug_cdp_stop_on_entry_integration_tests.rs`, `debug_cdp_transport_bounds_tests.rs`, `debug_cdp_variable_range_tests.rs`, `debug_cdp_variables_tests.rs`, `debug_cdp_watch_mutation_tests.rs`, `debug_exception_type_filter_integration_tests.rs`, `debug_source_map_registry_forward_lookup_tests.rs`
- `src-tauri/src/debug_cdp_function_breakpoints/` (4): `command.rs`, `installation.rs`, `state.rs`, `worker.rs`
- `src-tauri/src/debug_cdp_function_breakpoints/tests/` (1): `worker_policy_tests.rs`
- `src-tauri/src/debug_cdp_function_breakpoints/worker/` (1): `race_tests.rs`
- `src-tauri/src/debug_dbgp/` (1): `output.rs`
- `src-tauri/src/debug_dbgp/tests/` (4): `debug_dbgp_breakpoint_tests.rs`, `debug_dbgp_launch_argument_tests.rs`, `debug_dbgp_restart_frame_tests.rs`, `debug_dbgp_watch_evaluate_tests.rs`
- `src-tauri/src/debug_node_launch/tests/` (2): `debug_node_launch_runtime_tests.rs`, `debug_node_launch_source_map_tests.rs`
- `src-tauri/src/debug_node_watch_real_integration_tests/` (2): `function_breakpoint.rs`, `policy_replay.rs`
- `src-tauri/tests/` (3): `debug_node_child_inspector_discovery_strategy.rs`, `debug_node_child_target_multiplexer_tests.rs`, `debug_node_child_target_registry.rs`
