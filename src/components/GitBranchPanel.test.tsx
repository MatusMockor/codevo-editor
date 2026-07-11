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
      deleteError: null,
      isLoading: false,
      isOpen: true,
      onClose: vi.fn(),
      onCreate: vi.fn(),
      onDelete: vi.fn(async () => undefined),
      onRename: vi.fn(async () => undefined),
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

    const rows = Array.from(host.querySelectorAll(".git-branch-row"));

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("main");
    expect(rows[0].getAttribute("aria-current")).toBe("true");
    expect(
      rows[0].querySelector<HTMLButtonElement>(".git-branch-switch")?.disabled,
    ).toBe(true);
    expect(rows[1].textContent).toContain("feature/login");
    expect(
      rows[1].querySelector<HTMLButtonElement>(".git-branch-switch")?.disabled,
    ).toBe(false);
  });

  it("switches to a non-current branch on click", () => {
    const props = renderPanel();

    const featureRow = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".git-branch-switch"),
    ).find((row) => row.textContent?.includes("feature/login"));

    act(() => {
      featureRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onSwitch).toHaveBeenCalledWith("feature/login");
  });

  it("does not switch when the current branch is clicked", () => {
    const props = renderPanel();

    const currentRow = host.querySelector<HTMLButtonElement>(
      ".git-branch-row.active .git-branch-switch",
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

  it("deletes normally, then offers an explicit force delete for an unmerged error", async () => {
    const props = renderPanel();
    const deleteButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Delete branch feature/login"]',
    );

    await act(async () => {
      deleteButton?.click();
    });

    expect(props.onDelete).toHaveBeenCalledWith("feature/login", {
      force: false,
    });

    renderPanel({
      ...props,
      deleteError: {
        id: "delete-error",
        message: "error: branch 'feature/login' is not fully merged",
      },
    });

    expect(host.textContent).toContain("Branch not merged — force delete?");

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".git-branch-force-delete")
        ?.click();
    });

    expect(props.onDelete).toHaveBeenLastCalledWith("feature/login", {
      force: true,
    });
  });

  it("does not offer force delete for a generic delete error", async () => {
    const props = renderPanel();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Delete branch feature/login"]',
        )
        ?.click();
    });

    renderPanel({
      ...props,
      deleteError: {
        id: "generic-delete-error",
        message: "fatal: cannot lock ref 'refs/heads/feature/login'",
      },
    });

    expect(host.textContent).not.toContain("Branch not merged — force delete?");
    expect(host.querySelector(".git-branch-force-confirm")).toBeNull();
  });

  it("clears force-delete confirmation when branches change", async () => {
    const props = renderPanel();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Delete branch feature/login"]',
        )
        ?.click();
    });
    renderPanel({
      ...props,
      deleteError: {
        id: "unmerged-before-refresh",
        message: "error: branch 'feature/login' is not fully merged",
      },
    });
    expect(host.querySelector(".git-branch-force-confirm")).not.toBeNull();

    renderPanel({
      ...props,
      branches: branches.map((branch) => ({ ...branch })),
      deleteError: {
        id: "unmerged-before-refresh",
        message: "error: branch 'feature/login' is not fully merged",
      },
    });

    expect(host.querySelector(".git-branch-force-confirm")).toBeNull();
  });

  it("keeps force-delete confirmation on only the latest triggering branch", async () => {
    const branchSet: GitBranch[] = [
      ...branches,
      { isCurrent: false, name: "feature/payments" },
    ];
    const props = renderPanel({ branches: branchSet });

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Delete branch feature/login"]',
        )
        ?.click();
    });
    renderPanel({
      ...props,
      deleteError: {
        id: "login-unmerged",
        message: "error: branch 'feature/login' is not fully merged",
      },
    });
    expect(
      host
        .querySelector('[aria-label="Delete branch feature/login"]')
        ?.closest(".git-branch-row")
        ?.querySelector(".git-branch-force-confirm"),
    ).not.toBeNull();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Delete branch feature/payments"]',
        )
        ?.click();
    });
    expect(
      host
        .querySelector('[aria-label="Delete branch feature/login"]')
        ?.closest(".git-branch-row")
        ?.querySelector(".git-branch-force-confirm"),
    ).toBeNull();

    renderPanel({
      ...props,
      deleteError: {
        id: "payments-unmerged",
        message: "error: branch 'feature/payments' is not fully merged",
      },
    });

    const confirmRows = host.querySelectorAll(".git-branch-force-confirm");
    expect(confirmRows).toHaveLength(1);
    expect(confirmRows[0].closest(".git-branch-row")?.textContent).toContain(
      "feature/payments",
    );
  });

  it("renames inline on Enter and cancels on Escape", async () => {
    const props = renderPanel();
    const renameButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Rename branch feature/login"]',
    );

    act(() => renameButton?.click());

    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="New name for branch feature/login"]',
    );
    expect(input?.value).toBe("feature/login");

    act(() => {
      if (!input) {
        return;
      }

      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "feature/auth");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(props.onRename).toHaveBeenCalledWith(
      "feature/login",
      "feature/auth",
    );

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Rename branch feature/login"]',
        )
        ?.click();
    });
    const cancelInput = host.querySelector<HTMLInputElement>(
      '[aria-label="New name for branch feature/login"]',
    );
    act(() => {
      cancelInput?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(
      host.querySelector('[aria-label="New name for branch feature/login"]'),
    ).toBeNull();
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["the same name", "feature/login"],
    ["an empty name", ""],
    ["a whitespace-only name", "   \t"],
  ])("does not rename to %s", (_description, nextName) => {
    const props = renderPanel();

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Rename branch feature/login"]',
        )
        ?.click();
    });
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="New name for branch feature/login"]',
    );

    act(() => {
      if (!input) {
        return;
      }
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, nextName);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(props.onRename).not.toHaveBeenCalled();
  });

  it.each(["Enter", "Escape"])(
    "returns focus to the rename button after %s",
    async (key) => {
      renderPanel();
      const renameButton = host.querySelector<HTMLButtonElement>(
        '[aria-label="Rename branch feature/login"]',
      );

      act(() => renameButton?.click());
      const input = host.querySelector<HTMLInputElement>(
        '[aria-label="New name for branch feature/login"]',
      );

      await act(async () => {
        input?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key }),
        );
      });

      expect(document.activeElement).toBe(
        host.querySelector<HTMLButtonElement>(
          '[aria-label="Rename branch feature/login"]',
        ),
      );
    },
  );

  it("does not offer delete for the current branch and labels row actions", () => {
    renderPanel();

    expect(host.querySelector('[aria-label="Delete branch main"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Rename branch main"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Delete branch feature/login"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Rename branch feature/login"]'),
    ).not.toBeNull();
  });

  it("disables all branch mutations while loading", () => {
    renderPanel({ isLoading: true });

    const mutationButtons = host.querySelectorAll<HTMLButtonElement>(
      ".git-branch-row-action",
    );
    expect(mutationButtons).toHaveLength(3);
    expect(Array.from(mutationButtons).every((button) => button.disabled)).toBe(
      true,
    );
  });
});
