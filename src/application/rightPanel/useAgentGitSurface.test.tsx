// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { GitChangedFile, GitStatus } from "../../domain/git";
import type { AgentCommitSelection } from "../../domain/gitCommitSelection";
import type { GitLineStat } from "../../domain/gitSurfaceStatus";
import { waitForReact } from "../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  projectGitCommitPort,
  type AgentGitCommitOutcome,
  type AgentGitCommitPort,
  type ProjectGitCommitGateway,
} from "./projectGitCommitPort";
import {
  useAgentGitSurface,
  type AgentGitSurfaceState,
  type UseAgentGitSurfaceOptions,
} from "./useAgentGitSurface";

let ui: MountedUi | null = null;
const box: { current: AgentGitSurfaceState | null } = { current: null };

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function change(
  relativePath: string,
  status: GitChangedFile["status"] = "modified",
): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `/r/${relativePath}`,
    relativePath,
    status,
  };
}

function memoryGit(changes: GitChangedFile[]) {
  const calls: string[] = [];
  let current = changes;
  const status = (): GitStatus => ({
    branch: "main",
    changes: current,
    isRepository: true,
    rootPath: "/r",
  });
  const git: ProjectGitCommitGateway = {
    getStatus: async () => status(),
    stageFiles: async (_root, files) => {
      calls.push(`stage:${files.map((file) => file.relativePath).join(",")}`);
      return status();
    },
    commit: async (_root, message, files) => {
      calls.push(`commit:${message}:${files.map((file) => file.relativePath).join(",")}`);
      current = current.filter((item) => !files.some((file) => file.path === item.path));
      return status();
    },
    push: async () => {
      calls.push("push");
      return status();
    },
  };
  return {
    calls,
    git,
    appear: (file: GitChangedFile) => {
      current = [...current, file];
    },
  };
}

interface PendingCall {
  readonly message: string;
  readonly selection: AgentCommitSelection;
  readonly result: Deferred<AgentGitCommitOutcome>;
}

function pendingPort() {
  const calls: PendingCall[] = [];
  const port: AgentGitCommitPort = {
    commit(message, selection) {
      const result = deferred<AgentGitCommitOutcome>();
      calls.push({ message, selection, result });
      return result.promise;
    },
    commitAndPush(message, selection) {
      const result = deferred<AgentGitCommitOutcome>();
      calls.push({ message, selection, result });
      return result.promise;
    },
    amendCandidate: async () => ({ kind: "unavailable", reason: "not in this test" }),
    amend: async () => ({ kind: "failed", message: "not in this test" }),
  };
  return { calls, port };
}

function Probe(props: { readonly options: UseAgentGitSurfaceOptions }) {
  box.current = useAgentGitSurface(props.options);
  return null;
}

function options(overrides: Partial<UseAgentGitSurfaceOptions>): UseAgentGitSurfaceOptions {
  return {
    ownerKey: "thread-a",
    rootPath: "/r",
    git: null,
    lineStats: [],
    port: null,
    threadTitle: null,
    onCommitted: () => undefined,
    ...overrides,
  };
}

function render(next: UseAgentGitSurfaceOptions): void {
  ui = ui ?? mountUi();
  ui.render(<Probe options={next} />);
}

function surface(): AgentGitSurfaceState {
  const current = box.current;
  expect(current).not.toBeNull();
  return current as AgentGitSurfaceState;
}

const STATS: GitLineStat[] = [
  { relativePath: "src/orders/a.ts", added: 12, deleted: 3 },
  { relativePath: "src/orders/b.ts", added: 4, deleted: 0 },
];

