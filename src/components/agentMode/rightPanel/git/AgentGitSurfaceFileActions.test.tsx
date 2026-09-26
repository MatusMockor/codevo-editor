// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitStatus } from "../../../../domain/git";
import type {
  GitAmendCandidate,
  GitAmendHeadRequest,
  GitDiscardFileRequest,
  GitWorkingTreeGateway,
} from "../../../../domain/gitWorkingTree";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { surfaceThreadView } from "../../agentSurfaceTestFixtures";
import type { AgentShipActions } from "../../useAgentShipActions";
import type { AgentRightPanelGateways } from "../agentRightPanelGateways";
import { WithRightPanelContext, rightPanelTestContext } from "../agentRightPanelTestSupport";
import { AgentGitSurfaceContainer } from "./AgentGitSurfaceContainer";

const HEAD = "c".repeat(40);
const FINGERPRINT = "ab".repeat(32);
let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function change(
  relativePath: string,
  status: GitChangedFile["status"] = "modified",
): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: status === "untracked",
    oldPath: null,
    oldRelativePath: null,
    path: `/repo/${relativePath}`,
    relativePath,
    status,
  };
}

function memoryGit(initial: GitChangedFile[]) {
  const calls: string[] = [];
  let changes = initial;
  const status = (): GitStatus => ({
    branch: "main",
    changes,
    isRepository: true,
    rootPath: "/repo",
  });
  const git: AgentRightPanelGateways["git"] = {
    getStatus: async (root) => {
      calls.push(`status:${root}`);
      return status();
    },
    getDiff: () => Promise.reject(new Error("unused")),
    stageFiles: async (_root, files) => {
      calls.push(`stage:${files.map((file) => file.relativePath).join(",")}`);
      return status();
    },
    commit: async () => status(),
    push: async () => status(),
    fetch: async () => status(),
    createBranch: async () => undefined,
    switchBranch: async () => undefined,
  };
  return {
    calls,
    git,
    remove: (relativePath: string) => {
      changes = changes.filter((item) => item.relativePath !== relativePath);
    },
  };
}

function workingTree(candidate: GitAmendCandidate) {
  const amends: GitAmendHeadRequest[] = [];
  const discards: GitDiscardFileRequest[] = [];
  const gateway: GitWorkingTreeGateway = {
    getAmendCandidate: async () => candidate,
    amendHead: async (request) => {
      amends.push(request);
      return { headSha: "d".repeat(40), indexSynced: true };
    },
    prepareDiscard: async () => ({ fingerprint: FINGERPRINT }),
    discardFile: async (request) => {
      discards.push(request);
      return { relativePath: request.file.relativePath, action: "restored" };
    },
  };
  return { amends, discards, gateway };
}

function mount(value: ReturnType<typeof rightPanelTestContext>): MountedUi {
  const mounted = mountUi();
  mounted.render(
    <WithRightPanelContext value={value}>
      <AgentGitSurfaceContainer />
    </WithRightPanelContext>,
  );
  ui = mounted;
  return mounted;
}

function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}

function menuItem(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>("[role^='menuitem']")].find(
    (candidate) => candidate.textContent?.includes(name),
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}

