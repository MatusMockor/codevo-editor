import type { ReactElement, ReactNode } from "react";
import { languageServerCrashNoticeGroupKey } from "../application/workbenchNotice";
import { ToastNotification } from "./ToastNotification";
import type { NoticeToastRenderer } from "./NoticeToastHost";

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

export type LanguageServerCrashNoticeToastRendererFactoryResult = [
  string,
  NoticeToastRenderer,
];

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

export { languageServerCrashNoticeGroupKey };

interface LanguageServerCrashNoticeProps {
  message: string;
  onDismiss(): void;
  onOpenRuntimePanel(): void;
}

function LanguageServerCrashNotice({
  message,
  onDismiss,
  onOpenRuntimePanel,
}: LanguageServerCrashNoticeProps): ReactElement {
  return (
    <ToastNotification
      actions={[
        {
          id: "open-runtime-panel",
          label: "Open Runtime panel",
          onClick: onOpenRuntimePanel,
          tone: "primary",
        },
      ]}
      description={message}
      onClose={onDismiss}
      template="error"
      title="PHP IDE engine crashed"
    />
  );
}
