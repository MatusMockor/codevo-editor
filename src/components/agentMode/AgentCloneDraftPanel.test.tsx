// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCloneDraftPanel, type AgentCloneDraftPanelProps } from "./AgentCloneDraftPanel";

describe("AgentCloneDraftPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: AgentCloneDraftPanelProps;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      clone: { id: "clone-1", name: "Project", status: "running", error: null },
      onCancel: vi.fn(),
      onRetry: vi.fn(),
      onRemove: vi.fn(),
      onClose: vi.fn(),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function render(next: Partial<AgentCloneDraftPanelProps> = {}) {
    props = { ...props, ...next };
    act(() => root.render(<AgentCloneDraftPanel {...props} />));
  }
  function button(name: string) {
    return Array.from(host.querySelectorAll("button")).find((item) => item.textContent === name)!;
  }
  it("shows compact clone progress and cancellation without a second composer", () => {
    render();
    expect(host.textContent).toContain("Cloning Project");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).not.toContain("Continue with draft");
    act(() => button("Cancel clone").click());
    expect(props.onCancel).toHaveBeenCalledExactlyOnceWith();
  });
  it.each(["failed", "canceled", "cancelled", "interrupted"])(
    "offers retry and removal after %s",
    (status) => {
      render({ clone: { ...props.clone, status, error: "Could not clone" } });
      expect(host.textContent).toContain("Your message and attachments are kept");
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not clone");
      act(() => button("Retry clone").click());
      act(() => button("Remove project").click());
      expect(props.onRetry).toHaveBeenCalledOnce();
      expect(props.onRemove).toHaveBeenCalledExactlyOnceWith();
    },
  );
  it.each(["completed", "succeeded"])("does not dispatch automatically on %s", (status) => {
    render({ clone: { ...props.clone, status } });
    expect(host.textContent).toContain("Review your message and send when you are ready");
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onRetry).not.toHaveBeenCalled();
    expect(props.onRemove).not.toHaveBeenCalled();
  });
  it("retries a failed status check without treating the running clone as failed", () => {
    render({ clone: { ...props.clone, status: "running", error: "Connection interrupted" } });
    act(() => button("Retry status").click());
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(button("Cancel clone").disabled).toBe(false);
    expect(button("Remove project")).toBeUndefined();
  });
  it("does not offer retry without a retry capability", () => {
    render({ clone: { ...props.clone, status: "interrupted" }, onRetry: undefined });
    expect(button("Retry clone")).toBeUndefined();
  });
  it("keeps focus when status changes and closing does not cancel or remove", () => {
    render();
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Close clone draft"]')!;
    close.focus();
    render({ clone: { ...props.clone, status: "succeeded" } });
    expect(document.activeElement).toBe(close);
    act(() => close.click());
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onRemove).not.toHaveBeenCalled();
  });
});
