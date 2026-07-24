import { describe, expect, it, vi } from "vitest";
import type { LanguageServerWorkspaceEdit } from "../domain/languageServerFeatures";
import type { SemanticWorkspaceEditCasCapture } from "../domain/semanticWorkspaceEditCas";
import type { WorkspacePathKey } from "../domain/workspacePath";
import {
  createSemanticWorkspaceEditCasAuthority,
  type SemanticWorkspaceEditAtomicCasPort,
  type SemanticWorkspaceEditCasLease,
} from "./semanticWorkspaceEditCasAuthority";

const EDIT: LanguageServerWorkspaceEdit = {
  changes: {
    "file:///ws/HomePresenter.php": [
      {
        newText: "protected function createComponentCart() {}",
        range: {
          end: { character: 0, line: 1 },
          start: { character: 0, line: 1 },
        },
      },
    ],
  },
};

describe("createSemanticWorkspaceEditCasAuthority", () => {
  it("forwards one exact lease to the atomic CAS port", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    const compareAndSwap: SemanticWorkspaceEditAtomicCasPort["compareAndSwap"] = vi.fn(
      async () => ({ kind: "accepted" }) as const,
    );

    await expect(
      authority.compareAndSwap(lease, {
        current: snapshot(),
        edit: EDIT,
        port: { compareAndSwap },
      }),
    ).resolves.toEqual({ kind: "accepted" });
    expect(compareAndSwap).toHaveBeenCalledWith({
      edit: EDIT,
      preconditions: lease.preconditions,
    });
  });

  it("consumes before awaiting so concurrent duplicates cannot reach the port", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const port: SemanticWorkspaceEditAtomicCasPort = {
      compareAndSwap: vi.fn(async () => {
        await pending;
        return { kind: "accepted" } as const;
      }),
    };
    const first = authority.compareAndSwap(lease, {
      current: snapshot(),
      edit: EDIT,
      port,
    });
    const duplicate = await authority.compareAndSwap(lease, {
      current: snapshot(),
      edit: EDIT,
      port,
    });

    expect(duplicate).toEqual({ kind: "rejected", reason: "alreadyConsumed" });
    expect(port.compareAndSwap).toHaveBeenCalledTimes(1);
    settle();
    await expect(first).resolves.toEqual({ kind: "accepted" });
  });

  it("consumes before hostile option inspection can synchronously reenter", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    const compareAndSwap = vi.fn(async () => ({ kind: "accepted" }) as const);
    const normal = {
      current: snapshot(),
      edit: EDIT,
      port: { compareAndSwap },
    };
    let reentrant: ReturnType<typeof authority.compareAndSwap> | undefined;
    const hostile = new Proxy(normal, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "current" && !reentrant) {
          reentrant = authority.compareAndSwap(lease, normal);
        }

        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    await expect(authority.compareAndSwap(lease, hostile)).resolves.toEqual({ kind: "accepted" });
    await expect(reentrant).resolves.toEqual({
      kind: "rejected",
      reason: "alreadyConsumed",
    });
    expect(compareAndSwap).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged clone and a lease issued by another authority", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const other = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    const port = neverPort();

    for (const foreign of [
      { ...lease },
      other.issue(snapshot())!,
    ] as SemanticWorkspaceEditCasLease[]) {
      await expect(
        authority.compareAndSwap(foreign, {
          current: snapshot(),
          edit: EDIT,
          port,
        }),
      ).resolves.toEqual({ kind: "rejected", reason: "foreignLease" });
    }
    expect(port.compareAndSwap).not.toHaveBeenCalled();
  });

  it("rejects stale template, owner and A-B-A workspace identity before the port", async () => {
    const cases: Array<{
      current: SemanticWorkspaceEditCasCapture;
      reason: string;
    }> = [
      {
        current: {
          ...snapshot(),
          template: { ...snapshot().template, version: 8 },
        },
        reason: "templateChanged",
      },
      {
        current: {
          ...snapshot(),
          owner: { ...snapshot().owner, contentHash: "sha256:owner-b" },
        },
        reason: "ownerChanged",
      },
      {
        current: {
          ...snapshot(),
          workspace: { ...snapshot().workspace, generation: 10 },
        },
        reason: "workspaceChanged",
      },
    ];

    for (const testCase of cases) {
      const authority = createSemanticWorkspaceEditCasAuthority();
      const lease = authority.issue(snapshot())!;
      const port = neverPort();

      await expect(
        authority.compareAndSwap(lease, {
          current: testCase.current,
          edit: EDIT,
          port,
        }),
      ).resolves.toEqual({ kind: "rejected", reason: testCase.reason });
      expect(port.compareAndSwap).not.toHaveBeenCalled();
    }
  });

  it("does not permit replay after backend rejection or failure", async () => {
    for (const port of [
      {
        compareAndSwap: vi.fn(
          async () =>
            ({
              kind: "rejected",
              reason: "ownerChanged",
            }) as const,
        ),
      },
      {
        compareAndSwap: vi.fn(async () => {
          throw new Error("unavailable");
        }),
      },
    ] satisfies SemanticWorkspaceEditAtomicCasPort[]) {
      const authority = createSemanticWorkspaceEditCasAuthority();
      const lease = authority.issue(snapshot())!;
      await authority.compareAndSwap(lease, {
        current: snapshot(),
        edit: EDIT,
        port,
      });

      await expect(
        authority.compareAndSwap(lease, {
          current: snapshot(),
          edit: EDIT,
          port,
        }),
      ).resolves.toEqual({ kind: "rejected", reason: "alreadyConsumed" });
      expect(port.compareAndSwap).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects malformed edits before the port", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    const port = neverPort();

    await expect(
      authority.compareAndSwap(lease, {
        current: snapshot(),
        edit: {
          changes: {
            "file:///ws/HomePresenter.php": [
              {
                newText: "x",
                range: {
                  end: { character: 0, line: -1 },
                  start: { character: 0, line: 0 },
                },
              },
            ],
          },
        },
        port,
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidEdit" });
    expect(port.compareAndSwap).not.toHaveBeenCalled();
  });

  it("rejects null versions, explicit empty edits and Unicode control URIs before the port", async () => {
    const cases: LanguageServerWorkspaceEdit[] = [
      {
        ...structuredClone(EDIT),
        documentVersions: { "file:///ws/HomePresenter.php": null },
      },
      { changes: {}, fileOperations: [] },
      {
        changes: {
          "file:///ws/\u0085.php": structuredClone(EDIT.changes["file:///ws/HomePresenter.php"]),
        },
      },
    ];

    for (const edit of cases) {
      const authority = createSemanticWorkspaceEditCasAuthority();
      const lease = authority.issue(snapshot())!;
      const port = neverPort();

      await expect(
        authority.compareAndSwap(lease, {
          current: snapshot(),
          edit,
          port,
        }),
      ).resolves.toEqual({ kind: "rejected", reason: "invalidEdit" });
      expect(port.compareAndSwap).not.toHaveBeenCalled();
    }
  });

  it("passes an immutable snapshot that cannot follow caller mutation", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    const mutableEdit = structuredClone(EDIT);
    const observed: { value?: LanguageServerWorkspaceEdit } = {};
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const port: SemanticWorkspaceEditAtomicCasPort = {
      async compareAndSwap(request) {
        observed.value = request.edit;
        await pending;
        return { kind: "accepted" };
      },
    };
    const result = authority.compareAndSwap(lease, {
      current: snapshot(),
      edit: mutableEdit,
      port,
    });

    mutableEdit.changes["file:///ws/HomePresenter.php"][0]!.newText = "mutated";
    settle();
    await expect(result).resolves.toEqual({ kind: "accepted" });
    expect(observed.value?.changes["file:///ws/HomePresenter.php"][0]?.newText).toBe(
      "protected function createComponentCart() {}",
    );
    expect(Object.isFrozen(observed.value)).toBe(true);
    expect(Object.isFrozen(observed.value?.changes["file:///ws/HomePresenter.php"][0])).toBe(true);
  });

  it("strictly rejects malformed or embellished backend decisions", async () => {
    for (const decision of [
      { kind: "accepted", extra: true },
      { kind: "accepted-ish" },
      { kind: "rejected", reason: "invented" },
      null,
    ]) {
      const authority = createSemanticWorkspaceEditCasAuthority();
      const lease = authority.issue(snapshot())!;
      const port = {
        compareAndSwap: vi.fn(async () => decision),
      } as unknown as SemanticWorkspaceEditAtomicCasPort;

      await expect(
        authority.compareAndSwap(lease, {
          current: snapshot(),
          edit: EDIT,
          port,
        }),
      ).resolves.toEqual({
        kind: "rejected",
        reason: "invalidPortResult",
      });
    }
  });

  it("snapshots prototype-sensitive change keys without dictionary mutation", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    const changes = Object.create(null) as LanguageServerWorkspaceEdit["changes"];
    changes.__proto__ = structuredClone(EDIT.changes["file:///ws/HomePresenter.php"]);
    changes["constructor"] = structuredClone(EDIT.changes["file:///ws/HomePresenter.php"]);
    const observed: { value?: LanguageServerWorkspaceEdit } = {};
    const port: SemanticWorkspaceEditAtomicCasPort = {
      compareAndSwap: vi.fn(async (request) => {
        observed.value = request.edit;
        return { kind: "accepted" } as const;
      }),
    };

    await expect(
      authority.compareAndSwap(lease, {
        current: snapshot(),
        edit: { changes },
        port,
      }),
    ).resolves.toEqual({ kind: "accepted" });
    expect(Object.keys(observed.value?.changes ?? {})).toEqual(["__proto__", "constructor"]);
    expect(Object.getPrototypeOf(observed.value?.changes)).toBeNull();
  });

  it("keeps worst-case escaped valid text within the shared 16 MiB wire ceiling", async () => {
    const authority = createSemanticWorkspaceEditCasAuthority();
    const lease = authority.issue(snapshot())!;
    const compareAndSwap = vi.fn(async () => ({ kind: "accepted" }) as const);

    await expect(
      authority.compareAndSwap(lease, {
        current: snapshot(),
        edit: {
          changes: {
            "file:///ws/HomePresenter.php": [
              {
                newText: "\0".repeat(1_000_000),
                range: {
                  end: { character: 0, line: 0 },
                  start: { character: 0, line: 0 },
                },
              },
            ],
          },
          documentVersions: {},
          fileOperations: [],
        },
        port: { compareAndSwap },
      }),
    ).resolves.toEqual({ kind: "accepted" });
    expect(compareAndSwap).toHaveBeenCalledOnce();
  });
});

function neverPort(): SemanticWorkspaceEditAtomicCasPort {
  return {
    compareAndSwap: vi.fn(async () => {
      throw new Error("must not be called");
    }),
  };
}

function snapshot(): SemanticWorkspaceEditCasCapture {
  return {
    owner: {
      contentHash: "sha256:owner-a",
      hostEpoch: 41,
      kind: "closed",
      pathKey: "/ws/HomePresenter.php" as WorkspacePathKey,
      revision: 41,
    },
    template: {
      contentHash: "sha256:template-a",
      hostEpoch: 17,
      kind: "open",
      lifecycle: 3,
      pathKey: "/ws/default.latte" as WorkspacePathKey,
      sessionId: 11,
      version: 7,
    },
    workspace: {
      generation: 9,
      ownerKey: "owner-a",
      rootKey: "/ws",
      sessionId: 31,
    },
  };
}
