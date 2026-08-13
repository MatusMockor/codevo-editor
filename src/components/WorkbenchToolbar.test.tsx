// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialIndexProgress } from "../domain/indexProgress";
import { WorkbenchToolbar, type WorkbenchToolbarProps } from "./WorkbenchToolbar";

describe("WorkbenchToolbar", () => {
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

  it("marks Code as the active mode by default", () => {
    render();

    expect(modeButton("Code").getAttribute("aria-pressed")).toBe("true");
    expect(modeButton("Agents").getAttribute("aria-pressed")).toBe("false");
  });

  it("marks Agents as the active mode when agent mode runs", () => {
    render({ agentModeActive: true });

    expect(modeButton("Agents").getAttribute("aria-pressed")).toBe("true");
    expect(modeButton("Code").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches between the two modes", () => {
    const onSelectAgentMode = vi.fn();
    render({ onSelectAgentMode });

    act(() => modeButton("Agents").click());
    act(() => modeButton("Code").click());

    expect(onSelectAgentMode.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps agent mode unreachable without a workspace", () => {
    render({ workspaceRoot: null });

    expect(modeButton("Agents").disabled).toBe(true);
  });

  it("keeps the IDE Mode switch and the workspace status next to the mode switch", () => {
    const onToggleSmartMode = vi.fn();
    render();

    expect(host.textContent).toContain("IDE Mode");
    act(() => host.querySelector<HTMLButtonElement>(".smart-mode-switch")?.click());

    render({ onToggleSmartMode });
    act(() => host.querySelector<HTMLButtonElement>(".smart-mode-switch")?.click());

    expect(onToggleSmartMode).toHaveBeenCalledTimes(1);
  });

  it("offers to trust an untrusted workspace", () => {
    const onTrustWorkspace = vi.fn();
    render({ onTrustWorkspace, workspaceTrusted: false });

    act(() => host.querySelector<HTMLButtonElement>(".toolbar-action")?.click());

    expect(onTrustWorkspace).toHaveBeenCalledTimes(1);
  });

  function render(overrides: Partial<WorkbenchToolbarProps> = {}): void {
    act(() => root.render(<WorkbenchToolbar {...defaultProps()} {...overrides} />));
  }

  function modeButton(label: string): HTMLButtonElement {
    const element = [
      ...host.querySelectorAll<HTMLButtonElement>(".workbench-mode-switch button"),
    ].find((candidate) => candidate.textContent === label);
    expect(element).toBeDefined();
    return element ?? document.createElement("button");
  }
});

function defaultProps(): WorkbenchToolbarProps {
  return {
    agentModeActive: false,
    ideProgress: { busy: false, state: "idle", text: null },
    indexProgress: initialIndexProgress(),
    intelligenceMode: "fullSmart",
    languageServerPlan: null,
    languageServerRuntimeStatus: null,
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
    onSelectAgentMode: () => undefined,
    onShowProgressPanel: () => undefined,
    onToggleSmartMode: () => undefined,
    onTrustWorkspace: () => undefined,
  };
}
