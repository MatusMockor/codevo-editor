import { describe, expect, it, vi } from "vitest";
import {
  DocumentSaveCoordinator,
  DocumentSaveCoordinatorDisposedError,
  type DocumentSaveKey,
  type DocumentSaveLease,
  type DocumentSaveWritePermit,
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
    const coordinator = new DocumentSaveCoordinator<string>();
    const first = deferred();
    const latest = deferred();
    const calls: string[] = [];
    const settled = vi.fn();

    const saveA = coordinator.request(key("/a.php"), async () => {
      calls.push("A");
      await first.promise;
      return "A-result";
    });
    const saveB = coordinator.request(key("/a.php"), async () => {
      calls.push("B");
      return "B-result";
    });
    const saveC = coordinator.request(key("/a.php"), async () => {
      calls.push("C");
      await latest.promise;
      return "C-result";
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
      { status: "saved", result: "A-result" },
      { status: "saved", result: "C-result" },
      { status: "saved", result: "C-result" },
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

  it("attributes a replacement failure only to its coalesced waiters", async () => {
    const coordinator = new DocumentSaveCoordinator<string>();
    const first = deferred();
    const latest = deferred();
    const error = new Error("latest write failed");
    const calls: string[] = [];

    const saveA = coordinator.request(key("/a.php"), async () => {
      calls.push("A");
      await first.promise;
      return "A-result";
    });
    const saveB = coordinator.request(key("/a.php"), async () => {
      calls.push("B");
      return "B-result";
    });
    const saveC = coordinator.request(key("/a.php"), async () => {
      calls.push("C");
      await latest.promise;
      return "C-result";
    });

    first.resolve();
    await flushPromises();
    expect(calls).toEqual(["A", "C"]);

    latest.reject(error);
    await expect(saveA).resolves.toEqual({
      status: "saved",
      result: "A-result",
    });
    await expect(saveB).rejects.toBe(error);
    await expect(saveC).rejects.toBe(error);
  });

  it("keeps an earlier failure separate from a successful replacement", async () => {
    const coordinator = new DocumentSaveCoordinator<string>();
    const first = deferred();
    const latest = deferred();
    const error = new Error("first write failed");
    const calls: string[] = [];

    const saveA = coordinator.request(key("/a.php"), async () => {
      calls.push("A");
      await first.promise;
      return "A-result";
    });
    const saveB = coordinator.request(key("/a.php"), async () => {
      calls.push("B");
      return "B-result";
    });
    const saveC = coordinator.request(key("/a.php"), async () => {
      calls.push("C");
      await latest.promise;
      return "C-result";
    });

    first.reject(error);
    await flushPromises();
    expect(calls).toEqual(["A", "C"]);

    latest.resolve();
    await expect(saveA).rejects.toBe(error);
    await expect(saveB).resolves.toEqual({
      status: "saved",
      result: "C-result",
    });
    await expect(saveC).resolves.toEqual({
      status: "saved",
      result: "C-result",
    });
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

  it("denies a file write when issued-write exclusion wins without waiting for preparation", async () => {
    const coordinator = new DocumentSaveCoordinator<string>();
    const preparation = deferred();
    const callback = deferred();
    const calls: string[] = [];

    const save = coordinator.request(key("/a.php"), async (lease) => {
      calls.push("prepare:start");
      await preparation.promise;
      calls.push(lease.tryBeginWrite() ? "write:issued" : "write:denied");
      return "prepared";
    });
    const droppedSave = coordinator.request(key("/a.php"), async () => {
      calls.push("pending:ran");
      return "pending";
    });

    const exclusion = coordinator.runWithIssuedWriteDrain(
      { kind: "file", path: "/a.php", rootPath: rootA },
      async () => {
        calls.push("callback:start");
        await callback.promise;
        calls.push("callback:end");
        return 42;
      },
    );

    expect(calls).toEqual(["prepare:start", "callback:start"]);
    await flushPromises();
    expect(calls).toEqual(["prepare:start", "callback:start"]);
    await expect(droppedSave).resolves.toEqual({ status: "stale" });
    await expect(
      coordinator.request(key("/a.php"), async () => {
        calls.push("excluded:ran");
        return "excluded";
      }),
    ).resolves.toEqual({ status: "stale" });

    preparation.resolve();
    await expect(save).resolves.toEqual({
      status: "saved",
      result: "prepared",
    });
    expect(calls).toEqual([
      "prepare:start",
      "callback:start",
      "write:denied",
    ]);

    callback.resolve();
    await expect(exclusion).resolves.toBe(42);
    expect(calls).toEqual([
      "prepare:start",
      "callback:start",
      "write:denied",
      "callback:end",
    ]);
  });

  it("waits for a workspace write permit through acknowledgement settlement", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const write = deferred();
    const postAcknowledgement = deferred();
    const calls: string[] = [];

    const save = coordinator.request(key("/a.php"), async (lease) => {
      const permit = lease.tryBeginWrite();
      expect(permit).toMatchObject({ granted: true });
      expect(lease.tryBeginWrite()).toBe(permit);
      calls.push("write:start");
      await write.promise;
      calls.push("write:settled");
      calls.push("write:acknowledged");
      permit?.settle();
      await postAcknowledgement.promise;
      calls.push("save:complete");
    });

    const exclusion = coordinator.runWithIssuedWriteDrain(
      { kind: "workspace", rootPath: rootA },
      async () => {
        calls.push("callback");
        return "switched";
      },
    );

    await flushPromises();
    expect(calls).toEqual(["write:start"]);
    write.resolve();
    await flushPromises();
    await expect(exclusion).resolves.toBe("switched");
    expect(calls).toEqual([
      "write:start",
      "write:settled",
      "write:acknowledged",
      "callback",
    ]);

    postAcknowledgement.resolve();
    await expect(save).resolves.toEqual({ status: "saved" });
    expect(calls[calls.length - 1]).toBe("save:complete");
  });

  it("denies reacquisition after a settled permit while a zero-barrier drain runs", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const retry = deferred();
    const retryAfterDrain = deferred();
    const callback = deferred();
    const calls: string[] = [];

    const save = coordinator.request(key("/a.php"), async (lease) => {
      const permit = lease.tryBeginWrite();
      expect(lease.tryBeginWrite()).toBe(permit);
      calls.push("write:issued");
      permit?.settle();
      calls.push("write:settled");
      await retry.promise;
      calls.push(
        lease.tryBeginWrite() ? "write:reissued" : "write:denied-during-drain",
      );
      await retryAfterDrain.promise;
      calls.push(
        lease.tryBeginWrite() ? "write:reissued" : "write:denied-after-drain",
      );
    });

    const exclusion = coordinator.runWithIssuedWriteDrain(
      { kind: "file", path: "/a.php", rootPath: rootA },
      async () => {
        calls.push("callback:start");
        await callback.promise;
        calls.push("callback:end");
      },
    );

    await flushPromises();
    expect(calls).toEqual([
      "write:issued",
      "write:settled",
      "callback:start",
    ]);

    retry.resolve();
    await flushPromises();
    expect(calls[calls.length - 1]).toBe("write:denied-during-drain");

    callback.resolve();
    await expect(exclusion).resolves.toBeUndefined();
    retryAfterDrain.resolve();
    await expect(save).resolves.toEqual({ status: "saved" });
    expect(calls).toEqual([
      "write:issued",
      "write:settled",
      "callback:start",
      "write:denied-during-drain",
      "callback:end",
      "write:denied-after-drain",
    ]);
  });

  it("does not let directory-scoped preparation block a drain or escape later", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const preparation = deferred();
    const calls: string[] = [];

    const save = coordinator.request(
      key("/project/src/nested/a.php"),
      async (lease) => {
        await preparation.promise;
        calls.push(lease.tryBeginWrite() ? "issued" : "denied");
      },
    );

    await expect(
      coordinator.runWithIssuedWriteDrain(
        { kind: "directory", path: "/project/src", rootPath: rootA },
        async () => {
          calls.push("callback");
        },
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["callback"]);

    preparation.resolve();
    await expect(save).resolves.toEqual({ status: "saved" });
    expect(calls).toEqual(["callback", "denied"]);
  });

  it("settles a failed issued write before running the drain operation", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const write = deferred();
    const error = new Error("write failed");
    const calls: string[] = [];

    const save = coordinator.request(key("/a.php"), async (lease) => {
      expect(lease.tryBeginWrite()).not.toBeNull();
      await write.promise;
    });
    void save.catch(() => calls.push("write:rejected"));

    const exclusion = coordinator.runWithIssuedWriteDrain(
      { kind: "workspace", rootPath: rootA },
      async () => {
        calls.push("callback");
      },
    );

    write.reject(error);
    await expect(save).rejects.toBe(error);
    await expect(exclusion).resolves.toBeUndefined();
    expect(calls).toEqual(expect.arrayContaining(["write:rejected", "callback"]));
  });

  it("cancels a waiting issued-write drain on dispose without touching the issued write", async () => {
    const coordinator = new DocumentSaveCoordinator();
    const operationFinished = deferred();
    const callback = vi.fn(async () => "switched");
    const captured: { permit: DocumentSaveWritePermit | null } = {
      permit: null,
    };

    const save = coordinator.request(key("/a.php"), async (lease) => {
      captured.permit = lease.tryBeginWrite();
      await operationFinished.promise;
    });
    const drain = coordinator.runWithIssuedWriteDrain(
      { kind: "workspace", rootPath: rootA },
      callback,
    );

    expect(callback).not.toHaveBeenCalled();
    coordinator.dispose();

    await expect(drain).rejects.toBeInstanceOf(
      DocumentSaveCoordinatorDisposedError,
    );
    expect(callback).not.toHaveBeenCalled();
    await expect(save).resolves.toEqual({ status: "disposed" });
    const internals = coordinator as unknown as {
      exclusions: Set<unknown>;
      issuedWriteDrains: Set<unknown>;
    };
    expect(internals.exclusions.size).toBe(0);
    expect(internals.issuedWriteDrains.size).toBe(0);

    expect(() => captured.permit?.settle()).not.toThrow();
    expect(() => captured.permit?.settle()).not.toThrow();
    operationFinished.resolve();
    await flushPromises();

    const afterDispose = vi.fn(async () => "unexpected");
    await expect(
      coordinator.runWithIssuedWriteDrain(
        { kind: "workspace", rootPath: rootA },
        afterDispose,
      ),
    ).rejects.toBeInstanceOf(DocumentSaveCoordinatorDisposedError);
    expect(afterDispose).not.toHaveBeenCalled();
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
