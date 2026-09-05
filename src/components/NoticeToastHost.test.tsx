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

  const renderNotices = (notices: WorkbenchNotice[], maxVisible?: number) => {
    act(() => {
      root.render(
        <NoticeToastHost
          maxVisible={maxVisible}
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

  const notice = (message: string, groupKey: string): WorkbenchNotice => ({
    groupKey,
    id: groupKey,
    message,
    severity: "info",
    source: "Test",
  });

  it("keeps duplicate request failures dismissed but shows a later unrelated failure", () => {
    const workspaceRoot = "/workspace";
    const groupKey = languageServerRequestErrorNoticeGroupKey(workspaceRoot)!;
    const requestNotice = (message: string): WorkbenchNotice => ({
      ...createWorkbenchNotice("error", "Language Server", message, groupKey),
      toastDismissKey:
        languageServerRequestErrorToastDismissKey(workspaceRoot, message) ?? undefined,
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

    renderNotices([createWorkbenchNotice("error", "Language Server", "First crash", groupKey)]);
    act(() => host.querySelector("button")?.click());

    renderNotices([createWorkbenchNotice("error", "Language Server", "Second crash", groupKey)]);
    expect(host.textContent).toBe("");
  });

  it("renders nothing without visible notices", () => {
    renderNotices([]);
    expect(host.querySelector(".toast-region")).toBeNull();
  });

  it("stacks the first notice in front, keeps one behind, and collapses the rest", () => {
    renderNotices([notice("First", "a"), notice("Second", "b"), notice("Third", "c")]);

    const region = host.querySelector(".toast-region");
    expect(region?.classList.contains("toast-region--stacked")).toBe(true);
    const slots = Array.from(host.querySelectorAll(".toast-region__slot"));
    expect(slots.map((slot) => slot.textContent)).toEqual(["First", "Second"]);
    expect(slots[0]?.classList.contains("toast-region__slot--front")).toBe(true);
    expect(slots[0]?.getAttribute("aria-hidden")).toBeNull();
    expect(slots[0]?.hasAttribute("inert")).toBe(false);
    expect(slots[1]?.classList.contains("toast-region__slot--behind")).toBe(true);
    expect(slots[1]?.getAttribute("aria-hidden")).toBe("true");
    expect(slots[1]?.hasAttribute("inert")).toBe(true);
    expect(host.textContent).not.toContain("Third");
  });

  it("promotes the next notice after the front one is dismissed", () => {
    renderNotices([notice("First", "a"), notice("Second", "b"), notice("Third", "c")]);

    act(() => host.querySelector<HTMLButtonElement>(".toast-region__slot--front button")?.click());

    const slots = Array.from(host.querySelectorAll(".toast-region__slot"));
    expect(slots.map((slot) => slot.textContent)).toEqual(["Second", "Third"]);
    expect(slots[0]?.classList.contains("toast-region__slot--front")).toBe(true);
  });

  it("honours a single-toast limit without the stacked layout", () => {
    renderNotices([notice("First", "a"), notice("Second", "b")], 1);

    expect(host.querySelector(".toast-region--stacked")).toBeNull();
    expect(host.querySelectorAll(".toast-region__slot")).toHaveLength(1);
    expect(host.textContent).toBe("First");
  });
});
