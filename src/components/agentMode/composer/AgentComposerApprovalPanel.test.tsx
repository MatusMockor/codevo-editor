// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentAgentApproval } from "../agentApprovalPresenter";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { AgentComposerApprovalPanel } from "./AgentComposerApprovalPanel";

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

function interaction(
  decide: (decision: "allowOnce" | "allowForSession" | "deny") => Promise<void>,
): Extract<AgentComposerInteraction, { kind: "approval" }> {
  return {
    kind: "approval",
    key: "approval:task:a1",
    pendingCount: 2,
    sending: false,
    error: null,
    decide,
    view: presentAgentApproval({
      id: "a1",
      taskId: "task",
      provider: "codex",
      kind: "command",
      title: "outside the sandbox",
      detail: `npm test -- ${"orders.idempotency ".repeat(30)}`,
      detailTruncated: false,
      facts: [{ label: "Reason", value: "Needs network access" }],
      decisions: ["allowOnce", "allowForSession", "deny"],
      status: "pending",
    }),
  };
}

function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === name || candidate.getAttribute("aria-label") === name,
  );
}

describe("AgentComposerApprovalPanel", () => {
  it("shows the request like the mockup with Decline, Approve and the more menu", () => {
    act(() => root.render(<AgentComposerApprovalPanel interaction={interaction(vi.fn())} />));

    const panel = host.querySelector('[role="group"][aria-label="Approval request"]');
    expect(panel?.querySelector(".cv-composer-interaction__kicker b")?.textContent).toBe("Command");
    expect(panel?.querySelector(".cv-composer-interaction__count")?.textContent).toBe("1/2");
    expect(panel?.querySelector("pre")?.textContent).toContain("npm test --");
    expect(panel?.textContent).toContain("Reason: Needs network access");
    expect(button("Decline")?.className).toContain("cv-button--default");
    expect(button("Approve")?.className).toContain("cv-button--primary");
    expect(button("Approve for this session")).toBeUndefined();
    act(() => button("More approval options")?.click());
    expect(button("Approve for this session")).toBeDefined();
  });

  it("sends one decision for a double click and re-enables after a failure", async () => {
    let fail: (reason: Error) => void = () => undefined;
    const decide = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    act(() => root.render(<AgentComposerApprovalPanel interaction={interaction(decide)} />));

    act(() => {
      button("Approve")?.click();
      button("Approve")?.click();
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith("allowOnce");
    expect(button("Approve")?.disabled).toBe(true);
    await act(async () => {
      fail(new Error("offline"));
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not send your decision. Please try again.",
    );
    expect(button("Approve")?.disabled).toBe(false);
  });
});
