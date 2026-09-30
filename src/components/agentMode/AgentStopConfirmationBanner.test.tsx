// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_STOP_INTERRUPTING_TEXT,
  AgentStopConfirmationAnnouncer,
  AgentStopConfirmationBanner,
} from "./AgentStopConfirmationBanner";
import { agentStopConfirmationText } from "./agentStopConfirmationPresentation";

let mounted: { readonly root: Root; readonly host: HTMLElement } | null = null;

function render(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(element));
  return host;
}

function rerender(element: ReactElement): void {
  const current = mounted;
  expect(current).not.toBeNull();
  act(() => current?.root.render(element));
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  );
  expect(match).toBeInstanceOf(HTMLButtonElement);
  return match as HTMLButtonElement;
}

afterEach(() => {
  const current = mounted;
  mounted = null;
  if (current === null) return;
  act(() => current.root.unmount());
  current.host.remove();
});

describe("AgentStopConfirmationBanner", () => {
  it("renders nothing without a pending confirmation", () => {
    const host = render(<AgentStopConfirmationBanner confirmation={null} onConfirm={vi.fn()} />);
    expect(host.childElementCount).toBe(0);
    expect(host.textContent).toBe("");
  });

  it("offers stopping everything or keeping the work running", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onFocusReturn = vi.fn();
    const host = render(
      <AgentStopConfirmationBanner
        confirmation={{ kind: "confirmBackground", liveTaskCount: 2, onCancel }}
        onConfirm={onConfirm}
        onFocusReturn={onFocusReturn}
      />,
    );
    expect(host.textContent).toContain(agentStopConfirmationText(2));
    act(() => button(host, "Stop everything").click());
    expect(onFocusReturn).toHaveBeenCalledTimes(1);
    act(() => button(host, "Keep running").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onFocusReturn).toHaveBeenCalledTimes(2);
  });

  it("explains an interrupt and offers stopping everything or dismissing", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const host = render(
      <AgentStopConfirmationBanner
        confirmation={{ kind: "interrupting", onCancel }}
        onConfirm={onConfirm}
      />,
    );
    expect(AGENT_STOP_INTERRUPTING_TEXT).toBe(
      "Stopping the current step. Press Stop or Esc again to end Claude's session.",
    );
    expect(host.textContent).toContain(AGENT_STOP_INTERRUPTING_TEXT);
    expect(host.textContent).not.toContain("Keep running");
    act(() => button(host, "Stop everything").click());
    act(() => button(host, "Dismiss").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("offers stopping an idle session's tasks, ending the session or keeping them running", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onStopTasks = vi.fn();
    const onEndSession = vi.fn();
    const onFocusReturn = vi.fn();
    const host = render(
      <AgentStopConfirmationBanner
        confirmation={{
          kind: "confirmSessionBackground",
          liveTaskCount: 1,
          onCancel,
          onStopTasks,
          onEndSession,
        }}
        onConfirm={onConfirm}
        onFocusReturn={onFocusReturn}
      />,
    );
    expect(host.textContent).toContain(
      "1 background task is still running in Claude's session. Press Stop tasks or Esc again to stop it.",
    );
    expect(host.textContent).not.toContain("Stop everything");
    act(() => button(host, "Stop tasks").click());
    act(() => button(host, "End session").click());
    act(() => button(host, "Keep running").click());
    expect(onStopTasks).toHaveBeenCalledTimes(1);
    expect(onEndSession).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onFocusReturn).toHaveBeenCalledTimes(3);
  });

  it("words an idle session's several tasks and omits End session without a port", () => {
    const host = render(
      <AgentStopConfirmationBanner
        confirmation={{
          kind: "confirmSessionBackground",
          liveTaskCount: 3,
          onCancel: vi.fn(),
          onStopTasks: vi.fn(),
        }}
        onConfirm={undefined}
      />,
    );
    expect(host.textContent).toContain(
      "3 background tasks are still running in Claude's session. Press Stop tasks or Esc again to stop them.",
    );
    expect([...host.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
      "Stop tasks",
      "Keep running",
    ]);
  });

  it("leaves the announcement to the persistent live region", () => {
    const host = render(
      <AgentStopConfirmationBanner
        confirmation={{ kind: "confirmBackground", liveTaskCount: 1, onCancel: vi.fn() }}
        onConfirm={vi.fn()}
      />,
    );
    expect(host.querySelector("[role='status'], [aria-live]")).toBeNull();
  });

  it("words the count truthfully", () => {
    expect(agentStopConfirmationText(1)).toBe(
      "1 background task is still running. Press Stop or Esc again to end it.",
    );
    expect(agentStopConfirmationText(3)).toBe(
      "3 background tasks are still running. Press Stop or Esc again to end them.",
    );
    expect(agentStopConfirmationText(0)).toBe(
      "Background work is still running. Press Stop or Esc again to end it.",
    );
  });
});

describe("AgentStopConfirmationAnnouncer", () => {
  it("keeps one mounted live region and only changes its text", () => {
    const host = render(<AgentStopConfirmationAnnouncer confirmation={null} />);
    const region = host.querySelector("[role='status']");
    expect(region).toBeInstanceOf(HTMLElement);
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");

    rerender(
      <AgentStopConfirmationAnnouncer
        confirmation={{ kind: "confirmBackground", liveTaskCount: 1, onCancel() {} }}
      />,
    );
    expect(host.querySelector("[role='status']")).toBe(region);
    expect(region?.textContent).toBe(agentStopConfirmationText(1));

    rerender(
      <AgentStopConfirmationAnnouncer confirmation={{ kind: "interrupting", onCancel() {} }} />,
    );
    expect(host.querySelector("[role='status']")).toBe(region);
    expect(region?.textContent).toBe(AGENT_STOP_INTERRUPTING_TEXT);

    rerender(<AgentStopConfirmationAnnouncer confirmation={null} />);
    expect(host.querySelector("[role='status']")).toBe(region);
    expect(region?.textContent).toBe("");
  });
});
