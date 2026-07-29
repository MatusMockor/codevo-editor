import { useRef, type MutableRefObject } from "react";
import type { IncrementalLanguageServerDocumentSyncGateway } from "../domain/incrementalLanguageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { IncrementalDocumentSyncCoordinator } from "./incrementalDocumentSyncCoordinator";
import {
  JavaScriptTypeScriptIncrementalSyncProductionCoordinator,
  type JavaScriptTypeScriptIncrementalLegacyRequest,
  type JavaScriptTypeScriptIncrementalRuntimeAuthority,
} from "./javaScriptTypeScriptIncrementalSyncProduction";
import { JavaScriptTypeScriptIncrementalSyncService } from "./javaScriptTypeScriptIncrementalSyncService";

export interface JavaScriptTypeScriptIncrementalSyncComposition {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  readonly gateway?: IncrementalLanguageServerDocumentSyncGateway;
  isHandoffSafe(rootPath: string, path: string): boolean;
  isSessionCurrent(rootPath: string, sessionId: number): boolean;
  readonly productionRef: MutableRefObject<JavaScriptTypeScriptIncrementalSyncProductionCoordinator | null>;
  retireForHandoff(rootPath: string, path: string, isCurrent?: () => boolean): Promise<boolean>;
  readonly runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  readonly runtimeStatusRootRef: MutableRefObject<string | null>;
  readonly syncGenerationRef: MutableRefObject<number>;
  syncOpen(document: EditorDocument, isCurrent?: () => boolean): Promise<void>;
}

export function useJavaScriptTypeScriptIncrementalSyncOwnerRef() {
  return useRef<JavaScriptTypeScriptIncrementalSyncProductionCoordinator | null>(null);
}

export function useJavaScriptTypeScriptIncrementalSyncComposition({
  currentWorkspaceRootRef,
  documentsRef,
  gateway,
  isHandoffSafe,
  isSessionCurrent,
  productionRef,
  retireForHandoff,
  runtimeStatusRef,
  runtimeStatusRootRef,
  syncGenerationRef,
  syncOpen,
}: JavaScriptTypeScriptIncrementalSyncComposition): void {
  const legacyRef = useRef({ isHandoffSafe, retireForHandoff, syncOpen });
  legacyRef.current = { isHandoffSafe, retireForHandoff, syncOpen };
  if (!gateway || productionRef.current) return;
  const runtime = {
    current: () => {
      const rootPath = currentWorkspaceRootRef.current;
      const status = runtimeStatusRef.current;
      const capability = status?.kind === "running" ? status.capabilities.documentSync : null;
      if (
        !rootPath ||
        status?.kind !== "running" ||
        !capability ||
        capability.changeKind !== "incremental" ||
        !capability.openClose ||
        !workspaceRootKeysEqual(runtimeStatusRootRef.current, rootPath)
      ) {
        return null;
      }
      return {
        capability,
        rootPath,
        sessionId: status.sessionId,
        syncGeneration: syncGenerationRef.current,
      };
    },
    isCurrent: (authority: JavaScriptTypeScriptIncrementalRuntimeAuthority) => {
      const current = runtime.current();
      return (
        !!current &&
        current.rootPath === authority.rootPath &&
        current.sessionId === authority.sessionId &&
        current.syncGeneration === authority.syncGeneration &&
        current.capability.changeKind === authority.capability.changeKind &&
        current.capability.openClose === authority.capability.openClose &&
        current.capability.save.kind === authority.capability.save.kind &&
        (current.capability.save.kind !== "supported" ||
          (authority.capability.save.kind === "supported" &&
            current.capability.save.includeText === authority.capability.save.includeText)) &&
        isSessionCurrent(authority.rootPath, authority.sessionId)
      );
    },
  };
  const assertCurrent = (request: JavaScriptTypeScriptIncrementalLegacyRequest) =>
    request.isCurrent() && runtime.isCurrent(request.authority);
  productionRef.current = new JavaScriptTypeScriptIncrementalSyncProductionCoordinator(
    new JavaScriptTypeScriptIncrementalSyncService(
      new IncrementalDocumentSyncCoordinator(),
      gateway,
    ),
    runtime,
    {
      close: async (request) => {
        if (!assertCurrent(request)) {
          throw new Error("Incremental legacy close authority is stale.");
        }
        const { rootPath } = request.authority;
        const settled = await legacyRef.current.retireForHandoff(
          rootPath,
          request.path,
          request.isCurrent,
        );
        if (
          !assertCurrent(request) ||
          !settled ||
          !legacyRef.current.isHandoffSafe(rootPath, request.path)
        ) {
          throw new Error("Legacy JavaScript/TypeScript lifecycle close is uncertain.");
        }
      },
      open: async (request) => {
        if (!assertCurrent(request)) return;
        const document = documentsRef.current[request.path];
        if (document) await legacyRef.current.syncOpen(document, request.isCurrent);
      },
    },
  );
}
