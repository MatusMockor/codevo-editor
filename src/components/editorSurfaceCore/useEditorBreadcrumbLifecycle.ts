import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerDocumentSymbol,
  LanguageServerFeaturesGateway,
} from "../../domain/languageServerFeatures";
import { isLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { EditorDocument } from "../../domain/workspace";
import type { EditorRuntimeContextValue } from "../editorRuntimeContext";
import { editorSurfaceBreadcrumbFeaturesGateway } from "../editorSurfaceBreadcrumbGateway";
import type { LanguageServerMonacoDocumentRequestLease } from "../languageServerMonacoProviders";

interface EditorBreadcrumbLifecycleOptions {
  readonly activeDocument: EditorDocument | null;
  readonly activeDocumentIsLargeSmart: boolean;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly errorReporterRef: MutableRefObject<(error: unknown) => void>;
  readonly flushPendingLanguageServerDocument: (path: string) => Promise<void>;
  readonly isLanguageServerDocumentRequestLeaseCurrentRef: MutableRefObject<
    ((lease: LanguageServerMonacoDocumentRequestLease) => boolean) | undefined
  >;
  readonly isLanguageServerDocumentSyncedRef: MutableRefObject<
    ((path: string) => boolean) | undefined
  >;
  readonly javaScriptTypeScriptFeaturesGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
  readonly languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  readonly requestLanguageServerDocumentLeaseRef: MutableRefObject<
    | ((rootPath: string, path: string) => Promise<LanguageServerMonacoDocumentRequestLease | null>)
    | undefined
  >;
  readonly runtime: EditorRuntimeContextValue | null;
  readonly runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  readonly setBreadcrumbSymbolsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDocumentSymbol[]>>
  >;
  readonly workspaceRoot: string | null;
}

/**
 * Owns the delayed, exact-document breadcrumb request lifecycle.
 *
 * The request retains the historical sync polling and lease checks so a late
 * document-symbol response cannot publish into another workspace generation.
 */
export function useEditorBreadcrumbLifecycle({
  activeDocument,
  activeDocumentIsLargeSmart,
  activeDocumentRef,
  errorReporterRef,
  flushPendingLanguageServerDocument,
  isLanguageServerDocumentRequestLeaseCurrentRef,
  isLanguageServerDocumentSyncedRef,
  javaScriptTypeScriptFeaturesGateway,
  languageServerFeaturesGateway,
  requestLanguageServerDocumentLeaseRef,
  runtime,
  runtimeStatusRef,
  setBreadcrumbSymbolsByPath,
  workspaceRoot,
}: EditorBreadcrumbLifecycleOptions): void {
  useEffect(() => {
    if (!activeDocument || !workspaceRoot) {
      return;
    }

    if (activeDocumentIsLargeSmart) {
      setBreadcrumbSymbolsByPath((current) => {
        if (!current[activeDocument.path]) {
          return current;
        }

        const next = { ...current };
        delete next[activeDocument.path];
        return next;
      });
      return;
    }

    const breadcrumbGateway = editorSurfaceBreadcrumbFeaturesGateway(activeDocument, {
      javaScriptTypeScript: javaScriptTypeScriptFeaturesGateway,
      php: languageServerFeaturesGateway,
    });

    if (!breadcrumbGateway) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocument.path;
    const requiresSync = isLanguageServerDocument(activeDocument);
    const requestDocumentLease = requestLanguageServerDocumentLeaseRef.current;
    const isDocumentLeaseCurrent = isLanguageServerDocumentRequestLeaseCurrentRef.current;
    const canUseDocumentLease = Boolean(
      requiresSync && requestDocumentLease && isDocumentLeaseCurrent,
    );
    let active = true;
    let timeout: number | null = null;

    const fetchBreadcrumbSymbols = async () => {
      let documentLease: LanguageServerMonacoDocumentRequestLease | null = null;

      try {
        documentLease = canUseDocumentLease
          ? ((await requestDocumentLease?.(requestedRoot, requestedPath)) ?? null)
          : null;

        if (!active) {
          return;
        }

        if (canUseDocumentLease && (!documentLease || !isDocumentLeaseCurrent?.(documentLease))) {
          return;
        }

        let load = () => breadcrumbGateway.documentSymbols(requestedRoot, requestedPath);
        if (requiresSync) {
          if (!canUseDocumentLease) {
            await flushPendingLanguageServerDocument(requestedPath);
            if (!active) {
              return;
            }
          }

          const document = activeDocumentRef.current;
          const status = runtimeStatusRef.current;
          if (!document || document.path !== requestedPath) {
            return;
          }

          if (
            documentLease &&
            (status?.kind !== "running" || status.sessionId !== documentLease.sessionId)
          ) {
            return;
          }

          if (
            documentLease &&
            status?.kind === "running" &&
            status.rootPath &&
            workspaceRootKeysEqual(status.rootPath, requestedRoot)
          ) {
            const directLoad = load;
            const coordinatedLease = documentLease;
            load = () =>
              runtime?.coordinatePhpDocumentSymbols(
                {
                  content: document.content,
                  lifecycleIdentity: coordinatedLease.lifecycleIdentity,
                  path: requestedPath,
                  rootPath: requestedRoot,
                  runtimeIdentity: languageServerFeaturesGateway,
                  sessionId: coordinatedLease.sessionId,
                },
                directLoad,
              ) ?? directLoad();
          }
        }

        const symbols = await load();
        if (!active) {
          return;
        }

        if (documentLease && !isDocumentLeaseCurrent?.(documentLease)) {
          return;
        }

        setBreadcrumbSymbolsByPath((current) => ({
          ...current,
          [requestedPath]: symbols,
        }));
      } catch (error) {
        if (!active) {
          return;
        }

        if (documentLease && !isDocumentLeaseCurrent?.(documentLease)) {
          return;
        }

        errorReporterRef.current(error);
      }
    };

    const loadBreadcrumbSymbols = () => {
      if (!active) {
        return;
      }

      if (
        requiresSync &&
        !canUseDocumentLease &&
        !isLanguageServerDocumentSyncedRef.current?.(requestedPath)
      ) {
        timeout = window.setTimeout(loadBreadcrumbSymbols, 160);
        return;
      }

      void fetchBreadcrumbSymbols();
    };

    timeout = window.setTimeout(loadBreadcrumbSymbols, 160);

    return () => {
      active = false;

      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [
    activeDocument,
    activeDocumentIsLargeSmart,
    activeDocumentRef,
    errorReporterRef,
    flushPendingLanguageServerDocument,
    isLanguageServerDocumentRequestLeaseCurrentRef,
    isLanguageServerDocumentSyncedRef,
    javaScriptTypeScriptFeaturesGateway,
    languageServerFeaturesGateway,
    requestLanguageServerDocumentLeaseRef,
    runtime,
    runtimeStatusRef,
    setBreadcrumbSymbolsByPath,
    workspaceRoot,
  ]);
}
