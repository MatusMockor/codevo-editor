// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  RemoteRunnerGateway,
  RemoteRunnerTaskFiles,
  RemoteRunnerTaskFileDiff,
} from "../domain/remoteRunner";
import type { RemoteAgentThreadExecution } from "./agentThreadPorts";
import { useRemoteAgentChanges, type RemoteAgentChangesInput } from "./useRemoteAgentChanges";

const target: RemoteAgentThreadExecution = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  projectId: "project",
  conversationId: "root",
  latestTaskId: "latest",
  resume: null,
};
const files: RemoteRunnerTaskFiles = {
  files: [{ path: "src/a.ts", status: "modified" }],
  truncated: false,
};
const diff: RemoteRunnerTaskFileDiff = {
  path: "src/a.ts",
  original: { text: "before", truncated: false },
  modified: { text: "after", truncated: false },
  unavailableReason: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function harness() {
  const listTaskFiles = vi.fn(async () => files);
  const getTaskFileDiff = vi.fn(async () => diff);
  // Only these capabilities are used by this application hook.
  const gateway = { listTaskFiles, getTaskFileDiff } as unknown as RemoteRunnerGateway;
  let input: RemoteAgentChangesInput = {
    gateway,
    owner: {},
    valid: () => true,
    resolveTarget: () => target,
    report: vi.fn(),
  };
  let surface!: ReturnType<typeof useRemoteAgentChanges>;
  const node = document.createElement("div");
  const root = createRoot(node);
  function Host() {
    surface = useRemoteAgentChanges(input);
    return null;
  }
  await act(async () => root.render(<Host />));
  return {
    listTaskFiles,
    getTaskFileDiff,
    surface: () => surface,
    async update(next: Partial<RemoteAgentChangesInput>) {
      input = { ...input, ...next };
      await act(async () => root.render(<Host />));
    },
    async dispose() {
      await act(async () => root.unmount());
    },
  };
}

describe("remote agent changes", () => {
  it("uses latest server turn and projects per-file sides into the unchanged changes UI", async () => {
    const h = await harness();
    try {
      await act(async () => h.surface().showChanges("thread"));
      expect(h.listTaskFiles).toHaveBeenCalledWith({ serverId: "server", taskId: "latest" });
      const file = h.surface().summaries.get("thread")!.files[0];
      expect(file.path).toBe("src/a.ts");
      await act(async () => h.surface().showFileDiff("thread", file));
      expect(h.getTaskFileDiff).toHaveBeenCalledWith({
        serverId: "server",
        taskId: "latest",
        path: "src/a.ts",
      });
      expect(h.surface().summaries.get("thread")?.diff?.modified.text).toBe("after");
    } finally {
      await h.dispose();
    }
  });
  it("drops late results after A to B to A owner replacement", async () => {
    const h = await harness();
    const pending = deferred<RemoteRunnerTaskFiles>();
    h.listTaskFiles.mockReturnValueOnce(pending.promise);
    let work!: Promise<void>;
    try {
      await act(async () => {
        work = h.surface().showChanges("thread");
      });
      await h.update({ owner: {} });
      await h.update({ owner: {} });
      await act(async () => {
        pending.resolve(files);
        await work;
      });
      expect(h.surface().summaries.size).toBe(0);
    } finally {
      await h.dispose();
    }
  });
  it("invalidates same-owner task replacement and does not resurrect hidden results", async () => {
    const h = await harness();
    const pending = deferred<RemoteRunnerTaskFiles>();
    h.listTaskFiles.mockReturnValueOnce(pending.promise);
    let work!: Promise<void>;
    try {
      await act(async () => {
        work = h.surface().showChanges("thread");
      });
      await h.update({ resolveTarget: () => ({ ...target, latestTaskId: "new" }) });
      await h.update({ resolveTarget: () => target });
      await act(async () => {
        pending.resolve(files);
        await work;
      });
      expect(h.surface().summaries.size).toBe(0);
      await act(async () => h.surface().showChanges("thread"));
      const pendingDiff = deferred<RemoteRunnerTaskFileDiff>();
      h.getTaskFileDiff.mockReturnValueOnce(pendingDiff.promise);
      await act(async () => {
        work = h.surface().showFileDiff("thread", h.surface().summaries.get("thread")!.files[0]);
      });
      await act(async () => h.surface().hideFileDiff("thread"));
      await act(async () => {
        pendingDiff.resolve(diff);
        await work;
      });
      expect(h.surface().summaries.get("thread")?.diff).toBeNull();
    } finally {
      await h.dispose();
    }
  });
  it("rejects arbitrary local paths and mismatched response paths", async () => {
    const h = await harness();
    try {
      await act(async () => h.surface().showChanges("thread"));
      const file = h.surface().summaries.get("thread")!.files[0];
      for (const relativePath of ["../a.ts", "/home/user/a.ts", "C:\\file", "other.ts"]) {
        await act(async () => h.surface().showFileDiff("thread", { ...file, relativePath }));
      }
      expect(h.getTaskFileDiff).not.toHaveBeenCalled();
      h.getTaskFileDiff.mockResolvedValueOnce({ ...diff, path: "other.ts" });
      await act(async () => h.surface().showFileDiff("thread", file));
      expect(h.surface().summaries.get("thread")?.diff?.error).toContain("could not be read");
    } finally {
      await h.dispose();
    }
  });
  it("bounds pending requests even when earlier requests are hidden", async () => {
    const h = await harness();
    const pending = deferred<RemoteRunnerTaskFiles>();
    h.listTaskFiles.mockReturnValue(pending.promise);
    const work: Promise<void>[] = [];
    try {
      await act(async () => {
        for (let index = 0; index < 70; index++) {
          work.push(h.surface().showChanges(String(index)));
          h.surface().hideChanges(String(index));
        }
      });
      expect(h.listTaskFiles).toHaveBeenCalledTimes(64);
      await act(async () => {
        pending.resolve(files);
        await Promise.all(work);
      });
      expect(h.surface().summaries.size).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("bounds retained summaries and surfaces request failures", async () => {
    const h = await harness();
    try {
      for (let index = 0; index < 35; index++)
        await act(async () => h.surface().showChanges(String(index)));
      expect(h.surface().summaries.size).toBe(32);
      h.listTaskFiles.mockRejectedValueOnce(new Error("private error"));
      await act(async () => h.surface().showChanges("failed"));
      expect(h.surface().summaries.get("failed")?.error).toBe(
        "The server worktree changes could not be read.",
      );
    } finally {
      await h.dispose();
    }
  });
});
