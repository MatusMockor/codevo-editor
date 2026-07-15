import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { WorkbenchNotice } from "../application/workbenchNotice";

interface NoticeToastContext {
  dismiss: () => void;
}

export type NoticeToastRenderer = (
  notice: WorkbenchNotice,
  context: NoticeToastContext,
) => ReactNode | null;

interface NoticeToastHostProps {
  maxVisible?: number;
  notices: WorkbenchNotice[];
  renderNotice: NoticeToastRenderer;
}

export function NoticeToastHost({
  maxVisible = 1,
  notices,
  renderNotice,
}: NoticeToastHostProps): ReactNode {
  const [dismissedNoticeKeys, setDismissedNoticeKeys] = useState<Set<string>>(
    new Set(),
  );
  const previousGroupNoticeKeys = useRef<Set<string>>(new Set());

  const getNoticeDismissKey = useCallback((notice: WorkbenchNotice) => {
    if (notice.toastDismissKey) {
      return `notice:${notice.toastDismissKey}`;
    }

    return notice.groupKey ? `group:${notice.groupKey}` : `id:${notice.id}`;
  }, []);

  const dismissNotice = (notice: WorkbenchNotice) => {
    const key = getNoticeDismissKey(notice);
    setDismissedNoticeKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  useEffect(() => {
    const activeNoticeKeys = new Set(notices.map(getNoticeDismissKey));
    const activeGroupNoticeKeys = new Set(
      notices
        .filter(
          (notice) =>
            notice.groupKey !== undefined &&
            notice.toastDismissKey === undefined,
        )
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
          (key.startsWith("group:") &&
            previouslyActive &&
            currentlyActive) ||
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
    const rendered: ReactNode[] = [];

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

      rendered.push(
        <Fragment key={notice.id}>
          {output}
        </Fragment>,
      );

      if (rendered.length >= maxVisible) {
        break;
      }
    }

    return rendered;
  }, [
    dismissedNoticeKeys,
    getNoticeDismissKey,
    maxVisible,
    notices,
    renderNotice,
  ]);

  if (renderedNotices.length === 0) {
    return null;
  }

  return renderedNotices;
}
