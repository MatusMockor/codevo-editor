// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranch } from "../domain/git";
import { GitBranchPanel } from "./GitBranchPanel";

describe("GitBranchPanel", () => {
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

  const branches: GitBranch[] = [
    { isCurrent: true, name: "main" },
    { isCurrent: false, name: "feature/login" },
  ];

  function renderPanel(
    overrides: Partial<Parameters<typeof GitBranchPanel>[0]> = {},
  ) {
    const props = {
      branches,
      isLoading: false,
      isOpen: true,
      onClose: vi.fn(),
      onCreate: vi.fn(),
      onSwitch: vi.fn(),
      ...overrides,
    };

    act(() => {
      root.render(<GitBranchPanel {...props} />);
    });

    return props;
  }

  it("renders nothing when closed", () => {
    renderPanel({ isOpen: false });

    expect(host.querySelector(".git-branch-panel")).toBeNull();
  });

  it("lists branches and marks the current branch selected and disabled", () => {
    renderPanel();

    const rows = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".git-branch-row"),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("main");
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(rows[0].disabled).toBe(true);
    expect(rows[1].textContent).toContain("feature/login");
    expect(rows[1].disabled).toBe(false);
  });

  it("switches to a non-current branch on click", () => {
    const props = renderPanel();

    const featureRow = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".git-branch-row"),
    ).find((row) => row.textContent?.includes("feature/login"));

    act(() => {
      featureRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onSwitch).toHaveBeenCalledWith("feature/login");
  });

  it("does not switch when the current branch is clicked", () => {
    const props = renderPanel();

    const currentRow = host.querySelector<HTMLButtonElement>(
      ".git-branch-row.active",
    );

    act(() => {
      currentRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The current row is disabled, so the click is a no-op.
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it("invokes onCreate from the New Branch button", () => {
    const props = renderPanel();

    const createButton = host.querySelector<HTMLButtonElement>(
      ".git-branch-new-button",
    );

    act(() => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state and an empty state", () => {
    renderPanel({ branches: [], isLoading: true });
    expect(host.textContent).toContain("Loading branches");

    renderPanel({ branches: [], isLoading: false });
    expect(host.textContent).toContain("No branches");
  });

  it("closes on Escape", () => {
    const props = renderPanel();

    const dialog = host.querySelector<HTMLElement>(".git-branch-panel");

    act(() => {
      dialog?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
