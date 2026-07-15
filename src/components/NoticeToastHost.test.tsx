// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkbenchNotice,
  languageServerRequestErrorNoticeGroupKey,
  languageServerRequestErrorToastDismissKey,
  type WorkbenchNotice,
} from "../application/workbenchNotice";
import { NoticeToastHost } from "./NoticeToastHost";

describe("NoticeToastHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const renderNotices = (notices: WorkbenchNotice[]) => {
    act(() => {
      root.render(
        <NoticeToastHost
          notices={notices}
          renderNotice={(notice, actions) => (
            <button onClick={actions.dismiss} type="button">
              {notice.message}
            </button>
          )}
        />,
      );
    });
  };

  it("keeps duplicate request failures dismissed but shows a later unrelated failure", () => {
    const workspaceRoot = "/workspace";
    const groupKey = languageServerRequestErrorNoticeGroupKey(workspaceRoot)!;
    const requestNotice = (message: string): WorkbenchNotice => ({
      ...createWorkbenchNotice("error", "Language Server", message, groupKey),
      toastDismissKey:
        languageServerRequestErrorToastDismissKey(workspaceRoot, message) ??
        undefined,
    });

    renderNotices([requestNotice("Completion failed")]);
    act(() => host.querySelector("button")?.click());
    expect(host.textContent).toBe("");

    renderNotices([requestNotice("Completion failed")]);
    expect(host.textContent).toBe("");

    renderNotices([requestNotice("Hover failed")]);
    expect(host.textContent).toBe("Hover failed");
  });

  it("keeps an active crash group dismissed when its notice identity changes", () => {
    const groupKey = "language-server-crash:/workspace";

    renderNotices([
      createWorkbenchNotice("error", "Language Server", "First crash", groupKey),
    ]);
    act(() => host.querySelector("button")?.click());

    renderNotices([
      createWorkbenchNotice("error", "Language Server", "Second crash", groupKey),
    ]);
    expect(host.textContent).toBe("");
  });
});
