import { useEffect, useLayoutEffect, useRef } from "react";
import { CommandPalette } from "../components/CommandPalette";
import { QuickOpen } from "../components/QuickOpen";
import { useWorkbenchController } from "../application/useWorkbenchController";
import type { ControllerDependencies, WorkbenchController } from "./workbenchControllerTestHarness";
import { createWorkspaceEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorCursorLease } from "../application/editorCursorStore";

export function WorkbenchHarness({
  dependencies,
  onWorkbench,
  renderQuickOpenSurfaces,
}: {
  dependencies: ControllerDependencies;
  onWorkbench(workbench: WorkbenchController): void;
  renderQuickOpenSurfaces: boolean;
}) {
  const workbench = useWorkbenchController(
    dependencies.workspaceGateways,
    dependencies.smartModeGateway,
    dependencies.workspaceTrustGateway,
    dependencies.indexProgressGateway,
    dependencies.phpFileOutlineGateway,
    dependencies.phpTreeGateway,
    dependencies.gitGateway,
    dependencies.localHistoryGateway,
    dependencies.languageServerGateway,
    dependencies.languageServerRuntimeGateway,
    dependencies.languageServerDocumentSyncGateway,
    dependencies.languageServerDiagnosticsGateway,
    dependencies.languageServerFeaturesGateway,
    dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway,
    dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    dependencies.javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    dependencies.javaScriptTypeScriptLanguageServerFeaturesGateway,
    dependencies.workspaceRuntimeLifecycleGateway,
    dependencies.terminalGateway,
    dependencies.settingsGateway,
    dependencies.prompter,
    dependencies.controllerOptions,
  );
  const cursorStore = dependencies.controllerOptions.editorCursorStore;
  const activeDocumentPath = workbench.activeDocument?.path ?? null;
  const activeGroupId = workbench.editorGroups.activeGroupId;
  const workspaceRoot = workbench.workspaceRoot;
  const workspaceIdentityDescriptor = workbench.workspaceIdentityDescriptor;
  const cursorLeaseRef = useRef<EditorCursorLease | null>(null);
  const cursorPositionsRef = useRef(
    new Map<string, { readonly column: number; readonly lineNumber: number }>(),
  );

  useLayoutEffect(() => {
    if (!cursorStore || !activeDocumentPath) {
      return;
    }

    const cursorPositions = cursorPositionsRef.current;
    const lease = cursorStore.activate({
      documentPath: activeDocumentPath,
      groupId: activeGroupId,
      ownerKey: createWorkspaceEditorSessionOwnerKey(
        workspaceRoot ?? "workbench-controller-test",
        workspaceIdentityDescriptor,
      ),
    });
    cursorLeaseRef.current = lease;
    const cursorKey = lease
      ? JSON.stringify([lease.ownerKey, lease.groupId, lease.documentPath])
      : null;
    const retainedPosition = cursorKey ? cursorPositions.get(cursorKey) : null;
    if (lease && retainedPosition) {
      cursorStore.publish(lease, retainedPosition);
    }

    return () => {
      cursorLeaseRef.current = null;
      if (lease) {
        const snapshot = cursorStore.getSnapshot(lease);
        if (cursorKey && snapshot.status === "available" && snapshot.position) {
          cursorPositions.delete(cursorKey);
          cursorPositions.set(cursorKey, snapshot.position);
          if (cursorPositions.size > 256) {
            const oldestKey = cursorPositions.keys().next().value;
            if (oldestKey !== undefined) {
              cursorPositions.delete(oldestKey);
            }
          }
        }
        cursorStore.deactivate(lease);
      }
    };
  }, [activeDocumentPath, activeGroupId, cursorStore, workspaceIdentityDescriptor, workspaceRoot]);

  useLayoutEffect(() => {
    const lease = cursorLeaseRef.current;
    const target = workbench.editorRevealTarget;
    if (cursorStore && lease && target?.path === activeDocumentPath) {
      cursorStore.publish(lease, target.position);
    }
  }, [activeDocumentPath, cursorStore, workbench.editorRevealTarget]);

  useEffect(() => {
    onWorkbench(workbench);
  }, [onWorkbench, workbench]);

  if (renderQuickOpenSurfaces) {
    return (
      <>
        <CommandPalette
          commands={workbench.commands}
          context={workbench.commandContext}
          initialQuery={workbench.commandPaletteInitialQuery}
          isOpen={workbench.paletteOpen}
          onCommandError={workbench.reportCommandError}
          onClose={() => workbench.setPaletteOpen(false)}
        />
        <QuickOpen
          isLoading={workbench.quickOpenLoading}
          isOpen={workbench.quickOpenOpen}
          isTruncated={workbench.quickOpenTruncated}
          onChangeQuery={workbench.setQuickOpenQuery}
          onClose={() => workbench.setQuickOpenOpen(false)}
          onOpen={workbench.openSearchResult}
          onOpenCurrentFileLocation={workbench.openCurrentFileLocation}
          query={workbench.quickOpenQuery}
          request={workbench.quickOpenRequest}
          results={workbench.quickOpenResults}
        />
      </>
    );
  }

  return null;
}
