import { describe, expect, it, vi } from "vitest";
import {
  planNeonCrossFileSymbolRename,
  snapshotNeonCrossFileRepository,
  type NeonCrossFileRenamePlan,
} from "./neonCrossFileSymbolSweep";
import {
  createNeonWorkspaceRenameService,
  type NeonWorkspaceEditApplier,
  type NeonWorkspaceRenameCapture,
  type NeonWorkspaceRenameRequest,
  type NeonWorkspaceRenameResult,
} from "./neonWorkspaceRenameService";
import type {
  TemplateWorkspaceRenameDocumentSnapshot,
  TemplateWorkspaceRenameOpenModel,
} from "./templateWorkspaceRenameTransaction";
import { commitTemplateWorkspaceRenameOpenModels } from "./templateWorkspaceRenameTransaction";
import type { WorkspaceEditApplicationDecision } from "./workspaceEditApplication";
import type { LanguageServerTextEdit } from "../domain/languageServerFeatures";

const ROOT = "/ws";
const ACTIVE = "/ws/config/services.neon";
const CLOSED = "/ws/config/wiring.neon";

describe("NEON workspace rename service", () => {
  it("applies an open+closed plan through the shared atomic workspace transaction", async () => {
    const fixture = await renameFixture();
    const activeModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model: activeModel }]);
    const applyWorkspaceEdit: NeonWorkspaceEditApplier = vi.fn(async (edit, context) => {
      expect(Object.keys(edit.changes)).toEqual([uri(ACTIVE), uri(CLOSED)]);
      expect(
        edit.changes[uri(CLOSED)]?.map(({ range }: LanguageServerTextEdit) => range.start.line),
      ).toEqual([2, 1]);
      expect(context.openPaths).toEqual([ACTIVE]);
      expect(context.expectedClosedFileHashes).toEqual({ [uri(CLOSED)]: "closed-hash" });
      expect(context.requiresAtomicFinalization).toBe(true);
      const staged = context.applyOpenModels?.();
      expect(staged?.kind).toBe("applied");
      expect(staged?.kind === "applied" && staged.finalize?.().kind).toBe("applied");
      return { kind: "accepted" } as const;
    });

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, applyWorkspaceEdit)),
    ).resolves.toEqual({ kind: "accepted" });
    expect(activeModel.read()?.content).toContain("primaryMailer:");
    expect(applyWorkspaceEdit).toHaveBeenCalledTimes(1);
  });

  it("fails closed on hash, open-version, owner, and trust drift", async () => {
    const fixture = await renameFixture();

    const hashModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const hashCapture = captured(fixture, [{ path: ACTIVE, model: hashModel }]);
    const hashReject: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      expect(context.expectedClosedFileHashes?.[uri(CLOSED)]).toBe("closed-hash");
      return { kind: "rejected", reason: "staleDocumentVersion" } as const;
    });
    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, hashCapture, hashReject)),
    ).resolves.toEqual({ kind: "rejected", reason: "applicationRejected" });
    expect(hashModel.read()?.content).toBe(fixture.sources[ACTIVE]);

    const versionModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const versionCapture = captured(fixture, [{ path: ACTIVE, model: versionModel }]);
    versionModel.userEdit(`${fixture.sources[ACTIVE]}# changed`);
    const neverApply = vi.fn(
      async () => ({ kind: "accepted" }) as WorkspaceEditApplicationDecision,
    );
    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, versionCapture, neverApply)),
    ).resolves.toEqual({ kind: "rejected", reason: "staleCapture" });
    expect(neverApply).not.toHaveBeenCalled();

    for (const drift of [
      { current: false, trusted: true, reason: "staleCapture" },
      { current: true, trusted: false, reason: "untrustedWorkspace" },
    ] as const) {
      const model = new FakeOpenModel(fixture.sources[ACTIVE]);
      const capture = captured(fixture, [{ path: ACTIVE, model }], drift);
      await expect(
        createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, neverApply)),
      ).resolves.toEqual({ kind: "rejected", reason: drift.reason });
    }
  });

  it("rolls back staged open models when the shared applier rejects", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    const apply: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      expect(context.applyOpenModels?.().kind).toBe("applied");
      expect(model.read()?.content).toContain("primaryMailer:");
      return { kind: "rejected", reason: "atomicWorkspaceEditUnavailable" } as const;
    });

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, apply)),
    ).resolves.toEqual({ kind: "rejected", reason: "applicationRejected" });
    expect(model.read()?.content).toBe(fixture.sources[ACTIVE]);
  });

  it("can still roll back exact open-model state after the applier finalized then rejected", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    const apply: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      const staged = context.applyOpenModels?.();
      expect(staged?.kind === "applied" && staged.finalize?.().kind).toBe("applied");
      return { kind: "rejected", reason: "atomicWorkspaceEditUnavailable" } as const;
    });

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, apply)),
    ).resolves.toEqual({ kind: "rejected", reason: "applicationRejected" });
    expect(model.read()?.content).toBe(fixture.sources[ACTIVE]);
  });

  it("rolls back earlier models after a partial open-model apply failure", async () => {
    const fixture = await renameFixture();
    const active = new FakeOpenModel(fixture.sources[ACTIVE]);
    const wiring = new FakeOpenModel(fixture.sources[CLOSED]);
    wiring.failNextReplace = true;
    const capture = captured(fixture, [
      { path: ACTIVE, model: active },
      { path: CLOSED, model: wiring },
    ]);
    const apply: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      expect(context.applyOpenModels?.().kind).toBe("rejected");
      return { kind: "rejected", reason: "invalidOpenModelEdits" } as const;
    });

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, apply)),
    ).resolves.toEqual({ kind: "rejected", reason: "applicationRejected" });
    expect(active.read()?.content).toBe(fixture.sources[ACTIVE]);
    expect(wiring.read()?.content).toBe(fixture.sources[CLOSED]);
  });

  it("does not destructively roll back a concurrent user edit after finalize rejection", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    const apply: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      const staged = context.applyOpenModels?.();
      expect(staged?.kind).toBe("applied");
      model.userEdit("user won");
      expect(staged?.kind === "applied" && staged.finalize?.().kind).toBe("rejected");
      return { kind: "rejected", reason: "invalidOpenModelEdits" } as const;
    });

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, apply)),
    ).resolves.toEqual({ kind: "rejected", reason: "applicationRejected" });
    expect(model.read()?.content).toBe("user won");
  });

  it("single-flights, cancels, and permits a clean retry", async () => {
    const fixture = await renameFixture();
    const service = createNeonWorkspaceRenameService();
    const firstModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const firstCapture = captured(fixture, [{ path: ACTIVE, model: firstModel }]);
    let resolveApply!: (decision: WorkspaceEditApplicationDecision) => void;
    const delayedApply = vi.fn(
      () => new Promise<WorkspaceEditApplicationDecision>((resolve) => (resolveApply = resolve)),
    );
    const first = service.rename(request(fixture.plan, firstCapture, delayedApply));
    await expect(
      service.rename(request(fixture.plan, firstCapture, delayedApply)),
    ).resolves.toEqual({ kind: "rejected", reason: "busy" });
    expect(service.cancel(ROOT)).toBe(true);
    resolveApply({ kind: "rejected", reason: "inactiveWorkspace" });
    await expect(first).resolves.toEqual({ kind: "rejected", reason: "cancelled" });

    const retryModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const retryCapture = captured(fixture, [{ path: ACTIVE, model: retryModel }]);
    const accept: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      const staged = context.applyOpenModels?.();
      if (staged?.kind === "applied") staged.finalize?.();
      return { kind: "accepted" } as const;
    });
    await expect(service.rename(request(fixture.plan, retryCapture, accept))).resolves.toEqual({
      kind: "accepted",
    });
  });

  it("installs the single-flight fence before invoking a reentrant applier", async () => {
    const fixture = await renameFixture();
    const service = createNeonWorkspaceRenameService();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    let reentrant: Promise<NeonWorkspaceRenameResult> | undefined;
    const shouldNotRun: NeonWorkspaceEditApplier = vi.fn(
      async () => ({ kind: "accepted" }) as const,
    );
    const apply: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      reentrant = service.rename(request(fixture.plan, capture, shouldNotRun));
      expect(context.applyOpenModels?.().kind).toBe("applied");
      return { kind: "accepted" } as const;
    });

    await expect(service.rename(request(fixture.plan, capture, apply))).resolves.toEqual({
      kind: "accepted",
    });
    await expect(reentrant).resolves.toEqual({ kind: "rejected", reason: "busy" });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });

  it("rejects without the shared workspace-edit applier", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    const withoutApplier = request(fixture.plan, capture, undefined);
    await expect(createNeonWorkspaceRenameService().rename(withoutApplier)).resolves.toEqual({
      kind: "rejected",
      reason: "workspaceEditUnavailable",
    });
    expect(model.read()?.content).toBe(fixture.sources[ACTIVE]);
  });

  it("returns invalidCapture instead of throwing synchronously for a forged root type", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = {
      ...captured(fixture, [{ path: ACTIVE, model }]),
      rootPath: 42,
    } as unknown as NeonWorkspaceRenameCapture;

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, undefined)),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });
  });

  it("rejects an accepted decision that never committed the captured open model", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    const forgedAccept: NeonWorkspaceEditApplier = vi.fn(
      async () => ({ kind: "accepted" }) as const,
    );

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, forgedAccept)),
    ).resolves.toEqual({ kind: "rejected", reason: "applicationRejected" });
    expect(model.read()?.content).toBe(fixture.sources[ACTIVE]);
  });

  it("fails closed when a captured model throws while its live snapshot is checked", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    model.failNextRead = true;
    const neverApply: NeonWorkspaceEditApplier = vi.fn(
      async () => ({ kind: "accepted" }) as const,
    );

    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, neverApply)),
    ).resolves.toEqual({ kind: "rejected", reason: "staleCapture" });
    expect(neverApply).not.toHaveBeenCalled();
  });

  it("does not treat async trust or currency callbacks as truthy authority", async () => {
    const fixture = await renameFixture();
    const apply: NeonWorkspaceEditApplier = vi.fn(async () => ({ kind: "accepted" }) as const);
    for (const field of ["isTrusted", "isCurrent"] as const) {
      const model = new FakeOpenModel(fixture.sources[ACTIVE]);
      const capture = {
        ...captured(fixture, [{ path: ACTIVE, model }]),
        [field]: async () => true,
      } as unknown as NeonWorkspaceRenameCapture;
      await expect(
        createNeonWorkspaceRenameService().rename(request(fixture.plan, capture, apply)),
      ).resolves.toEqual({
        kind: "rejected",
        reason: field === "isTrusted" ? "untrustedWorkspace" : "staleCapture",
      });
    }
    expect(apply).not.toHaveBeenCalled();
  });

  it("treats an unreadable abort signal as cancellation", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    const apply: NeonWorkspaceEditApplier = vi.fn(async () => ({ kind: "accepted" }) as const);
    const signal = Object.defineProperty({}, "aborted", {
      get() {
        throw new Error("signal unavailable");
      },
    }) as AbortSignal;

    await expect(
      createNeonWorkspaceRenameService().rename({
        ...request(fixture.plan, capture, apply),
        signal,
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "cancelled" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects forged cross-root, traversal, UNC, and empty/closed-only plans before apply", async () => {
    const fixture = await renameFixture();
    const apply: NeonWorkspaceEditApplier = vi.fn(async () => ({ kind: "accepted" }) as const);
    const variants: Array<Extract<NeonCrossFileRenamePlan, { kind: "ready" }>> = [
      { ...fixture.plan, rootPath: "/other" },
      {
        ...fixture.plan,
        documents: fixture.plan.documents.map((document) =>
          document.path === CLOSED ? { ...document, path: "/ws/config/../escape.neon" } : document,
        ),
        edits: fixture.plan.edits.map((edit) =>
          edit.path === CLOSED ? { ...edit, path: "/ws/config/../escape.neon" } : edit,
        ),
      },
      { ...fixture.plan, rootPath: "//server/share" },
      { ...fixture.plan, edits: [] },
      { ...fixture.plan, edits: fixture.plan.edits.filter(({ path }) => path !== ACTIVE) },
    ];
    for (const plan of variants) {
      const model = new FakeOpenModel(fixture.sources[ACTIVE]);
      const capture = captured(fixture, [{ path: ACTIVE, model }]);
      await expect(
        createNeonWorkspaceRenameService().rename(request(plan, capture, apply)),
      ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });
    }
    expect(apply).not.toHaveBeenCalled();

    const windowsPlan = { ...fixture.plan, rootPath: "c:/ws-evil" };
    const windowsModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const windowsCapture = {
      ...captured(fixture, [{ path: ACTIVE, model: windowsModel }]),
      rootPath: "C:\\WS",
    };
    await expect(
      createNeonWorkspaceRenameService().rename(request(windowsPlan, windowsCapture, apply)),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects malformed spans, broadened active edits, path aliases, hashes, and non-file URIs", async () => {
    const fixture = await renameFixture();
    const apply: NeonWorkspaceEditApplier = vi.fn(async () => ({ kind: "accepted" }) as const);
    const activeEditIndex = fixture.plan.edits.findIndex(({ path }) => path === ACTIVE);
    const activeEdit = fixture.plan.edits[activeEditIndex];
    if (!activeEdit) throw new Error("Expected an active edit.");
    const malformedPlans: Array<Extract<NeonCrossFileRenamePlan, { kind: "ready" }>> = [
      {
        ...fixture.plan,
        edits: fixture.plan.edits.map((edit, index) =>
          index === activeEditIndex
            ? { ...edit, span: { ...edit.span, start: Number.NaN } }
            : edit,
        ),
      },
      {
        ...fixture.plan,
        edits: fixture.plan.edits.map((edit, index) =>
          index === activeEditIndex
            ? { ...edit, span: { end: activeEdit.span.end + 1, start: activeEdit.span.start - 1 } }
            : edit,
        ),
      },
    ];
    for (const plan of malformedPlans) {
      const model = new FakeOpenModel(fixture.sources[ACTIVE]);
      const capture = captured(fixture, [{ path: ACTIVE, model }]);
      await expect(
        createNeonWorkspaceRenameService().rename(request(plan, capture, apply)),
      ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });
    }

    const aliasedModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const aliasedCapture = {
      ...captured(fixture, [{ path: ACTIVE, model: aliasedModel }]),
      activePath: "/ws/config/../config/services.neon",
    };
    await expect(
      createNeonWorkspaceRenameService().rename(request(fixture.plan, aliasedCapture, apply)),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });

    const hashModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const invalidHashCapture = {
      ...captured(fixture, [{ path: ACTIVE, model: hashModel }]),
      closedFileHashes: { [uri(CLOSED)]: undefined },
    } as unknown as NeonWorkspaceRenameCapture;
    await expect(
      createNeonWorkspaceRenameService().rename(
        request(fixture.plan, invalidHashCapture, apply),
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });

    const uriModel = new FakeOpenModel(fixture.sources[ACTIVE]);
    const uriCapture = {
      ...captured(fixture, [{ path: ACTIVE, model: uriModel }]),
      activeUri: "https://example.test/services.neon",
      openDocuments: [
        {
          content: fixture.sources[ACTIVE],
          model: uriModel,
          path: ACTIVE,
          uri: "https://example.test/services.neon",
          versionId: 1,
        },
      ],
    };
    await expect(
      createNeonWorkspaceRenameService().rename({
        ...request(fixture.plan, uriCapture, apply),
        toFileUri: (path) => `https://example.test${path}`,
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("guards throwing and duplicate URI mappers and resolves each valid path once", async () => {
    const fixture = await renameFixture();
    const model = new FakeOpenModel(fixture.sources[ACTIVE]);
    const capture = captured(fixture, [{ path: ACTIVE, model }]);
    const apply: NeonWorkspaceEditApplier = vi.fn(async () => ({ kind: "accepted" }) as const);

    await expect(
      createNeonWorkspaceRenameService().rename({
        ...request(fixture.plan, capture, apply),
        toFileUri: () => {
          throw new Error("mapper failed");
        },
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });

    const duplicateCapture = {
      ...capture,
      activeUri: "file:///same",
      openDocuments: capture.openDocuments.map((document) => ({
        ...document,
        uri: "file:///same",
      })),
    };
    await expect(
      createNeonWorkspaceRenameService().rename({
        ...request(fixture.plan, duplicateCapture, apply),
        toFileUri: () => "file:///same",
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "invalidCapture" });
    expect(apply).not.toHaveBeenCalled();

    const calls = new Map<string, number>();
    const exactMapper = (path: string) => {
      calls.set(path, (calls.get(path) ?? 0) + 1);
      return uri(path);
    };
    const accept: NeonWorkspaceEditApplier = vi.fn(async (_edit, context) => {
      const staged = context.applyOpenModels?.();
      if (staged?.kind === "applied") staged.finalize?.();
      return { kind: "accepted" } as const;
    });
    await expect(
      createNeonWorkspaceRenameService().rename({
        ...request(fixture.plan, capture, accept),
        toFileUri: exactMapper,
      }),
    ).resolves.toEqual({ kind: "accepted" });
    expect([...calls.values()].every((count) => count === 1)).toBe(true);
  });
});

class FakeOpenModel implements TemplateWorkspaceRenameOpenModel {
  failNextReplace = false;
  failNextRead = false;
  private snapshot: TemplateWorkspaceRenameDocumentSnapshot;

  constructor(content: string) {
    this.snapshot = { content, versionId: 1 };
  }

  read(): TemplateWorkspaceRenameDocumentSnapshot {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error("read failed");
    }
    return { ...this.snapshot };
  }

  replace(
    expected: TemplateWorkspaceRenameDocumentSnapshot,
    content: string,
  ): TemplateWorkspaceRenameDocumentSnapshot | null {
    if (this.failNextReplace) {
      this.failNextReplace = false;
      return null;
    }
    if (
      expected.content !== this.snapshot.content ||
      expected.versionId !== this.snapshot.versionId
    ) {
      return null;
    }
    this.snapshot = { content, versionId: this.snapshot.versionId + 1 };
    return this.read();
  }

  userEdit(content: string): void {
    this.snapshot = { content, versionId: this.snapshot.versionId + 1 };
  }
}

describe("template workspace rename transaction", () => {
  it("turns a throwing finalize into a rejection and rolls back exact applied state", () => {
    const model = new ThrowingFinalizeModel("before");
    const commit = commitTemplateWorkspaceRenameOpenModels([
      {
        model,
        nextContent: "after",
        original: { content: "before", versionId: 1 },
        path: ACTIVE,
      },
    ]);

    expect(commit.kind).toBe("applied");
    expect(commit.kind === "applied" && commit.finalize?.()).toEqual({
      kind: "rejected",
      path: ACTIVE,
      reason: "invalidOpenModelEdits",
    });
    expect(model.read()).toEqual({ content: "before", versionId: 3 });
  });

  it("rejects a replace result that is not the model's exact live snapshot", () => {
    const model = new LyingReplaceModel("before");
    const commit = commitTemplateWorkspaceRenameOpenModels([
      {
        model,
        nextContent: "after",
        original: { content: "before", versionId: 1 },
        path: ACTIVE,
      },
    ]);

    expect(commit).toEqual({
      kind: "rejected",
      path: ACTIVE,
      reason: "invalidOpenModelEdits",
    });
    expect(model.read()).toEqual({ content: "before", versionId: 1 });
  });
});

class ThrowingFinalizeModel extends FakeOpenModel {
  finalize(): TemplateWorkspaceRenameDocumentSnapshot | null {
    throw new Error("finalize failed");
  }
}

class LyingReplaceModel implements TemplateWorkspaceRenameOpenModel {
  constructor(private readonly content: string) {}

  read(): TemplateWorkspaceRenameDocumentSnapshot {
    return { content: this.content, versionId: 1 };
  }

  replace(): TemplateWorkspaceRenameDocumentSnapshot {
    return { content: "after", versionId: 2 };
  }
}

async function renameFixture(): Promise<{
  plan: Extract<NeonCrossFileRenamePlan, { kind: "ready" }>;
  sources: Record<string, string>;
}> {
  const sources: Record<string, string> = {
    "/ws/config/config.neon": "includes:\n  - services\n  - wiring\n",
    [ACTIVE]: "services:\n  mailer: App\\Mailer\n",
    [CLOSED]: "services:\n  one: App\\One(@mailer)\n  two: App\\Two(@mailer)\n",
  };
  const snapshot = await snapshotNeonCrossFileRepository({
    activePath: ACTIVE,
    rootPath: ROOT,
    listNeonFiles: async () => Object.keys(sources),
    readFile: async (path) => sources[path] ?? null,
  });
  const plan = planNeonCrossFileSymbolRename(
    snapshot,
    sources[ACTIVE].indexOf("mailer") + 1,
    "primaryMailer",
  );
  if (plan.kind !== "ready") throw new Error(`Expected ready plan: ${plan.reason}`);
  return { plan, sources };
}

function captured(
  fixture: Awaited<ReturnType<typeof renameFixture>>,
  open: readonly { path: string; model: FakeOpenModel }[],
  state: { readonly current: boolean; readonly trusted: boolean } = {
    current: true,
    trusted: true,
  },
): NeonWorkspaceRenameCapture {
  const active = open.find(({ path }) => path === ACTIVE);
  if (!active) throw new Error("Active document must be open.");
  const activeSnapshot = active.model.read();
  return {
    activePath: ACTIVE,
    activeUri: uri(ACTIVE),
    activeVersionId: activeSnapshot.versionId,
    closedFileHashes: { [uri(CLOSED)]: "closed-hash" },
    generation: 3,
    isCurrent: () => state.current,
    isTrusted: () => state.trusted,
    openDocuments: open.map(({ model, path }) => {
      const snapshot = model.read();
      return {
        content: fixture.sources[path] ?? "",
        model,
        path,
        uri: uri(path),
        versionId: snapshot.versionId,
      };
    }),
    rootPath: ROOT,
    workspaceOwnerKey: "owner-1",
  };
}

function request(
  plan: Extract<NeonCrossFileRenamePlan, { kind: "ready" }>,
  capture: NeonWorkspaceRenameCapture,
  applyWorkspaceEdit: NeonWorkspaceRenameRequest["applyWorkspaceEdit"],
): NeonWorkspaceRenameRequest {
  return { applyWorkspaceEdit, capture, plan, toFileUri: uri };
}

function uri(path: string): string {
  return `file://${path}`;
}
