import type { ReactElement } from "react";
import { ToastNotification } from "./ToastNotification";

interface LanguageServerCrashNoticeProps {
  message: string;
  onDismiss(): void;
  onOpenRuntimePanel(): void;
}

export function LanguageServerCrashNotice({
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
