import { useCallback, type MutableRefObject } from "react";
import { formattingOptionsFromContent } from "../domain/formattingOptionsFromContent";
import {
  planFormatOnSave,
  type FormatOnSavePlan,
} from "../domain/formatOnSave";
import {
  fullDocumentRange,
  javaScriptTypeScriptOnSaveSourceActionKinds,
  organizeImportsCodeActionContext,
  organizeImportsCodeActionToResolve,
  organizeImportsTextEditsForPath,
  planOrganizeImportsOnSave,
} from "../domain/organizeImportsOnSave";
import { optimizePhpImportsSource } from "../domain/phpImportsOrganizer";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import type {
  LanguageServerFeaturesGateway,
  LanguageServerTextEdit,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { applyLanguageServerTextEdits } from "./languageServerTextEdits";

export interface DocumentSavePipelineDependencies {
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  hasPhpWorkspace: boolean;
  languageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  languageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  javaScriptTypeScriptLanguageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChangeForRoot: (
    rootPath: string,
    path: string,
  ) => Promise<void>;
  flushPendingJavaScriptTypeScriptDocumentChangeForRoot: (
    rootPath: string,
    path: string,
  ) => Promise<void>;
  isLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
    owner?: WorkspaceRuntimeOwner,
  ) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
    owner?: WorkspaceRuntimeOwner,
  ) => boolean;
}

export interface DocumentSavePipelineOwnerContext {
  readonly canUseLanguageServerDocument: boolean;
  readonly hasPhpWorkspace: boolean;
  readonly javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly javaScriptTypeScriptRuntimeStatusRoot: string | null;
  readonly owner?: WorkspaceRuntimeOwner;
  readonly phpRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly phpRuntimeStatusRoot: string | null;
  readonly settings: WorkspaceSettings;
}

export interface DocumentSavePipeline {
  formattedContentForSave: (
    document: EditorDocument,
    requestedRoot: string,
  ) => Promise<string>;
  optimizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
  ) => string;
  organizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
    requestedRoot: string,
  ) => Promise<string>;
  formattedContentForOwnerSave: (
    context: DocumentSavePipelineOwnerContext,
    document: EditorDocument,
    requestedRoot: string,
  ) => Promise<string>;
  optimizedImportsContentForOwnerSave: (
    context: DocumentSavePipelineOwnerContext,
    document: EditorDocument,
    content: string,
  ) => string;
  organizedImportsContentForOwnerSave: (
    context: DocumentSavePipelineOwnerContext,
    document: EditorDocument,
    content: string,
    requestedRoot: string,
  ) => Promise<string>;
}

