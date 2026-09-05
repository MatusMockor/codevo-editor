import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";

interface NoticeToastContext {
  dismiss: () => void;
}

export type NoticeToastRenderer = (
  notice: WorkbenchNotice,
  context: NoticeToastContext,
) => ReactNode | null;

export const DEFAULT_MAX_VISIBLE_TOASTS = 2;

interface NoticeToastHostProps {
  maxVisible?: number;
  notices: WorkbenchNotice[];
  renderNotice: NoticeToastRenderer;
}

interface RenderedToast {
  readonly key: string;
  readonly node: ReactNode;
}

export function NoticeToastHost({
  maxVisible = DEFAULT_MAX_VISIBLE_TOASTS,
  notices,
  renderNotice,
}: NoticeToastHostProps): ReactNode {
  const [dismissedNoticeKeys, setDismissedNoticeKeys] = useState<Set<string>>(new Set());
  const previousGroupNoticeKeys = useRef<Set<string>>(new Set());

  const getNoticeDismissKey = useCallback((notice: WorkbenchNotice) => {
    if (notice.toastDismissKey) {
      return `notice:${notice.toastDismissKey}`;
    }

    return notice.groupKey ? `group:${notice.groupKey}` : `id:${notice.id}`;
  }, []);

  const dismissNotice = useCallback(
    (notice: WorkbenchNotice) => {
      const key = getNoticeDismissKey(notice);
      setDismissedNoticeKeys((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
    },
    [getNoticeDismissKey],
  );

  useEffect(() => {
    const activeNoticeKeys = new Set(notices.map(getNoticeDismissKey));
    const activeGroupNoticeKeys = new Set(
      notices
        .filter((notice) => notice.groupKey !== undefined && notice.toastDismissKey === undefined)
        .map(getNoticeDismissKey),
    );

    const previouslyActiveGroupNoticeKeys = previousGroupNoticeKeys.current;
    previousGroupNoticeKeys.current = activeGroupNoticeKeys;

    setDismissedNoticeKeys((current) => {
      if (current.size === 0) {
        return current;
      }
      const next = new Set<string>();

      for (const key of current) {
        const previouslyActive = previouslyActiveGroupNoticeKeys.has(key);
        const currentlyActive = activeGroupNoticeKeys.has(key);

        if (
          (key.startsWith("group:") && previouslyActive && currentlyActive) ||
          (!key.startsWith("group:") && activeNoticeKeys.has(key))
        ) {
          next.add(key);
        }
      }

      if (next.size === current.size) {
        return current;
      }

      return next;
    });
  }, [getNoticeDismissKey, notices]);

  const renderedNotices = useMemo(() => {
    const rendered: RenderedToast[] = [];
    const limit = Math.max(1, Math.floor(maxVisible));

    for (const notice of notices) {
      if (dismissedNoticeKeys.has(getNoticeDismissKey(notice))) {
        continue;
      }

      const output = renderNotice(notice, {
        dismiss: () => dismissNotice(notice),
      });

      if (!output) {
        continue;
      }

      rendered.push({ key: notice.id, node: output });

      if (rendered.length >= limit) {
        break;
      }
    }

    return rendered;
  }, [dismissedNoticeKeys, dismissNotice, getNoticeDismissKey, maxVisible, notices, renderNotice]);

  if (renderedNotices.length === 0) {
    return null;
  }

  return (
    <div
      className={renderedNotices.length > 1 ? "toast-region toast-region--stacked" : "toast-region"}
    >
      {renderedNotices.map((entry, index) => {
        const behind = index > 0;
        return (
          <div
            aria-hidden={behind || undefined}
            className={
              behind
                ? "toast-region__slot toast-region__slot--behind"
                : "toast-region__slot toast-region__slot--front"
            }
            inert={behind || undefined}
            key={entry.key}
          >
            {entry.node}
          </div>
        );
      })}
    </div>
  );
}
