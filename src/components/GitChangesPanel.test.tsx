// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitStatus } from "../domain/git";
import { GitChangesPanel } from "./GitChangesPanel";

describe("GitChangesPanel", () => {
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

  it("renders tracked and unversioned groups with commit controls", async () => {
    await renderPanel({
      status: gitStatus([
        gitChange("modified", "src/User.php", true),
        gitChange("untracked", "notes.txt", false),
      ]),
    });

    expect(host.textContent).toContain("Commit");
    expect(host.textContent).toContain("main");
    expect(host.textContent).toContain("Changes 1");
    expect(host.textContent).toContain("Unversioned Files 1");
    expect(host.textContent).toContain("User.php");
    expect(host.textContent).toContain("notes.txt");
    expect(host.querySelector(".git-change-name")?.textContent).toBe("User.php");
    expect(host.querySelector(".git-change-directory")?.textContent).toBe("src");
    expect(host.querySelector(".git-change-row .tree-entry-icon-file")).not.toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>(".git-commit-button")?.disabled,
    ).toBe(false);
  });

  it("opens a diff preview when a change row is clicked", async () => {
    const change = gitChange("modified", "src/User.php", true);
    const onOpenChange = vi.fn();
    await renderPanel({
      onOpenChange,
      status: gitStatus([change]),
    });

    act(() => {
      host.querySelector<HTMLButtonElement>(".git-change-row")?.click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(change);
  });

  it("collapses and expands change groups from the group header", async () => {
    await renderPanel({
      status: gitStatus([
        gitChange("modified", "src/User.php", true),
        gitChange("untracked", "notes.txt", false),
      ]),
    });

    const toggles = host.querySelectorAll<HTMLButtonElement>(
      ".git-change-group-toggle",
    );

    expect(host.textContent).toContain("User.php");

    act(() => {
      toggles[0].click();
    });

    expect(toggles[0].getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("User.php");
    expect(host.textContent).toContain("notes.txt");

    act(() => {
      toggles[0].click();
    });

    expect(toggles[0].getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("User.php");
  });

  it("uses themed checkbox wrappers instead of visible native checkboxes", async () => {
    await renderPanel({
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    expect(host.querySelector(".git-themed-checkbox-box")).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>(".git-themed-checkbox input")).not.toBeNull();
  });

  it("toggles commit inclusion from file checkboxes without staging immediately", async () => {
    const staged = gitChange("modified", "src/Staged.php", true);
    const unstaged = gitChange("modified", "src/Unstaged.php", false);
    const onToggleChangeIncluded = vi.fn();
    await renderPanel({
      includedChangePaths: new Set(["src/Staged.php"]),
      onToggleChangeIncluded,
      status: gitStatus([staged, unstaged]),
    });

    const checkboxes = host.querySelectorAll<HTMLInputElement>(
      ".git-change-checkbox input",
    );

    await act(async () => {
      checkboxes[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      checkboxes[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onToggleChangeIncluded).toHaveBeenCalledWith(staged);
    expect(onToggleChangeIncluded).toHaveBeenCalledWith(unstaged);
  });

  it("stages selected included files from the toolbar", async () => {
    const untracked = gitChange("untracked", "notes.txt", false);
    const onStageChanges = vi.fn();
    await renderPanel({
      includedChangePaths: new Set(["notes.txt"]),
      onStageChanges,
      status: gitStatus([untracked]),
    });

    act(() => {
      host.querySelector<HTMLButtonElement>('[title="Stage selected files"]')?.click();
    });

    expect(onStageChanges).toHaveBeenCalledWith([untracked]);
  });

  it("updates the commit message and submits the commit", async () => {
    const onCommit = vi.fn();
    const onCommitAndPush = vi.fn();
    const onCommitMessageChange = vi.fn();
    await renderPanel({
      commitMessage: "feat: update git panel",
      onCommit,
      onCommitAndPush,
      onCommitMessageChange,
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    await act(async () => {
      const textarea = host.querySelector<HTMLTextAreaElement>(
        ".git-commit-message",
      );
      textarea!.value = "fix: staged commit";
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    act(() => {
      host.querySelector<HTMLButtonElement>(".git-commit-button")?.click();
    });

    expect(onCommitMessageChange).toHaveBeenCalledWith("fix: staged commit");
    expect(onCommit).toHaveBeenCalled();

    act(() => {
      host.querySelector<HTMLButtonElement>(".git-commit-push-button")?.click();
    });

    expect(onCommitAndPush).toHaveBeenCalled();
  });

  async function renderPanel(
    props: Partial<React.ComponentProps<typeof GitChangesPanel>> = {},
  ) {
    await act(async () => {
      root.render(
        <GitChangesPanel
          activeChange={props.activeChange ?? null}
          commitMessage={props.commitMessage ?? "feat: update"}
          gitOperationLoading={props.gitOperationLoading ?? false}
          includedChangePaths={props.includedChangePaths ?? new Set(["src/User.php"])}
          isLoading={props.isLoading ?? false}
          onCommit={props.onCommit ?? vi.fn()}
          onCommitAndPush={props.onCommitAndPush ?? vi.fn()}
          onCommitMessageChange={props.onCommitMessageChange ?? vi.fn()}
          onToggleChangeIncluded={props.onToggleChangeIncluded ?? vi.fn()}
          onOpenChange={props.onOpenChange ?? vi.fn()}
          onRefresh={props.onRefresh ?? vi.fn()}
          onRevertChanges={props.onRevertChanges ?? vi.fn()}
          onStageChanges={props.onStageChanges ?? vi.fn()}
          onUnstageChanges={props.onUnstageChanges ?? vi.fn()}
          rootPath={props.rootPath ?? "/workspace"}
          status={props.status ?? gitStatus([])}
        />,
      );
      await Promise.resolve();
    });
  }
});

function gitStatus(changes: GitChangedFile[]): GitStatus {
  return {
    branch: "main",
    changes,
    isRepository: true,
    rootPath: "/workspace",
  };
}

function gitChange(
  status: GitChangedFile["status"],
  relativePath: string,
  isStaged: boolean,
  isUnversioned = status === "untracked",
): GitChangedFile {
  return {
    isStaged,
    isUnversioned,
    oldPath: null,
    oldRelativePath: null,
    path: `/workspace/${relativePath}`,
    relativePath,
    status,
  };
}
