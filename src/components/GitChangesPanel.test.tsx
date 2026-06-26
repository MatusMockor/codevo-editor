// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gitDomain from "../domain/git";
import { gitChangeKey, type GitChangedFile, type GitStatus } from "../domain/git";
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

  it("enables commit for included unstaged files when a message is present", async () => {
    const change = gitChange("modified", "src/User.php", false);
    await renderPanel({
      includedChangePaths: new Set([gitChangeKey(change)]),
      status: gitStatus([change]),
    });

    expect(
      host.querySelector<HTMLButtonElement>(".git-commit-button")?.disabled,
    ).toBe(false);
    expect(
      host.querySelector<HTMLButtonElement>(".git-commit-push-button")?.disabled,
    ).toBe(false);
  });

  it("opens a diff preview when a change row is clicked", async () => {
    const change = gitChange("modified", "src/User.php", true);
    const onPreviewChange = vi.fn();
    const onOpenChange = vi.fn();
    await renderPanel({
      onOpenChange,
      onPreviewChange,
      status: gitStatus([change]),
    });

    act(() => {
      host.querySelector<HTMLButtonElement>(".git-change-row")?.click();
    });

    expect(onPreviewChange).toHaveBeenCalledWith(change);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("previews a worktree README modification with the plain single-click path", async () => {
    const change = gitChange("modified", "README.md", false);
    const onPreviewChange = vi.fn();
    const onOpenChange = vi.fn();
    await renderPanel({
      includedChangePaths: new Set(),
      onOpenChange,
      onPreviewChange,
      status: gitStatus([change]),
    });

    act(() => {
      host.querySelector<HTMLButtonElement>(".git-change-row")?.click();
    });

    expect(onPreviewChange).toHaveBeenCalledTimes(1);
    expect(onPreviewChange).toHaveBeenCalledWith(change);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("pins a diff when a change row is double clicked", async () => {
    const change = gitChange("modified", "src/User.php", true);
    const onPreviewChange = vi.fn();
    const onOpenChange = vi.fn();
    await renderPanel({
      onOpenChange,
      onPreviewChange,
      status: gitStatus([change]),
    });

    const row = host.querySelector<HTMLButtonElement>(".git-change-row");

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    });

    expect(onPreviewChange).not.toHaveBeenCalled();
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

  it("keeps checkbox inputs outside Git change row buttons", async () => {
    await renderPanel({
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    expect(host.querySelector(".git-change-row .git-themed-checkbox")).toBeNull();
    expect(host.querySelector(".git-change-row-wrapper .git-themed-checkbox")).not.toBeNull();
  });

  it("toggles commit inclusion from file checkboxes without staging immediately", async () => {
    const staged = gitChange("modified", "src/Staged.php", true);
    const unstaged = gitChange("modified", "src/Unstaged.php", false);
    const onToggleChangeIncluded = vi.fn();
    await renderPanel({
      includedChangePaths: new Set([gitChangeKey(staged)]),
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
      includedChangePaths: new Set([gitChangeKey(untracked)]),
      onStageChanges,
      status: gitStatus([untracked]),
    });

    act(() => {
      host.querySelector<HTMLButtonElement>('[title="Stage selected files"]')?.click();
    });

    expect(onStageChanges).toHaveBeenCalledWith([untracked]);
  });

  it("does not open rows or collapse groups while a Git operation is running", async () => {
    const change = gitChange("modified", "src/User.php", true);
    const onOpenChange = vi.fn();
    const onPreviewChange = vi.fn();
    await renderPanel({
      gitOperationLoading: true,
      onOpenChange,
      onPreviewChange,
      status: gitStatus([change]),
    });

    const toggle = host.querySelector<HTMLButtonElement>(".git-change-group-toggle");
    const row = host.querySelector<HTMLButtonElement>(".git-change-row");

    act(() => {
      toggle?.click();
      row?.click();
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(onPreviewChange).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
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

  it("does not recompute groups or re-render when the parent re-renders with identical props", async () => {
    const groupSpy = vi.spyOn(gitDomain, "groupGitChanges");
    const stableProps: React.ComponentProps<typeof GitChangesPanel> = {
      activeChange: null,
      commitMessage: "feat: update",
      gitOperationLoading: false,
      includedChangePaths: new Set<string>(),
      isLoading: false,
      onCommit: vi.fn(),
      onCommitAndPush: vi.fn(),
      onCommitMessageChange: vi.fn(),
      onOpenChange: vi.fn(),
      onPreviewChange: vi.fn(),
      onRefresh: vi.fn(),
      onRevertChanges: vi.fn(),
      onStageChanges: vi.fn(),
      onToggleChangeIncluded: vi.fn(),
      onUnstageChanges: vi.fn(),
      rootPath: "/workspace",
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    };

    let forceParentRender: (value: number) => void = () => undefined;

    function Parent() {
      const [, setTick] = useState(0);
      forceParentRender = setTick;
      return <GitChangesPanel {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    expect(groupSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      forceParentRender(1);
      await Promise.resolve();
    });

    // React.memo skips the re-render because every prop is referentially
    // unchanged, so the memoized groups are never recomputed.
    expect(groupSpy).toHaveBeenCalledTimes(1);

    groupSpy.mockRestore();
  });

  it("memoizes groups across a re-render that keeps status.changes identity", async () => {
    const groupSpy = vi.spyOn(gitDomain, "groupGitChanges");
    const status = gitStatus([gitChange("modified", "src/User.php", true)]);

    let setMessage: (value: string) => void = () => undefined;

    function Parent() {
      const [commitMessage, updateMessage] = useState("feat: a");
      setMessage = updateMessage;
      return (
        <GitChangesPanel
          activeChange={null}
          commitMessage={commitMessage}
          gitOperationLoading={false}
          includedChangePaths={new Set<string>()}
          isLoading={false}
          onCommit={vi.fn()}
          onCommitAndPush={vi.fn()}
          onCommitMessageChange={vi.fn()}
          onOpenChange={vi.fn()}
          onPreviewChange={vi.fn()}
          onRefresh={vi.fn()}
          onRevertChanges={vi.fn()}
          onStageChanges={vi.fn()}
          onToggleChangeIncluded={vi.fn()}
          onUnstageChanges={vi.fn()}
          rootPath="/workspace"
          status={status}
        />
      );
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    expect(groupSpy).toHaveBeenCalledTimes(1);

    // A real prop change (commitMessage) forces the panel to re-render past
    // React.memo, but `status.changes` keeps its reference, so useMemo reuses
    // the previously computed groups instead of recomputing them.
    await act(async () => {
      setMessage("feat: b");
      await Promise.resolve();
    });

    expect(groupSpy).toHaveBeenCalledTimes(1);

    groupSpy.mockRestore();
  });

  it("does not re-render unrelated change rows when another row's inclusion toggles", async () => {
    // Distinct statuses let us attribute gitStatusTitle calls to a specific
    // row: the unchanged row's memoized component should not recompute its
    // path split / status title when only another row's inclusion flips.
    const first = gitChange("modified", "src/First.php", false);
    const second = gitChange("added", "src/Second.php", false);
    const status = gitStatus([first, second]);
    const titleSpy = vi.spyOn(gitDomain, "gitStatusTitle");

    // The real workbench passes referentially stable useCallback handlers, so
    // only includedChangePaths identity flips when a row toggles. Mirror that
    // here so the test exercises the memoization rather than recreated props.
    const handlers = {
      onCommit: vi.fn(),
      onCommitAndPush: vi.fn(),
      onCommitMessageChange: vi.fn(),
      onOpenChange: vi.fn(),
      onPreviewChange: vi.fn(),
      onRefresh: vi.fn(),
      onRevertChanges: vi.fn(),
      onStageChanges: vi.fn(),
      onToggleChangeIncluded: vi.fn(),
      onUnstageChanges: vi.fn(),
    };

    let toggleFirst: () => void = () => undefined;

    function Parent() {
      const [included, setIncluded] = useState<Set<string>>(new Set());
      toggleFirst = () =>
        setIncluded((current) => {
          const next = new Set(current);
          const key = gitChangeKey(first);
          next.has(key) ? next.delete(key) : next.add(key);
          return next;
        });

      return (
        <GitChangesPanel
          activeChange={null}
          commitMessage="feat: update"
          gitOperationLoading={false}
          includedChangePaths={included}
          isLoading={false}
          rootPath="/workspace"
          status={status}
          {...handlers}
        />
      );
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    const secondRowTitleCallsBefore = titleSpy.mock.calls.filter(
      ([rowStatus]) => rowStatus === "added",
    ).length;

    expect(secondRowTitleCallsBefore).toBeGreaterThan(0);

    await act(async () => {
      toggleFirst();
      await Promise.resolve();
    });

    const secondRowTitleCallsAfter = titleSpy.mock.calls.filter(
      ([rowStatus]) => rowStatus === "added",
    ).length;

    // The second row's inclusion is unchanged, so its memoized GitChangeRow
    // bails out and never recomputes its status title / path split.
    expect(secondRowTitleCallsAfter).toBe(secondRowTitleCallsBefore);

    titleSpy.mockRestore();
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
          includedChangePaths={
            props.includedChangePaths ??
            new Set([gitChangeKey(gitChange("modified", "src/User.php", true))])
          }
          isLoading={props.isLoading ?? false}
          onCommit={props.onCommit ?? vi.fn()}
          onCommitAndPush={props.onCommitAndPush ?? vi.fn()}
          onCommitMessageChange={props.onCommitMessageChange ?? vi.fn()}
          onToggleChangeIncluded={props.onToggleChangeIncluded ?? vi.fn()}
          onOpenChange={props.onOpenChange ?? vi.fn()}
          onPreviewChange={props.onPreviewChange ?? vi.fn()}
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
