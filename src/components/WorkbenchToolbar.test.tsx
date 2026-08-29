// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialIndexProgress } from "../domain/indexProgress";
import {
  COLLAPSE_EDITOR_LABEL,
  WorkbenchToolbar,
  type WorkbenchToolbarProps,
} from "./WorkbenchToolbar";

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

  it("has no Code or Agents mode switch", () => {
    render();

    expect(host.querySelector(".workbench-mode-switch")).toBeNull();
    expect(host.querySelector('[aria-label="Workbench mode"]')).toBeNull();
    expect(host.textContent).not.toContain("Agents");
  });

  it("offers to collapse the expanded editor back to the threads", () => {
    const onCollapseEditor = vi.fn();
    render({ onCollapseEditor });

    act(() => collapseButton()?.click());

    expect(collapseButton()?.getAttribute("title")).toBe(COLLAPSE_EDITOR_LABEL);
    expect(onCollapseEditor).toHaveBeenCalledTimes(1);
  });

  it("hides the collapse button when the agent layout is unavailable", () => {
    render({ collapseAvailable: false });

    expect(collapseButton()).toBeNull();
  });

  it("keeps the IDE Mode switch and the workspace status in the expanded layout", () => {
    const onToggleSmartMode = vi.fn();
    render({ onToggleSmartMode });

    expect(host.textContent).toContain("IDE Mode");
    act(() => host.querySelector<HTMLButtonElement>(".smart-mode-switch")?.click());

    expect(onToggleSmartMode).toHaveBeenCalledTimes(1);
  });

  it("renders no toolbar in the agent layout", () => {
    render({ layout: "agent", ideProgress: { busy: true, state: "active", text: "Indexing" } });

    expect(host.querySelector(".workbench-toolbar")).toBeNull();
  });

  it("does not restore the toolbar for an untrusted agent workspace", () => {
    const onTrustWorkspace = vi.fn();
    render({ layout: "agent", onTrustWorkspace, workspaceTrusted: false });

    expect(host.querySelector(".workbench-toolbar")).toBeNull();
    expect(onTrustWorkspace).not.toHaveBeenCalled();
  });

  it("offers to trust an untrusted workspace in the expanded layout", () => {
    const onTrustWorkspace = vi.fn();
    render({ onTrustWorkspace, workspaceTrusted: false });

    act(() => host.querySelector<HTMLButtonElement>(".toolbar-action")?.click());

    expect(onTrustWorkspace).toHaveBeenCalledTimes(1);
  });

  function render(overrides: Partial<WorkbenchToolbarProps> = {}): void {
    act(() => root.render(<WorkbenchToolbar {...defaultProps()} {...overrides} />));
  }

  function collapseButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`button[aria-label="${COLLAPSE_EDITOR_LABEL}"]`);
  }
});

function defaultProps(): WorkbenchToolbarProps {
  return {
    collapseAvailable: true,
    ideProgress: { busy: false, state: "idle", text: null },
    indexProgress: initialIndexProgress(),
    intelligenceMode: "fullSmart",
    languageServerPlan: null,
    languageServerRuntimeStatus: null,
    layout: "editor-expanded",
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
    onCollapseEditor: () => undefined,
    onShowProgressPanel: () => undefined,
    onToggleSmartMode: () => undefined,
    onTrustWorkspace: () => undefined,
  };
}
