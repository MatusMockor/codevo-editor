// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_NODE_DEBUG_LAUNCH_CHOICES,
  NodeDebugLaunchSelector,
  type NodeDebugLaunchSelectorProps,
} from "./NodeDebugLaunchSelector";

function props(
  overrides: Partial<NodeDebugLaunchSelectorProps> = {},
): NodeDebugLaunchSelectorProps {
  return {
    busy: false,
    choices: [
      { default: true, name: "API", targetKind: "script" },
      { default: false, name: "Worker", targetKind: "npm" },
    ],
    error: null,
    mutationPending: false,
    onLoad: vi.fn(),
    onRefresh: vi.fn(),
    onSelect: vi.fn(),
    onStartSelected: vi.fn(),
    selectedName: "API",
    sessionActive: false,
    state: "ready",
    workspaceTrusted: true,
    ...overrides,
  };
}

describe("NodeDebugLaunchSelector", () => {
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

  function render(overrides: Partial<NodeDebugLaunchSelectorProps> = {}) {
    const value = props(overrides);
    act(() => root.render(<NodeDebugLaunchSelector {...value} />));
    return value;
  }

  function button(label: string) {
    return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  }

  it("selects and starts a named configuration with native select semantics", () => {
    const value = render();
    const select = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Node launch configuration"]',
    )!;
    expect(select.value).toBe("API");
    expect([...select.options].map(({ text }) => text)).toEqual([
      "API (Default) — script",
      "Worker — npm",
    ]);

    act(() => {
      select.value = "Worker";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      button("Start selected Node launch configuration").click();
    });

    expect(value.onSelect).toHaveBeenCalledWith("Worker");
    expect(value.onStartSelected).toHaveBeenCalledOnce();
  });

  it.each([
    ["untrusted", { workspaceTrusted: false }],
    ["active session", { sessionActive: true }],
    ["pending session mutation", { mutationPending: true }],
    ["busy launch", { busy: true }],
    ["loading", { state: "loading" as const }],
  ])("disables selection, start, and refresh while %s", (_label, overrides) => {
    render(overrides);
    expect(host.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(button("Start selected Node launch configuration").disabled).toBe(true);
    expect(button("Refresh Node launch configurations").disabled).toBe(true);
  });

  it("disables loading configurations while a session mutation is pending", () => {
    render({
      choices: [],
      mutationPending: true,
      selectedName: null,
      state: "idle",
    });

    expect(host.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(button("Start selected Node launch configuration").disabled).toBe(true);
    expect(button("Load Node launch configurations").disabled).toBe(true);
  });

  it("loads from idle and reports loading, empty, and error states accessibly", () => {
    const idle = render({ choices: [], selectedName: null, state: "idle" });
    act(() => button("Load Node launch configurations").click());
    expect(idle.onLoad).toHaveBeenCalledOnce();

    render({ choices: [], selectedName: null, state: "loading" });
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading");
    render({ choices: [], selectedName: null, state: "empty" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("No Node");
    render({ choices: [], error: "launch.json is invalid", selectedName: null, state: "error" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("launch.json is invalid");
  });

  it("refreshes a settled state and rejects a stale selected name", () => {
    const value = render({ selectedName: "Missing" });
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("");
    expect(button("Start selected Node launch configuration").disabled).toBe(true);
    act(() => button("Refresh Node launch configurations").click());
    expect(value.onRefresh).toHaveBeenCalledOnce();
  });

  it("renders at most 64 safe presentation choices without launch secrets", () => {
    const choices = Array.from({ length: MAX_NODE_DEBUG_LAUNCH_CHOICES + 3 }, (_, index) => ({
      default: index === 0,
      name: `Configuration ${index}`,
      targetKind: "script" as const,
    }));
    render({ choices, selectedName: choices[0]!.name });

    expect(host.querySelectorAll("option")).toHaveLength(MAX_NODE_DEBUG_LAUNCH_CHOICES);
    expect(host.innerHTML).not.toContain("NODE_OPTIONS");
    expect(host.innerHTML).not.toContain("secret");
  });
});