export function useDocumentSavePipeline(
  dependencies: DocumentSavePipelineDependencies,
): DocumentSavePipeline {
  const {
    workspaceSettingsRef,
    hasPhpWorkspace,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    flushPendingDocumentChangeForRoot,
    flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
  } = dependencies;

  const requestFormatOnSaveEdits = useCallback(
    async (
      plan: FormatOnSavePlan,
      requestedRoot: string,
      path: string,
      content: string,
      settings: WorkspaceSettings,
    ): Promise<LanguageServerTextEdit[]> => {
      const options = formattingOptionsFromContent(content, {
        insertSpaces: settings.defaultInsertSpaces,
        tabSize: settings.defaultTabSize,
      });

      if (plan.provider === "javaScriptTypeScript") {
        return javaScriptTypeScriptLanguageServerFeaturesGateway.formatting(
          requestedRoot,
          path,
          options,
        );
      }

      return languageServerFeaturesGateway.formatting(
        requestedRoot,
        path,
        options,
      );
    },
    [
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      languageServerFeaturesGateway,
    ],
  );

  const flushPendingDocumentChangeForFormatOnSave = useCallback(
    async (
      plan: FormatOnSavePlan,
      requestedRoot: string,
      path: string,
    ): Promise<void> => {
      if (plan.provider === "javaScriptTypeScript") {
        await flushPendingJavaScriptTypeScriptDocumentChangeForRoot(
          requestedRoot,
          path,
        );
        return;
      }

      await flushPendingDocumentChangeForRoot(requestedRoot, path);
    },
    [
      flushPendingDocumentChangeForRoot,
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    ],
  );

  const formattedContentForOwnerSave = useCallback(
    async (
      context: DocumentSavePipelineOwnerContext,
      document: EditorDocument,
      requestedRoot: string,
    ): Promise<string> => {
      if (!context.settings.formatOnSave) {
        return document.content;
      }
      if (!context.canUseLanguageServerDocument) {
        return document.content;
      }

      const plan = planFormatOnSave({
        document,
        hasPhpWorkspace: context.hasPhpWorkspace,
        javaScriptTypeScript: {
          status: context.javaScriptTypeScriptRuntimeStatus,
          statusRoot: context.javaScriptTypeScriptRuntimeStatusRoot,
        },
        php: {
          status: context.phpRuntimeStatus,
          statusRoot: context.phpRuntimeStatusRoot,
        },
        workspaceRoot: requestedRoot,
      });

      if (!plan) {
        return document.content;
      }

      const isRequestedSessionActive = () =>
        plan.provider === "javaScriptTypeScript"
          ? isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
              requestedRoot,
              plan.sessionId,
              context.owner,
            )
          : isLanguageServerSessionActiveForRoot(
              requestedRoot,
              plan.sessionId,
              context.owner,
            );

      try {
        // Flush any debounced document change so the language server formats the
        // current content rather than the stale snapshot it last received.
        await flushPendingDocumentChangeForFormatOnSave(
          plan,
          requestedRoot,
          document.path,
        );

        if (!isRequestedSessionActive()) {
          return document.content;
        }

        const edits = await requestFormatOnSaveEdits(
          plan,
          requestedRoot,
          document.path,
          document.content,
          context.settings,
        );

        if (!isRequestedSessionActive()) {
          return document.content;
        }

        if (edits.length === 0) {
          return document.content;
        }

        return applyLanguageServerTextEdits(document.content, edits);
      } catch {
        return document.content;
      }
    },
    [
      flushPendingDocumentChangeForFormatOnSave,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isLanguageServerSessionActiveForRoot,
      requestFormatOnSaveEdits,
    ],
  );

  const activeContext = useCallback((): DocumentSavePipelineOwnerContext => ({
    canUseLanguageServerDocument: true,
    hasPhpWorkspace,
    javaScriptTypeScriptRuntimeStatus:
      javaScriptTypeScriptLanguageServerRuntimeStatusRef.current,
    javaScriptTypeScriptRuntimeStatusRoot:
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
    phpRuntimeStatus: languageServerRuntimeStatusRef.current,
    phpRuntimeStatusRoot: languageServerRuntimeStatusRootRef.current,
    settings: workspaceSettingsRef.current,
  }), [
    hasPhpWorkspace,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    workspaceSettingsRef,
  ]);

  const formattedContentForSave = useCallback(
    (document: EditorDocument, requestedRoot: string) =>
      formattedContentForOwnerSave(activeContext(), document, requestedRoot),
    [activeContext, formattedContentForOwnerSave],
  );

  // Optimize-imports-on-save: a pure, synchronous PHP `use` reorganizer applied
  // to the (already formatted) content just before it is written. It only runs
  // for PHP documents in a PHP workspace when the setting is on, and is a no-op
  // (returns the input) for any other language or when the imports are already
  // clean. Being synchronous, it adds no extra await to the save path, so the
  // existing post-format workspace-root re-check still fully guards the write.
  const optimizedImportsContentForOwnerSave = useCallback(
    (
      context: DocumentSavePipelineOwnerContext,
      document: EditorDocument,
      content: string,
    ): string => {
      if (!context.settings.optimizeImportsOnSave) {
        return content;
      }

      if (!isLanguageServerDocument(document) || !context.hasPhpWorkspace) {
        return content;
      }

      return optimizePhpImportsSource(content) ?? content;
    },
    [],
  );

  const optimizedImportsContentForSave = useCallback(
    (document: EditorDocument, content: string) =>
      optimizedImportsContentForOwnerSave(activeContext(), document, content),
    [activeContext, optimizedImportsContentForOwnerSave],
  );

  // JS/TS source actions on save: unlike the synchronous PHP path, this asks
  // the JS/TS language server for each enabled source action and applies inline
  // same-file edits to the (already formatted) content before it is written.
  // It is async, so the session is re-checked after awaits and the caller
  // re-checks the workspace root before writing. Failures are no-ops.
  const organizedImportsContentForOwnerSave = useCallback(
    async (
      context: DocumentSavePipelineOwnerContext,
      document: EditorDocument,
      content: string,
      requestedRoot: string,
    ): Promise<string> => {
      if (!context.canUseLanguageServerDocument) {
        return content;
      }

      const plan = planOrganizeImportsOnSave({
        document,
        javaScriptTypeScript: {
          status: context.javaScriptTypeScriptRuntimeStatus,
          statusRoot: context.javaScriptTypeScriptRuntimeStatusRoot,
        },
        sourceActionKinds: javaScriptTypeScriptOnSaveSourceActionKinds(
          context.settings,
        ),
        workspaceRoot: requestedRoot,
      });

      if (!plan) {
        return content;
      }

      const isRequestedSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          plan.sessionId,
          context.owner,
        );

      try {
        // Flush any debounced change so the server organizes the current content
        // rather than the stale snapshot it last received.
        await flushPendingJavaScriptTypeScriptDocumentChangeForRoot(
          requestedRoot,
          document.path,
        );

        if (!isRequestedSessionActive()) {
          return content;
        }

        let currentContent = content;

        for (const sourceActionKind of plan.sourceActionKinds) {
          try {
            const actions =
              await javaScriptTypeScriptLanguageServerFeaturesGateway.codeActions(
                requestedRoot,
                document.path,
                fullDocumentRange(currentContent),
                organizeImportsCodeActionContext(sourceActionKind),
              );

            if (!isRequestedSessionActive()) {
              return content;
            }

            let edits = organizeImportsTextEditsForPath(
              actions,
              document.path,
              sourceActionKind,
            );

            if (!edits || edits.length === 0) {
              const actionToResolve = organizeImportsCodeActionToResolve(
                actions,
                sourceActionKind,
              );

              if (actionToResolve) {
                const resolvedAction =
                  await javaScriptTypeScriptLanguageServerFeaturesGateway.resolveCodeAction(
                    requestedRoot,
                    actionToResolve,
                  );

                if (!isRequestedSessionActive()) {
                  return content;
                }

                edits = organizeImportsTextEditsForPath(
                  [resolvedAction],
                  document.path,
                  sourceActionKind,
                );
              }
            }

            if (edits && edits.length > 0) {
              currentContent = applyLanguageServerTextEdits(
                currentContent,
                edits,
              );
              break;
            }
          } catch {
            continue;
          }
        }

        return currentContent;
      } catch {
        return content;
      }
    },
    [
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
    ],
  );

  const organizedImportsContentForSave = useCallback(
    (document: EditorDocument, content: string, requestedRoot: string) =>
      organizedImportsContentForOwnerSave(
        activeContext(),
        document,
        content,
        requestedRoot,
      ),
    [activeContext, organizedImportsContentForOwnerSave],
  );

  return {
    formattedContentForSave,
    formattedContentForOwnerSave,
    optimizedImportsContentForSave,
    optimizedImportsContentForOwnerSave,
    organizedImportsContentForSave,
    organizedImportsContentForOwnerSave,
  };
}
