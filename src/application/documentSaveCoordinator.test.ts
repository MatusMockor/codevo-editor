import { describe, expect, it, vi } from "vitest";
import {
  DocumentSaveCoordinator,
  type DocumentSaveKey,
  type DocumentSaveLease,
} from "./documentSaveCoordinator";

const rootA = "/workspace-a";
const rootB = "/workspace-b";

function key(path: string, rootPath = rootA): DocumentSaveKey {
  return { path, rootPath };
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("DocumentSaveCoordinator", () => {
  it("serializes one path and coalesces pending requests to the latest", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const first = deferred();
    const latest = deferred();
    const calls: string[] = [];
    const settled = vi.fn();

    const saveA = coordinator.request(key("/a.php"), async () => {
      calls.push("A");
      await first.promise;
    });
    const saveB = coordinator.request(key("/a.php"), async () => {
      calls.push("B");
    });
    const saveC = coordinator.request(key("/a.php"), async () => {
      calls.push("C");
      await latest.promise;
    });
    void saveA.then(settled);
    void saveB.then(settled);
    void saveC.then(settled);

    expect(calls).toEqual(["A"]);
    first.resolve();
    await flushPromises();

    expect(calls).toEqual(["A", "C"]);
    expect(settled).not.toHaveBeenCalled();

    latest.resolve();
    await expect(Promise.all([saveA, saveB, saveC])).resolves.toEqual([
      { status: "saved" },
      { status: "saved" },
      { status: "saved" },
    ]);
  });

  it("runs different paths concurrently", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const blocked = deferred();
    const calls: string[] = [];

    const saveA = coordinator.request(key("/a.php"), async () => {
      calls.push("A:start");
      await blocked.promise;
      calls.push("A:end");
    });
    const saveB = coordinator.request(key("/b.php"), async () => {
      calls.push("B");
    });

    await expect(saveB).resolves.toEqual({ status: "saved" });
    expect(calls).toEqual(["A:start", "B"]);

    blocked.resolve();
    await expect(saveA).resolves.toEqual({ status: "saved" });
  });

  it("retires a lease when its save lane completes", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const captured: { lease: DocumentSaveLease | null } = { lease: null };

    await coordinator.request(key("/retired.php"), async (lease) => {
      captured.lease = lease;
      expect(lease.isCurrent()).toBe(true);
    });

    expect(captured.lease?.isCurrent()).toBe(false);
  });

  it("invalidates old work synchronously and lets a reopen wait behind it", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const blocked = deferred();
    const calls: string[] = [];
    const captured: { oldLease: DocumentSaveLease | null } = { oldLease: null };

    const saveKey = key("/a.php");
    const oldSave = coordinator.request(saveKey, async (lease) => {
      captured.oldLease = lease;
      calls.push("old:start");
      await blocked.promise;
      calls.push(`old:${lease.isCurrent() ? "current" : "stale"}`);
    });
    const droppedSave = coordinator.request(saveKey, async () => {
      calls.push("dropped");
    });

    expect(captured.oldLease?.isCurrent()).toBe(true);
    coordinator.invalidate(saveKey);
    expect(captured.oldLease?.isCurrent()).toBe(false);

    const reopenedSave = coordinator.request(saveKey, async (lease) => {
      calls.push(`reopened:${lease.isCurrent() ? "current" : "stale"}`);
    });
    expect(calls).toEqual(["old:start"]);

    blocked.resolve();
    await expect(Promise.all([oldSave, droppedSave, reopenedSave])).resolves.toEqual([
      { status: "stale" },
      { status: "stale" },
      { status: "saved" },
    ]);
    expect(calls).toEqual(["old:start", "old:stale", "reopened:current"]);
  });

  it("continues queued work after a failure and accepts later saves", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const failed = deferred();
    const followUp = deferred();
    const error = new Error("write failed");
    const calls: string[] = [];
    const firstSettled = vi.fn();

    const firstSave = coordinator.request(key("/a.php"), async () => {
      calls.push("first");
      await failed.promise;
    });
    const secondSave = coordinator.request(key("/a.php"), async () => {
      calls.push("second");
      await followUp.promise;
    });
    void firstSave.then(firstSettled, firstSettled);

    failed.reject(error);
    await flushPromises();
    expect(calls).toEqual(["first", "second"]);
    expect(firstSettled).not.toHaveBeenCalled();

    followUp.resolve();
    await expect(firstSave).rejects.toBe(error);
    await expect(secondSave).resolves.toEqual({ status: "saved" });

    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("third");
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(calls).toEqual(["first", "second", "third"]);
  });

  it("disposes idempotently, drops pending work, and rejects future execution", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const blocked = deferred();
    const calls: string[] = [];
    const captured: { lease: DocumentSaveLease | null } = { lease: null };

    const activeSave = coordinator.request(key("/a.php"), async (activeLease) => {
      captured.lease = activeLease;
      calls.push("active");
      await blocked.promise;
    });
    const droppedSave = coordinator.request(key("/a.php"), async () => {
      calls.push("dropped");
    });

    coordinator.dispose();
    coordinator.dispose();
    expect(captured.lease?.isCurrent()).toBe(false);

    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("future");
      }),
    ).resolves.toEqual({ status: "disposed" });

    blocked.resolve();
    await expect(Promise.all([activeSave, droppedSave])).resolves.toEqual([
      { status: "disposed" },
      { status: "disposed" },
    ]);
    expect(calls).toEqual(["active"]);
  });

  it("isolates the same absolute path across project roots", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const blockedA = deferred();
    const blockedB = deferred();
    const path = "/shared/index.php";
    const leases: DocumentSaveLease[] = [];

    const saveA = coordinator.request(key(path, rootA), async (lease) => {
      leases.push(lease);
      await blockedA.promise;
    });
    const saveB = coordinator.request(key(path, rootB), async (lease) => {
      leases.push(lease);
      await blockedB.promise;
    });

    expect(leases).toHaveLength(2);
    coordinator.invalidate(key(path, rootA));
    expect(leases[0]?.isCurrent()).toBe(false);
    expect(leases[1]?.isCurrent()).toBe(true);

    blockedA.resolve();
    blockedB.resolve();
    await expect(saveA).resolves.toEqual({ status: "stale" });
    await expect(saveB).resolves.toEqual({ status: "saved" });
  });

  it("keeps an active lease current, drops pending work, and blocks requests through the callback", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const active = deferred();
    const callback = deferred();
    const calls: string[] = [];
    const captured: { activeLease: DocumentSaveLease | null } = {
      activeLease: null,
    };

    const activeSave = coordinator.request(key("/a.php"), async (lease) => {
      captured.activeLease = lease;
      calls.push("active:start");
      await active.promise;
      calls.push(`active:${lease.isCurrent() ? "current" : "stale"}`);
    });
    void activeSave.then(() => calls.push("active:acknowledged"));
    const droppedSave = coordinator.request(key("/a.php"), async () => {
      calls.push("dropped");
    });

    const exclusion = coordinator.runWithExclusion(
      { kind: "workspace", rootPath: rootA },
      async () => {
        calls.push("callback:start");
        await callback.promise;
        calls.push("callback:end");
        return 42;
      },
    );

    expect(captured.activeLease?.isCurrent()).toBe(true);
    await expect(droppedSave).resolves.toEqual({ status: "stale" });
    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("blocked-before-callback");
      }),
    ).resolves.toEqual({ status: "stale" });
    expect(calls).toEqual(["active:start"]);

    active.resolve();
    await flushPromises();
    expect(calls).toEqual([
      "active:start",
      "active:current",
      "active:acknowledged",
      "callback:start",
    ]);
    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("blocked-during-callback");
      }),
    ).resolves.toEqual({ status: "stale" });

    callback.resolve();
    await expect(exclusion).resolves.toBe(42);
    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("after");
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(calls).toEqual([
      "active:start",
      "active:current",
      "active:acknowledged",
      "callback:start",
      "callback:end",
      "after",
    ]);
  });

  it("normalizes roots and respects file and directory boundaries", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const callback = deferred();
    const calls: string[] = [];

    const exclusion = coordinator.runWithExclusion(
      {
        kind: "directory",
        path: "/project/src",
        rootPath: `${rootA}/`,
      },
      async () => callback.promise,
    );

    const requests = [
      coordinator.request(key("/project/src"), async () => {
        calls.push("directory");
      }),
      coordinator.request(key("/project/src/index.php"), async () => {
        calls.push("child");
      }),
      coordinator.request(key("/project/src/nested/a.php"), async () => {
        calls.push("nested");
      }),
    ];
    await expect(Promise.all(requests)).resolves.toEqual(
      requests.map(() => ({ status: "stale" })),
    );
    await expect(
      coordinator.request(key("/project/src-sibling/a.php"), async () => {
        calls.push("sibling");
      }),
    ).resolves.toEqual({ status: "saved" });
    await expect(
      coordinator.request(key("/project/src/a.php", rootB), async () => {
        calls.push("other-root");
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(calls).toEqual(["sibling", "other-root"]);

    callback.resolve();
    await exclusion;

    const fileCallback = deferred();
    const fileExclusion = coordinator.runWithExclusion(
      {
        kind: "file",
        path: "/project/file.php",
        rootPath: rootA,
      },
      async () => fileCallback.promise,
    );
    await expect(
      coordinator.request(key("/project/file.php"), async () => {
        calls.push("blocked-file");
      }),
    ).resolves.toEqual({ status: "stale" });
    await expect(
      coordinator.request(key("/project/file.php.bak"), async () => {
        calls.push("file-neighbor");
      }),
    ).resolves.toEqual({ status: "saved" });
    fileCallback.resolve();
    await fileExclusion;
    expect(calls).toEqual(["sibling", "other-root", "file-neighbor"]);
  });

  it("keeps nested scopes blocked until their owning callback exits", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const innerCallback = deferred();
    const outerCallback = deferred();
    const calls: string[] = [];

    const outer = coordinator.runWithExclusion(
      {
        kind: "workspace",
        rootPath: rootA,
      },
      async () => {
        calls.push("outer:start");
        await coordinator.runWithExclusion(
          {
            kind: "file",
            path: "/a.php",
            rootPath: rootA,
          },
          async () => {
            calls.push("inner:start");
            await innerCallback.promise;
            calls.push("inner:end");
          },
        );
        calls.push("outer:after-inner");
        await outerCallback.promise;
      },
    );

    await flushPromises();
    expect(calls).toEqual(["outer:start", "inner:start"]);
    innerCallback.resolve();
    await flushPromises();
    expect(calls).toEqual([
      "outer:start",
      "inner:start",
      "inner:end",
      "outer:after-inner",
    ]);
    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("released-too-early");
      }),
    ).resolves.toEqual({ status: "stale" });

    outerCallback.resolve();
    await outer;
    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("released");
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(calls[calls.length - 1]).toBe("released");
  });

  it("keeps overlapping scopes independently blocked", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const directoryCallback = deferred();
    const fileCallback = deferred();

    const directoryExclusion = coordinator.runWithExclusion(
      { kind: "directory", path: "/project", rootPath: rootA },
      async () => directoryCallback.promise,
    );
    const fileExclusion = coordinator.runWithExclusion(
      { kind: "file", path: "/project/a.php", rootPath: rootA },
      async () => fileCallback.promise,
    );

    directoryCallback.resolve();
    await directoryExclusion;
    await expect(
      coordinator.request(key("/project/a.php"), async () => undefined),
    ).resolves.toEqual({ status: "stale" });
    await expect(
      coordinator.request(key("/project/b.php"), async () => undefined),
    ).resolves.toEqual({ status: "saved" });

    fileCallback.resolve();
    await fileExclusion;
    await expect(
      coordinator.request(key("/project/a.php"), async () => undefined),
    ).resolves.toEqual({ status: "saved" });
  });

  it("releases an exclusion when its callback throws", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const error = new Error("rename failed");
    const calls: string[] = [];

    await expect(
      coordinator.runWithExclusion(
        { kind: "file", path: "/a.php", rootPath: rootA },
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("saved");
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(calls).toEqual(["saved"]);
  });

  it("settles current waiters immediately when disposed during a never-settling operation", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const never = deferred();
    const settled = vi.fn();
    const calls: string[] = [];

    const activeSave = coordinator.request(key("/a.php"), async () => {
      calls.push("active");
      await never.promise;
    });
    const pendingSave = coordinator.request(key("/a.php"), async () => {
      calls.push("pending");
    });
    void activeSave.then(settled, settled);
    void pendingSave.then(settled, settled);
    coordinator.dispose();

    await expect(Promise.all([activeSave, pendingSave])).resolves.toEqual([
      { status: "disposed" },
      { status: "disposed" },
    ]);
    expect(settled).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["active"]);
  });

  it("preserves an undefined rejection reason", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const rejected = deferred();

    const save = coordinator.request(key("/a.php"), async () => rejected.promise);
    rejected.reject(undefined);

    await expect(save).rejects.toBeUndefined();
  });
});
