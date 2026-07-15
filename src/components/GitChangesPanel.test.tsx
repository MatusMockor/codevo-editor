// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gitDomain from "../domain/git";
import {
  gitChangeKey,
  gitChangeKeyForRepository,
  type GitChangedFile,
  type GitStatus,
} from "../domain/git";
import type { GitRepositoryStatus } from "../domain/gitRepositoryMapping";
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
    expect(
      host.querySelector(".git-change-row .git-change-status-icon-modified"),
    ).not.toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>(".git-commit-button")?.disabled,
    ).toBe(false);
  });

  it("renders a distinct status icon per file status, not a generic file icon", async () => {
    await renderPanel({
      status: gitStatus([
        gitChange("added", "src/Added.php", true),
        gitChange("modified", "src/Modified.php", true),
        gitChange("deleted", "src/Deleted.php", true),
        gitChange("untracked", "notes.txt", false),
      ]),
    });

    // Each row's status icon carries a status-specific class so themes can tint
    // it (JetBrains "Local Changes" feel), instead of every file sharing the
    // generic FileCode2 tree icon.
    expect(host.querySelector(".git-change-status-icon-added")).not.toBeNull();
    expect(host.querySelector(".git-change-status-icon-modified")).not.toBeNull();
    expect(host.querySelector(".git-change-status-icon-deleted")).not.toBeNull();
    expect(host.querySelector(".git-change-status-icon-untracked")).not.toBeNull();

    const icons = host.querySelectorAll(".git-change-status-icon svg");
    expect(icons).toHaveLength(4);
  });

  it("summarizes the total changed file count in the commit header", async () => {
    await renderPanel({
      status: gitStatus([
        gitChange("modified", "src/User.php", true),
        gitChange("added", "src/Post.php", true),
        gitChange("untracked", "notes.txt", false),
      ]),
    });

    const summary = host.querySelector(".git-changes-summary");
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("3");
  });

  it("renders behind and ahead tracking next to the branch", async () => {
    await renderPanel({
      status: gitStatus([], {
        branch: "origin/main",
        ahead: 1,
        behind: 2,
      }),
    });

    const badge = host.querySelector(".git-upstream-badge");
    expect(badge?.textContent).toBe("2↓ 1↑");
    expect(badge?.getAttribute("title")).toBe("Upstream: origin/main");
  });

  it("hides zero tracking components", async () => {
    await renderPanel({
      status: gitStatus([], {
        branch: "origin/main",
        ahead: 3,
        behind: 0,
      }),
    });

    expect(host.querySelector(".git-upstream-badge")?.textContent).toBe("3↑");
    expect(host.textContent).not.toContain("0↓");
  });

  it("hides tracking without an upstream", async () => {
    await renderPanel({ status: gitStatus([]) });

    expect(host.querySelector(".git-upstream-badge")).toBeNull();
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

  it("renders the stage toolbar button with a lucide Plus icon, not bare text", async () => {
    await renderPanel({
      status: gitStatus([gitChange("untracked", "notes.txt", false)]),
    });

    const stageButton = host.querySelector<HTMLButtonElement>(
      '[title="Stage selected files"]',
    );

    expect(stageButton).not.toBeNull();
    // The bare "+" glyph is replaced by an inline SVG icon.
    expect(stageButton?.querySelector("svg")).not.toBeNull();
    expect(stageButton?.textContent?.trim()).toBe("");
  });

  it("labels the change checkboxes as Stage/Unstage rather than Include/Exclude", async () => {
    const staged = gitChange("modified", "src/Alpha.php", false);
    const unstaged = gitChange("modified", "src/Beta.php", false);
    await renderPanel({
      includedChangePaths: new Set([gitChangeKey(staged)]),
      status: gitStatus([staged, unstaged]),
    });

    const labelFor = (relativePath: string) =>
      Array.from(
        host.querySelectorAll<HTMLInputElement>(".git-change-checkbox input"),
      )
        .map((input) => input.getAttribute("aria-label") ?? "")
        .find((label) => label.includes(relativePath)) ?? "";

    // An included (checked) file offers to Unstage it; an excluded one to Stage.
    expect(labelFor("src/Alpha.php")).toBe("Unstage src/Alpha.php");
    expect(labelFor("src/Beta.php")).toBe("Stage src/Beta.php");

    // The group header checkbox uses the same Stage/Unstage vocabulary.
    const groupLabel = host
      .querySelector<HTMLInputElement>(
        ".git-change-group-header .git-themed-checkbox input",
      )
      ?.getAttribute("aria-label");

    expect(groupLabel).toMatch(/Stage|Unstage/);
    expect(groupLabel).not.toMatch(/Include|Exclude/);
  });

  it("labels the stage action for a conflicted row as Mark resolved", async () => {
    const conflict = gitChange("conflicted", "src/Conflict.php", false);
    await renderPanel({ status: gitStatus([conflict]) });

    const label = host
      .querySelector<HTMLInputElement>(".git-change-checkbox input")
      ?.getAttribute("aria-label");

    expect(label).toBe("Mark resolved src/Conflict.php");
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

  it("renders accessible conventional commit hints for a matching prefix", async () => {
    await renderPanel({
      commitMessage: "f",
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    const strip = host.querySelector(".git-conventional-commit-hints");
    expect(strip).not.toBeNull();
    expect(
      strip?.querySelector('button[aria-label="Complete conventional commit type feat"]'),
    ).not.toBeNull();
    expect(
      strip?.querySelector('button[aria-label="Complete conventional commit type fix"]'),
    ).not.toBeNull();
  });

  it("offers no conventional commit hints for fexxx when the caret is inside the token", async () => {
    await renderPanel({
      commitMessage: "fexxx",
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });
    const textarea = host.querySelector<HTMLTextAreaElement>(
      ".git-commit-message",
    )!;

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(2, 2);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });

    expect(host.querySelector(".git-conventional-commit-hints")).toBeNull();
  });

  it("keeps conventional commit hints visible while typing a scope and preserves it on completion", async () => {
    const onCommitMessageChange = vi.fn();
    await renderPanel({
      commitMessage: "fe(api)!",
      onCommitMessageChange,
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });
    const textarea = host.querySelector<HTMLTextAreaElement>(
      ".git-commit-message",
    )!;

    act(() => {
      textarea.focus();
      textarea.setSelectionRange("fe(api)!".length, "fe(api)!".length);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });

    const featHint = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Complete conventional commit type feat"]',
    );
    expect(featHint).not.toBeNull();

    act(() => featHint?.click());

    expect(onCommitMessageChange).toHaveBeenCalledWith("feat(api)!: ");
  });

  it("offers and non-lossily completes plain fe when the caret is inside the token", async () => {
    const onCommitMessageChange = vi.fn();
    await renderPanel({
      commitMessage: "fe",
      onCommitMessageChange,
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });
    const textarea = host.querySelector<HTMLTextAreaElement>(
      ".git-commit-message",
    )!;

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(1, 1);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });

    const featHint = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Complete conventional commit type feat"]',
    );
    expect(featHint).not.toBeNull();

    act(() => featHint?.click());

    expect(onCommitMessageChange).toHaveBeenCalledWith("feat: ");
  });

  it("disables conventional commit hint buttons while a Git operation is running", async () => {
    await renderPanel({
      commitMessage: "fe",
      gitOperationLoading: true,
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    const hintButtons = host.querySelectorAll<HTMLButtonElement>(
      ".git-conventional-commit-hints button",
    );
    expect(hintButtons.length).toBeGreaterThan(0);
    expect(Array.from(hintButtons).every((button) => button.disabled)).toBe(true);
  });

  it.each(["", "feat: subject", "feat subject"])(
    "hides conventional commit hints for %j",
    async (commitMessage) => {
      await renderPanel({
        commitMessage,
        status: gitStatus([gitChange("modified", "src/User.php", true)]),
      });

      expect(host.querySelector(".git-conventional-commit-hints")).toBeNull();
    },
  );

  it("hides conventional commit hints when the caret leaves the first word", async () => {
    await renderPanel({
      commitMessage: "fe\nbody",
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });
    const textarea = host.querySelector<HTMLTextAreaElement>(
      ".git-commit-message",
    )!;
    expect(host.querySelector(".git-conventional-commit-hints")).not.toBeNull();

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(4, 4);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });

    expect(host.querySelector(".git-conventional-commit-hints")).toBeNull();
  });

  it("completes a conventional type and restores the textarea caret", async () => {
    const onCommitMessageChange = vi.fn();

    function Parent() {
      const [commitMessage, setCommitMessage] = useState("fe\nbody");
      return (
        <GitChangesPanel
          activeChange={null}
          commitMessage={commitMessage}
          gitOperationLoading={false}
          includedChangePaths={new Set()}
          isLoading={false}
          onCommit={vi.fn()}
          onCommitAndPush={vi.fn()}
          onCommitMessageChange={(message) => {
            onCommitMessageChange(message);
            setCommitMessage(message);
          }}
          onOpenChange={vi.fn()}
          onPreviewChange={vi.fn()}
          onRefresh={vi.fn()}
          onRevertChanges={vi.fn()}
          onStageChanges={vi.fn()}
          onToggleChangeIncluded={vi.fn()}
          onUnstageChanges={vi.fn()}
          rootPath="/workspace"
          status={gitStatus([gitChange("modified", "src/User.php", true)])}
        />
      );
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Complete conventional commit type feat"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const textarea = host.querySelector<HTMLTextAreaElement>(
      ".git-commit-message",
    )!;
    expect(onCommitMessageChange).toHaveBeenCalledWith("feat: \nbody");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe("feat: ".length);
    expect(textarea.selectionEnd).toBe("feat: ".length);
  });

  it("hides commit message history when it is empty", async () => {
    await renderPanel({
      commitMessageHistory: [],
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    expect(
      host.querySelector('button[aria-label="Commit message history"]'),
    ).toBeNull();
  });

  it("renders history most-recent-first and fills the textarea on selection", async () => {
    const onCommitMessageChange = vi.fn();
    await renderPanel({
      commitMessageHistory: ["newest\nbody", "older"],
      onCommitMessageChange,
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Commit message history"]',
        )
        ?.click();
    });

    const options = host.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toBe("newest");
    expect(options[1].textContent).toBe("older");

    act(() => options[0].click());
    expect(onCommitMessageChange).toHaveBeenCalledWith("newest\nbody");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("dismisses open history on a pointer press outside it", async () => {
    await renderPanel({
      commitMessageHistory: ["newest", "older"],
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Commit message history"]',
    )!;

    act(() => button.click());
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    act(() => {
      host.querySelector("textarea")?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });

    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("closes open history when the history entries change", async () => {
    const status = gitStatus([gitChange("modified", "src/User.php", true)]);
    await renderPanel({
      commitMessageHistory: ["newest", "middle", "oldest"],
      status,
    });

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Commit message history"]',
        )
        ?.click();
    });
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();

    await renderPanel({ commitMessageHistory: ["other workspace"], status });

    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("supports keyboard navigation, selection, and dismissal", async () => {
    const onCommitMessageChange = vi.fn();
    await renderPanel({
      commitMessageHistory: ["newest", "middle", "oldest"],
      onCommitMessageChange,
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Commit message history"]',
    )!;

    act(() => button.click());
    const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!;
    act(() => {
      listbox.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
      listbox.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(onCommitMessageChange).toHaveBeenCalledWith("middle");

    act(() => button.click());
    act(() => {
      const reopened = host.querySelector<HTMLElement>('[role="listbox"]')!;
      reopened.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      );
      reopened.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(onCommitMessageChange).toHaveBeenLastCalledWith("oldest");

    act(() => button.click());
    act(() => {
      host.querySelector<HTMLElement>('[role="listbox"]')?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("performs a plain commit on the next click after amend resets", async () => {
    const onAmend = vi.fn();
    const onCommit = vi.fn();
    function Parent() {
      const [amendEnabled, setAmendEnabled] = useState(true);
      return (
        <GitChangesPanel
          activeChange={null}
          amendEnabled={amendEnabled}
          commitMessage="next commit"
          gitOperationLoading={false}
          includedChangePaths={new Set([gitChangeKey(gitChange("modified", "src/User.php", true))])}
          isLoading={false}
          onAmend={() => {
            onAmend();
            setAmendEnabled(false);
          }}
          onAmendEnabledChange={setAmendEnabled}
          onCommit={onCommit}
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
          status={gitStatus([gitChange("modified", "src/User.php", true)])}
        />
      );
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    const button = host.querySelector<HTMLButtonElement>(".git-commit-button");
    expect(button?.textContent).toBe("Amend");
    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(onAmend).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    expect(button?.textContent).toBe("Commit");
    act(() => button?.click());
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("toggles amend when its visible text is clicked", async () => {
    const onAmendEnabledChange = vi.fn();
    await renderPanel({
      amendEnabled: false,
      onAmendEnabledChange,
      status: gitStatus([gitChange("modified", "src/User.php", true)]),
    });

    const amendText = Array.from(host.querySelectorAll("span")).find(
      (element) => element.textContent === "Amend",
    );
    act(() => {
      amendText?.click();
    });

    expect(onAmendEnabledChange).toHaveBeenCalledWith(true);
  });

  it("runs pull and fetch from compact remote actions", async () => {
    const onFetch = vi.fn();
    const onPull = vi.fn();
    await renderPanel({ onFetch, onPull });

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Fetch"]')?.click();
      host.querySelector<HTMLButtonElement>('button[aria-label="Pull"]')?.click();
    });

    expect(onFetch).toHaveBeenCalledTimes(1);
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it("disables pull and fetch while a Git operation is running", async () => {
    await renderPanel({ gitOperationLoading: true });

    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Fetch"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Pull"]')?.disabled).toBe(true);
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

  it("renders and toggles efficiently with a large number of changed files (300+)", async () => {
    // Verifies the memoization pattern (React.memo per row/group + useMemo
    // grouping) that keeps the panel fast still holds at the scale a large
    // feature-branch diff or a big vendor bump would produce, without adding
    // list virtualization: the file tree virtualizes because it can render
    // thousands of nodes across a whole project, but a changed-file list this
    // size stays a few hundred DOM rows at most, where per-row memoization is
    // enough to keep toggling one row cheap.
    const statuses: GitChangedFile["status"][] = [
      "modified",
      "added",
      "deleted",
      "untracked",
    ];
    const changes: GitChangedFile[] = Array.from({ length: 320 }, (_, index) =>
      gitChange(
        statuses[index % statuses.length],
        `src/Module${index % 20}/File${index}.php`,
        index % 3 !== 0,
      ),
    );
    const status = gitStatus(changes);
    const titleSpy = vi.spyOn(gitDomain, "gitStatusTitle");
    const target = changes[0];
    const bystander = changes[changes.length - 1];

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

    let toggleTarget: () => void = () => undefined;

    function Parent() {
      const [included, setIncluded] = useState<Set<string>>(new Set());
      toggleTarget = () =>
        setIncluded((current) => {
          const next = new Set(current);
          const key = gitChangeKey(target);
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

    expect(host.querySelectorAll(".git-change-row-wrapper")).toHaveLength(
      changes.length,
    );

    const bystanderCallsBefore = titleSpy.mock.calls.filter(
      ([rowStatus]) => rowStatus === bystander.status,
    ).length;
    expect(bystanderCallsBefore).toBeGreaterThan(0);

    await act(async () => {
      toggleTarget();
      await Promise.resolve();
    });

    const bystanderCallsAfter = titleSpy.mock.calls.filter(
      ([rowStatus]) => rowStatus === bystander.status,
    ).length;

    // Toggling one row out of 320 must not recompute every other row's status
    // title: each GitChangeRow is memoized on its own props, so only the
    // toggled row's memo bails out.
    expect(bystanderCallsAfter).toBe(bystanderCallsBefore);

    titleSpy.mockRestore();
  });

  it("groups changes by repository with a header per repo when several repos change", async () => {
    const primary = gitChange("modified", "app/Kernel.php", true);
    const nested = nestedGitChange(
      "workbench/lcsk/attendance",
      "modified",
      "src/Attendance.php",
      true,
    );

    await renderPanel({
      repositoryStatuses: [
        repositoryStatus("", "main", [primary]),
        repositoryStatus("workbench/lcsk/attendance", "develop", [nested]),
      ],
      status: gitStatus([primary]),
    });

    const headers = host.querySelectorAll(".git-repository-header");
    expect(headers).toHaveLength(2);

    const names = Array.from(
      host.querySelectorAll(".git-repository-name"),
    ).map((node) => node.textContent);
    // Primary repo shows the workspace base name; nested shows its relative path.
    expect(names).toContain("workspace");
    expect(names).toContain("workbench/lcsk/attendance");

    // Each repo header carries its own branch.
    expect(host.textContent).toContain("main");
    expect(host.textContent).toContain("develop");

    // Both repos' files are listed.
    expect(host.textContent).toContain("Kernel.php");
    expect(host.textContent).toContain("Attendance.php");
  });

  it("renders each repository section's own upstream tracking", async () => {
    const primary = gitChange("modified", "app/Kernel.php", true);
    const nested = nestedGitChange(
      "workbench/lcsk/attendance",
      "modified",
      "src/Attendance.php",
      true,
    );

    await renderPanel({
      repositoryStatuses: [
        repositoryStatus("", "main", [primary], {
          branch: "origin/main",
          ahead: 0,
          behind: 2,
        }),
        repositoryStatus("workbench/lcsk/attendance", "develop", [nested], {
          branch: "origin/develop",
          ahead: 1,
          behind: 0,
        }),
      ],
      status: gitStatus([primary]),
    });

    const badges = host.querySelectorAll(".git-upstream-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]?.textContent).toBe("2↓");
    expect(badges[0]?.getAttribute("title")).toBe("Upstream: origin/main");
    expect(badges[1]?.textContent).toBe("1↑");
    expect(badges[1]?.getAttribute("title")).toBe("Upstream: origin/develop");
  });

  it("shows no repository headers for a single repository (unchanged single-repo look)", async () => {
    const primary = gitChange("modified", "app/Kernel.php", true);

    await renderPanel({
      repositoryStatuses: [repositoryStatus("", "main", [primary])],
      status: gitStatus([primary]),
    });

    expect(host.querySelector(".git-repository-header")).toBeNull();
    expect(host.textContent).toContain("Kernel.php");
  });

  it("renders a single nested repository's changes without a header", async () => {
    // Only a nested repo changed; the primary is clean. The panel must show the
    // nested repo's changes (not "No changes") and, being a single repo, no
    // header.
    const nested = nestedGitChange(
      "workbench/lcsk/attendance",
      "modified",
      "src/Attendance.php",
      true,
    );

    await renderPanel({
      repositoryStatuses: [
        repositoryStatus("", "main", []),
        repositoryStatus("workbench/lcsk/attendance", "develop", [nested]),
      ],
      status: gitStatus([]),
    });

    expect(host.querySelector(".git-repository-header")).toBeNull();
    expect(host.textContent).toContain("Attendance.php");
    expect(host.textContent).not.toContain("No changes");
  });

  it("routes nested preview and open actions with their repository root", async () => {
    const nested = nestedGitChange(
      "workbench/lcsk/attendance",
      "modified",
      "src/Attendance.php",
      true,
    );
    const onOpenChange = vi.fn();
    const onPreviewChange = vi.fn();

    await renderPanel({
      onOpenChange,
      onPreviewChange,
      repositoryStatuses: [
        repositoryStatus("", "main", []),
        repositoryStatus("workbench/lcsk/attendance", "develop", [nested]),
      ],
      status: gitStatus([]),
    });

    const row = host.querySelector<HTMLButtonElement>(".git-change-row");
    expect(row).toBeTruthy();
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    });

    const repositoryRoot = "/workspace/workbench/lcsk/attendance";
    expect(onPreviewChange).toHaveBeenCalledWith(nested, repositoryRoot);
    expect(onOpenChange).toHaveBeenCalledWith(nested, repositoryRoot);
  });

  it("toggles a nested change with its repository-qualified key", async () => {
    const primary = gitChange("modified", "app/Kernel.php", true);
    const nested = nestedGitChange(
      "workbench/lcsk/attendance",
      "modified",
      "src/Attendance.php",
      true,
    );
    const onToggleChangeIncluded = vi.fn();

    await renderPanel({
      onToggleChangeIncluded,
      repositoryStatuses: [
        repositoryStatus("", "main", [primary]),
        repositoryStatus("workbench/lcsk/attendance", "develop", [nested]),
      ],
      status: gitStatus([primary]),
    });

    const checkbox = Array.from(
      host.querySelectorAll<HTMLInputElement>(".git-change-checkbox input"),
    ).find((input) =>
      input.getAttribute("aria-label")?.includes("src/Attendance.php"),
    );
    expect(checkbox).toBeTruthy();

    act(() => {
      checkbox?.click();
    });

    expect(onToggleChangeIncluded).toHaveBeenCalledWith(
      nested,
      "workbench/lcsk/attendance",
    );
  });

  it("reflects a repository-qualified included key in the nested repo's checkbox", async () => {
    const primary = gitChange("modified", "README.md", true);
    const nested = nestedGitChange(
      "workbench/lcsk/attendance",
      "modified",
      "README.md",
      true,
    );

    // Only the nested README is included (qualified key); the primary README of
    // the same relative path must stay unchecked.
    await renderPanel({
      includedChangePaths: new Set([
        gitChangeKeyForRepository("workbench/lcsk/attendance", nested),
      ]),
      repositoryStatuses: [
        repositoryStatus("", "main", [primary]),
        repositoryStatus("workbench/lcsk/attendance", "develop", [nested]),
      ],
      status: gitStatus([primary]),
    });

    // Both READMEs share the same repo-relative aria-label, so distinguish them
    // by their repository section (primary first, nested second).
    const sectionEls = host.querySelectorAll(".git-repository-section");
    expect(sectionEls).toHaveLength(2);
    const primaryBox = sectionEls[0].querySelector<HTMLInputElement>(
      ".git-change-checkbox input",
    );
    const nestedBox = sectionEls[1].querySelector<HTMLInputElement>(
      ".git-change-checkbox input",
    );

    // Only the nested README is checked; the colliding primary README is not.
    expect(nestedBox?.checked).toBe(true);
    expect(primaryBox?.checked).toBe(false);
    const allBoxes = Array.from(
      host.querySelectorAll<HTMLInputElement>(".git-change-checkbox input"),
    );
    expect(allBoxes.filter((input) => input.checked)).toHaveLength(1);
  });

  async function renderPanel(
    props: Partial<React.ComponentProps<typeof GitChangesPanel>> = {},
  ) {
    await act(async () => {
      root.render(
        <GitChangesPanel
          activeChange={props.activeChange ?? null}
          amendEnabled={props.amendEnabled ?? false}
          commitMessage={props.commitMessage ?? "feat: update"}
          commitMessageHistory={props.commitMessageHistory ?? []}
          gitOperationLoading={props.gitOperationLoading ?? false}
          includedChangePaths={
            props.includedChangePaths ??
            new Set([gitChangeKey(gitChange("modified", "src/User.php", true))])
          }
          isLoading={props.isLoading ?? false}
          onCommit={props.onCommit ?? vi.fn()}
          onAmend={props.onAmend ?? vi.fn()}
          onAmendEnabledChange={props.onAmendEnabledChange ?? vi.fn()}
          onCommitAndPush={props.onCommitAndPush ?? vi.fn()}
          onFetch={props.onFetch ?? vi.fn()}
          onCommitMessageChange={props.onCommitMessageChange ?? vi.fn()}
          onToggleChangeIncluded={props.onToggleChangeIncluded ?? vi.fn()}
          onOpenChange={props.onOpenChange ?? vi.fn()}
          onPreviewChange={props.onPreviewChange ?? vi.fn()}
          onPull={props.onPull ?? vi.fn()}
          onRefresh={props.onRefresh ?? vi.fn()}
          onRevertChanges={props.onRevertChanges ?? vi.fn()}
          onStageChanges={props.onStageChanges ?? vi.fn()}
          onUnstageChanges={props.onUnstageChanges ?? vi.fn()}
          repositoryStatuses={props.repositoryStatuses}
          rootPath={props.rootPath ?? "/workspace"}
          status={props.status ?? gitStatus([])}
          workspaceRoot={props.workspaceRoot ?? "/workspace"}
        />,
      );
      await Promise.resolve();
    });
  }
});

function gitStatus(
  changes: GitChangedFile[],
  upstream: GitStatus["upstream"] = null,
): GitStatus {
  return {
    branch: "main",
    changes,
    isRepository: true,
    rootPath: "/workspace",
    upstream,
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

function nestedGitChange(
  repoRootRelative: string,
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
    path: `/workspace/${repoRootRelative}/${relativePath}`,
    relativePath,
    status,
  };
}

function repositoryStatus(
  rootRelativePath: string,
  branch: string,
  changes: GitChangedFile[],
  upstream: GitStatus["upstream"] = null,
): GitRepositoryStatus {
  const root =
    rootRelativePath === ""
      ? "/workspace"
      : `/workspace/${rootRelativePath}`;

  return {
    mapping: { rootRelativePath },
    root,
    status: { branch, changes, isRepository: true, rootPath: root, upstream },
    failed: false,
  };
}
