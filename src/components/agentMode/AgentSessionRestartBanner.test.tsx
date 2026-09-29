// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_SESSION_RESTART_TEXT, AgentSessionRestartBanner } from "./AgentSessionRestartBanner";

let mounted: { readonly root: Root; readonly host: HTMLElement } | null = null;

function render(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(element));
  return host;
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

describe("AgentSessionRestartBanner", () => {
  it("renders nothing without a pending restart", () => {
    const host = render(<AgentSessionRestartBanner confirmation={null} onConfirm={vi.fn()} />);
    expect(host.childElementCount).toBe(0);
    expect(host.textContent).toBe("");
  });

  it("says a restart may stop background tasks, without claiming to end them all", () => {
    const host = render(
      <AgentSessionRestartBanner confirmation={{ onCancel: vi.fn() }} onConfirm={vi.fn()} />,
    );
    expect(AGENT_SESSION_RESTART_TEXT).toBe(
      "Sending this restarts Claude for this thread. Restarting ends this Claude session. Background tasks it started may stop.",
    );
    expect(host.textContent).toContain(AGENT_SESSION_RESTART_TEXT);
    expect(host.textContent).not.toContain("tasks it is tracking");
  });

  it("restarts and sends or cancels", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const host = render(
      <AgentSessionRestartBanner confirmation={{ onCancel }} onConfirm={onConfirm} />,
    );
    act(() => button(host, "Restart and send").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    act(() => button(host, "Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
