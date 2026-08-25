// @vitest-environment jsdom

import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipAvailability } from "../../domain/agentShip";
import type { AgentThread } from "../../domain/agentThread";
import type { GitChangeStatus, GitChangedFile } from "../../domain/git";
import { AgentThreadChanges, type AgentThreadChangesProps } from "./AgentThreadChanges";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;

describe("AgentThreadChanges", () => {
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

  it("opens a changed file and its diff document through the surface", () => {
    const onOpenChangedFile = vi.fn();
    const onOpenChangedFileDiff = vi.fn();
    const file = changedFile("src/parser.ts");
    render({
      onOpenChangedFile,
      onOpenChangedFileDiff,
      summary: summary({ files: [file] }),
    });

    click('[aria-label="Open src/parser.ts in the editor"]');
    click('[aria-label="Open a diff document for src/parser.ts"]');

    expect(onOpenChangedFile).toHaveBeenCalledWith("agt-1", file);
    expect(onOpenChangedFileDiff).toHaveBeenCalledWith("agt-1", file);
  });

  it("keeps the inline preview on the file path itself", () => {
    const onShowFileDiff = vi.fn();
    const file = changedFile("src/parser.ts");
    render({ onShowFileDiff, summary: summary({ files: [file] }) });

    click(".agent-files__path");

    expect(onShowFileDiff).toHaveBeenCalledWith("agt-1", file);
  });

  it("disables both editor actions with the reason of a background project", () => {
    render({
      summary: summary({ files: [changedFile("src/parser.ts")] }),
      thread: threadView({
        editorAvailability: {
          kind: "blocked",
          reason: "Switch to this project's tab to open files.",
        },
      }),
    });

    expect(open("src/parser.ts").disabled).toBe(true);
    expect(diff("src/parser.ts").disabled).toBe(true);
    expect(open("src/parser.ts").getAttribute("title")).toBe(
      "Switch to this project's tab to open files.",
    );
    expect(host.querySelector(".agent-files__reason")?.textContent).toBe(
      "Switch to this project's tab to open files.",
    );
  });

  it("keeps the diff of a deleted file available while its open is blocked", () => {
    render({ summary: summary({ files: [changedFile("src/gone.ts", "deleted")] }) });

    expect(open("src/gone.ts").disabled).toBe(true);
    expect(open("src/gone.ts").getAttribute("title")).toBe(
      "This file was deleted in the worktree.",
    );
    expect(diff("src/gone.ts").disabled).toBe(false);
  });

  function render(overrides: Partial<AgentThreadChangesProps> = {}): void {
    act(() => root.render(<AgentThreadChanges {...defaultProps()} {...overrides} />));
  }

  function open(relativePath: string): HTMLButtonElement {
    return required(`[aria-label="Open ${relativePath} in the editor"]`);
  }

  function diff(relativePath: string): HTMLButtonElement {
    return required(`[aria-label="Open a diff document for ${relativePath}"]`);
  }

  function required(selector: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    return element as HTMLButtonElement;
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    act(() => element?.click());
  }
});

function defaultProps(): AgentThreadChangesProps {
  return {
    thread: threadView({}),
    summary: summary({}),
    onHideChanges: () => undefined,
    onHideFileDiff: () => undefined,
    onOpenChangedFile: () => undefined,
    onOpenChangedFileDiff: () => undefined,
    onRefreshChanges: () => undefined,
    onShowFileDiff: () => undefined,
  };
}

function summary(overrides: Partial<AgentTaskChangeSummary>): AgentTaskChangeSummary {
  return {
    loading: false,
    error: null,
    files: [],
    truncated: false,
    removing: false,
    diff: null,
    ...overrides,
  };
}

function changedFile(relativePath: string, status: GitChangeStatus = "modified"): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE}/${relativePath}`,
    relativePath,
    status,
  };
}

function threadView(overrides: {
  readonly editorAvailability?: AgentShipAvailability;
}): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: WORKTREE },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 5 * 60_000,
    updatedAtEpochMs: NOW - 5 * 60_000,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    integration: null,
  };

  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: overrides.editorAvailability ?? { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
