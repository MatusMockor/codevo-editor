import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  languageServerDocumentSyncKey,
} from "../domain/languageServerDocumentSync";
import {
  isBenignLanguageServerRequestError,
  languageServerErrorMessage,
} from "../domain/languageServerErrorClassification";
import { pathFromLanguageServerUri } from "../domain/languageServerFeatures";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { isBenignError } from "../infrastructure/globalErrorSafetyNet";
import {
  createWorkbenchNotice,
  languageServerCrashNoticeGroupKey,
  languageServerRequestErrorNoticeGroupKey,
  languageServerRequestErrorToastDismissKey,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";

type MutableRef<T> = { current: T };

export interface LanguageServerFeatureErrorReportingDependencies {
  currentWorkspaceRootRef: MutableRef<string | null>;
  syncedDocumentPathsRef: MutableRef<Set<string>>;
  javaScriptTypeScriptSyncedDocumentPathsRef: MutableRef<Set<string>>;
  lastLanguageServerCrashRef: MutableRef<string | null>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
}

export interface LanguageServerFeatureErrorReporting {
  reportLanguageServerCrash: (error: unknown) => void;
  reportLanguageServerError: (error: unknown) => void;
  reportLanguageServerErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    error: unknown,
  ) => void;
}

export function useLanguageServerFeatureErrorReporting({
  currentWorkspaceRootRef,
  syncedDocumentPathsRef,
  javaScriptTypeScriptSyncedDocumentPathsRef,
  lastLanguageServerCrashRef,
  setMessage,
  setNotices,
}: LanguageServerFeatureErrorReportingDependencies): LanguageServerFeatureErrorReporting {
  const isUnknownDocumentForUnsyncedPath = useCallback(
    (rootPath: string | null | undefined, error: unknown): boolean => {
      const message = languageServerErrorMessage(error);

      if (!message.includes("UnknownDocument")) {
        return false;
      }

      const uri = /Unknown text document "([^"]+)"/.exec(message)?.[1];
      const path = uri ? pathFromLanguageServerUri(uri) : null;

      if (!path || !rootPath) {
        return false;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, path);

      // The document is genuinely unsynced only when neither language server
      // (PHP nor JavaScript/TypeScript) still holds it open. An UnknownDocument
      // error for a document that is still open on either server is a real
      // desync, not the benign close race, so it must not be suppressed.
      return (
        !syncedDocumentPathsRef.current.has(syncKey) &&
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      );
    },
    [javaScriptTypeScriptSyncedDocumentPathsRef, syncedDocumentPathsRef],
  );

  const reportLanguageServerError = useCallback(
    (error: unknown) => {
      // Monaco feature providers (hover/completion/definition/codeAction/
      // rename/references) report their failures through this path. When a tab
      // is closed (didClose) between flushing a document change and the server's
      // reply, phpactor answers with UnknownDocument for a path that is no
      // longer open. That is a benign desync, not a real failure, so suppress it
      // before it surfaces a false error toast or status message. Legitimate
      // errors, and UnknownDocument for a document that is still open, fall
      // through unchanged.
      if (
        isBenignError(error) ||
        isBenignLanguageServerRequestError(error) ||
        isUnknownDocumentForUnsyncedPath(currentWorkspaceRootRef.current, error)
      ) {
        return;
      }

      const nextMessage = languageServerErrorMessage(error);
      setMessage(nextMessage);

      const groupKey = languageServerRequestErrorNoticeGroupKey(
        currentWorkspaceRootRef.current,
      );
      const notice: WorkbenchNotice = {
        ...createWorkbenchNotice(
          "error",
          "Language Server",
          nextMessage,
          groupKey ?? undefined,
        ),
        toastDismissKey:
          languageServerRequestErrorToastDismissKey(
            currentWorkspaceRootRef.current,
            nextMessage,
          ) ?? undefined,
      };

      if (!groupKey) {
        setNotices((current) => [notice, ...current]);
        return;
      }

      setNotices((current) =>
        replaceWorkbenchNoticeGroup(current, groupKey, [notice]),
      );
    },
    [
      currentWorkspaceRootRef,
      isUnknownDocumentForUnsyncedPath,
      setMessage,
      setNotices,
    ],
  );

  const reportLanguageServerCrash = useCallback(
    (error: unknown) => {
      const nextMessage = languageServerErrorMessage(error);
      setMessage(nextMessage);

      if (lastLanguageServerCrashRef.current === nextMessage) {
        return;
      }

      lastLanguageServerCrashRef.current = nextMessage;
      setNotices((current) => [
        createWorkbenchNotice(
          "error",
          "Language Server",
          nextMessage,
          languageServerCrashNoticeGroupKey(currentWorkspaceRootRef.current) ??
            undefined,
        ),
        ...current,
      ]);
    },
    [
      currentWorkspaceRootRef,
      lastLanguageServerCrashRef,
      setMessage,
      setNotices,
    ],
  );

  const reportLanguageServerErrorForActiveWorkspaceRoot = useCallback(
    (rootPath: string | null | undefined, error: unknown) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      if (isUnknownDocumentForUnsyncedPath(rootPath, error)) {
        return;
      }

      reportLanguageServerError(error);
    },
    [
      currentWorkspaceRootRef,
      isUnknownDocumentForUnsyncedPath,
      reportLanguageServerError,
    ],
  );

  return {
    reportLanguageServerCrash,
    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
  };
}
