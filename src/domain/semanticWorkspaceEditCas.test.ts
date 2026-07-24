import { describe, expect, it } from "vitest";
import type { WorkspacePathKey } from "./workspacePath";
import {
  captureSemanticWorkspaceEditCasPreconditions,
  validateSemanticWorkspaceEditCasPreconditions,
  type SemanticEditOpenDocumentIdentity,
  type SemanticWorkspaceEditCasCapture,
} from "./semanticWorkspaceEditCas";

describe("semanticWorkspaceEditCas", () => {
  it("captures an immutable valid envelope and accepts an exact snapshot", () => {
    const capture = snapshot();
    const expected = captureSemanticWorkspaceEditCasPreconditions(capture);

    expect(expected).not.toBeNull();
    expect(Object.isFrozen(expected)).toBe(true);
    expect(Object.isFrozen(expected?.template)).toBe(true);
    expect(validateSemanticWorkspaceEditCasPreconditions(expected!, snapshot())).toEqual({
      kind: "current",
    });
  });

  it("rejects template source, version, session and lifecycle drift", () => {
    const expected = captureSemanticWorkspaceEditCasPreconditions(snapshot())!;

    for (const template of [
      { ...snapshot().template, contentHash: "sha256:template-b" },
      { ...snapshot().template, version: 8 },
      { ...snapshot().template, sessionId: 12 },
      { ...snapshot().template, lifecycle: 4 },
      { ...snapshot().template, hostEpoch: 18 },
    ]) {
      expect(
        validateSemanticWorkspaceEditCasPreconditions(expected, {
          ...snapshot(),
          template,
        }),
      ).toEqual({ kind: "stale", reason: "templateChanged" });
    }
  });

  it("rejects open-owner drift and an open/closed identity transition", () => {
    const openOwner: SemanticEditOpenDocumentIdentity = {
      contentHash: "sha256:owner-a",
      hostEpoch: 41,
      kind: "open",
      lifecycle: 2,
      pathKey: key("/ws/HomePresenter.php"),
      sessionId: 21,
      version: 5,
    };
    const open = snapshot({
      owner: openOwner,
    });
    const expected = captureSemanticWorkspaceEditCasPreconditions(open)!;

    expect(
      validateSemanticWorkspaceEditCasPreconditions(expected, {
        ...open,
        owner: { ...openOwner, version: 6 },
      }),
    ).toEqual({ kind: "stale", reason: "ownerChanged" });
    expect(
      validateSemanticWorkspaceEditCasPreconditions(expected, {
        ...open,
        owner: { ...openOwner, hostEpoch: 42 },
      }),
    ).toEqual({ kind: "stale", reason: "ownerChanged" });
    expect(validateSemanticWorkspaceEditCasPreconditions(expected, snapshot())).toEqual({
      kind: "stale",
      reason: "ownerChanged",
    });
  });

  it("rejects a changed closed-owner content hash", () => {
    const expected = captureSemanticWorkspaceEditCasPreconditions(snapshot())!;

    expect(
      validateSemanticWorkspaceEditCasPreconditions(expected, {
        ...snapshot(),
        owner: { ...snapshot().owner, contentHash: "sha256:owner-b" },
      }),
    ).toEqual({ kind: "stale", reason: "ownerChanged" });
  });

  it("rejects same-hash closed-owner replacement and A-B-A by revision", () => {
    const expected = captureSemanticWorkspaceEditCasPreconditions(snapshot())!;

    expect(
      validateSemanticWorkspaceEditCasPreconditions(expected, {
        ...snapshot(),
        owner: {
          contentHash: "sha256:owner-a",
          hostEpoch: 43,
          kind: "closed",
          pathKey: key("/ws/HomePresenter.php"),
          revision: 43,
        },
      }),
    ).toEqual({ kind: "stale", reason: "ownerChanged" });
  });

  it("rejects workspace A-B-A through monotonic owner, generation and session identity", () => {
    const expected = captureSemanticWorkspaceEditCasPreconditions(snapshot())!;

    for (const workspace of [
      { ...snapshot().workspace, ownerKey: "owner-b" },
      { ...snapshot().workspace, generation: 10 },
      { ...snapshot().workspace, sessionId: 32 },
    ]) {
      expect(
        validateSemanticWorkspaceEditCasPreconditions(expected, {
          ...snapshot(),
          workspace,
        }),
      ).toEqual({ kind: "stale", reason: "workspaceChanged" });
    }
  });

  it("fails closed for malformed identities and a self-targeting edit", () => {
    expect(
      captureSemanticWorkspaceEditCasPreconditions(
        snapshot({
          owner: {
            ...snapshot().owner,
            pathKey: snapshot().template.pathKey,
          },
        }),
      ),
    ).toBeNull();
    expect(
      captureSemanticWorkspaceEditCasPreconditions(
        snapshot({
          workspace: { ...snapshot().workspace, ownerKey: "bad\u0085owner" },
        }),
      ),
    ).toBeNull();
    expect(
      captureSemanticWorkspaceEditCasPreconditions(
        snapshot({
          workspace: { ...snapshot().workspace, ownerKey: "bad\u0000owner" },
        }),
      ),
    ).toBeNull();
    expect(
      validateSemanticWorkspaceEditCasPreconditions(
        captureSemanticWorkspaceEditCasPreconditions(snapshot())!,
        null as never,
      ),
    ).toEqual({ kind: "stale", reason: "invalidCapture" });
    const throwing = Object.defineProperty({}, "workspace", {
      get() {
        throw new Error("hostile");
      },
    }) as SemanticWorkspaceEditCasCapture;

    expect(captureSemanticWorkspaceEditCasPreconditions(throwing)).toBeNull();
    expect(
      validateSemanticWorkspaceEditCasPreconditions(
        captureSemanticWorkspaceEditCasPreconditions(snapshot())!,
        throwing,
      ),
    ).toEqual({ kind: "stale", reason: "invalidCapture" });

    let reads = 0;
    const changingTemplate = {
      ...snapshot().template,
      get pathKey() {
        reads += 1;
        return reads === 1 ? key("/ws/default.latte") : key("/ws/HomePresenter.php");
      },
    };

    expect(
      captureSemanticWorkspaceEditCasPreconditions({
        ...snapshot(),
        template: changingTemplate,
      }),
    ).toBeNull();
    expect(reads).toBe(0);
  });
});

function snapshot(
  overrides: Partial<SemanticWorkspaceEditCasCapture> = {},
): SemanticWorkspaceEditCasCapture {
  return {
    owner: {
      contentHash: "sha256:owner-a",
      hostEpoch: 41,
      kind: "closed",
      pathKey: key("/ws/HomePresenter.php"),
      revision: 41,
    },
    template: {
      contentHash: "sha256:template-a",
      hostEpoch: 17,
      kind: "open",
      lifecycle: 3,
      pathKey: key("/ws/default.latte"),
      sessionId: 11,
      version: 7,
    },
    workspace: {
      generation: 9,
      ownerKey: "owner-a",
      rootKey: "/ws",
      sessionId: 31,
    },
    ...overrides,
  };
}

function key(value: string): WorkspacePathKey {
  return value as WorkspacePathKey;
}
