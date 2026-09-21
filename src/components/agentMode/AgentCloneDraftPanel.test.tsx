// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
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
      draft: "A draft",
      onChangeDraft: vi.fn(),
      onCancel: vi.fn(),
      onRetry: vi.fn(),
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
  it("allows drafting while clone is running but cannot send", () => {
    render({ onContinue: vi.fn() });
    const input = host.querySelector("textarea")!;
    expect(input.disabled).toBe(false);
    expect(button("Send").disabled).toBe(true);
    expect(host.querySelector("label")?.htmlFor).toBe(input.id);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "Edited draft",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(props.onChangeDraft).toHaveBeenCalledWith("Edited draft");
    act(() => button("Cancel clone").click());
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onContinue).not.toHaveBeenCalled();
  });
  it.each(["failed", "canceled", "cancelled", "interrupted"])(
    "preserves the draft and supports retry after %s",
    (status) => {
      render({ clone: { ...props.clone, status, error: "Could not clone" } });
      expect(host.querySelector("textarea")?.value).toBe("A draft");
      expect(host.textContent).toContain("Could not clone");
      act(() => button("Retry clone").click());
      expect(props.onRetry).toHaveBeenCalledOnce();
    },
  );
  it.each(["completed", "succeeded"])(
    "continues only when %s and the parent provides a destination",
    (status) => {
      render({ clone: { ...props.clone, status } });
      expect(button("Send").disabled).toBe(true);
      render({ onContinue: vi.fn() });
      act(() => button("Continue with draft").click());
      expect(props.onContinue).toHaveBeenCalledOnce();
    },
  );
  it("accepts exact UTF-8 boundary and visibly rejects excess without truncation", () => {
    const boundary = "é".repeat(MAX_AGENT_TASK_PROMPT_BYTES / 2);
    render({
      clone: { ...props.clone, status: "succeeded" },
      onContinue: vi.fn(),
      draft: boundary,
    });
    expect(button("Continue with draft").disabled).toBe(false);
    render({ draft: boundary + "é" });
    expect(button("Continue with draft").disabled).toBe(true);
    expect(host.querySelector("textarea")?.value).toBe(boundary + "é");
    expect(host.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("has not been truncated");
    act(() => button("Continue with draft").click());
    expect(props.onContinue).not.toHaveBeenCalled();
  });
  it("retries a failed status check without treating the running clone as failed", () => {
    render({ clone: { ...props.clone, status: "running", error: "Connection interrupted" } });
    expect(button("Send").disabled).toBe(true);
    expect(button("Cancel clone").disabled).toBe(false);
    expect(host.querySelector("textarea")?.value).toBe("A draft");
    act(() => button("Retry status").click());
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
  it("does not offer retry without a retry capability", () => {
    render({ clone: { ...props.clone, status: "interrupted" }, onRetry: undefined });
    expect(host.textContent).not.toContain("Retry clone");
    expect(button("Send").disabled).toBe(true);
  });
  it("does not steal focus when the clone status updates and closing does not cancel", () => {
    render();
    button("Close").focus();
    render({ clone: { ...props.clone, status: "succeeded" }, onContinue: vi.fn() });
    expect(document.activeElement).toBe(button("Close"));
    act(() => button("Close").click());
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});
