import type { ReactNode } from "react";
import {
  languageServerCrashNoticeGroupKey,
  languageServerRequestErrorNoticeGroupKey,
} from "../application/workbenchNotice";
import { ToastNotification } from "./ToastNotification";
import type { NoticeToastRenderer } from "./NoticeToastHost";
import { LanguageServerCrashNotice } from "./LanguageServerCrashNoticeView";

/**
 * "Crash visibility" for the PHP language server: the status-bar chip already
 * turns red the moment `useWorkbenchController`'s existing crash-dedup
 * (`lastLanguageServerCrashRef`) reports a new crash, but that dedup ref lives
 * deep in the controller and is out of scope here. This renderer only adds an
 * actionable surface on top of the *existing*, already-deduped "Language
 * Server" notice: a single, dismissible toast with an "Open Runtime panel"
 * shortcut into the cockpit (PID/stderr/restart), scoped per project so it
 * never leaks across workspace tabs.
 */
export interface LanguageServerCrashNoticeToastContext {
  onOpenRuntimePanel(): void;
  workspaceRoot: string | null;
}

export type LanguageServerCrashNoticeToastRendererFactoryResult = [string, NoticeToastRenderer];

export function languageServerCrashNoticeToastRenderer(
  context: LanguageServerCrashNoticeToastContext,
): LanguageServerCrashNoticeToastRendererFactoryResult | null {
  const groupKey = languageServerCrashNoticeGroupKey(context.workspaceRoot);

  if (!groupKey) {
    return null;
  }

  return [
    groupKey,
    (notice, actions): ReactNode => (
      <LanguageServerCrashNotice
        message={notice.message}
        onDismiss={actions.dismiss}
        onOpenRuntimePanel={() => {
          actions.dismiss();
          context.onOpenRuntimePanel();
        }}
      />
    ),
  ];
}

export const GENERIC_LANGUAGE_SERVER_REQUEST_ERROR_TOAST_TITLE = "Language server request failed";

const LANGUAGE_SERVER_REQUEST_ERROR_TOAST_TITLES_BY_SOURCE: ReadonlyMap<string, string> = new Map([
  ["JavaScript/TypeScript", "TypeScript IDE request failed"],
  ["PHP", "PHP IDE request failed"],
  ["TypeScript", "TypeScript IDE request failed"],
  ["phpactor", "PHP IDE request failed"],
  ["tsserver", "TypeScript IDE request failed"],
]);

export function languageServerRequestErrorToastTitle(source: string | null | undefined): string {
  if (!source) {
    return GENERIC_LANGUAGE_SERVER_REQUEST_ERROR_TOAST_TITLE;
  }

  return (
    LANGUAGE_SERVER_REQUEST_ERROR_TOAST_TITLES_BY_SOURCE.get(source) ??
    GENERIC_LANGUAGE_SERVER_REQUEST_ERROR_TOAST_TITLE
  );
}

export function languageServerRequestErrorNoticeToastRenderer(
  context: Pick<LanguageServerCrashNoticeToastContext, "workspaceRoot">,
): LanguageServerCrashNoticeToastRendererFactoryResult | null {
  const groupKey = languageServerRequestErrorNoticeGroupKey(context.workspaceRoot);

  if (!groupKey) {
    return null;
  }

  return [
    groupKey,
    (notice, actions): ReactNode => (
      <ToastNotification
        description={notice.message}
        onClose={actions.dismiss}
        template="error"
        title={languageServerRequestErrorToastTitle(notice.source)}
      />
    ),
  ];
}

export { languageServerCrashNoticeGroupKey, languageServerRequestErrorNoticeGroupKey };
