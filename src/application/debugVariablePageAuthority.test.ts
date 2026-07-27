import { describe, expect, it } from "vitest";
import {
  debugVariablePageCanLoad,
  debugVariablePagePublicationIsCurrent,
  debugVariablePageRequestKey,
  flattenNamedDebugVariables,
} from "./debugVariablePageAuthority";

const owner = {
  rootKey: "/workspace/a",
  workspaceId: "owner-a",
  workspaceEpoch: 2,
  sessionId: 4,
  pauseGeneration: 3,
  frameId: 11,
} as const;

describe("debug variable page authority", () => {
  it("keys flights by exact workspace generation and filter", () => {
    expect(debugVariablePageRequestKey(owner, 21, "named", 0)).not.toBe(
      debugVariablePageRequestKey({ ...owner, workspaceEpoch: 4 }, 21, "named", 0),
    );
    expect(debugVariablePageRequestKey(owner, 21, "named", 0)).not.toBe(
      debugVariablePageRequestKey(owner, 21, "indexed", 0),
    );
  });

  it("rejects A to B to A publications from an older A generation", () => {
    expect(
      debugVariablePagePublicationIsCurrent({
        owner,
        workspaceId: "owner-a",
        workspaceEpoch: 4,
        currentRootKey: "/workspace/a",
        stoppedSessionId: 4,
        pauseGeneration: 3,
        selectedFrameId: 11,
      }),
    ).toBe(false);
  });

  it("normalizes legacy owners to the initial null workspace generation", () => {
    const legacyOwner = {
      rootKey: "/workspace/a",
      sessionId: 4,
      pauseGeneration: 3,
      frameId: 11,
    };
    expect(
      debugVariablePagePublicationIsCurrent({
        owner: legacyOwner,
        workspaceId: null,
        workspaceEpoch: 0,
        currentRootKey: "/workspace/a",
        stoppedSessionId: 4,
        pauseGeneration: 3,
        selectedFrameId: 11,
      }),
    ).toBe(true);
    expect(
      debugVariablePagePublicationIsCurrent({
        owner: legacyOwner,
        workspaceId: "owner-b",
        workspaceEpoch: 1,
        currentRootKey: "/workspace/a",
        stoppedSessionId: 4,
        pauseGeneration: 3,
        selectedFrameId: 11,
      }),
    ).toBe(false);
  });

  it("permits random indexed pages but only progressive named pages", () => {
    const ready = { kind: "ready", variables: [], nextStart: 100 } as const;
    expect(debugVariablePageCanLoad(ready, "indexed", 4_900)).toBe(true);
    expect(debugVariablePageCanLoad(ready, "named", 4_900)).toBe(false);
    expect(debugVariablePageCanLoad(ready, "named", 100)).toBe(true);
  });

  it("materializes only the requested named legacy reference", () => {
    let reads = 0;
    const namedPage = {
      start: 0,
      filter: "named" as const,
      get variables() {
        reads += 1;
        return [{ name: "named", value: "1", variablesReference: 0 }];
      },
      nextStart: null,
    };
    const projected = flattenNamedDebugVariables({
      20: {
        pages: {
          0: namedPage,
          "indexed:0": {
            start: 0,
            filter: "indexed",
            variables: [{ name: "0", value: "2", variablesReference: 0 }],
            nextStart: null,
          },
        },
        pending: {},
        errors: {},
        limit: null,
      },
    });

    expect(reads).toBe(0);
    expect(projected[99]).toBeUndefined();
    expect(reads).toBe(0);
    expect(projected[20]?.map((variable) => variable.name)).toEqual(["named"]);
    expect(reads).toBe(1);
    expect(projected[20]?.[0]?.value).toBe("1");
    expect(reads).toBe(1);
  });
});
