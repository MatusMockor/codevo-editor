// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadUndoNotification } from "../../application/useAgentThreadUndo";
import { AGENT_THREAD_UNDO_BUSY_TITLE, AgentThreadUndoNotice } from "./AgentThreadUndoNotice";

describe("AgentThreadUndoNotice", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onUndo: ReturnType<typeof vi.fn<() => void>>;
  let onDismiss: ReturnType<typeof vi.fn<() => void>>;
  let onPausedChange: ReturnType<typeof vi.fn<(paused: boolean) => void>>;

  function render(notification: AgentThreadUndoNotification | null): void {
    act(() =>
      root.render(
        <AgentThreadUndoNotice
          notification={notification}
          onDismiss={onDismiss}
          onPausedChange={onPausedChange}
          onUndo={onUndo}
        />,
      ),
    );
  }

  function region(): HTMLElement {
    const element = host.querySelector<HTMLElement>('[data-slot="agent-thread-undo"]');
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function buttons(): ReadonlyArray<HTMLButtonElement> {
    return [...region().querySelectorAll<HTMLButtonElement>("button")];
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onUndo = vi.fn<() => void>();
    onDismiss = vi.fn<() => void>();
    onPausedChange = vi.fn<(paused: boolean) => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps a polite live region mounted while nothing is pending", () => {
    render(null);
    expect(region().getAttribute("role")).toBe("status");
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(region().childElementCount).toBe(0);
  });

  it("announces the action inside the existing live region with real buttons", () => {
    render(null);
    const mounted = region();
    render({ id: 1, message: "Thread archived", busy: false });
    expect(region()).toBe(mounted);
    expect(region().textContent).toContain("Thread archived");
    expect(region().querySelector(".agent-thread-notice > .agent-notice")).not.toBeNull();
    const [undo, dismiss] = buttons();
    expect(buttons()).toHaveLength(2);
    expect(undo?.textContent).toBe("Undo");
    expect(undo?.type).toBe("button");
    expect(undo?.tabIndex).toBe(0);
    expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss undo notice");
  });

  it("does not move focus when it appears or is replaced", () => {
    const composer = document.createElement("textarea");
    document.body.append(composer);
    composer.focus();
    render({ id: 1, message: "Thread archived", busy: false });
    expect(document.activeElement).toBe(composer);
    render({ id: 2, message: "Thread settled", busy: false });
    expect(document.activeElement).toBe(composer);
    expect(region().textContent).toContain("Thread settled");
    composer.remove();
  });

  it("asks to pause while hovered and resumes when the pointer leaves", () => {
    render({ id: 1, message: "Thread archived", busy: false });
    const notice = region().querySelector(".agent-notice");
    expect(notice).not.toBeNull();
    expect(onPausedChange.mock.calls).toEqual([[false]]);

    act(() => {
      notice?.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(onPausedChange).toHaveBeenLastCalledWith(true);
    act(() => {
      notice?.dispatchEvent(
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(onPausedChange).toHaveBeenLastCalledWith(false);
  });

  it("asks to pause while focus is inside and resumes only when focus leaves the notice", () => {
    render({ id: 1, message: "Thread archived", busy: false });
    const [undo, dismiss] = buttons();

    act(() => undo?.focus());
    expect(onPausedChange).toHaveBeenLastCalledWith(true);
    const calls = onPausedChange.mock.calls.length;
    act(() => dismiss?.focus());
    expect(onPausedChange.mock.calls.length).toBe(calls);
    act(() => dismiss?.blur());
    expect(onPausedChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the pause while a hovered or focused offer is replaced and releases it when the offer goes away", () => {
    render({ id: 1, message: "Thread archived", busy: false });
    const notice = region().querySelector(".agent-notice");
    act(() => {
      notice?.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(onPausedChange).toHaveBeenLastCalledWith(true);

    render({ id: 2, message: "Thread settled", busy: false });
    expect(region().querySelector(".agent-notice")).toBe(notice);
    expect(region().textContent).toContain("Thread settled");
    expect(onPausedChange).toHaveBeenLastCalledWith(true);

    render(null);
    expect(onPausedChange).toHaveBeenLastCalledWith(false);
    render({ id: 3, message: "Thread snoozed", busy: false });
    expect(onPausedChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps keyboard focus on Undo when the offer is replaced", () => {
    render({ id: 1, message: "Thread archived", busy: false });
    const undo = buttons()[0];
    act(() => undo?.focus());
    render({ id: 2, message: "Thread settled", busy: false });
    expect(document.activeElement).toBe(undo);
    expect(onPausedChange).toHaveBeenLastCalledWith(true);
  });

  it("starts paused when it appears under a resting pointer", () => {
    const matches = vi
      .spyOn(Element.prototype, "matches")
      .mockImplementation((selector) => selector === ":hover");
    render({ id: 1, message: "Thread archived", busy: false });
    matches.mockRestore();
    expect(onPausedChange).toHaveBeenLastCalledWith(true);
  });

  it("disables Undo with a busy state while an earlier undo is still in flight", () => {
    render({ id: 1, message: "Thread archived", busy: true });
    const [undo, dismiss] = buttons();
    expect(undo?.disabled).toBe(true);
    expect(undo?.getAttribute("aria-busy")).toBe("true");
    expect(undo?.title).toBe(AGENT_THREAD_UNDO_BUSY_TITLE);
    act(() => undo?.click());
    expect(onUndo).not.toHaveBeenCalled();
    expect(dismiss?.disabled).toBe(false);

    render({ id: 1, message: "Thread archived", busy: false });
    expect(buttons()[0]?.disabled).toBe(false);
    expect(buttons()[0]?.getAttribute("aria-busy")).toBe("false");
    act(() => buttons()[0]?.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("routes Undo and close to their handlers", () => {
    render({ id: 1, message: "3 threads archived", busy: false });
    const [undo, dismiss] = buttons();
    act(() => undo?.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => dismiss?.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
