import type { MutableRefObject } from "react";
import type { DiagnosticsCoalescer } from "../domain/diagnosticsCoalescer";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  diagnosticsExecutionRoot,
  diagnosticsOwnerKey,
  diagnosticsOwnerLifecycleKey,
  type DiagnosticsChannelKind,
} from "./diagnosticsOwnerIdentity";
import type { DiagnosticsOwnerLifecycleStore } from "./diagnosticsOwnerLifecycleStore";

interface DiagnosticsChannelLifecycleOptions {
  readonly cacheByOwnerRef: MutableRefObject<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  readonly clearUriCapacity: (kind: DiagnosticsChannelKind, ownerKey: string) => void;
  readonly clearVisibleDiagnostics: () => void;
  readonly coalescerRef: MutableRefObject<DiagnosticsCoalescer | null>;
  readonly isOwnerVisible: (
    ownerKey: string,
    executionRoot: string | null | undefined,
    visibleOwnerKeyRef: MutableRefObject<string>,
  ) => boolean;
  readonly kind: DiagnosticsChannelKind;
  readonly lifecycleStore: DiagnosticsOwnerLifecycleStore;
  readonly reportOwnerCapacity: (
    kind: DiagnosticsChannelKind,
    ownerKey: string,
    available: boolean,
  ) => void;
  readonly visibleOwnerKeyRef: MutableRefObject<string>;
}

export function createDiagnosticsChannelLifecycleCoordinator(
  options: DiagnosticsChannelLifecycleOptions,
) {
  const resetContent = (rootPath: string | null | undefined, owner?: WorkspaceRuntimeOwner) => {
    const ownerKey = diagnosticsOwnerKey(rootPath, owner);
    if (ownerKey) {
      delete options.cacheByOwnerRef.current[ownerKey];
      options.lifecycleStore.clearOwnerData(diagnosticsOwnerLifecycleKey(options.kind, ownerKey));
      options.clearUriCapacity(options.kind, ownerKey);
    }
    if (owner) {
      options.coalescerRef.current?.dropOwner(owner.ownerKey);
    } else {
      options.coalescerRef.current?.dropRoot(rootPath);
    }
    if (
      options.isOwnerVisible(
        ownerKey,
        diagnosticsExecutionRoot(rootPath, owner),
        options.visibleOwnerKeyRef,
      )
    ) {
      options.clearVisibleDiagnostics();
    }
  };

  return {
    clear(rootPath: string | null | undefined, owner?: WorkspaceRuntimeOwner) {
      const ownerKey = diagnosticsOwnerKey(rootPath, owner);
      if (owner) {
        options.reportOwnerCapacity(options.kind, ownerKey, true);
        options.lifecycleStore.close(diagnosticsOwnerLifecycleKey(options.kind, ownerKey));
      }
      resetContent(rootPath, owner);
    },
    prepare(rootPath: string | null | undefined, owner?: WorkspaceRuntimeOwner) {
      const ownerKey = diagnosticsOwnerKey(rootPath, owner);
      options.reportOwnerCapacity(
        options.kind,
        ownerKey,
        options.lifecycleStore.prepare(diagnosticsOwnerLifecycleKey(options.kind, ownerKey)),
      );
      resetContent(rootPath, owner);
    },
    reset(rootPath: string | null | undefined, owner?: WorkspaceRuntimeOwner) {
      const ownerKey = diagnosticsOwnerKey(rootPath, owner);
      options.lifecycleStore.resetPending(diagnosticsOwnerLifecycleKey(options.kind, ownerKey));
      resetContent(rootPath, owner);
    },
    resetContent,
  };
}