function dialog(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>("[role='alertdialog']");
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

function messageBox(host: HTMLElement): HTMLTextAreaElement {
  const found = host.querySelector<HTMLTextAreaElement>("textarea[aria-label='Commit message']");
  expect(found).not.toBeNull();
  return found as HTMLTextAreaElement;
}

describe("Git surface file actions", () => {
  it("amends the last commit with its prefilled message and the included files", async () => {
    const memory = memoryGit([change("a.ts"), change("b.ts")]);
    const tree = workingTree({ kind: "ready", headSha: HEAD, message: "feat: first" });
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(2));

    click(button(mounted.host, "More commit options"));
    await waitForReact(() => expect(menuItem("Amend last commit").disabled).toBe(false));
    click(menuItem("Amend last commit"));

    await waitForReact(() => expect(messageBox(mounted.host).value).toBe("feat: first"));
    expect(mounted.host.textContent).toContain("Amending ccccccc");
    expect(
      [...mounted.host.querySelectorAll("button")].some(
        (candidate) => candidate.textContent?.trim() === "Commit & push",
      ),
    ).toBe(false);
    click(button(mounted.host, "Include b.ts"));
    click(button(mounted.host, "Amend commit"));

    await waitForReact(() =>
      expect(mounted.host.textContent).toContain("Amended the last commit."),
    );
    expect(tree.amends).toEqual([
      {
        repositoryRoot: "/repo",
        worktreePath: null,
        expectedHead: HEAD,
        message: "feat: first",
        files: [{ relativePath: "a.ts", action: "stageWorktree" }],
      },
    ]);
    expect(memory.calls.some((call) => call.startsWith("stage:"))).toBe(false);
    expect(mounted.host.textContent).not.toContain("Amending ccccccc");
  });

  it("restores the draft when amend is turned off", async () => {
    const memory = memoryGit([change("a.ts")]);
    const tree = workingTree({ kind: "ready", headSha: HEAD, message: "feat: first" });
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(1));
    click(button(mounted.host, "More commit options"));
    await waitForReact(() => expect(menuItem("Amend last commit").disabled).toBe(false));
    click(menuItem("Amend last commit"));
    await waitForReact(() => expect(messageBox(mounted.host).value).toBe("feat: first"));

    click(button(mounted.host, "Stop amending"));

    await waitForReact(() => expect(messageBox(mounted.host).value).toBe(""));
    expect(button(mounted.host, "Commit & push")).toBeDefined();
    expect(tree.amends).toEqual([]);
  });

  it("explains why the last commit cannot be amended", async () => {
    const memory = memoryGit([change("a.ts")]);
    const tree = workingTree({ kind: "pushed", headSha: HEAD });
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(1));

    click(button(mounted.host, "More commit options"));

    await waitForReact(() =>
      expect(menuItem("Amend last commit").getAttribute("aria-disabled")).toBe("true"),
    );
    expect(menuItem("Amend last commit").title).toBe(
      "The last commit is already pushed. Amending it would rewrite published history.",
    );
    click(menuItem("Amend last commit"));
    expect(messageBox(mounted.host).value).toBe("");
  });

  it("keeps amend disabled with a reason for agent threads", async () => {
    const memory = memoryGit([change("a.ts")]);
    const tree = workingTree({ kind: "ready", headSha: HEAD, message: "m" });
    const actions: AgentShipActions = {
      onRefreshShipStatus: vi.fn(),
      onCommit: vi.fn(),
      onPush: vi.fn(),
      onOpenCompareUrl: vi.fn(),
      onIntegrate: vi.fn(),
      onRemoveWorktree: vi.fn(),
      onDiscardWorktree: vi.fn(),
      onDismissFailure: vi.fn(),
    };
    const mounted = mount(
      rightPanelTestContext(
        { thread: surfaceThreadView(), shipActions: actions, checkoutRoot: "/repo" },
        { git: memory.git, workingTree: tree.gateway },
      ),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(1));

    click(button(mounted.host, "More commit options"));

    await waitForReact(() =>
      expect(menuItem("Amend last commit").getAttribute("aria-disabled")).toBe("true"),
    );
    expect(menuItem("Amend last commit").title).toContain("Agent threads");
  });

  it("discards one file only after confirmation and reloads the list", async () => {
    const memory = memoryGit([change("a.ts"), change("b.ts")]);
    const tree = workingTree({ kind: "noCommit" });
    tree.gateway.discardFile = async (request) => {
      tree.discards.push(request);
      memory.remove(request.file.relativePath);
      return { relativePath: request.file.relativePath, action: "restored" };
    };
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(2));

    click(button(mounted.host, "Discard changes to a.ts"));
    expect(dialog().textContent).toContain("Discard changes?");
    expect(dialog().textContent).toContain("a.ts");
    click(button(dialog(), "Cancel"));
    expect(document.body.querySelector("[role='alertdialog']")).toBeNull();
    expect(tree.discards).toEqual([]);

    click(button(mounted.host, "Discard changes to a.ts"));
    await waitForReact(() => expect(button(dialog(), "Discard changes").disabled).toBe(false));
    click(button(dialog(), "Discard changes"));

    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(1));
    expect(tree.discards).toEqual([
      {
        repositoryRoot: "/repo",
        worktreePath: null,
        file: { relativePath: "a.ts", oldRelativePath: null, expectedStatus: "modified" },
        fingerprint: FINGERPRINT,
      },
    ]);
    expect(mounted.host.textContent).toContain("Discarded changes to a.ts.");
    expect(document.body.querySelector("[role='alertdialog']")).toBeNull();
    await waitForReact(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Include b.ts"),
    );
  });

  it("warns that an untracked file is deleted and blocks conflicted files", async () => {
    const memory = memoryGit([change("notes.txt", "untracked"), change("merge.ts", "conflicted")]);
    const tree = workingTree({ kind: "noCommit" });
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(2));

    expect(button(mounted.host, "Discard changes to merge.ts").disabled).toBe(true);
    expect(button(mounted.host, "Discard changes to merge.ts").title).toBe(
      "Resolve the conflict before discarding this file.",
    );
    click(button(mounted.host, "Delete notes.txt"));
    expect(dialog().textContent).toContain("Delete untracked file?");
    expect(dialog().textContent).toContain("deleted from disk");
    await waitForReact(() => expect(button(dialog(), "Delete file").disabled).toBe(false));
    click(button(dialog(), "Delete file"));

    await waitForReact(() => expect(tree.discards).toHaveLength(1));
    expect(tree.discards[0]?.file.expectedStatus).toBe("untracked");
  });

  it("says when an amend only changes the message", async () => {
    const memory = memoryGit([change("a.ts")]);
    const tree = workingTree({ kind: "ready", headSha: HEAD, message: "feat: first" });
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(1));
    click(button(mounted.host, "More commit options"));
    await waitForReact(() => expect(menuItem("Amend last commit").disabled).toBe(false));
    click(menuItem("Amend last commit"));
    await waitForReact(() => expect(messageBox(mounted.host).value).toBe("feat: first"));
    expect(mounted.host.textContent).not.toContain("Only the message changes");

    click(button(mounted.host, "Include a.ts"));

    expect(mounted.host.textContent).toContain("Only the message changes");
  });

  it("explains why a nested repository row cannot be discarded", async () => {
    const memory = memoryGit([change("vendor/lib/", "untracked"), change("a.ts")]);
    const tree = workingTree({ kind: "noCommit" });
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(2));

    const nested = button(mounted.host, "Delete vendor/lib/");
    expect(nested.disabled).toBe(true);
    expect(nested.title).toBe("Nested repositories can't be discarded here.");
    click(nested);
    expect(document.body.querySelector("[role='alertdialog']")).toBeNull();
    expect(tree.discards).toEqual([]);
  });

  it("leaves amend mode and says so truthfully when the index could not be updated", async () => {
    const memory = memoryGit([change("a.ts")]);
    const refresh = vi.fn();
    const tree = workingTree({ kind: "ready", headSha: HEAD, message: "feat: first" });
    tree.gateway.amendHead = async (request) => {
      tree.amends.push(request);
      return { headSha: "d".repeat(40), indexSynced: false };
    };
    const mounted = mount(
      rightPanelTestContext(
        { gitStatus: { load: { kind: "idle" }, refresh } },
        { git: memory.git, workingTree: tree.gateway },
      ),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(1));
    click(button(mounted.host, "More commit options"));
    await waitForReact(() => expect(menuItem("Amend last commit").disabled).toBe(false));
    click(menuItem("Amend last commit"));
    await waitForReact(() => expect(messageBox(mounted.host).value).toBe("feat: first"));

    click(button(mounted.host, "Amend commit"));

    await waitForReact(() =>
      expect(mounted.host.querySelector("[role='alert']")?.textContent).toContain(
        "could not update the staged files",
      ),
    );
    expect(mounted.host.textContent).not.toContain("Amending ccccccc");
    expect(button(mounted.host, "Commit & push")).toBeDefined();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a staged delete and its untracked copy as two rows and amends only the delete", async () => {
    const deleted = { ...change("secrets.env", "deleted"), isStaged: true };
    const memory = memoryGit([deleted, change("secrets.env", "untracked")]);
    const tree = workingTree({ kind: "ready", headSha: HEAD, message: "feat: first" });
    const mounted = mount(
      rightPanelTestContext({}, { git: memory.git, workingTree: tree.gateway }),
    );
    await waitForReact(() => expect(mounted.host.querySelectorAll(".cv-git-row")).toHaveLength(2));
    expect(
      [...mounted.host.querySelectorAll(".cv-git-status")].map((node) => node.textContent),
    ).toEqual(["D", "U"]);
    click(button(mounted.host, "More commit options"));
    await waitForReact(() => expect(menuItem("Amend last commit").disabled).toBe(false));
    click(menuItem("Amend last commit"));
    await waitForReact(() => expect(messageBox(mounted.host).value).toBe("feat: first"));

    click(button(mounted.host, "Include secrets.env (untracked)"));
    click(button(mounted.host, "Amend commit"));

    await waitForReact(() => expect(tree.amends).toHaveLength(1));
    expect(tree.amends[0]?.files).toEqual([
      { relativePath: "secrets.env", action: "stageDeletion" },
    ]);
  });
});