describe("useAgentGitSurface", () => {
  it("reloads the change list when the status revision changes", async () => {
    const memory = memoryGit([change("a.ts")]);
    render(options({ git: memory.git, revision: 1 }));
    await waitForReact(() => expect(surface().rows).toHaveLength(1));

    memory.appear(change("b.ts"));
    render(options({ git: memory.git, revision: 1 }));
    await act(async () => undefined);
    expect(surface().rows).toHaveLength(1);

    render(options({ git: memory.git, revision: 2 }));
    await waitForReact(() =>
      expect(surface().rows.map((row) => row.relativePath)).toEqual(["a.ts", "b.ts"]),
    );
  });

  it("merges the status rows with line stats", async () => {
    const memory = memoryGit([change("src/orders/a.ts"), change("src/orders/b.ts", "added")]);
    render(options({ git: memory.git, lineStats: STATS }));

    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    expect(surface().rows).toEqual([
      {
        key: "tracked:src/orders/a.ts",
        relativePath: "src/orders/a.ts",
        oldRelativePath: null,
        status: "modified",
        added: 12,
        deleted: 3,
        included: true,
      },
      {
        key: "tracked:src/orders/b.ts",
        relativePath: "src/orders/b.ts",
        oldRelativePath: null,
        status: "added",
        added: 4,
        deleted: 0,
        included: true,
      },
    ]);
    expect(surface().summary).toEqual({ included: 2, total: 2, checked: true });
  });

  it("excludes a toggled row and reports a mixed summary", async () => {
    const memory = memoryGit([change("a.ts"), change("b.ts"), change("c.ts")]);
    render(options({ git: memory.git }));
    await waitForReact(() => expect(surface().rows).toHaveLength(3));

    act(() => surface().setRowIncluded("tracked:b.ts", false));

    expect(surface().rows.map((row) => row.included)).toEqual([true, false, true]);
    expect(surface().summary).toEqual({ included: 2, total: 3, checked: "mixed" });
    act(() => surface().setAllIncluded(false));
    expect(surface().summary).toEqual({ included: 0, total: 3, checked: false });
    act(() => surface().setAllIncluded(true));
    expect(surface().summary).toEqual({ included: 3, total: 3, checked: true });
  });

  it("commits the exact selection with a generated message when the box is empty", async () => {
    const memory = memoryGit([change("src/orders/a.ts", "added"), change("src/orders/b.ts")]);
    const committed: string[] = [];
    render(
      options({
        git: memory.git,
        port: projectGitCommitPort(memory.git, "/r", null),
        threadTitle: "Replay idempotent responses",
        onCommitted: () => committed.push("done"),
      }),
    );
    await waitForReact(() => expect(surface().rows).toHaveLength(2));
    act(() => surface().setRowIncluded("tracked:src/orders/b.ts", false));

    act(() => surface().commit());

    await waitForReact(() => expect(surface().notice).toEqual({ kind: "ok", text: "Committed." }));
    expect(memory.calls).toEqual([
      "stage:src/orders/a.ts",
      "commit:feat(orders): replay idempotent responses:src/orders/a.ts",
    ]);
    expect(committed).toEqual(["done"]);
    await waitForReact(() =>
      expect(surface().rows.map((row) => row.relativePath)).toEqual(["src/orders/b.ts"]),
    );
    expect(surface().busy).toBe("idle");
  });

  it("fills the message box from the generator", async () => {
    const memory = memoryGit([change("README.md")]);
    render(options({ git: memory.git }));
    await waitForReact(() => expect(surface().rows).toHaveLength(1));

    act(() => surface().generate());

    expect(surface().message).toBe("docs: update README.md");
  });

  it("keeps a late outcome for its owner and shows it when the owner is shown again", async () => {
    const memory = memoryGit([change("a.ts")]);
    const pending = pendingPort();
    let committed = 0;
    const base = {
      git: memory.git,
      port: pending.port,
      onCommitted: () => {
        committed += 1;
      },
    };
    render(options({ ...base, ownerKey: "thread-a" }));
    await waitForReact(() => expect(surface().rows).toHaveLength(1));
    act(() => surface().setMessage("Keep me"));
    act(() => surface().commit());
    expect(surface().busy).toBe("committing");

    render(options({ ...base, ownerKey: "thread-b" }));
    expect(surface().busy).toBe("idle");
    act(() => surface().setMessage("Draft for B"));
    await act(async () => pending.calls[0]?.result.resolve({ kind: "committed" }));

    expect(surface().notice).toBeNull();
    expect(committed).toBe(0);
    render(options({ ...base, ownerKey: "thread-a" }));
    expect(surface().notice).toEqual({ kind: "ok", text: "Committed." });
    expect(surface().busy).toBe("idle");
    expect(surface().message).toBe("");
    render(options({ ...base, ownerKey: "thread-b" }));
    expect(surface().message).toBe("Draft for B");
    expect(surface().notice).toBeNull();
  });

  it("shows a pending commit as busy again after switching back to its owner", async () => {
    const memory = memoryGit([change("a.ts")]);
    const pending = pendingPort();
    const base = { git: memory.git, port: pending.port };
    render(options({ ...base, ownerKey: "thread-a" }));
    await waitForReact(() => expect(surface().rows).toHaveLength(1));
    act(() => surface().commitAndPush());

    render(options({ ...base, ownerKey: "thread-b" }));
    render(options({ ...base, ownerKey: "thread-a" }));
    expect(surface().busy).toBe("pushing");
    act(() => surface().commit());
    expect(pending.calls).toHaveLength(1);

    await act(async () =>
      pending.calls[0]?.result.resolve({ kind: "failed", message: "rejected" }),
    );
    expect(surface().notice).toEqual({ kind: "error", text: "rejected" });
  });

  it("clears a status error when another owner is shown", async () => {
    const memory = memoryGit([]);
    const failing = {
      ...memory.git,
      getStatus: () => Promise.reject(new Error("not a repository")),
    };
    const pendingStatus = deferred<GitStatus>();
    render(options({ git: failing, ownerKey: "thread-a" }));
    await waitForReact(() => expect(surface().error).toBe("not a repository"));

    render(
      options({
        git: { ...memory.git, getStatus: () => pendingStatus.promise },
        ownerKey: "thread-b",
      }),
    );

    expect(surface().error).toBeNull();
  });

  it("never commits a change that appeared after the list was rendered", async () => {
    const memory = memoryGit([change("a.ts")]);
    render(options({ git: memory.git, port: projectGitCommitPort(memory.git, "/r", null) }));
    await waitForReact(() => expect(surface().rows).toHaveLength(1));
    act(() => surface().setMessage("Only a"));

    memory.appear(change("secret.env", "untracked"));
    act(() => surface().commit());

    await waitForReact(() => expect(surface().notice).toEqual({ kind: "ok", text: "Committed." }));
    expect(memory.calls).toEqual(["stage:a.ts", "commit:Only a:a.ts"]);
  });

  it("shows a partially staged file as one row and commits both of its entries", async () => {
    const memory = memoryGit([
      { ...change("a.ts"), isStaged: true },
      change("b.ts"),
      change("a.ts"),
    ]);
    const port = pendingPort();
    render(options({ git: memory.git, port: port.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(2));

    expect(surface().rows.map((row) => row.relativePath)).toEqual(["a.ts", "b.ts"]);
    act(() => surface().setRowIncluded("tracked:b.ts", false));
    expect(surface().summary).toEqual({ included: 1, total: 2, checked: "mixed" });
    act(() => surface().commit());
    expect(port.calls[0]?.selection).toEqual({ kind: "rows", rowKeys: ["tracked:a.ts"] });
  });

  it("keeps drafts per owner across switches", async () => {
    const memory = memoryGit([change("a.ts")]);
    render(options({ git: memory.git, ownerKey: "thread-a" }));
    act(() => surface().setMessage("Draft A"));
    render(options({ git: memory.git, ownerKey: "thread-b" }));
    expect(surface().message).toBe("");
    render(options({ git: memory.git, ownerKey: "thread-a" }));
    expect(surface().message).toBe("Draft A");
  });

  it("shows a failed outcome as an error and keeps the draft", async () => {
    const memory = memoryGit([change("a.ts")]);
    const pending = pendingPort();
    render(options({ git: memory.git, port: pending.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(1));
    act(() => surface().setMessage("Fix it"));

    act(() => surface().commitAndPush());
    expect(surface().busy).toBe("pushing");
    expect(pending.calls[0]?.message).toBe("Fix it");
    expect(pending.calls[0]?.selection).toEqual({ kind: "rows", rowKeys: ["tracked:a.ts"] });
    await act(async () =>
      pending.calls[0]?.result.resolve({
        kind: "failed",
        message: "The change list changed. Review the selection and commit again.",
      }),
    );

    expect(surface().notice).toEqual({
      kind: "error",
      text: "The change list changed. Review the selection and commit again.",
    });
    expect(surface().message).toBe("Fix it");
    expect(surface().busy).toBe("idle");
  });

  it("clears the draft and reports the push failure after a completed commit", async () => {
    const memory = memoryGit([change("a.ts")]);
    const pending = pendingPort();
    render(options({ git: memory.git, port: pending.port }));
    await waitForReact(() => expect(surface().rows).toHaveLength(1));
    act(() => surface().setMessage("Ship it"));

    act(() => surface().commitAndPush());
    await act(async () =>
      pending.calls[0]?.result.resolve({
        kind: "pushFailed",
        message: "Committed, but the push failed: rejected",
      }),
    );

    expect(surface().notice).toEqual({
      kind: "error",
      text: "Committed, but the push failed: rejected",
    });
    expect(surface().message).toBe("");
  });

  it("reports a status failure", async () => {
    const memory = memoryGit([]);
    render(
      options({
        git: { ...memory.git, getStatus: () => Promise.reject(new Error("not a repository")) },
      }),
    );
    await waitForReact(() => expect(surface().error).toBe("not a repository"));
    expect(surface().loading).toBe(false);
  });

  it("shows line stats only on the tracked row of a staged delete and its untracked copy", async () => {
    const deleted = { ...change("secrets.env", "deleted"), isStaged: true };
    const memory = memoryGit([deleted, change("secrets.env", "untracked")]);
    render(
      options({
        git: memory.git,
        lineStats: [{ relativePath: "secrets.env", added: 0, deleted: 3 }],
      }),
    );
    await waitForReact(() => expect(surface().rows).toHaveLength(2));

    expect(surface().rows.map((row) => [row.key, row.added, row.deleted])).toEqual([
      ["tracked:secrets.env", 0, 3],
      ["untracked:secrets.env", null, null],
    ]);
  });
});
